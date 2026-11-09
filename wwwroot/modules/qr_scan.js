/**
 * @module qr_scan
 * QR 入力: カメラ / 画像ファイル / 文字列ペーストの縮退階層（§6.4 / docs/impl_contracts.md qr_scan 節）。
 * 復号はすべて QRTool.verifyCanvas 経由（jsQR 等の外部モジュールの直接 import は禁止）。
 * カメラは getUserMedia の Secure Context 制約で LAN http では不可 → canCamera()/error で呼び出し側がフォールバック UI。
 */
import { QRTool } from './qr_tool.js';

export class QRScan {
	/**
	 * 画像ファイル（png/jpg 等）→ canvas → jsQR。カメラ不要（非 Secure Context でも動作）。
	 * @param {File|Blob} file
	 * @returns {Promise<{data:string}|{error:string}>}
	 */
	static async imageFile(file) {
		let bmp = null;
		try {
			bmp = await createImageBitmap(file);
		} catch {
			return { error: '画像を読み込めません' };
		}
		const max = 1600; // 復号用の上限辺（超過時は縮小。QR 解像度を潰さない範囲）
		const k = Math.min(1, max / Math.max(1, bmp.width, bmp.height));
		const canvas = document.createElement('canvas');
		canvas.width = Math.max(1, Math.round(bmp.width * k));
		canvas.height = Math.max(1, Math.round(bmp.height * k));
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			if (bmp.close) bmp.close();
			return { error: 'canvas を使用できません' };
		}
		ctx.imageSmoothingEnabled = true;
		ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
		if (bmp.close) bmp.close();
		const v = await QRTool.verifyCanvas(canvas);
		return v.ok ? { data: v.data } : { error: 'QR コードを検出できませんでした' };
	}

	/**
	 * カメラスキャン利用可否。isSecureContext は http localhost で true / LAN http で false（§6.4）。
	 * @returns {boolean}
	 */
	static canCamera() {
		const nav = globalThis.navigator;
		return !!(globalThis.isSecureContext
			&& nav
			&& nav.mediaDevices
			&& typeof nav.mediaDevices.getUserMedia === 'function');
	}

	/**
	 * カメラ連続スキャン。video（非表示接続）+ raf で各フレームを幅 640 以下へ縮小 → jsQR。
	 * 復号成功時に onFound(text) を 1 回だけ呼び、自動で停止する（stop は冪等）。
	 * @param {(text:string)=>void} onFound
	 * @returns {Promise<{stop:Function}|{error:string}>} getUserMedia が非同期のため Promise で返す
	 */
	static async camera(onFound) {
		if (!QRScan.canCamera())
			return { error: 'カメラスキャンには Secure Context（https または localhost）が必要です' };
		let stream;
		try {
			stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
		} catch (e) {
			return { error: QRScan._camErr(e) };
		}
		// document への接続はフレーム供給のためメソッド実行時のみ（画外配置）
		const video = document.createElement('video');
		video.muted = true;
		video.setAttribute('playsinline', '');
		video.srcObject = stream;
		video.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0';
		document.body.appendChild(video);
		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d');
		let raf = 0,
			busy = false,
			stopped = false;
		const cleanup = () => {
			if (stopped) return;
			stopped = true;
			if (raf) cancelAnimationFrame(raf);
			stream.getTracks().forEach((t) => t.stop());
			video.srcObject = null;
			if (video.parentNode) video.parentNode.removeChild(video);
		};
		try {
			await video.play();
		} catch {
			cleanup();
			return { error: 'ビデオを開始できませんでした' };
		}
		const tick = async () => {
			if (stopped) return;
			if (!busy && video.readyState >= 2 && video.videoWidth > 0 && ctx) {
				busy = true;
				try {
					const k = Math.min(1, 640 / video.videoWidth); // 640 縮小 → jsQR
					canvas.width = Math.max(1, Math.round(video.videoWidth * k));
					canvas.height = Math.max(1, Math.round(video.videoHeight * k));
					ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
					const v = await QRTool.verifyCanvas(canvas);
					if (v.ok) {
						cleanup(); // 停止後に成功コール（コールは 1 回のみ）
						onFound(v.data);
						return;
					}
				} catch {
					// 1 フレームの失敗は無視して継続
				} finally {
					busy = false;
				}
			}
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return { stop: cleanup };
	}

	/**
	 * ペースト文字列はそのまま（TMIWR1: パース・末尾スペース除去・検証は呼び出し側、§6.4）。
	 * @param {unknown} s
	 * @returns {string}
	 */
	static text(s) {
		return s == null ? '' : String(s);
	}

	static _camErr(e) {
		const n = (e && e.name) || '';
		if (n === 'NotAllowedError' || n === 'PermissionDeniedError') return 'カメラの権限が拒否されました';
		if (n === 'NotFoundError' || n === 'DevicesNotFoundError') return 'カメラが見つかりません';
		if (n === 'NotReadableError' || n === 'TrackStartError') return 'カメラを使用できません（使用中の可能性）';
		return 'カメラを開始できません' + (n ? ': ' + n : '');
	}
}
