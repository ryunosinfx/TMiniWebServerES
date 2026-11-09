/**
 * @module zip.js — ZIP 書き出し（DEFLATE⇄STORE 自動選択）
 * 契約: docs/impl_contracts.md / 仕様 §9.10・§14（zip.js）
 *  - CompressionStream('deflate-raw') を 1 回だけ試行して可否をキャッシュ
 *  - エントリ毎に DEFLATE(method 8) ⇄ STORE(method 0) の小さい方を選択
 *  - ローカルヘッダ / セントラルディレクトリ / EOCD は自前組み立て
 *  - CRC-32 はテーブル自前（ crc32(u8) を export ）
 *  - 名前は UTF-8 格納 + 汎用フラグ bit11 + Info-ZIP Unicode Path extra field(0x7075)
 *  - タイムスタンプは DOS 形式（生成時の現在時刻）
 *  - ZIP64 は不使用（32bit フィールド）
 *  - 最終結合は Blob.parts（単一 ArrayBuffer を積層しない → 10MB 分割の_bulk_dl 前提）
 * 注: 本ファイルはブラウザ用。Node では CompressionStream が無いため STORE にフォールバックする。
 */

/* ---------- CRC-32（IEEE  polynomial 0xEDB88320、テーブル自前） ---------- */

const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
		t[n] = c >>> 0;
	}
	return t;
})();

/**
 * CRC-32（ZIP と同一の定義: 初期値 0xFFFFFFFF、最終 XOR 0xFFFFFFFF）
 * @param {Uint8Array|ArrayBuffer} u8
 * @returns {number} 0..0xFFFFFFFF
 */
