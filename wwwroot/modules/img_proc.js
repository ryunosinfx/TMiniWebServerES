/**
 * @module img_proc
 * 画像処理ユーティリティ（契約: docs/impl_contracts.md §img_proc.js / 仕様 §5.4・§9.2）。
 * ImgProc: load/thumb/collage/slice/ab2blob/blob2ab（静的メソッド）。
 * SliceCache: スライス表示用の objectURL キャッシュ（set/get/release/releaseAll）。
 * canvas 描画 → canvas.toBlob('image/jpeg', q) で JPEG 化。スレッド外ではなく main で動作。
 */
import { Y } from '../Y.js'; // CSP 対応: サーバーヘッダ img-src は 'self' data: のため objectURL(blob:) でなく data: URL を使う（ws_chat2 と同方式）

export class ImgProc {
	/**
	 * Blob/ImageBitmap or HTMLImageElement にデコード。
	 * createImageBitmap 優先、失敗時は Image + objectURL にフォールバック。
	 * @param {Blob} blob
	 * @returns {Promise<ImageBitmap|HTMLImageElement>}
	 */
	static async load(blob) {
		try {
			return await createImageBitmap(blob);
		} catch (e) {
			return await new Promise((res, rej) => {
				const url = URL.createObjectURL(blob);
				const img = new Image();
				img.onload = () => { URL.revokeObjectURL(url); res(img); };
				img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('ImgProc.load: decode failed')); };
				img.src = url;
			});
		}
	}

	/** ImageBitmap / HTMLImageElement の実寸 [w,h] を返す（プライベート的ヘルプ）。 */
	static _size(src) {
		return [src.naturalWidth || src.width, src.naturalHeight || src.height];
	}

	/** 白背景の canvas を作る（JPEG 化時に透明が黒にならないため既定で白塗り）。 */
	static _canvas(w, h) {
		const c = document.createElement('canvas');
		c.width = w; c.height = h;
		const ctx = c.getContext('2d');
		ctx.fillStyle = '#fff';
		ctx.fillRect(0, 0, w, h);
		return { c, ctx };
	}

	/** canvas.toBlob の Promise 化。失敗は reject。 */
	static _toBlob(canvas, type, q) {
		return new Promise((res, rej) => {
			canvas.toBlob(b => (b ? res(b) : rej(new Error('ImgProc: toBlob failed'))), type, q);
		});
	}

	/**
	 * 正方形 contain — 画像全体が収まるよう縮小（または拡大）し、白地中央配置で px×px の JPEG に。
	 * v1.6 §20: center-crop 廃止。小さい画像は長辺が px になるまで拡大する（交換基準 128 を想定）。
	 * @param {Blob} blob
	 * @param {number} px 一辺ピクセル
	 * @returns {Promise<Blob>} image/jpeg
	 */
	static async thumb(blob, px) {
		const src = await ImgProc.load(blob);
		const [w, h] = ImgProc._size(src);
		const s = px / Math.max(w, h, 1); // 長辺を px へ（小画像は拡大含め等倍>1 許）
		const dw = Math.max(1, Math.round(w * s)),
			dh = Math.max(1, Math.round(h * s));
		const { c, ctx } = ImgProc._canvas(px, px);
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(src, (px - dw) / 2, (px - dh) / 2, dw, dh); // 短辺側は白レターボックス
		const out = await ImgProc._toBlob(c, 'image/jpeg', 0.8);
		src.close && src.close(); // ImageBitmap は明示解放（Image 要素には無い）
		return out;
	}

	/**
	 * cols×rows のセル（各 px×px）を一枚の JPEG シートに合成。
	 * cellBlobs は row-major（r*cols+c）。空スロット（null/undefined）は白のまま。
	 * @param {(Blob|null)[]} cellBlobs
	 * @param {number} cols @param {number} rows @param {number} px 各セル一辺 @param {number} q JPEG 品質
	 * @returns {Promise<Blob>} image/jpeg
	 */
	static async collage(cellBlobs, cols, rows, px, q) {
		const { c, ctx } = ImgProc._canvas(cols * px, rows * px);
		ctx.imageSmoothingQuality = 'high';
		for (let r = 0; r < rows; r++) {
			for (let col = 0; col < cols; col++) {
				const blob = cellBlobs[r * cols + col];
				if (!blob) continue; // 空スロットは白
				const src = await ImgProc.load(blob);
				const [w, h] = ImgProc._size(src);
				const s = Math.min(w, h);
				ctx.drawImage(src, (w - s) / 2, (h - s) / 2, s, s, col * px, r * px, px, px);
				src.close && src.close();
			}
		}
		return await ImgProc._toBlob(c, 'image/jpeg', q);
	}

	/**
	 * シート Blob を cols×rows の px×px セルに切り出し。
	 * 出力順は collage と同じ row-major（r*cols+c）。
	 * @param {Blob} sheetBlob @param {number} cols @param {number} rows @param {number} px @param {number} q
	 * @returns {Promise<Blob[]>} image/jpeg の配列
	 */
	static async slice(sheetBlob, cols, rows, px, q) {
		const src = await ImgProc.load(sheetBlob);
		const out = [];
		for (let r = 0; r < rows; r++) {
			for (let col = 0; col < cols; col++) {
				const { c, ctx } = ImgProc._canvas(px, px);
				ctx.drawImage(src, col * px, r * px, px, px, 0, 0, px, px);
				out.push(await ImgProc._toBlob(c, 'image/jpeg', q));
			}
		}
		src.close && src.close();
		return out;
	}

	/** ArrayBuffer → Blob（mime 既定 application/octet-stream）。 */
	static ab2blob(ab, mime) {
		return new Blob([ab], { type: mime || 'application/octet-stream' });
	}

	/** Blob → ArrayBuffer。 */
	static async blob2ab(blob) {
		return await blob.arrayBuffer();
	}

	/**
	 * 大きな画像投入ポリシー（仕様 §17 v1.4）: デコード前にヘッダだけ読んで寸法を推定する。
	 * 推定不可の形式は null（→ 実デコードテストで可否を判定）。
	 * @param {Uint8Array} u8 ファイル先頭（~64KB で十分）
	 * @param {string} mime
	 * @returns {{w:number,h:number}|null}
	 */
	static sniffDims(u8, mime = '') {
		const dv = (o, little) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
		const u16 = (o, le = true) => dv().getUint16(o, le);
		const u32 = (o, le = true) => dv().getUint32(o, le);
		const tag = (o, n) => String.fromCharCode(...u8.subarray(o, o + n));
		try {
			if (tag(0, 8) === '\x89PNG\r\n\x1a\n' && tag(12, 4) === 'IHDR') return { w: u32(16, false), h: u32(20, false) };
			if (tag(0, 3) === 'GIF') return { w: u16(6), h: u16(8) };
			if (tag(0, 2) === 'BM') return { w: u32(18), h: Math.abs(u32(22)) };
			if (tag(0, 4) === 'RIFF' && tag(8, 4) === 'WEBP') {
				const c = tag(12, 4);
				if (c === 'VP8X' && u8.length >= 29) { // 拡張: 24bit LE (w-1,h-1) @23/@26
					return { w: (u8[23] | (u8[24] << 8) | (u8[25] << 16)) + 1, h: (u8[26] | (u8[27] << 8) | (u8[28] << 16)) + 1 };
				}
				if (c === 'VP8 ') { // ロスリー: キーフレーム sync 9D 01 2A の直後 16bit×2（14bit 有効）
					for (let o = 20, e = Math.min(u8.length - 7, 20 + 64); o < e; o++) {
						if (u8[o] === 0x9d && u8[o + 1] === 0x01 && u8[o + 2] === 0x2a) {
							return { w: u16(o + 3) & 0x3fff, h: u16(o + 5) & 0x3fff };
						}
					}
				}
				return null; // VP8L はビットパックのため推定しない
			}
			if ((mime === 'image/jpeg' || u8[0] === 0xff && u8[1] === 0xd8) && tag(0, 2) === '\xff\xd8') {
				// JPEG: SOF0..C3/C5..C7/C9..CB/CD..CF マーカをスキャン（64KB 上限）
				let o = 2;
				const n = Math.min(u8.length - 9, 65536);
				while (o < n) {
					if (u8[o] !== 0xff) { o++; continue; }
					while (o < n && u8[o] === 0xff) o++;
					const m = u8[o++];
					if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) {
						return { h: u16(o + 1, false), w: u16(o + 3, false) };
					}
					if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) continue; // 長さ無しマーカー
					o += 2 + u16(o, false); // セグメント長スキップ
				}
			}
			if (tag(4, 4) === 'ftyp') { // AVIF/HEIF: ispe ボックスを探す（w/h be32）
				for (let o = 0, e = Math.min(u8.length - 16, 65536); o < e; o++) {
					if (tag(o, 4) === 'ispe') return { w: u32(o + 8, false), h: u32(o + 12, false) };
				}
			}
		} catch (e) { /* ヘッダ異常は null 扱い */ }
		return null;
	}

	/**
	 * JPEG 再圧縮+縮小（§17: 上限超画像の変換共有用）。デコード失敗（非対応実体）は null。
	 * @param {Blob} blob 元画像
	 * @param {number} maxDim 長辺上限 px
	 * @param {number} q JPEG 品質
	 * @returns {Promise<{blob:Blob,w:number,h:number,fromW:number,fromH:number}|null>}
	 */
	static async shrink(blob, maxDim = 4096, q = 0.82) {
		let src;
		try {
			src = await ImgProc.load(blob);
		} catch (e) {
			return null; // デコード不可 = ブラウザ実質非対応
		}
		try {
			const [w0, h0] = ImgProc._size(src);
			if (!w0 || !h0) return null;
			const s = Math.min(1, maxDim / Math.max(w0, h0));
			const { c, ctx } = ImgProc._canvas(Math.max(1, Math.round(w0 * s)), Math.max(1, Math.round(h0 * s)));
			ctx.imageSmoothingQuality = 'high';
			ctx.drawImage(src, 0, 0, c.width, c.height);
			const out = await ImgProc._toBlob(c, 'image/jpeg', q);
			return { blob: out, w: c.width, h: c.height, fromW: w0, fromH: h0 };
		} finally {
			src.close && src.close();
		}
	}
}

