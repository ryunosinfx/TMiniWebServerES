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

// 静的な QR 像（QRCodeModel インスタンス）から、q モジュール分の白縁を確定適用して canvas へ描画
function quietCanvas(m, size, q = 2) {
	if (!m || typeof m.getModuleCount !== 'function') return null;
	const n = m.getModuleCount();
	const cell = Math.max(2, Math.floor(size / (n + q * 2))),
		S = (n + q * 2) * cell,
		c = document.createElement('canvas');
	c.width = S;
	c.height = S;
	const g = c.getContext('2d');
	if (!g) return null;
	g.fillStyle = '#ffffff';
	g.fillRect(0, 0, S, S);
	g.fillStyle = '#000000';
	for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (m.isDark(r, k)) g.fillRect((k + q) * cell, (r + q) * cell, cell, cell);
	return c;
}

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
		// v2.2 §26: drawer.draw(qrCD) を介して QRCodeModel を受け取り、2 モジュール分の白縁付き
		// canvas を自前描画する（ライブラリ描画は余りが 1 モジュール未満で静域が不定だったため）
		let model = null;
		const dr = qr.drawer,
			rawDraw = dr.draw.bind(dr);
		dr.draw = q => {
			model = q;
			rawDraw(q);
		};
		let t = text,
			passes = 0,
			last = null;
		try {
			for (let i = 0; i <= retry; i++) {
				qr.makeCode(t);
				passes = i + 1;
				const out = quietCanvas(model, size, 2);
				if (!out) continue;
				last = out;
				const ctx = out.getContext('2d'),
					img = ctx.getImageData(0, 0, out.width, out.height),
					res = await jsQR(img.data, out.width, out.height);
				if (res && res.data === t) {
					out.title = t;
					return { canvas: out, data: t, passes, failed: false };
				}
				t += ' ';
			}
		} catch {
			// 'Too long data' 等の生成例外
			return { canvas: last, data: text, passes, failed: true };
		}
		return { canvas: last, data: text, passes, failed: true };
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