export function crc32(u8) {
	const b = (u8 instanceof Uint8Array) ? u8 : new Uint8Array(u8);
	let c = 0xffffffff;
	for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

/* ---------- deflate-raw 可否 probe（1 回試行して結果をキャッシュ） ---------- */

let deflateProbe = undefined; // true: 使用可 / false: 不使用(STORE 固定) / undefined: 未 probe

/** CompressionStream('deflate-raw') が実際に使えるかを 1 回だけ試す。 */
async function probeDeflateRaw() {
	if (deflateProbe !== undefined) return deflateProbe;
	deflateProbe = false;
	try {
		if (typeof CompressionStream !== 'function') return deflateProbe;
		const src = new TextEncoder().encode('deflate-raw-probe');
		const cs = new CompressionStream('deflate-raw');
		const writer = cs.writable.getWriter();
		writer.write(src);
		writer.close();
		const ab = await new Response(cs.readable).arrayBuffer();
		// 伸長できて元データと一致すれば OK（round-trip 検証）
		const ds = new DecompressionStream('deflate-raw');
		const dw = ds.writable.getWriter();
		dw.write(new Uint8Array(ab));
		dw.close();
		const back = await new Response(ds.readable).arrayBuffer();
		deflateProbe = new TextDecoder().decode(back) === 'deflate-raw-probe';
	} catch (e) {
		deflateProbe = false; // 非対応 / 失敗 → STORE
	}
	return deflateProbe;
}

/** deflate-raw 圧縮（CompressionStream 使用可の呼び出しのみ）。 */
async function deflateRawBytes(u8) {
	const cs = new CompressionStream('deflate-raw');
	const writer = cs.writable.getWriter();
	writer.write(u8);
	writer.close();
	const ab = await new Response(cs.readable).arrayBuffer();
	return new Uint8Array(ab);
}

/* ---------- 入力の正規化（Blob | ArrayBuffer | string → Uint8Array） ---------- */

async function toBytes(data) {
	if (typeof data === 'string') return new TextEncoder().encode(data);
	if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
	if (data instanceof ArrayBuffer) return new Uint8Array(data);
	if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	throw new Error('ZipBuilder.add: unsupported data type');
}

/* ---------- DOS 形式タイムスタンプ（現在時刻） ---------- */

function dosDateTime(d = new Date()) {
	const y = Math.max(1980, d.getFullYear());
	return {
		time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff,
		date: (((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff
	};
}

/* ---------- little-endian ヘルプ（ヘッダ組み立て） ---------- */

const ENC = new TextEncoder();

function u16(v) { return new Uint8Array([v & 0xff, (v >>> 8) & 0xff]); }
function u32(v) { return new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]); }

/** 0x7075 Info-ZIP Unicode Path extra field（version 1 + 名前 CRC-32 + UTF-8 名） */
function unicodePathExtra(nameBytes) {
	const dataLen = 5 + nameBytes.length; // ver(1) + crc32(4) + name
	const out = new Uint8Array(4 + dataLen);
	out.set(u16(0x7075), 0);
	out.set(u16(dataLen), 2);
	out[4] = 1; // extra field version
	out.set(u32(crc32(nameBytes)), 5);
	out.set(nameBytes, 9);
	return out;
}

/* ---------- ZipBuilder ---------- */

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const FLAG_UTF8 = 0x0800; // 汎用フラグビット 11（EFS: 名前が UTF-8）
const VER_NEED = 20;      // version needed to extract (2.0)
const VER_MADE = 20;      // version made by

export class ZipBuilder {
	constructor() {
		this.entries = []; // { name, data }
		this.dosTime = null;
	}

	/**
	 * エントリ追加（圧縮方式の決定と実際の展開は build() で行う）。
	 * @param {string} name UTF-8 の相対パス（'/' 区切り。先頭 '/' は除去）
	 * @param {Blob|ArrayBuffer|string} data
	 */
	add(name, data) {
		if (typeof name !== 'string' || name.length === 0) throw new Error('ZipBuilder.add: empty name');
		const clean = name.replace(/\\/g, '/').replace(/^\/+/, '');
		if (clean.length === 0) throw new Error('ZipBuilder.add: invalid name');
		this.entries.push({ name: clean, data });
		return this;
	}

	get size() { return this.entries.length; }

	/**
	 * ZIP を生成。エントリ毎に DEFLATE ⇄ STORE の小さい方を選ぶ。
	 * @returns {Promise<Blob>} ZIP Blob（parts 結合、総サイズを単一 ArrayBuffer に積層しない）
	 */
	async build() {
		const canDeflate = await probeDeflateRaw();
		const dt = dosDateTime();
		const local = [];   // ローカルヘッダ + 圧縮データ
		const central = []; // セントラルディレクトリ
		let offset = 0;
		let count = 0;

		for (const e of this.entries) {
			const nameBytes = ENC.encode(e.name);
			const extra = unicodePathExtra(nameBytes);
			const raw = await toBytes(e.data);
			const crc = crc32(raw);

			// DEFLATE ⇄ STORE: 圧縮できる環境のみ試行し、小さい方 adopted
			let method = 0;
			let comp = raw;
			if (canDeflate) {
				try {
					const d = await deflateRawBytes(raw);
					if (d.length < raw.length) { method = 8; comp = d; }
				} catch (err) { /* 圧縮失敗 → STORE を維持 */ }
			}

			// ---- Local file header (30 + name + extra) ----
			const lh = new Uint8Array(30 + nameBytes.length + extra.length);
			let p = 0;
			lh.set(u32(SIG_LOCAL), p); p += 4;
			lh.set(u16(VER_NEED), p); p += 2;
			lh.set(u16(FLAG_UTF8), p); p += 2;
			lh.set(u16(method), p); p += 2;
			lh.set(u16(dt.time), p); p += 2;
			lh.set(u16(dt.date), p); p += 2;
			lh.set(u32(crc), p); p += 4;
			lh.set(u32(comp.length), p); p += 4;
			lh.set(u32(raw.length), p); p += 4;
			lh.set(u16(nameBytes.length), p); p += 2;
			lh.set(u16(extra.length), p); p += 2;
			lh.set(nameBytes, p); p += nameBytes.length;
			lh.set(extra, p); p += extra.length;

			const entryOffset = offset;
			local.push(lh, comp);
			offset += lh.length + comp.length;

			// ---- Central directory header (46 + name + extra) ----
			const ch = new Uint8Array(46 + nameBytes.length + extra.length);
			p = 0;
			ch.set(u32(SIG_CENTRAL), p); p += 4;
			ch.set(u16(VER_MADE), p); p += 2;
			ch.set(u16(VER_NEED), p); p += 2;
			ch.set(u16(FLAG_UTF8), p); p += 2;
			ch.set(u16(method), p); p += 2;
			ch.set(u16(dt.time), p); p += 2;
			ch.set(u16(dt.date), p); p += 2;
			ch.set(u32(crc), p); p += 4;
			ch.set(u32(comp.length), p); p += 4;
			ch.set(u32(raw.length), p); p += 4;
			ch.set(u16(nameBytes.length), p); p += 2;
			ch.set(u16(extra.length), p); p += 2;
			ch.set(u16(0), p); p += 2;            // comment length
			ch.set(u16(0), p); p += 2;            // disk number start
			ch.set(u16(0), p); p += 2;            // internal attributes
			ch.set(u32(0), p); p += 4;            // external attributes
			ch.set(u32(entryOffset), p); p += 4;  // local header offset
			ch.set(nameBytes, p); p += nameBytes.length;
			ch.set(extra, p); p += extra.length;

			central.push(ch);
			count++;
		}

		// ---- End of central directory record (22, comment なし) ----
		const centralSize = central.reduce((a, b) => a + b.length, 0);
		const eocd = new Uint8Array(22);
		let q = 0;
		eocd.set(u32(SIG_EOCD), q); q += 4;
		eocd.set(u16(0), q); q += 2;         // this disk
		eocd.set(u16(0), q); q += 2;         // disk with CD
		eocd.set(u16(count), q); q += 2;     // entries on this disk
		eocd.set(u16(count), q); q += 2;     // total entries
		eocd.set(u32(centralSize), q); q += 4;
		eocd.set(u32(offset), q); q += 4;    // CD offset
		eocd.set(u16(0), q); q += 2;         // comment length

		return new Blob([...local, ...central, eocd]);
	}
}
