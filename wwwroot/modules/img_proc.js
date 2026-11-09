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
	 * 正方形 center-crop → px×px の JPEG。
	 * @param {Blob} blob
	 * @param {number} px 一辺ピクセル
	 * @returns {Promise<Blob>} image/jpeg
	 */
	static async thumb(blob, px) {
		const src = await ImgProc.load(blob);
		const [w, h] = ImgProc._size(src);
		const s = Math.min(w, h);
		const { c, ctx } = ImgProc._canvas(px, px);
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(src, (w - s) / 2, (h - s) / 2, s, s, 0, 0, px, px);
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
}

/**
 * SliceCache: スライス（collage/slice 出力）の objectURL を key で保持し、
 * <img src> 等で再利用する。release/releaseAll で必ず revoke すること。
 */
export class SliceCache {
	constructor() {
		this.urls = new Map(); // key -> objectURL
	}

	/** 既存の同じ key があれば revoke してから set。生成した objectURL を返す。 */
	async set(key, blob) {
		this.release(key);
		const ab = await blob.arrayBuffer(),
			url = `data:${blob.type || 'image/jpeg'};base64,${Y.a2B(ab)}`; // CSP: img-src 'self' data:（サーバー既定ヘッダ）に適合
		this.urls.set(key, url);
		return url;
	}

	/** 保持 URL を返す（無ければ null）。 */
	get(key) {
		return this.urls.get(key) ?? null;
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
