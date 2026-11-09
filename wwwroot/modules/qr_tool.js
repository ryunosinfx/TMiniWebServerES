/**
 * @module qr_tool
 * QR 生成 → jsQR 復号検証 → 不一致時は末尾スペース付与で再エンコードする検証ループ（§6.4 / docs/impl_contracts.md qr_tool 節）。
 * 外部 2 モジュール（qrcode.es.min.js / jsQR/jsQR.es.min.nosjis.js）の import はこのファイルのみ。
 * 実 API（ソース確認済み）:
 *   QRCode 基底: ctor(elm, opt) / makeCode(s) / setSize / setColor / setCorrectLevel('H'|'Q'|'M'|'L') / clear。
 *     correctLevel は数値 enum（L:1 M:0 Q:3 H:2）。ctor へ文字列レベルを渡すと _getTypeNumber が壊れるため
 *     setCorrectLevel() で変換してから makeCode() する。makeCode 内部の QRCodeModel は未 export（isDark 外部参照不可）。
 *   CanvasQRCode(elm, text, width, height, colorDark, colorLight, correctLevel) — DOM 前提（要素へ canvas/img を append、
 *     描画 canvas は drawer.cElm。draw 後に canvas は display:none 化されるので返却前に style を戻す）。
 *   jsQR(data, width, height, options?) — nosjis ビルドは async（await jsQR(...) → {data,...} | null）。
 */
import { CanvasQRCode } from './qrcode.es.min.js';
import { jsQR } from './jsQR/jsQR.es.min.nosjis.js';

export class QRTool {
	/**
	 * 生成〜復号検証ループ: canvas 描画 → getImageData → jsQR 照合 →
	 * null・不一致なら text に末尾スペース 1 文字付与で再エンコード（上限 retry 回、§6.4）。
	 * @param {string} text ペイロード（TMIWR1:...。ASCII 前提）
	 * @param {{size?:number, level?:string, retry?:number}} [opt]
	 * @returns {Promise<{canvas:HTMLCanvasElement|null, data:string, passes:number, failed:boolean}>}
	 *   成功時 data は検証を通った最終テキスト（追加スペースもペイロードの一部として QR に載る）。
	 *   失敗時（上限超過・生成例外）は data を原文テキストとし、canvas のコードは表示しない（§6.4）。
	 */
	static async make(text, { size = 256, level = 'H', retry = 8 } = {}) {
		if (typeof document === 'undefined')
			return { canvas: null, data: text, passes: 0, failed: true };
		const host = document.createElement('div'); // 非接続のコンテナ（document には繋がない）
		const qr = new CanvasQRCode(host, '', size, size, '#000000', '#ffffff');
		qr.setCorrectLevel(level); // 'L'|'M'|'Q'|'H' → 数値 enum に変換
		const canvas = qr.drawer.cElm;
		const ctx = canvas.getContext('2d');
		let t = text,
			passes = 0;
		try {
			for (let i = 0; i <= retry; i++) {
				qr.makeCode(t);
				passes = i + 1;
				const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
				const res = await jsQR(img.data, canvas.width, canvas.height);
				if (res && res.data === t) {
					// CanvasDrawer は draw 後に canvas を display:none にする。呼び出し側が使えるよう戻す
					canvas.style.display = '';
					canvas.style.position = '';
					canvas.style.top = '';
					canvas.title = t;
					return { canvas, data: t, passes, failed: false };
				}
				t += ' ';
			}
		} catch {
			// 'Too long data' 等の生成例外
			return { canvas, data: text, passes, failed: true };
		}
		return { canvas, data: text, passes, failed: true };
	}

	/**
	 * canvas をそのまま jsQR で復号して検証する。
	 * @returns {Promise<{ok:boolean, data:string|null}>}
	 */
	static async verifyCanvas(canvas) {
		if (!canvas || typeof canvas.getContext !== 'function')
			return { ok: false, data: null };
		const ctx = canvas.getContext('2d');
		if (!ctx) return { ok: false, data: null };
		const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
		const res = await jsQR(img.data, canvas.width, canvas.height);
		return { ok: !!(res && typeof res.data === 'string'), data: res ? res.data : null };
	}

	/** canvas → PNG Blob（PNG DL 用、§6.4） */
	static pngBlob(canvas) {
		return new Promise((resolve, reject) => {
			if (!canvas || typeof canvas.toBlob !== 'function') {
				reject(new Error('canvas.toBlob unavailable'));
				return;
			}
			canvas.toBlob((blob) => {
				if (blob) resolve(blob);
				else reject(new Error('canvas.toBlob failed'));
			}, 'image/png');
		});
	}
}