/**
 * SliceCache: スライス（collage/slice 出力）の objectURL を key で保持し、
 * <img src> 等で再利用する。release/releaseAll で必ず revoke すること。
 */
export class SliceCache {
	constructor(max = 0) {
		this.urls = new Map(); // key -> objectURL/base64 URL
		this.max = max > 0 ? max : 64; // 上限超過は LRU 放出（サーバーモード低メモリ化 v1.3）
	}

	/** 既存の同じ key があれば revoke してから set。生成した objectURL を返す。 */
	async set(key, blob) {
		this.release(key);
		const ab = await blob.arrayBuffer(),
			url = `data:${blob.type || 'image/jpeg'};base64,${Y.a2B(ab)}`; // CSP: img-src 'self' data:（サーバー既定ヘッダ）に適合
		this.urls.set(key, url);
		while (this.urls.size > this.max) {
			const old = this.urls.keys().next().value; // 挿入順最古=LRU（get で touch）
			if (old === undefined) break;
			this.release(old);
		}
		return url;
	}

	/** 保持 URL を返す（無ければ null。hit は最新へ touch=LRU）。 */
	get(key) {
		const u = this.urls.get(key);
		if (u === undefined) return null;
		this.urls.delete(key);
		this.urls.set(key, u);
		return u;
	}

	/** key の URL を revoke して削除（無ければ何もしない）。 */
	release(key) {
		const url = this.urls.get(key);
		if (url) {
			if (url.startsWith('blob:')) URL.revokeObjectURL(url);
			this.urls.delete(key);
		}
	}

	/** 全 URL を revoke して空にする。 */
	releaseAll() {
		for (const url of this.urls.values()) if (url.startsWith('blob:')) URL.revokeObjectURL(url);
		this.urls.clear();
	}
}
