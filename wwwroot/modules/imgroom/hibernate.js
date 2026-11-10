/** @module modules/imgroom/hibernate.js @version 0.1.0 @see docs/img_room_spec.md §15.8 */
// 長時間作動の一時退避（追加仕様 v1.3）:
//   起動から HIBER_AFTER_MS（既定 12 時間）を超えたら、一時情報（現部屋 rid/nb/uid/mode・
//   保持平文 pw）を AES-GCM で暗号化して localStorage へ書き出し、ページを location.reload() する。
//   復鍵（256bit 乱数）は sessionStorage に置く（タブ固有・リロードでは保持、タブ閉じると消滅）。
//   つまり localStorage には暗号文のみが残り、同じタブのリロードでのみ復号できる。
//   起動後は自分の tabId の条目を即座に消費（削除）。TTL（既定 5 分）超過の条目は廃棄する。
//   全タブは sessionStorage 由来の個別 tabId を持つため、各自の 12h で独立に退避→復帰する。
//   非安全コンテキスト（crypto.subtle 無し）では平文を残さないため書き出しのみスキップ（リロードは実行）。
import { ef } from '../../Y.js';
import { Vw } from '../../Vw.js';
import { AppSettings } from '../app_settings.js';

const PFX = 'ir.hiber.v1.',
	KPFX = 'ir.hiberkey.v1.',
	TABK = 'ir.tabid.v1';

export class Hibernate {
	constructor(app, cfg = {}) {
		this.app = app;
		this.cfg = cfg;
		this.tabId = Hibernate.tabId();
		this.bootAt = Date.now();
		this._t = null; // 起動時間計測の間隔チェック（背景タブのタイマ鈍化を visibilitychange で補う）
		this._waitFrom = 0; // 安全点待ち開始時刻
		this._jit = 0; // 複数タブの同時リロードをずらすジッタ
		this._fired = false; // 1 起動につき 1 回
	}
	// ---- タブ識別子（sessionStorage: リロードを跨ぎ、タブクローン/新タブへは移らない）----
	static tabId() {
		try {
			let id = sessionStorage.getItem(TABK) || '';
			if (!id) {
				const b = new Uint8Array(8);
				crypto.getRandomValues(b);
				id = Hibernate.u8h(b);
				sessionStorage.setItem(TABK, id);
			}
			return id;
		} catch (e) {
			return 'tmp' + Hibernate.u8h(crypto.getRandomValues(new Uint8Array(6)));
		}
	}
	static storeOk() {
		try {
			localStorage.setItem('ir.probe.v1', '1');
			localStorage.removeItem('ir.probe.v1');
			return true;
		} catch (e) {
			return false;
		}
	}
	static u8h(u) {
		return [...u].map(x => x.toString(16).padStart(2, '0')).join('');
	}
	static h2u(h) {
		const a = new Uint8Array(h.length >> 1);
		for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16);
		return a;
	}
	// ---- 暗号（AES-GCM 256。鍵は sessionStorage、暗号文のみ localStorage）----
	async enc(obj, kHex) {
		const key = await crypto.subtle.importKey('raw', Hibernate.h2u(kHex), 'AES-GCM', false, ['encrypt']);
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
		return { a: 'aesgcm', iv: Hibernate.u8h(iv), ct: Hibernate.u8h(new Uint8Array(ct)) };
	}
	async dec(e, kHex) {
		const key = await crypto.subtle.importKey('raw', Hibernate.h2u(kHex), 'AES-GCM', false, ['decrypt']);
		const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Hibernate.h2u(e.iv) }, key, Hibernate.h2u(e.ct));
		return JSON.parse(new TextDecoder().decode(pt));
	}
	// ---- 起動時: 自タブ条目の_claim_（即削除）+ TTL 判定 + 他タブ分期限切れ掃除 ----
	async restore() {
		if (!Hibernate.storeOk()) return null;
		const now = Date.now(),
			own = PFX + this.tabId,
			keys = [];
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (k && k.indexOf(PFX) === 0 && k !== own) keys.push(k);
		}
		for (const k of keys) {
			// 他タブ（他リロード待ち）の条目は TTL 超過分のみ掃除。生存中の退避を消さない
			let at = 0;
			try {
				at = (JSON.parse(localStorage.getItem(k) || '') || {}).at || 0;
			} catch (e) { /* 壊損は削除 */ }
			if (!at || now - at > (this.cfg.HIBER_TTL_MS || 300000)) {
				localStorage.removeItem(k);
				try {
					sessionStorage.removeItem(KPFX + k.slice(PFX.length));
				} catch (e) { /* noop */ }
			}
		}
		const raw = localStorage.getItem(own);
		if (!raw) return null;
		localStorage.removeItem(own); // リロード後は削除（消費）
		let e = null,
			o = null;
		try {
			e = JSON.parse(raw);
		} catch (er) {
			return null;
		}
		if (e && e.at && now - e.at <= (this.cfg.HIBER_TTL_MS || 300000) && e.a === 'aesgcm') {
			let kh = '';
			try {
				kh = sessionStorage.getItem(KPFX + this.tabId) || '';
			} catch (er) { /* 鍵無し=復号不可 */ }
			if (kh) {
				try {
					o = await this.dec(e, kh);
				} catch (er) {
					ef(er, 'hibernate.dec');
				}
			}
		}
		try {
			sessionStorage.removeItem(KPFX + this.tabId);
		} catch (er) { /* noop */ }
		if (!o || typeof o !== 'object') return null;
		return o;
	}
	// ---- 退避スケジュール ----
	arm() {
		this.bootAt = Date.now();
		this._fired = false;
		this._waitFrom = 0;
		if (this._t) clearInterval(this._t);
		this._t = setInterval(() => this.check(), this.cfg.HIBER_CHECK_MS || 60000);
		Vw.ael(document, 'visibilitychange', () => this.check());
	}
	check() {
		if (this._fired) return;
		if (Date.now() - this.bootAt < (this.cfg.HIBER_AFTER_MS || 43200000)) return;
		if (!this._waitFrom) {
			this._waitFrom = Date.now();
			this._jit = Math.floor(Math.random() * (this.cfg.HIBER_JITTER_MS || 0)); // 同時リロード回避
		}
		if (Date.now() - this._waitFrom < this._jit) return;
		// 安全点（転送・モーダル無し）を待つ。HIBER_WAIT_MAX_MS 超過で強制（autodl は台帳で再開）
		if (this.app.hibernateSafe() || Date.now() - this._waitFrom > (this.cfg.HIBER_WAIT_MAX_MS || 300000)) this.now();
	}
	now() { // 即時退避（テスト/手動フック: window.__IRAPP.hib.now()）
		if (this._fired) return;
		this._fired = true;
		if (this._t) {
			clearInterval(this._t);
			this._t = null;
		}
		Promise.resolve()
			.then(() => this.write(this.app.hibernateState()))
			.catch(e => ef(e, 'hibernate.write'))
			.then(() => this.reload());
	}
	async write(d) {
		await Promise.resolve(AppSettings.flush()).catch(e => ef(e, 'hibernate.flush'));
		if (!Hibernate.storeOk() || !(crypto.subtle && crypto.subtle.importKey)) return; // 平文を残さない
		const kh = Hibernate.u8h(crypto.getRandomValues(new Uint8Array(32)));
		sessionStorage.setItem(KPFX + this.tabId, kh);
		const j = await this.enc(d || {}, kh);
		j.at = Date.now();
		localStorage.setItem(PFX + this.tabId, JSON.stringify(j));
	}
	reload() {
		setTimeout(() => location.reload(), 0);
	}
}
