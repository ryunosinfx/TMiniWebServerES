/** @module modules/imgroom/bulk_dl.js @version 0.1.0 @see docs/img_room_spec.md */
// 部屋の ZIP 一括ダウンロード（仕様 §9.10 / 契約 bulk_dl 節）
// 対象は collection.roomItems()（現部屋 manifest・ゴミ箱除く）。本体は store.get(h10) で都度取得し、
// ZIP_CHUNK_MB 毎に ZipBuilder を新建して分割する（ArrayBuffer を単一積層しない、§13）。
// Blob のダウンロード（<a download>）は呼び出し側の責務。ここでは onPart で blob を渡すだけ。
import { ZipBuilder } from '../zip.js';
import { CFG } from './ir_const.js';
import { Y, ef } from '../../Y.js';

// 拡張子が無い時に meta.t（MIME）から補う小マップ（§9.10）
const EXT = {
	'image/jpeg': 'jpg',
	'image/jpg': 'jpg',
	'image/png': 'png',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'image/bmp': 'bmp',
	'image/avif': 'avif',
	'image/svg+xml': 'svg',
	'image/tiff': 'tiff',
	'image/heif': 'heif',
	'image/heic': 'heic',
};
// 禁止文字 <>:"|?* とパス区切り / \ と制御文字は _（名前は UTF-8 で保存する。bit11/0x7075 は zip.js 側、§9.10）
const BAD = /[\x00-\x1f\x7f<>:"|?*\\/]+/g;
// Windows 予約名（拡張子込みで判定）
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export class BulkDL {
	constructor({ collection, store, ridNameB64U, cfg } = {}) {
		this.collection = collection;
		this.store = store;
		this.cfg = { ...CFG, ...(cfg || {}) };
		// ZIP ファイル名の部屋名成分（b64url なので通常そのまま。念のため同じ規則で清掃）
		this.ridName = ((ridNameB64U || 'room') + '').replace(BAD, '_').slice(0, 128) || 'room';
		this.t0 = 0; // DL 開始時刻（§9.10 の yyyyMMddhhmmss）
		this.used = new Set(); // エントリ名の重複除去用（小文字比較）
	}

	// 現部屋の全画像を ZIP 分割 + 順次ダウンロード。
	// run(onPart) -> Promise<{files:[{name,blob}], count, skipped}>
	async run(onPart) {
		this.t0 = Date.now();
		this.used = new Set();
		const limit = Math.max(1, (this.cfg.ZIP_CHUNK_MB || CFG.ZIP_CHUNK_MB || 10) * 1024 * 1024);
		let files, count, skipped, totalEstimate;
		try {
			// 選別: ゴミ箱は数えない。h10 欠落は skipped（本体有無はループ内で has() 判定）
			const items = (await this.collection.roomItems()) || [];
			const cand = [];
			skipped = 0;
			for (const it of items) {
				if (!it || it.trashed) continue;
				const h10 = it.h10 || (it.meta && it.meta.h);
				if (!h10) {
					skipped++;
					continue;
				}
				// meta は roomItems 実装が持つ前提。無ければ HashStore.metaGet（並び順の ts にも必要）
				cand.push({ h10, meta: it.meta || (typeof this.store.metaGet === 'function' ? await this.store.metaGet(h10) : null) });
			}
			// 並び順: 投稿時刻 ts 降順（roomItems 未ソートでも §5.5 と同じ順。同値は h10 で決定化する）
			cand.sort((a, b) => this.tsOf(b.meta) - this.tsOf(a.meta) || (a.h10 < b.h10 ? -1 : 1));
			// 見積り総パーティ数（§9.10 の分割規則を meta.l でシミュレート。has() 除外で実数より多めに出得る）
			let te = 0,
				sa = 0,
				sh = 0;
			for (const c of cand) {
				const s = this.sizeOf(c.meta);
				if (sh && sa + s > limit) {
					te++;
					sa = 0;
					sh = 0;
				}
				sa += s;
				sh++;
			}
			if (sh) te++;
			totalEstimate = te;

			let zb = new ZipBuilder();
			let held = 0,
				acc = 0,
				part = 0;
			count = 0;
			files = [];
			const flush = async () => {
				if (!held) return;
				const blob = await zb.build();
				part++;
				files.push({ name: this.zipName(part), blob });
				zb = new ZipBuilder();
				held = 0;
				acc = 0;
				if (onPart) await onPart({ name: this.zipName(part), blob }, totalEstimate);
			};
			for (const c of cand) {
				// meta は roomItems 実装が持つ前提。無ければ HashStore.metaGet（未実装なら null 扱い）
				const meta = c.meta || (this.store && typeof this.store.metaGet === 'function' ? await this.store.metaGet(c.h10) : null);
				// 本体取得可否（未取得 = skipped、§9.10 の取得不能除外）
				if (!(await this.hasBody(c.h10))) {
					skipped++;
					continue;
				}
				let ab = null;
				try {
					ab = await this.store.get(c.h10);
				} catch (e) {
					ef(e, 'bulkdl.get ' + c.h10);
				}
				if (!ab || !ab.byteLength) {
					skipped++;
					continue;
				}
				const size = ab.byteLength;
				// 累計元サイズが上限超過 → 新 ZIP。単一画像が上限超でも分割せず 1 エントリ（§9.10）
				if (held && acc + size > limit) await flush();
				zb.add(this.uni(this.entryName(meta, c.h10), c.h10), ab);
				held++;
				acc += size;
				count++;
				ab = null; // 本体参照を放して逐次 ZIP の parts に委ねる（§13）
			}
			await flush();
		} catch (e) {
			ef(e, 'bulkdl.run'); // ログしてから呼び出し側へ伝搬（暗黙の握りつぶし禁止）
			throw e;
		}
		return { files, count, skipped };
	}

	// 本体の有無（HashStore.has 相当。has 未実装なら get() の null で判定するため true を返す）
	async hasBody(h10) {
		if (this.store && typeof this.store.has === 'function') {
			try {
				return !!(await this.store.has(h10));
			} catch (e) {
				ef(e, 'bulkdl.has ' + h10);
				return false;
			}
		}
		return true;
	}

	// 見積り用の元サイズ（meta.l。不明時は共有上限を仮定）
	// 投稿時刻（並び順と見積り用。meta 欠損は 0）
	tsOf(meta) {
		return (meta && meta.ts) || 0;
	}
	sizeOf(meta) {
		const l = meta && meta.l;
		return Number.isFinite(l) && l > 0 ? l : this.cfg.MAX_IMG_BYTES || CFG.MAX_IMG_BYTES;
	}

	// ZIP ファイル名: <部屋名 b64url>-<yyyyMMddhhmmss（ローカル）>-<連番 3桁 1 始まり>.zip（§9.10）
	zipName(part) {
		const d = new Date(this.t0),
			p = n => String(n).padStart(2, '0');
		const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
		return `${this.ridName}-${ts}-${String(part).padStart(3, '0')}.zip`;
	}

	// ZIP 内エントリ名 = meta.n（b64url → Y.U2u → UTF-8）の実ファイル名（§9.10）
	entryName(meta, h10) {
		let n = '';
		const raw = meta && meta.n;
		if (raw) {
			try {
				n = Y.u2s(Y.U2u(raw));
			} catch (e) {
				ef(e, 'bulkdl.name ' + h10);
			}
		}
		// パス区切り（/ \）は.flat 構造を保つため最後の要素だけ採用（ZIP 名の区切りは常に /）
		n = (n || '').split(/[\\/]+/).filter(s => s).pop() || '';
		n = n.replace(BAD, '_').trim().replace(/[. ]+$/, '');
		if (!n) n = h10 || 'image';
		if (RESERVED.test(n)) n = '_' + n;
		// 拡張子が無ければ MIME から補う（image/jpeg → .jpg 等。不明 MIME は無拡張のまま）
		if (!/\.[A-Za-z0-9]{1,11}$/.test(n)) {
			const e = EXT[((meta && meta.t) || '').toLowerCase()];
			if (e) n += '.' + e;
		}
		// 名前長対策（展開側のパス長制限。120 超過は拡張子を残して切り詰め）
		if (n.length > 120) {
			const dot = n.lastIndexOf('.'),
				ext = dot > 0 ? n.slice(dot) : '';
			n = n.slice(0, 100) + ext;
		}
		return n;
	}

	// 同名衝突は `_<h10先頭8>` サフィックスで重複除去（仕様 §9.10。それも衝突済みの場合のみ (2) 連番を追加）
	uni(n, h10 = '') {
		if (!this.used.has(n.toLowerCase())) {
			this.used.add(n.toLowerCase());
			return n;
		}
		const dot = n.lastIndexOf('.'),
			i = dot > 0 ? dot : n.length,
			b = n.slice(0, i),
			e = n.slice(i);
		let u = `${b}_${(h10 || 'dup').slice(0, 8)}${e}`;
		if (this.used.has(u.toLowerCase())) {
			let c = 2;
			while (this.used.has(u.toLowerCase())) u = `${b}_${(h10 || 'dup').slice(0, 8)} (${c++})${e}`;
		}
		this.used.add(u.toLowerCase());
		return u;
	}
}
