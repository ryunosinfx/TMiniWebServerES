/** @module modules/imgroom/room_app.js @version 0.1.0 @see docs/img_room_spec.md */
// RoomApp — ImageRoom エントリーポイント UI（仕様 §5, §11, §12）。
// 組み立て: ヘッダー(§5.2)/タブ/ホーム(§5.1)/作成(§5.3)/ログイン/共有(§9.1)/カレンダー/ゴミ箱(§5.6)/サーバーパネル(§5.7)/ビューア(§5.4)。
// M/S/T/X のルーティングは room_session に集約済み。room_app は session.onFrame + session.hooks で受ける
// （hooks = {onManifest,onM,onS,onT,onX,onJ,onB} — 契約外追加・lead 結合時に合わせる）。
import { OPFS } from '../../OPFS.js';
import { Y, ef } from '../../Y.js';
import { Vw } from '../../Vw.js';
import { AppSettings } from '../app_settings.js';
import { I18N } from '../i18n.js';
import { AuthChallenge } from '../auth_challenge.js';
import { HashStore } from '../hash_store.js';
import { FileTransfer } from '../p2p_file.js';
import { ImgProc, SliceCache } from '../img_proc.js';
import { QRTool } from '../qr_tool.js';
import { QRScan } from '../qr_scan.js';
import { Toggle, Badge, Toast, useLabel } from '../widgets.js';
import { CFG, STORAGE, ridOf, qrPack, qrUnpack, IR, QR_PREFIX, WS_PREFIX, getWsBase, setWsBase, wsNorm, claimMake, claimParse } from './ir_const.js';
import { Protocol } from './ir_protocol.js';
import { RoomSession } from './room_session.js';
import { Hibernate } from './hibernate.js';
import { Collection } from './collection.js';
import { SheetRoom } from './sheet_room.js';
import { SyncMode } from './sync_mode.js';
import { BulkDL } from './bulk_dl.js';
import { RoomCalendar } from './room_calendar.js';

const DAY = 86400000,
	t = (k, p) => I18N.t(k, p);

export class RoomApp {
	constructor() {
		this.rooms = new Map(); // rid -> ctx（各部屋セッション一式）
		this.active = ''; // アクティブタブ rid
		this.cfg = { ...CFG }; // 既定+user_settings+URL クエリ上書き（GRID_*/CAL_VIEW のみ、§11）
		this.store = null; // HashStore 全アプリ 1 個（bodies/meta は横断共有、§7.5）
		this.opfsOk = true;
		this.view = { t: 'home' }; // 再描画用の現在画面
		this.forcedMsg = ''; // §12 強制ログアウト理由（ホームに 1 回表示）
		this.usageT = 0; // §9.11 デバウンスタイマ
		this.hdEls = null;
	}
	// ---- 起動（契約 boot 節: OPFS → AppSettings → I18N → 画面）----
	async boot() {
		window.__IRAPP = this; // デバッグ/テストフック（browserTest が内部状態を観測する）
		try {
			if (!(navigator.storage && navigator.storage.getDirectory)) throw new Error('no OPFS');
			await OPFS.i('imgroom');
			await OPFS.rd;
		} catch (e) {
			ef(e, 'room_app.opfs'); // §12 OPFS 不存在: 縮退運転（保存・認証永続化無効）
			this.opfsOk = false;
		}
		try {
			if (this.opfsOk) await AppSettings.init(CFG); // 既定は ir_const CFG と user_settings マージ
		} catch (e) {
			ef(e, 'room_app.settings'); // 読込不可でも既定値で継続
		}
		this.cfg = Object.assign({}, CFG, (AppSettings && AppSettings.cfg) || {});
		this.qOverride(); // URL クエリ上書き（非永続）
		this.store = new HashStore(this.cfg); // cfg 確定後に生成（HASH_ROUNDS 反映）
		await I18N.init((AppSettings.cfg && AppSettings.cfg.LANG) || 'auto');
		setWsBase(this.cfg.WSBASE || ''); // v2.4 §28: WS ベース URL（既定=このサイト）
		// v2.15 §42: リンクによる WebSocket 接続設定（#部屋名:b64url(ws)）。別ドメインの既存設定があれば確認して上書き
		const hw = RoomApp.hashWs();
		if (hw) {
			const cur = wsNorm((this.cfg && this.cfg.WSBASE) || '');
			if (!cur || cur === hw || confirm(t('msg.ws.confirm', { from: cur, to: hw }))) {
				setWsBase(hw);
				this.cfg.WSBASE = hw;
				if (this.opfsOk) AppSettings.set('WSBASE', hw).catch(e => ef(e, 'room_app.wsbaseAnchor'));
			}
		}
		I18N.onChange = () => this.redraw(); // §11 言語変更で全 UI 即時再描画
		this.setCssVars();
		this.mkShell();
		this.sweepOnce(); // §9.8 起動時スイープ（lastSweep 判定）
		Vw.ael(window, 'beforeunload', () => AppSettings.flush()); // §11 書き戻し flush
		// 一時退避（追加仕様 v1.3 §15.8）: リロード後は localStorage の退避条目（5 分以内）から自動復帰
		this.hib = new Hibernate(this, this.cfg);
		const hr = await this.hib.restore();
		if (!(hr && hr.rid && (await this.tryResume(hr)))) {
			const h = RoomApp.hashName(); // v1.3.1: 不正 % での boot 停止防止
			if (h) await this.homeLogin(h); // §5.1 hash=部屋名 b64url → ログイン画面
			else await this.home();
			this.autoJoin(); // §5.7 サーバーモードは起動時に自動再参加
		}
		this.hib.arm(); // 12h 経過で安全点を見て退避→リロード（全タブ各自）
		if (!this.opfsOk) Toast(t('msg.opfs.unavail'));
	}
	// ハッシュの部屋名（b64url）。不正 % シーケンスでも落ちない（v1.3.1）
	static hashName() {
		try {
			return decodeURIComponent((location.hash || '').replace(/^#/, '')).split(':')[0]; // v2.15 §42: #部屋名:b64url(ws) の部屋名部のみ
		} catch (e) {
			return '';
		}
	}
	// v2.15 §42: アンカーの WebSocket ベース（#部屋名:b64url(ws)）。wsNorm で正規化、不正は ''
	static hashWs() {
		try {
			const a = (location.hash || '').replace(/^#/, '').split(':'); // v2.20 §47: #<nm>:<ws>:<claim>（ws は 2 節目のみ）
			if (a.length < 2) return '';
			return wsNorm(Y.u2s(Y.U2u(decodeURIComponent(a[1])))); // U2u: b64url→u8（u2s は u8 必須）
		} catch (e) {
			return '';
		}
	}
	// v2.20 §47: アンカーの作成者クレーム（3 節目）。不正は null
	static hashClaim() {
		try {
			const a = (location.hash || '').replace(/^#/, '').split(':');
			return a.length >= 3 ? claimParse(decodeURIComponent(a[2])) && decodeURIComponent(a[2]) : null;
		} catch (e) {
			return null;
		}
	}
	// ---- v2.20 §47: 部屋作成者の鍵とクレーム（ECDSA P-256/SHA-256。この実装環境は WebCrypto RSA generateKey 非対応で ECDSA のみ可）----
	// 署名対象= JSON.stringify({nm:部屋名平文, uid:参加者名, ct:作成時刻})（SHA256withECDSA ダイジェスト署名）。OPFS keys/<rid>.json に鍵組と自クレームを保管
	static crJson = (nm, uid, ct) => JSON.stringify({ nm, uid, ct }); // キー順固定（決定性）
	static CR_EC = { name: 'ECDSA', hash: { name: 'SHA-256' } };
	async _crKeys(rid, nmPlain, uid, ct) {
		const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']),
			spki = await crypto.subtle.exportKey('spki', kp.publicKey),
			priv = await crypto.subtle.exportKey('jwk', kp.privateKey),
			json = RoomApp.crJson(nmPlain, uid, ct),
			sg = Y.B2U(Y.u2B(new Uint8Array(await crypto.subtle.sign(RoomApp.CR_EC, kp.privateKey, Y.s2u(json))))), // u2B: u8→base64、B2U: url 安全化（Y.js の B2U は文字列入力）
			claim = claimMake({ ct, cr: Y.B2U(Y.u2B(Y.s2u(uid))), pk: Y.B2U(Y.u2B(new Uint8Array(spki))), sg });
		await OPFS.w('keys/' + rid + '.json', Y.s2u(JSON.stringify({ ver: 1, json, ct, uid, claim, privJwk: priv })).buffer);
		return claim;
	}
	async _crKeysLoad(rid) {
		try {
			const p = 'keys/' + rid + '.json';
			if (!(await OPFS.isEf(p))) return null;
			return JSON.parse(Y.u2s(await OPFS.r(p)));
		} catch (e) {
			return null;
		}
	}
	// 署名再作成一致: 鍵所持者は署名を再作成し、元クレーム sg と新規署名の両方が公開鍵検証で一致 → 所持を証明＝部屋作成者認定
	// （ECDSA は署名が非決定的なので**検証一致**で判定する。Byte 同一比較はしない）
	async _crSelfCheck(ctx) {
		const o = await this._crKeysLoad(ctx.rid);
		if (!o || !o.privJwk || !o.json) return false;
		try {
			const c = claimParse(o.claim);
			if (!c) return false;
			const priv = await crypto.subtle.importKey('jwk', o.privJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']),
				pub = await crypto.subtle.importKey('spki', Y.U2u(c.pk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']),
				data = Y.s2u(o.json),
				orig = await crypto.subtle.verify(RoomApp.CR_EC, pub, Y.U2u(c.sg), data),
				fresh = await crypto.subtle.sign(RoomApp.CR_EC, priv, data),
				re = await crypto.subtle.verify(RoomApp.CR_EC, pub, fresh, data);
			return orig && re;
		} catch (e) {
			ef(e, 'room_app.crSelfCheck');
			return false;
		}
	}
	// クレーム文字列+部屋名平文 → 署名照合（公開鍵でダイジェスト検証）
	async _crVerify(claim, nmPlain) {
		const c = claimParse(claim);
		if (!c) return { ok: false };
		try {
			let uid;
			try {
				uid = Y.u2s(Y.U2u(c.cr));
			} catch (e) {
				return { ok: false };
			}
			const pub = await crypto.subtle.importKey('spki', Y.U2u(c.pk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']),
				json = RoomApp.crJson(nmPlain, uid, c.ct),
				ok = await crypto.subtle.verify(RoomApp.CR_EC, pub, Y.U2u(c.sg), Y.s2u(json));
			return { ok: !!ok, cr: uid, ct: c.ct };
		} catch (e) {
			return { ok: false };
		}
	}
	_claimFor(ctx) {
		return (ctx && ctx._crInfo && ctx._crInfo.claim) || '';
	}
	// 参加/作成/autoJoin 共通: クレームの解決→検証→自機署名一致→room.cr 補完→表示
	async _creatorFlow(ctx) {
		let claim = RoomApp.hashClaim() || '';
		const keys = await this._crKeysLoad(ctx.rid);
		if (!claim && keys && keys.claim) claim = keys.claim; // 自機が鍵を持つ=作成者自身。QR を経由しなくてもクレーム復元可
		if (!claim) {
			try {
				const p = 'claim/' + ctx.rid + '.json'; // 受領済みクレーム（QR/URL 経由で保存）
				if (await OPFS.isEf(p)) claim = (JSON.parse(Y.u2s(await OPFS.r(p))) || {}).claim || '';
			} catch (e) { /* noop */ }
		}
		if (!claim) return;
		const nmPlain = RoomApp.unB64(ctx.nb) || ctx.title || '',
			v = await this._crVerify(claim, nmPlain);
		ctx._crInfo = { claim, ok: v.ok, cr: v.cr || '', ct: (claimParse(claim) || {}).ct || 0, self: false };
		if (v.ok && !ctx.room.cr && v.cr) ctx.room.cr = v.cr; // 作成者不明状態の救済: 署名検証できたクレームから認識
		if (keys && (await this._crSelfCheck(ctx))) { // 署名再作成一致 → この端末は作成者
			ctx._crInfo.self = true;
			if (v.ok && ctx.room.cr !== ctx.uid && ctx._crInfo.cr === ctx.uid) ctx.room.cr = ctx.uid;
			else if (!v.ok && ctx._crInfo.cr === ctx.uid) ctx.room.cr = ctx.uid;
		}
		if (RoomApp.hashClaim()) await OPFS.w('claim/' + ctx.rid + '.json', Y.s2u(JSON.stringify({ claim, ts: Date.now() })).buffer).catch(() => {}); // アンカー由来は保存（次回以降も認識）
		if (this.active === ctx.rid) this.paintCr(ctx);
	}
	paintCr(ctx) {
		if (!ctx || !ctx._crInfo || !ctx.partsEl) return;
		let el = ctx.partsEl.parentElement && ctx.partsEl.parentElement.querySelector('.ir-crinfo');
		if (!el) {
			const bar = ctx.partsEl.parentElement;
			if (!bar) return;
			el = Vw.add(bar, 'span', { class: 'ir-crinfo' });
		}
		const i = ctx._crInfo;
		el.textContent = I18N.t('lbl.cr') + ' ' + (i.cr || '?') + ' ' + (i.self ? I18N.t('lbl.cr.self') : i.ok ? I18N.t('lbl.cr.ok') : I18N.t('lbl.cr.bad'));
		el.classList.toggle('bad', !i.ok && !i.self);
		el.classList.toggle('ok', i.ok || i.self);
	}
	qOverride() { // §11: GRID_COLS/GRID_ROWS/CAL_VIEW のみ（デバッグ用・永続化しない）
		let p;
		try {
			p = new URL(location.href).searchParams;
		} catch (e) {
			return;
		}
		const gc = parseInt(p.get('GRID_COLS'), 10),
			gr = parseInt(p.get('GRID_ROWS'), 10);
		if (gc > 0 && gc <= 16 && gr > 0 && gr <= 16) {
			this.cfg.GRID_COLS = gc;
			this.cfg.GRID_ROWS = gr;
		}
		const cv = p.get('CAL_VIEW');
		if (cv === 'day' || cv === 'week' || cv === 'month') this.cfg.CAL_VIEW = cv;
	}
	sweepOnce() {
		if (!this.opfsOk) return;
		const last = (AppSettings.state && AppSettings.state.lastSweep) || 0;
		if (Date.now() - last < DAY) return;
		this.store.sweep(Date.now(), this.cfg.TRASH_KEEP_DAYS).then(r => {
			AppSettings.setState('lastSweep', Date.now()).catch(e => ef(e, 'room_app.sweepSet'));
			if (r && r.deleted && r.deleted.length) Toast(t('msg.trash.sweep'));
		}).catch(e => ef(e, 'room_app.sweep'));
	}
	// ---- ユーティリティ ----
	static nb(s) { // §7.2 ユーザー入力 → BASE64URL
		return Y.B2U(Y.u2B(Y.s2u(String(s))));
	}
	static unB64(u) { // b64url → 文字列（失敗時 ''）
		try {
			return Y.u2s(new Uint8Array(Y.B2a(Y.U2B(String(u)))));
		} catch (e) {
			return '';
		}
	}
	dl(blob, name, toast) { // <a download> 発火（§9.10 ビューア保存/DL 共通）。v2.2 §26: toast=true で成功時 10 秒表示
		try {
			const a = Vw.ce('a');
			a.href = URL.createObjectURL(blob);
			a.download = name || 'image';
			Vw.gB().appendChild(a);
			a.click();
			Vw.rm(a);
			setTimeout(() => URL.revokeObjectURL(a.href), 6000);
			if (toast) Toast(t('msg.dl.ok'), 10000);
		} catch (e) {
			ef(e, 'room_app.dl');
		}
	}
	// ---- CSS 変数注入（寸法等の設定値のみ。色/造形は css/imgroom.css のテーマ変数で差し替え可）----
	setCssVars() {
		document.documentElement.style.setProperty('--ir-thumb', (this.cfg.THUMB_PX || 96) + 'px');
	}
	// ---- シェル（ヘッダー+タブ+メイン、§5.2）----
	mkShell() {
		const b = Vw.gB();
		this.hd = Vw.div(b, { class: 'ir-hd' });
		this.tabsEl = Vw.div(b, { class: 'ir-tabs' });
		this.main = Vw.div(b, { class: 'ir-main' });
		const e = (this.hdEls = {});
		e.title = Vw.add(this.hd, 'b');
		e.usage = Vw.add(this.hd, 'span', { class: 'ir-mut' }); // §9.11 使用量
		e.modeWrap = Vw.div(this.hd, { class: 'ir-row' }); // §5.2 モード切替（server では非表示）
		// v2.2 §26 → v2.14 §41: ログイン画面でもモード選択可（通常都度/取得保持/同期の select。server セッションでは非表示のまま）
		e.modeSel = Vw.add(e.modeWrap, 'select', { class: 'ir-hmode' });
		for (const v of ['normal', 'keep', 'sync']) {
			const o = Vw.ce('option');
			o.value = v;
			e.modeSel.appendChild(o);
		}
		Vw.change(e.modeSel, () => this.setModeHdr(e.modeSel.value));
		e.lang = Vw.add(this.hd, 'select', { class: 'ir-langs' }); // 言語 auto/ja/en
		for (const v of ['auto', 'ja', 'en']) {
			const o = Vw.ce('option');
			o.value = v;
			e.lang.appendChild(o);
		}
		Vw.change(e.lang, () => this.setLang(e.lang.value));
		e.trash = Vw.btn(this.hd, { class: 'ir-btn' }); // §5.6
		Vw.click(e.trash, () => this.trashView());
		e.bulk = Vw.btn(this.hd, { class: 'ir-btn' }); // §9.10
		Vw.click(e.bulk, () => this.bulkDl());
		e.menu = Vw.btn(this.hd, { class: 'ir-btn' }); // 作成者メニュー §5.2
		Vw.click(e.menu, () => this.roomMenu());
		e.logout = Vw.btn(this.hd, { class: 'ir-btn warn' }); // ログアウト
		Vw.click(e.logout, () => this.logout(this.active));
		this.lblHdr();
		this.usageNow();
	}
	lblHdr() { // 言語再描画対応
		const e = this.hdEls;
		Vw.sT(e.title, t('app.title'));
		const mo = e.modeSel.options; // v2.14 §41: ヘッダーモード select（言語切替対応）
		mo[0].textContent = t('mode.normal.fetch');
		mo[1].textContent = t('mode.normal.keep');
		mo[2].textContent = t('hdr.mode.sync');
		const opts = e.lang.options;
		opts[0].textContent = t('hdr.lang') + ': auto';
		opts[1].textContent = t('hdr.lang') + ': 日本語';
		opts[2].textContent = t('hdr.lang') + ': English';
		e.lang.value = (AppSettings.cfg && AppSettings.cfg.LANG) || 'auto';
		Vw.sT(e.trash, t('btn.trash.ico')); // v1.8 §22: ゴミ箱は絵文字ボタン（画面側の見出しは t('btn.trash')='ゴミ箱' を維持）
		e.trash.title = t('btn.trash');
		e.trash.setAttribute('aria-label', t('btn.trash'));
		Vw.sT(e.bulk, t('btn.bulkdl'));
		Vw.sT(e.menu, '⚙️'); // v2.0 §24: 部屋設定は歯車絵文字（title/aria に語義維持）
		e.menu.title = t('btn.room.menu');
		e.menu.setAttribute('aria-label', t('btn.room.menu'));
		Vw.sT(e.logout, t('btn.logout'));
	}
	setLang(v) { // §5.2: LANG 保存 + I18N 切替（onChange→redraw）
		AppSettings.set('LANG', v).catch(e => ef(e, 'room_app.lang'));
		I18N.setLang(v).catch(e => ef(e, 'room_app.langSet'));
	}
	// ---- 使用量（§9.11: 変更イベントから最短 2s デバウンス）----
	usageDirty() {
		if (this.usageT) return;
		this.usageT = setTimeout(() => {
			this.usageT = 0;
			this.usageNow();
		}, 2000);
	}
	async usageNow() {
		if (!this.store) return;
		try {
			const u = await this.store.usage(); // {bodies,sheets,meta}
			const sum = Object.values(u || {}).reduce((a, v) => a + ((v && v.bytes) || 0), 0);
			let est = '';
			try { // estimate 併記可（§9.11）
				const s = await navigator.storage.estimate();
				if (s && s.usage != null) est = ' (' + useLabel(s.usage) + '/' + useLabel(s.quota || 0) + ')';
			} catch (e) { /* 非対応时无視 */ }
			Vw.sT(this.hdEls.usage, t('hdr.usage') + ': ' + useLabel(sum) + est);
		} catch (e) {
			ef(e, 'room_app.usage');
		}
	}
	// ---- タブ（§5.2: 部屋名+接続状態バッジ、＋で新規）----
	renderTabs() {
		Vw.rc(this.tabsEl);
		for (const [rid, ctx] of this.rooms) {
			const on = rid === this.active;
			const b = Vw.btn(this.tabsEl, { class: 'ir-tab' + (on ? ' on' : '') });
			Vw.add(b, 'span').textContent = ctx.title;
			const st = ctx.session.state || {};
			Badge(b, st.online ? 'ir-bdgon' : 'ir-bdgoff', st.online ? 'ON' : 'OFF');
			if (st.mirror) Badge(b, 'ir-bdg', 'M');
			Vw.click(b, () => this.activate(rid));
		}
		const plus = Vw.btn(this.tabsEl, { class: 'ir-tab' });
		Vw.sT(plus, '＋');
		Vw.click(plus, () => this.home());
		this.syncHdr();
	}
	// ヘッダー表示制御（モードトグルはサーバーモードで非表示、§5.7）
	syncHdr() {
		const e = this.hdEls,
			ctx = this.rooms.get(this.active);
		const disp = v => (v ? '' : 'none');
		Vw.sS(e.modeWrap, { display: ctx && ctx.mode !== 'server' ? '' : 'none' });
		if (e.modeSel) e.modeSel.value = ctx && ctx.mode !== 'server' ? ctx.mode : 'normal'; // v2.14 §41
		for (const k of ['trash', 'bulk', 'logout']) Vw.sS(e[k], { display: ctx ? disp(true) : disp(false) });
		Vw.sS(e.menu, { display: ctx && ctx.room.cr === ctx.uid ? '' : 'none' }); // 作成者のみ §5.3
	}
	activeCtx() {
		return this.rooms.get(this.active) || null;
	}
	setModeHdr(m) { // ヘッダー select: 通常（都度）⇄通常（保持）⇄同期（§9.9/v2.14 §41。server セッションでは変更不可）
		const ctx = this.activeCtx();
		if (!ctx || ctx.mode === 'server' || !['normal', 'keep', 'sync'].includes(m) || ctx.mode === m) return;
		ctx.mode = m;
		ctx.sync.enable(m === 'sync');
		if (ctx.cal) ctx.cal.keep = m === 'keep'; // 即時反映（次回 fetchBody/表示から）
		if (ctx.foot) Vw.sS(ctx.foot, { display: ctx.sync.enabled ? '' : 'none' });
		AppSettings.setNested('MODE.' + ctx.rid, m).catch(e => ef(e, 'room_app.mode'));
		const rl = (AppSettings.state && AppSettings.state.roomLogin || {})[ctx.rid];
		if (rl) AppSettings.setState('roomLogin.' + ctx.rid, Object.assign({}, rl, { mode: m })).catch(e => ef(e, 'room_app.rlMode')); // 次回起動の自動再参加にも保持
	}
	redraw() { // 言語切替等: 現在画面を作り直し
		this.lblHdr();
		this.renderTabs();
		if (this.view.t === 'room' && this.rooms.has(this.view.rid)) this.renderRoom(this.view.rid);
		else this.home();
	}
	// ---- ホーム（§5.1: 部屋一覧は OPFS rooms/*/room.json の nm、§10）----
	// v2.21 §48: 最終参加日 yyyy-mm-dd-hh-mm（ローカルタイムゾーン）
	static ljFmt(ms) {
		const d = new Date(ms),
			z = n => String(n).padStart(2, '0');
		return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + '-' + z(d.getHours()) + '-' + z(d.getMinutes());
	}
	// 部屋マニフェスト（manifest.<uid>.jsonl / legacy .json）に載る h10 集合
	async _roomHs(rid) {
		const out = new Set();
		try {
			const dir = 'rooms/' + rid;
			for (const f of await OPFS.ls(dir)) {
				if (!f || f.s === undefined) continue; // ファイルのみ
				const k = String(f.k).split('/').pop();
				if (!/^manifest\..+\.jsonl?$/.test(k)) continue;
				const txt = Y.u2s(await OPFS.r(dir + '/' + k));
				if (k.endsWith('.json')) {
					let arr = [];
					try {
						arr = JSON.parse(txt);
					} catch (e) { /* 不正は無視 */ }
					for (const e of arr || []) if (e && e.h) out.add(e.h);
				} else {
					const m = new Map(); // x 行除去・last-wins（loadManifest と同一規則）
					for (const line of txt.split('\n')) {
						if (!line) continue;
						let e;
						try {
							e = JSON.parse(line);
						} catch (er) {
							continue;
						}
						if (!e || !e.h) continue;
						if (e.x) m.delete(e.h);
						else m.set(e.h, 1);
					}
					for (const h of m.keys()) out.add(h);
				}
			}
		} catch (e) { /* 部屋直下の走査失敗は 0 扱い */ }
		return out;
	}
	// OPFS に本体実在する画像枚数（インスタンス中キャッシュ。削除時 invalidate）
	async _roomImgCount(rid) {
		this._cntC = this._cntC || new Map();
		if (this._cntC.has(rid)) return this._cntC.get(rid);
		const hs = await this._roomHs(rid);
		// 枚数=manifest 件数。10 万件規模で全件 isEf は実行不能（ホーム起動ハング: 教訓 §48）なので先頭 3 件の実在のみ安否確認
		let n = hs.size,
			seen = 0,
			k = 0;
		for (const h of hs) {
			if (await OPFS.isEf(HashStore.bp(h))) {
				seen = 1;
				break;
			}
			if (++k >= 3) break; // 本体全消失の古い manifest は 0 枚扱い
		}
		if (n && !seen) n = 0;
		this._cntC.set(rid, n);
		return n;
	}
	// 部屋完全消去: セッション dispose → 孤児本体+メタ物理削除 → rooms/<rid> 再帰削除 → 鍵/クレーム/タグ台帳/設定除去
	async _purgeRoom(rid) {
		if (!rid) return;
		if (this.rooms.has(rid)) this.disposeRoom(rid); // §12: 開いている部屋は先にセッション終端
		const ls = await this.roomList(),
			other = new Set(); // コンテンツアドレスは部屋間で共有されうる: 他部屋マニフェスト参照の本体は残す
		for (const it of ls) if (it.rid !== rid) for (const h of await this._roomHs(it.rid)) other.add(h);
		const hs = await this._roomHs(rid),
			orphans = new Set([...hs].filter(h => !other.has(h))); // 孤児のみ物理削除（本体も meta も部屋間で共有されうる）
		for (const h of orphans) await OPFS.rmf(HashStore.bp(h)).catch(e => ef(e, 'room_app.purgeBody'));
		await this.store.delMetas(orphans).catch(e => ef(e, 'room_app.purgeMetas'));
		try {
			const rh = await OPFS.gDH(rid, await OPFS.gDHR('rooms', false)); // gDH(名前, 親ハンドル): 作成しない
			if (rh) await rh.remove({ recursive: true }); // 直下（room.json/manifest/sheet/...）一括
		} catch (e) {
			ef(e, 'room_app.purgeDir');
		}
		for (const p of ['keys/' + rid + '.json', 'claim/' + rid + '.json', 'tagreg/' + rid + '.json']) await OPFS.rmf(p).catch(() => {}); // v2.20 §47 の部屋単位ファイルも
		for (const k of ['roomLogin.' + rid, 'MODE.' + rid, 'lj.' + rid]) AppSettings.setState(k, null).catch(() => {});
		this._cntC = this._cntC || new Map();
		this._cntC.delete(rid);
		this.usageDirty();
		await this.home();
	}
	async roomList() {
		const out = [];
		if (!this.opfsOk) return out;
		try {
			for (const d of await OPFS.ls(STORAGE.rooms)) {
				if (!d || d.s !== undefined || !d.l) continue; // dir 要素のみ {k,p,l}
				const rid = String(d.k).split('/').pop();
				if (!(d.l || []).some(e => e && e.s !== undefined && e.k === 'room.json')) continue;
				try {
					const ab = await OPFS.r(STORAGE.roomFile(rid));
					const o = ab && ab.byteLength ? JSON.parse(Y.u2s(ab)) : null;
					if (o && typeof o === 'object') out.push({ rid, room: o });
				} catch (e) { /* 壊れた room.json は無視 */ }
			}
		} catch (e) {
			ef(e, 'room_app.rooms');
		}
		return out;
	}
	async home() {
		this.view = { t: 'home' };
		this.active = '';
		Vw.rc(this.main);
		if (this.forcedMsg) { // §12 強制ログアウト表示
			Vw.add(this.main, 'div', { class: 'ir-sec' }).textContent = t(this.forcedMsg);
			this.forcedMsg = '';
		}
		this.renderTabs();
		Vw.add(this.main, 'h3').textContent = t('lbl.room.list');
		const list = await this.roomList(),
			ljs = (AppSettings.state && AppSettings.state.lj) || {}; // v2.21 §48: 最終参加日の降順
		list.sort((a, b) => (ljs[b.rid] || 0) - (ljs[a.rid] || 0));
		for (const { rid, room } of list) {
			const c = Vw.div(this.main, { class: 'ir-crd' });
			Vw.add(c, 'b').textContent = RoomApp.unB64(room.nm) || room.nm || rid;
			Vw.add(c, 'span', { class: 'ir-mut ir-lj' }).textContent = ljs[rid] ? RoomApp.ljFmt(ljs[rid]) : '—'; // yyyy-mm-dd-hh-mm（ローカル TZ）
			Vw.add(c, 'span', { class: 'ir-mut' }).textContent = rid;
			const rl = (AppSettings.state && AppSettings.state.roomLogin || {})[rid];
			if (this.rooms.has(rid)) {
				const b = Vw.btn(c, { class: 'ir-btn' });
				Vw.sT(b, t('btn.login'));
				Vw.click(b, () => this.activate(rid));
			} else if (rl) { // §5.1 ログイン済み: セッションへ参加
				Vw.add(c, 'span', { class: 'ir-mut' }).textContent = rl.uid + ' / ' + (rl.mode || 'normal');
				const b = Vw.btn(c, { class: 'ir-btn' });
				Vw.sT(b, t('btn.join'));
				Vw.click(b, () => this.rejoinRoom(rid, room, rl));
			} else {
				const b = Vw.btn(c, { class: 'ir-btn' });
				Vw.sT(b, t('btn.login'));
				Vw.click(b, () => this.loginForm(rid, room));
			}
			if (room.conflict) Vw.add(c, 'span', { class: 'ir-mut' }).textContent = t('msg.conflict.blocked'); // §6.9
			// v2.21 §48: OPFS に実在する画像枚数と削除（本体+メタの物理削除。他部屋が参照する同一コンテンツ本体は残す）
			const nimg = await this._roomImgCount(rid);
			if (nimg > 0) Vw.add(c, 'span', { class: 'ir-mut ir-nimg' }).textContent = t('lbl.room.imgs', { n: nimg });
			const bd = Vw.btn(c, { class: 'ir-btn warn ir-rdel' });
			Vw.sT(bd, t('btn.room.del'));
			Vw.click(bd, () => {
				if (!window.confirm(t('msg.room.del'))) return;
				this._purgeRoom(rid).catch(e => ef(e, 'room_app.purge'));
			});
		}
		const row = Vw.div(this.main, { class: 'ir-row' });
		const bc = Vw.btn(row, { class: 'ir-btn' });
		Vw.sT(bc, t('btn.create')); // §5.3 作成
		Vw.click(bc, () => this.createForm());
		const bj = Vw.btn(row, { class: 'ir-btn' });
		Vw.sT(bj, t('btn.join'));
		Vw.click(bj, () => this.loginForm('', null));
		const bw = Vw.btn(row, { class: 'ir-btn' }); // v2.4 §28: WebSocket URL 設定（QR 表示/変更/読み取り）
		Vw.sT(bw, '⚙️ ' + t('btn.ws'));
		Vw.click(bw, () => this.wsForm());
	}
	async homeLogin(nameB64U) { // §5.1 hash/QR 経由: 部屋ログイン画面
		const list = await this.roomList();
		const hit = list.find(x => (x.room.nm || '') === nameB64U) || null;
		await this.home();
		this.loginForm(hit ? hit.rid : '', hit ? hit.room : null, nameB64U);
	}
	// ---- ログインフォーム（§5.1: ユーザー名+パスワード+モード選択）----
	loginForm(rid, room, preNb) {
		this.view = { t: 'login', rid };
		Vw.rc(this.main);
		const f = Vw.add(this.main, 'form', { class: 'ir-frm' }); // v2.15 §42: 実 form（ブラウザパスワードマネージャ検知）
		Vw.add(f, 'h3').textContent = t('btn.login');
		const nmIn = Vw.ipt(f, { type: 'text', name: 'ir-nm', placeholder: t('lbl.room.name'), autocomplete: 'off' });
		if (room && room.nm) nmIn.value = RoomApp.unB64(room.nm) || room.nm;
		else if (preNb) nmIn.value = RoomApp.unB64(preNb);
		const uidIn = Vw.ipt(f, { type: 'text', name: 'ir-uid', placeholder: t('lbl.username'), autocomplete: 'username' }); // v2.15 §42
		const rl = rid && AppSettings.state && (AppSettings.state.roomLogin || {})[rid];
		if (rl) uidIn.value = rl.uid || '';
		const pwIn = Vw.ipt(f, { type: 'password', name: 'ir-pw', placeholder: t('lbl.password'), autocomplete: 'current-password' }); // v2.15 §42
		Vw.add(f, 'div', { class: 'ir-mut' }).textContent = t('diag.origin') + ': ' + location.origin; // v2.8 §34: 参加側のオリジン表示（作成者に oa 登録してもらうため）
		{ // v2.20 §47: URL/QR アンカーの作成者クレームをログイン画面で検証して表示（一致なら作成者名が分かる）
			const ac = RoomApp.hashClaim();
			if (ac) {
				const rowCr = Vw.add(f, 'div', { class: 'ir-mut ir-crinfo' });
				const nmP = RoomApp.unB64((room && room.nm) || preNb || '') || RoomApp.unB64(RoomApp.hashName()) || '';
				rowCr.textContent = t('lbl.cr') + ' …';
				this._crVerify(ac, nmP).then(v => {
					rowCr.textContent = t('lbl.cr') + ' ' + (v.cr || '?') + ' ' + (v.ok ? t('lbl.cr.ok') : t('lbl.cr.bad'));
					rowCr.classList.toggle('ok', !!v.ok);
					rowCr.classList.toggle('bad', !v.ok);
				});
			}
		}
		// モード選択（サーバーはログイン時のみ、srvOn=false 部屋では disabled、§5.1/§5.7/§6.8）
		Vw.add(f, 'label').textContent = t('lbl.mode');
		const mr = Vw.div(f, { class: 'ir-row' });
		const modes = [['normal', 'mode.normal.fetch'], ['keep', 'mode.normal.keep'], ['sync', 'hdr.mode.sync'], ['server', 'hdr.mode.server']]; // v2.13 §40: keep 追加
		const radios = {};
		for (const [m, key] of modes) {
			const lb = Vw.add(mr, 'label', { class: 'ir-rd' });
			const r = Vw.ipt(lb, { type: 'radio', name: 'ir-mode', value: m });
			r.checked = m === 'normal';
			if (m === 'server' && !(room && (room.srvOn === true || room.srvOn === 'true'))) r.disabled = true;
			radios[m] = r;
			Vw.add(lb, 'span').textContent = t(key);
		}
		const row = Vw.div(f, { class: 'ir-row' });
		const go = Vw.btn(row, { class: 'ir-btn', type: 'button' }); // v2.15 §42: 全ボタン type=button + form submit で Enter 対応
		Vw.sT(go, t('btn.login'));
		Vw.ael(f, 'submit', e => {
			e.preventDefault();
			go.click();
		});
		Vw.click(go, () => {
			const nmRaw = nmIn.value.trim();
			const nb = room && room.nm ? room.nm : (nmRaw ? RoomApp.nb(nmRaw) : '');
			if (!nb) {
				Toast(t('msg.form.nm'));
				return;
			}
			if (!uidIn.value.trim()) {
				Toast(t('msg.form.uid'));
				return;
			}
			const mode = Object.keys(radios).find(m => radios[m].checked) || 'normal';
			this.tryLogin({ rid: rid || '', room, nb, uid: uidIn.value.trim(), pw: pwIn.value, mode, f });
		});
		const sc = Vw.btn(row, { class: 'ir-btn', type: 'button' }); // QR スキャン（§5.4 カメラ→PNG→ペースト縮退）
		Vw.sT(sc, t('btn.scan'));
		Vw.click(sc, () => this.scanFlow(d => {
			const u = qrUnpack(d);
			if (!u) {
				Toast(t('msg.qr.verify.fail'));
				return;
			}
			nmIn.value = RoomApp.unB64(u.nameB64U) || u.nameB64U;
			pwIn.value = u.pw;
			this.pendingNb = u.nameB64U; // QR が正 → room.json の nm より QR を優先
		}));
		if (room && room.conflict) Vw.add(f, 'div', { class: 'ir-mut' }).textContent = t('msg.creator.otherAdmin'); // §6.9
		if (room && rl) { // §5.1 別 uid 再ログインはログアウト後
			Vw.add(f, 'div', { class: 'ir-mut' }).textContent = t('msg.session.mirror') + ' uid: ' + rl.uid;
		}
	}
	// rid 解決（部屋名 b64url → §7.3）
	async ridOfNb(nb) {
		return await ridOf(nb);
	}
	// v2.7 §33: QR 認証 QR のコピーはパック文字列（TMIWR1:<部屋名b64url>:<パスワード>）。
	// 貼り付いた TMIWR1: はパスワードの一部ではないため、パスワード欄ではパック/プレフィックスを自動除去する。
	static pwFromField(raw) {
		const t = (raw || '').trim();
		if (!t.startsWith(QR_PREFIX)) return t;
		const u = qrUnpack(t);
		if (u && u.pw) return u.pw;
		return t.slice(QR_PREFIX.length).trim() || t; // TMIWR1:<pw> 形
	}
	async tryLogin({ rid, room, nb, uid, pw, mode, f }) {
		pw = RoomApp.pwFromField(pw);
		if (room && room.pw && room.seedV !== 2) Toast(t('msg.seed.legacy')); // v2.11 §38: 更新前クライアント由来の旧 seed 部屋
		if (!rid) rid = await this.ridOfNb(nb); // 新規参加: 既存でなければ room.json は書かない（room_session の authOk 時保存想定）
		const r = room || { nm: nb };
		if (this.pendingNb) {
			r.nm = this.pendingNb;
			this.pendingNb = '';
		} else if (!r.nm) r.nm = nb;
		const ctx = await this.openRoom({ rid, nb: r.nm, room: r, uid, mode });
		ctx.lastTry = { rid, room: r, nb: r.nm, uid, pw, mode };
		location.hash = encodeURIComponent(r.nm); // §5.1 ハッシュに部屋 b64url（QR/リンク互換）
		this.view = { t: 'room', rid };
		this.activate(rid);
		let ok = false;
		try {
			ok = await ctx.session.login({ password: pw, mode, uid });
		} catch (e) {
			ef(e, 'room_app.login');
		}
		if (!ok) {
			this.retryBox(ctx); // §12 「採決応答なし」等: タブは認証待ちのまま再試行
		} else {
			AppSettings.setNested('MODE.' + rid, mode).catch(e => ef(e, 'room_app.mode'));
			this.usageDirty();
		}
	}
	retryBox(ctx) {
		const m = this.main;
		Vw.rc(m);
		Vw.add(m, 'div', { class: 'ir-sec' }).textContent = t('msg.auth.fail');
		// v2.8 §34: 自機情報のみを表示する診断欄（採決不 OK の切り分け用。秘密は出さない）
		const lt = ctx.lastTry || {};
		Vw.add(m, 'div', { class: 'ir-mut' }).textContent = t('diag.title') + ' ' + t('diag.origin') + ': ' + location.origin + ' / ' + t('diag.mode') + ': ' + (lt.mode || '-');
		Vw.add(m, 'div', { class: 'ir-mut' }).textContent = t('diag.hint');
		const b = Vw.btn(m, { class: 'ir-btn' });
		Vw.sT(b, t('btn.retry'));
		Vw.click(b, () => this.tryLogin(ctx.lastTry));
	}
	// 再ログイン済みセッション参加（§9.12。pwSalt 有効期間内のみ再参加）
	async rejoinRoom(rid, room, rl) {
		const nb = room.nm || RoomApp.nb(room.nm);
		const ctx = await this.openRoom({ rid, nb, room, uid: rl.uid, mode: rl.mode || 'normal' });
		location.hash = encodeURIComponent(nb);
		this.view = { t: 'room', rid };
		this.activate(rid);
		const ok = await ctx.session.rejoin().catch(e => {
			ef(e, 'room_app.rejoin');
			return false;
		});
		if (!ok) this.loginForm(rid, room);
	}
	// ---- 部屋作成（§5.3: 作成者のみ。xorig 作成時固定。pw 自動生成 §6.3）----
	async createForm() {
		this.view = { t: 'create' };
		Vw.rc(this.main);
		const f = Vw.add(this.main, 'form', { class: 'ir-frm' }); // v2.15 §42: 実 form（パスワードマネージャ検知: username/new-password）
		Vw.add(f, 'h3').textContent = t('btn.create');
		const nmIn = Vw.ipt(f, { type: 'text', name: 'ir-cn', placeholder: t('lbl.room.name'), autocomplete: 'off' });
		const uidIn = Vw.ipt(f, { type: 'text', name: 'ir-cuid', placeholder: t('lbl.username'), autocomplete: 'username' });
		Vw.add(f, 'label').textContent = t('lbl.password'); // v2.3 §27: パスワードエリアにラベル
		const pwIn = Vw.ipt(f, { type: 'text', name: 'ir-cpw', placeholder: t('lbl.password'), autocomplete: 'new-password' });
		// v2.3 §27: 最終作成値（LS）を初期値に。部屋名には yyyy-mm-dd-hh-mm-ss を追加（既存同形式は置換）。名前無ければ names からランダム
		const last = await this.lastDef();
		if (last && last.nm) nmIn.value = this.withTs(last.nm);
		uidIn.value = (last && last.uid) || this.rndName();
		const mxRow = Vw.div(f, { class: 'ir-row' }); // 追加仕様: 単一画像上限（既定 10MB・作成時に変更可）
		Vw.add(mxRow, 'span', { class: 'ir-mut' }).textContent = t('lbl.maxmb');
		const mxIn = Vw.ipt(mxRow, { type: 'number', name: 'ir-cmx', min: '1', max: '200', step: '1' });
		mxIn.value = String(Math.max(1, Math.round((this.cfg.MAX_IMG_BYTES || 10485760) / 1048576)));
		const row = Vw.div(f, { class: 'ir-row' });
		const gen = Vw.btn(row, { class: 'ir-btn', type: 'button' }); // 生成（512bit b64url）。v2.2 §26: 既定で自動生成済み・ボタンは再作成
		Vw.sT(gen, t('btn.pw.auto'));
		const doGen = async () => {
			try {
				pwIn.value = await AuthChallenge.newPw(this.cfg.PW_BITS);
			} catch (e) {
				ef(e, 'room_app.newPw');
			}
		};
		Vw.click(gen, doGen);
		doGen(); // 起動時点で自動生成パスワードをデフォルト設定
		const xo = Toggle({ parent: row, label: 'btn.xorig', onChange: () => {} }); // xorig=true で以後メニューから oa 管理（§6.6）
		const go = Vw.btn(row, { class: 'ir-btn', type: 'button' });
		Vw.sT(go, t('btn.create'));
		const bw = Vw.btn(row, { class: 'ir-btn', type: 'button' }); // v2.5 §30: 部屋作成画面にも接続設定
		Vw.sT(bw, '⚙️ ' + t('btn.ws'));
		Vw.click(bw, () => this.wsForm());
		Vw.ael(f, 'submit', e => { // v2.15 §42: Enter → 部屋作成
			e.preventDefault();
			go.click();
		});
		Vw.click(go, async () => {
			const nmRaw = nmIn.value.trim(),
				uid = uidIn.value.trim(),
				pw = RoomApp.pwFromField(pwIn.value); // v2.7 §33: パック貼り付け耐性
			if (!nmRaw || !uid || !pw) {
				Toast(t(nmRaw ? (uid ? 'msg.form.uid' : 'msg.form.nm') : 'msg.form.nm'));
				return;
			}
			const nb = RoomApp.nb(nmRaw);
			const rid = await this.ridOfNb(nb);
			if (await this.roomExists(rid)) { // §5.3 同一 roomId 作成不可 → ログインへ
				Toast(t('msg.room.exists'));
				this.loginForm(rid, await this.readRoom(rid));
				return;
			}
			const mx = Math.min(200, Math.max(1, parseInt(mxIn.value, 10) || 10)) * 1048576;
			await this.doCreate({ rid, nb, nmRaw, uid, pw, xorig: xo.get(), mx });
		});
	}
	// ---- v2.3 §27: 最終作成値（LocalStorage: base64url(DEFLATE(JSON{nm,uid}))）----
	static TS_RE = /(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})$/;
	static tsStr() {
		const d = new Date(),
			p2 = n => (n < 10 ? '0' + n : '' + n);
		return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}`;
	}
	withTs(nm) { // 同一形式（yyyy-mm-dd-hh-mm-ss）が末尾にあれば置換、無ければ追加
		const base = (nm || '').replace(RoomApp.TS_RE, '').replace(/-+$/, '');
		return (base ? base + '-' : '') + RoomApp.tsStr();
	}
	rndName() {
		const a = (this.cfg && this.cfg.names) || [];
		if (!a.length) return '';
		const i = crypto.getRandomValues(new Uint32Array(1))[0] % a.length;
		return a[i];
	}
	async lastDef() { // 復号: 先頭 D=deflate-raw / R=平文。localStorage 未対応/不正は null
		try {
			const v = localStorage.getItem('ir_lastdef');
			if (!v || v.length < 2) return null;
			const kind = v[0],
				bin = atob(v.slice(1).replace(/-/g, '+').replace(/_/g, '/')),
				u8 = new Uint8Array(bin.length);
			for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
			let j;
			if (kind === 'D') {
				if (typeof DecompressionStream !== 'function') return null;
				j = await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
			} else j = new TextDecoder().decode(u8);
			const o = JSON.parse(j);
			return o && typeof o.nm === 'string' && typeof o.uid === 'string' ? o : null;
		} catch (e) {
			ef(e, 'room_app.lastDef');
			return null;
		}
	}
	async saveLastDef(o) { // JSON → deflate-raw → base64url（URL 安全符号）で LocalStorage
		try {
			const j = JSON.stringify(o);
			let kind = 'R',
				bytes = new TextEncoder().encode(j);
			if (typeof CompressionStream === 'function') {
				try {
					bytes = new Uint8Array(await new Response(new Blob([j]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
					kind = 'D';
				} catch (e) {
					ef(e, 'room_app.gzip');
				}
			}
			let bin = '';
			for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
			localStorage.setItem('ir_lastdef', kind + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
		} catch (e) {
			ef(e, 'room_app.saveLastDef');
		}
	}
	// ---- v2.4 §28: WebSocket URL 設定フォーム（QR 表示・変更・カメラ/PNG 読取）----
	wsForm() {
		const box = this.dlg(t('ws.title'));
		Vw.add(box, 'div', { class: 'ir-mut' }).textContent = t('ws.note');
		const inp = Vw.ipt(box, { type: 'text', name: 'ir-wsb', placeholder: location.origin });
		inp.value = (this.cfg && this.cfg.WSBASE) || '';
		const baseOf = () => {
			const v = inp.value.trim();
			return v ? wsNorm(v) || v : location.origin;
		};
		const qrHost = Vw.div(box, { class: 'ir-wsqr' });
		const draw = async () => {
			await this.qrInto(qrHost, WS_PREFIX + baseOf(), { file: 'ws_url_qr.png' });
		};
		const apply = async () => {
			const raw = inp.value.trim();
			if (/[\s,]/.test(raw)) {
				Toast(t('msg.ws.multi')); // v2.6 §31: 複数指定不可（単一値のみ OPFS user_settings.json に保持）
				return;
			}
			if (raw && !wsNorm(raw)) {
				Toast(t('msg.ws.bad'));
				return;
			}
			const norm = raw ? wsNorm(raw) : '';
			inp.value = norm;
			setWsBase(norm);
			this.cfg.WSBASE = norm;
			AppSettings.set('WSBASE', norm).catch(e => ef(e, 'room_app.wsbase'));
			Toast(t('msg.ws.set') + ' ' + getWsBase());
			draw().catch(e => ef(e, 'room_app.wsQr'));
		};
		draw().catch(e => ef(e, 'room_app.wsQr0')); // v2.5 §30: QR はデフォルト表示
		const r1 = Vw.div(box, { class: 'ir-row' });
		const bQr = Vw.btn(r1, { class: 'ir-btn' });
		Vw.sT(bQr, t('ws.btn.qr'));
		Vw.click(bQr, () => {
			draw().catch(e => ef(e, 'room_app.wsQr'));
		});
		const bScan = Vw.btn(r1, { class: 'ir-btn' });
		Vw.sT(bScan, t('ws.btn.scan'));
		Vw.click(bScan, () => this.scanFlow(raw => {
			let v = raw || '';
			if (v.startsWith(WS_PREFIX)) v = v.slice(WS_PREFIX.length);
			const n = wsNorm(v);
			if (!n) {
				Toast(t('msg.ws.bad'));
				return;
			}
			inp.value = n;
			Toast(t('msg.ws.got'));
			draw().catch(e => ef(e, 'room_app.wsQr'));
		}));
		const bAp = Vw.btn(r1, { class: 'ir-btn' });
		Vw.sT(bAp, t('ws.btn.apply'));
		Vw.click(bAp, () => {
			apply().catch(e => ef(e, 'room_app.wsApply'));
		});
		const bDef = Vw.btn(r1, { class: 'ir-btn' });
		Vw.sT(bDef, t('ws.btn.default'));
		Vw.click(bDef, () => {
			inp.value = '';
			apply().catch(e => ef(e, 'room_app.wsDefault'));
		});
	}
	async roomExists(rid) {
		if (!this.opfsOk) return false;
		try {
			return await OPFS.isEf(STORAGE.roomFile(rid));
		} catch (e) {
			return false;
		}
	}
	async readRoom(rid) {
		try {
			const ab = await OPFS.r(STORAGE.roomFile(rid));
			return ab && ab.byteLength ? JSON.parse(Y.u2s(ab)) : null;
		} catch (e) {
			return null;
		}
	}
	async doCreate({ rid, nb, nmRaw, uid, pw, xorig, mx = 0 }) {
		// 作成者は room.json に seed を保管 → session.login の初回採決不要ショートカット（§5.3/§6.2）
		const salt = AuthChallenge.saltNormal();
		const seed = await AuthChallenge.seed(pw, nb, salt, this.cfg.HASH_ROUNDS); // v2.11 §38: origin 無し
		const room = { rid, nm: nb, pw: seed, pwSalt: salt, srvOn: false, cr: uid, cg: Date.now(), xorig: !!xorig, oa: [], mx: +mx || 0 };
		await OPFS.w(STORAGE.roomFile(rid), Y.s2u(JSON.stringify(room)).buffer);
		try { // v2.20 §47: 部屋単位の鍵組と署名を OPFS に作成（クレームは QR/URL アンカーで配布）
			await this._crKeys(rid, nmRaw, uid, room.cg);
		} catch (e) {
			ef(e, 'room_app.crKeys');
			Toast(t('msg.cr.keyfail'));
		}
		const ctx = await this.openRoom({ rid, nb, room, uid, mode: 'normal' });
		ctx.plainPw = pw; // QR 表示用（平文はセッション中のみ保持）
		location.hash = encodeURIComponent(nb);
		this.view = { t: 'room', rid };
		this.activate(rid);
		const ok = await ctx.session.login({ password: pw, mode: 'normal' }).catch(e => {
			ef(e, 'room_app.createLogin');
			return false;
		});
		if (!ok) {
			this.retryBox(ctx);
			return;
		}
		Toast(t('msg.room.created') + ' ' + nmRaw);
		AppSettings.setNested('MODE.' + rid, 'normal').catch(e => ef(e, 'room_app.mode'));
		this.saveLastDef({ nm: nmRaw, uid }).catch(e => ef(e, 'room_app.lastDef')); // v2.3 §27: 次回作成の初期値
	}
	// ---- QR スキャン（§5.4: camera→error なら PNG file→text paste）----
	scanFlow(onFound) {
		const box = this.dlg(t('btn.scan'));
		Vw.add(box, 'div', { class: 'ir-mut' }).textContent = t('msg.scan.paste');
		const cam = Vw.btn(box, { class: 'ir-btn' });
		Vw.sT(cam, t('btn.scan'));
		const done = data => {
			box._close(); // H4: dlg.close() 経由（keydown 解除+_onClose 発火）
			onFound(data);
		};
		let stop = null;
		// v1.3.1 H3: camera は async（Promise）。stop を確実に保持し、閉じ経路（☓/Esc/背景/done）全てで停止させる
		const startCam = () => {
			if (stop) return; // 起動済み
			QRScan.camera(done).then(r => {
				if (r && r.stop) stop = r.stop;
				else {
					Vw.sS(cam, { display: 'none' });
					Toast(t('msg.scan.cameraUnavail')); // §12/§5.4 フォールバック UI
				}
			}, () => {
				Vw.sS(cam, { display: 'none' });
				Toast(t('msg.scan.cameraUnavail'));
			});
		};
		box._onClose = () => {
			if (stop) try {
				stop(); // カメラ・rAF ループの停止（getUserMedia track も qr_scan 側 stop で解放）
			} catch (e) { /* stop 失敗無視 */ }
			stop = null;
		};
		if (QRScan.canCamera()) startCam();
		else Vw.sS(cam, { display: 'none' });
		Vw.click(cam, startCam);
		const fi = Vw.ipt(box, { type: 'file', accept: 'image/*' }); // PNG/JPG ファイル復号
		Vw.change(fi, async () => {
			const f = fi.files && fi.files[0];
			if (!f) return;
			const r = await QRScan.imageFile(f);
			if (r && r.data) done(r.data);
			else Toast(t((r && r.error) || 'msg.qr.verify.fail'));
		});
		const ta = Vw.add(box, 'textarea', { placeholder: t('msg.scan.paste') });
		const okb = Vw.btn(box, { class: 'ir-btn' });
		Vw.sT(okb, t('btn.join'));
		Vw.click(okb, () => {
			const s = QRScan.text((ta.value || '').trim());
			if (s) done(s);
		});
	}
	dlg(title) { // 共通モーダル（☓ 右上・Esc・背景クリックで閉じる。bx._close で程序から閉じ可）
		const mdl = Vw.add(Vw.gB(), 'div', { class: 'ir-mdl' });
		const bx = Vw.div(mdl, { class: 'ir-mbx' });
		const hd = Vw.div(bx, { class: 'ir-mhd' });
		Vw.add(hd, 'h3').textContent = title;
		const x = Vw.btn(hd, { class: 'ir-mclose', title: t('btn.close'), 'aria-label': t('btn.close') }); // ☓ 右上（追加仕様）
		x.textContent = '✕';
		const onKey = ev => {
			if (ev.key === 'Escape') close();
		};
		const close = () => {
			Vw.rel(document, 'keydown', onKey);
			Vw.rm(mdl);
			if (bx._onClose) bx._onClose(); // 呼び出し側後始末（ビューア単一化など）
		};
		Vw.ael(document, 'keydown', onKey);
		Vw.click(x, close);
		bx._mdl = mdl;
		bx._close = close;
		Vw.click(mdl, ev => {
			if (ev.target === mdl) close();
		});
		return bx;
	}
	async autoJoin() { // §5.7 サーバーモードは起動時に room.json があれば自動ログイン
		if (!this.opfsOk) return;
		const st = (AppSettings.state && AppSettings.state.roomLogin) || {};
		for (const rid of Object.keys(st)) {
			const rl = st[rid];
			if (this.rooms.has(rid)) continue; // 退避復帰等で既にセッション済み
			if (!rl || (AppSettings.state['MODE.' + rid] || (AppSettings.state.MODE || {})[rid]) !== 'server') continue;
			const room = await this.readRoom(rid);
			if (!room || room.conflict || !(room.srvOn === true || room.srvOn === 'true')) continue; // §6.8 未許可は自動ログインしない
			try {
				const ctx = await this.openRoom({ rid, nb: room.nm, room, uid: rl.uid, mode: 'server' });
				this.activate(rid);
				const ok = await ctx.session.rejoin().catch(() => false);
				if (!ok) this.loginForm(rid, room);
			} catch (e) {
				ef(e, 'room_app.autoJoin');
			}
		}
	}
	// ---- 一時退避（追加仕様 v1.3 §15.8）----
	hibernateState() { // 退避時に暗号化保存する一時情報（平文 pw は保持しているタブのみ）
		const ctx = this.activeCtx();
		return ctx ? { rid: ctx.rid, nb: ctx.nb, uid: ctx.uid, mode: ctx.mode, pw: ctx.plainPw || '' } : { rid: '' };
	}
	hibernateSafe() { // 退避して良いか（転送/共有/モーダル操作が進行中なら延期）
		if (document.querySelector('.ir-mdl')) return false;
		for (const ctx of this.rooms.values()) {
			if (ctx._sharing) return false;
			if (ctx.transfer && (ctx.transfer.in.size || ctx.transfer.out.size)) return false;
			if (ctx.sync && ctx.sync._pumping) return false;
			if (ctx.cal && ctx.cal.fetches.size) return false; // クリック取得（ビューア）中
		}
		return true;
	}
	async tryResume(hr) { // 退避条目からの自動復帰（rejoin→ダメなら pw で login→さらにダメならログイン画面）
		if (!this.opfsOk) return false;
		const room = await this.readRoom(hr.rid);
		if (!room || room.conflict) return false;
		try {
			const nb = room.nm || hr.nb,
				mode = hr.mode || 'normal',
				ctx = await this.openRoom({ rid: hr.rid, nb, room, uid: hr.uid, mode });
			if (hr.pw) ctx.plainPw = hr.pw; // 作成者は復帰後も pw QR/C 再発行が可能（追加仕様 v1.3）
			location.hash = encodeURIComponent(nb);
			this.view = { t: 'room', rid: hr.rid };
			this.activate(hr.rid);
			let ok = await ctx.session.rejoin().catch(() => false);
			if (!ok && hr.pw) ok = await ctx.session.login({ password: hr.pw, mode, uid: hr.uid }).catch(() => false);
			if (!ok) {
				this.loginForm(hr.rid, room);
				Toast(t('msg.hiber.fail'));
			} else Toast(t('msg.hiber.ok'));
			return true;
		} catch (e) {
			ef(e, 'room_app.resume');
			return false;
		}
	}
	// ---- 部屋セッション組立て（契約 boot 節 6: RoomSession+HashStore+FileTransfer+各モジュール）----
	async openRoom({ rid, nb, room, uid, mode }) {
		if (this.rooms.has(rid)) return this.rooms.get(rid);
		const cfg = this.cfg,
			ctx = {
				rid, nb, uid, mode, title: RoomApp.unB64((room && room.nm) || nb) || rid, plainPw: '',
				room: Object.assign({ nm: nb, pw: '', pwSalt: '', srvOn: false, cr: '', cg: 0, xorig: false, oa: [], mx: 0 }, room || {}),
			};
			// v2.21 §48: 最終参加時刻（ローカル表示用。ログアウトでも保持）
		AppSettings.setState('lj.' + rid, Date.now()).catch(e => ef(e, 'room_app.lj'));
		// send は session 経由（ミラーは BC 委譲、§9.12）。生成順循環回避の遅延バインド
		ctx.transfer = new FileTransfer({ send: s => (ctx.session ? ctx.session.sendFrame(s) : false), cfg, uid, gHoldMs: mode === 'server' ? (cfg.SRV_G_HOLD_MS || 10000) : (cfg.G_HOLD_MS || 30000) });
		// Q 応答側: 本体差し出し（§9.3。コンテンツアドレス故に保持していれば供給。nf=null）
		ctx.transfer.onNeedBody = async h10 => {
			try {
				const ab = await this.store.get(h10);
				return ab || null;
			} catch (e) {
				ef(e, 'room_app.needBody ' + h10);
				return null;
			}
		};
		ctx.session = new RoomSession({ rid, room: ctx.room, uid, mode, settings: AppSettings, transfer: ctx.transfer });
		ctx.collection = new Collection({ rid, nameB64U: nb, uid, store: this.store, cfg, sendFrame: s => ctx.session.sendFrame(s) });
		ctx.collection.cfg.MAX_IMG_BYTES = +ctx.room.mx > 0 ? +ctx.room.mx : cfg.MAX_IMG_BYTES; // 部屋毎上限（追加仕様。C 受信で共有部側も更新）
		await ctx.collection.loadManifest();
		await ctx.collection.refreshMetas();
		ctx.collection.sweepIfNeeded( // §9.8 部屋起動スイープ（lastSweep は app_state）
			() => (AppSettings.state && AppSettings.state.lastSweep) || 0,
			() => AppSettings.setState('lastSweep', Date.now()).catch(e => ef(e, 'room_app.sweepSet'))
		).catch(e => ef(e, 'room_app.sweepRoom'));
		ctx.sheet = new SheetRoom({ rid, uid, store: this.store, img: ImgProc, cfg, sendFrame: s => ctx.session.sendFrame(s), transfer: ctx.transfer });
		ctx.sheet.slices.max = mode === 'server' ? (cfg.SRV_SCACHE_MAX || 8) : (cfg.SCACHE_MAX || 64); // サーバーモード低メモリ化 v1.3
		await ctx.sheet.scan().catch(e => ef(e, 'room_app.sheetScan'));
		// 起動時: manifest→シート索引を復元（無変更なら送出なし。§9.7 オフライン再構築）
		await ctx.sheet.rebuild(ctx.collection.manifestEntries()).catch(e => ef(e, 'room_app.sheetRebuild'));
		ctx.sync = new SyncMode({ rid, uid, collection: ctx.collection, transfer: ctx.transfer, session: ctx.session, settings: AppSettings, cfg, store: this.store });
		ctx.sync.onProgress = s => { // §9.9 フッター進捗
			if (ctx.foot) Vw.sT(ctx.foot, t('lbl.sync.footer', { total: s.total, fetched: s.fetched }));
		};
		ctx.sync.start();
		await this._creatorFlow(ctx).catch(e => ef(e, 'room_app.creatorFlow')); // v2.20 §47: 作成者クレーム検証/鍵自認（全参加経路共通）
		ctx.slices = new SliceCache(mode === 'server' ? (cfg.SRV_SCACHE_MAX || 8) : (cfg.SCACHE_MAX || 64));
		// ---- session フック（契約外・lead 結合設計: hooks 公開プロパティ）----
		ctx.session.hooks = {
			onManifest: list => {
				ctx.collection.onPeers(list); // 保持者追跡 → §5.5 グレースケール判定
				ctx.sync.onManifestUpdate(); // §9.9 未所持キュー再構築
			},
			onM: (p, from) => ctx.sheet.onM(p, from),
			onS: (p, from) => ctx.sheet.onS(p, from),
			onT: (p, from) => ctx.sheet.onT(p, from),
			onX: (p, from) => ctx.collection.onDeleteX(p, from), // §9.5 r 除去
			onJ: (p, from) => ctx.sync.onManifestUpdate(),
			onB: (p, from) => ctx.cal && ctx.cal.refresh(),
		};
		// 現行 room_session は M/S/T/X を session.onFrame(p, from, rid) で配線（J/B/C・Q/H/A/G/~chunk は session 内部）。
		// M は同一 gen のページ連投（§7.4）のため、uid 単位でバースト蓄積してから onManifest を 1 回通す。
		ctx.peerMap = new Map(); // h10 -> {uid, idx, cell}（§7.4 sid/p。他端末シートからのサムネイル索引）
		ctx._mBuf = new Map();
		ctx._mTmr = null;
		ctx.attachThumb = it => {
			if (!it || it.thumb) return it;
			const own = ctx.sheet && ctx.sheet.placed && ctx.sheet.placed.get(it.h10);
			const src = own || ctx.peerMap.get(it.h10);
			if (src && src.idx != null) it.thumb = { uid: src.uid, idx: src.idx, cell: src.p != null ? src.p : src.cell };
			return it;
		};
		ctx.setItems = () => {
			if (ctx.cal) ctx.cal.setItems(ctx.collection.roomItems().map(ctx.attachThumb));
		};
		ctx._ingests = []; // M からの meta 取り込み（§9.4: 未所持でも meta は全員で共有→表示・sync 対象）
		ctx._ingestMeta = async e => {
			try {
				const m = await this.store.metaGet(e.h);
				if (!m) {
					const o = { h: e.h, n: e.n, r: e.r || [nb], u: e.u, ts: e.ts, t: e.t, l: e.l, s: e.s, c: e.c, d: null };
					if (Array.isArray(e.tg) && e.tg.length) o.tg = e.tg.slice(0, 16); // v2.19 §46
					await this.store.metaPut(o);
				} else {
					let ch = false;
					if (!(m.r || []).includes(nb)) { (m.r = m.r || []).push(nb); ch = true; } // §9.5 部屋横断: r マージ
					if (Array.isArray(e.tg) && e.tg.length) { // v2.19 §46: タグは加算マージ（union・16 個上限）
						const cur = Array.isArray(m.tg) ? m.tg : (m.tg = []);
						for (const x of e.tg) {
							const tgx = Collection.normTag(x);
							if (tgx && !cur.includes(tgx) && cur.length < 16) { cur.push(tgx); ch = true; }
						}
					}
					if (ch) await this.store.metaPut(m);
				}
			} catch (er) {
				ef(er, 'room_app.ingest ' + e.h);
			}
		};
		ctx.session.onFrame = (p, from) => {
			const hk = ctx.session.hooks;
			if (!hk) return;
			if (p.ir === IR.M) {
				const muid = p.uid || from;
				if (muid && muid !== ctx.session.uid) {
					const buf = ctx._mBuf.get(muid) || { entries: [] };
					for (const e of p.m || []) {
						if (!e || !e.h) continue;
						buf.entries.push(e);
						ctx._ingests.push(ctx._ingestMeta(e));
						const a = String(e.sid || '').split('.');
						if (a.length === 3) ctx.peerMap.set(e.h, { uid: a[1], idx: Number(a[2]), cell: e.p || 0 });
					}
					ctx._mBuf.set(muid, buf);
					clearTimeout(ctx._mTmr);
					ctx._mTmr = setTimeout(async () => {
						const list = [];
						for (const [u, b] of ctx._mBuf) list.push({ uid: u, entries: b.entries });
						ctx._mBuf.clear();
						await Promise.allSettled(ctx._ingests);
						ctx._ingests = [];
						hk.onManifest(list);
						ctx.collection.refreshMetas().then(() => ctx.setItems()).catch(e2 => ef(e2, 'room_app.refreshMetas'));
					}, 400);
				}
				hk.onM(p, from);
			} else if (p.ir === IR.S) hk.onS(p, from);
			else if (p.ir === IR.T) hk.onT(p, from);
			else if (p.ir === IR.X) hk.onX(p, from);
			else if (p.ir === IR.J) {
				hk.onJ(p, from);
				// 新規参加者へ自保持索引を再周知（§9.4。1〜4s 遅延で送信中の M と間引く）
				if (!p.to && p.uid !== ctx.session.uid)
					setTimeout(() => {
						try {
							ctx.sheet.broadcastMNow();
						} catch (e) {
							ef(e, 'room_app.renotify');
						}
					}, 1000 + Math.random() * 3000);
			} else if (p.ir === IR.B) hk.onB(p, from);
			else if (p.ir === IR.TG) this._onTG(ctx, p, from).catch(e => ef(e, 'room_app.TG')); // v2.19 §46
		};
		// ---- セッションイベント（§12 Toast/強制ログアウト）----
		ctx.session.on('open', () => {
			this.renderTabs();
			if (ctx.cal) ctx.cal.refresh();
		});
		ctx.session.on('close', () => {
			this.renderTabs();
			Toast(t('msg.offline')); // §9.7 オフライン継続
		});
		ctx.session.on('authOk', () => {
			this.usageDirty();
			this.renderTabs();
			if (ctx.room.cr === ctx.uid) this.pushC(ctx).catch(() => {}); // 追加仕様: 作成者は設定(mx 等)を再配信（cg 同一分は受信側で無視・新規参加者は採用）
			if (ctx.sheet) ctx.sheet.broadcastMNow(); // §9.4 自保持索引の周知
			setTimeout(() => { try { this._tagAsk(ctx); } catch (e) { ef(e, 'room_app.tagAsk'); } }, 1500 + Math.random() * 1500); // v2.19 §46: 同期時に部屋タグ登録表を取得（遅延で参加直後の roster 確定を待つ）
			ctx.setItems();
			if (this.active === rid) this.renderRoom(rid);
		});
		ctx.session.on('authFail', reason => Toast(t(reason || 'msg.auth.fail'))); // §12
		ctx.session.on('roomUpdate', r => { // C 反映を ctx.room（共有側）へ同期（追加仕様: mx/srvOn）
			Object.assign(ctx.room, r);
			ctx.collection.cfg.MAX_IMG_BYTES = +ctx.room.mx > 0 ? +ctx.room.mx : this.cfg.MAX_IMG_BYTES;
			this.renderTabs();
			if (ctx._zone) ctx._zone.classList.toggle('ir-srvon', r && (r.srvOn === true || r.srvOn === 'true')); // v2.2 §26: 同期ゾーンの枠線/色をライブ反映
		});
		ctx.session.on('participants', list => {
			ctx.collection.setOnline((list || []).map(x => x.uid));
			if (ctx.paintParts) ctx.paintParts(list);
			if (ctx.cal) ctx.cal.refresh(); // 保持者不在グレースケール
			const lw = ctx.session.lastWarn;
			if (lw && !ctx.warned) { // §6.6/§8.3 警告表示
				ctx.warned = true;
				Toast(t(lw.type === 'xorig' ? 'msg.xorig.mismatch' : 'msg.conflict.blocked'));
			}
		});
		ctx.session.on('conflict', () => { // §6.9 部屋再作成
			this.forcedMsg = 'msg.conflict.blocked';
			this.forcedLogout(rid);
		});
		ctx.session.on('srvOff', () => { // §6.8 強制ログアウト・自動再参加しない
			this.forcedMsg = 'msg.srv.kicked';
			this.forcedLogout(rid);
		});
		ctx.session.on('monthExpire', () => { // §6.7 UTC 月境界
			this.forcedMsg = 'msg.month.expire';
			this.forcedLogout(rid);
		});
		ctx.session.on('mirror', () => this.renderTabs()); // §9.12 ミラータブ
		ctx.session.on('takeover', () => this.renderTabs()); // セッション権継承
		ctx.collection.on('changed', () => {
			this.usageDirty(); // §9.11 画像変更イベント
			if (ctx.cal) ctx.setItems();
		});
		ctx.sheet.on('sheets', () => {
			this.usageDirty();
			ctx.setItems(); // 相手シート到着でサムネイル再生成（§9.2）
		});
		this.rooms.set(rid, ctx);
		return ctx;
	}
	// v2.13 §40: 取得保持モード — 本文取得完了で OPFS 永続化+manifest 採用（自が保持者化: 以降ローカル優先・他機へも供給可）。
	// v2.14 §41: ab=null は「本文は既にローカル」（ビューア自動保存分などの manifest 採用のみ）。mset 既存は no-op
	async keepAdopt(ctx, h10, ab) {
		try {
			if (ctx.collection.mset.has(h10)) return;
			if (ab) {
				await this.store.put(ab);
				this.usageDirty();
			}
			const meta = ctx.collection.metas.get(h10) || await this.store.metaGet(h10);
			if (meta && ctx.collection.adopt(meta)) {
				await ctx.collection.saveManifest();
				await ctx.sheet.rebuild(ctx.collection.manifestEntries()); // 変更シートのみ queueBroadcast（§8.6 スロットル）
			}
		} catch (e) {
			ef(e, 'room_app.keepAdopt');
		}
	}
	bodyOf(h10) { // RoomCalendar img.bodyOf 注入（未取得は undefined → 空白）
		return this.store.get(h10).then(ab => (ab ? ImgProc.ab2blob(ab) : null)).catch(() => null);
	}
	activate(rid) {
		this.active = rid;
		this.renderRoom(rid);
	}
	// ---- 部屋ビュー（§5.2: 参加者バー/共有部/カレンダー/フッター）----
	async renderRoom(rid) {
		const ctx = this.rooms.get(rid);
		if (!ctx) {
			this.home();
			return;
		}
		this.view = { t: 'room', rid };
		Vw.rc(this.main);
		this.renderTabs();
		// 参加者バッジ列（部屋名下・参加時刻昇順・サーバーモード参加者に S マーク。追加仕様）
		const pr = Vw.div(this.main, { class: 'ir-parts' });
		Vw.add(pr, 'span', { class: 'ir-parts-lbl' }).textContent = t('lbl.participants');
		ctx.partsEl = Vw.div(pr, { class: 'ir-row' });
		this.paintCr(ctx); // v2.20 §47: 作成者表示（クレーム検証済み/自機署名一致）
		ctx.paintParts = list => {
			Vw.rc(ctx.partsEl);
			const ps = (list || ctx.session.state.participants || []).slice().sort((a, b) => (a.t || 0) - (b.t || 0));
			for (const pt of ps) {
				const b = Vw.add(ctx.partsEl, 'span', { class: 'ir-pbadge' + (pt.uid === ctx.uid ? ' me' : '') });
				Vw.add(b, 'span').textContent = pt.uid;
				if (pt.md === 'server') Badge(b, 'ir-ps', 'S');
				b.title = t('lbl.part.join') + ': ' + (pt.t ? new Date(pt.t).toLocaleString() + ' (' + pt.t + ')' : '?');
			}
		};
		ctx.paintParts();
		// 作成者専用サブタブ: 画像 ⇄ URL QR ⇄ パスワード QR（追加仕様・作成者のみ表示）
		if (ctx.room.cr === ctx.uid) {
			const st = Vw.div(this.main, { class: 'ir-subtabs' });
			for (const [k, key] of [['imgs', 'tab.view.imgs'], ['qrurl', 'tab.view.qrurl'], ['qrpw', 'tab.view.qrpw']]) {
				const b = Vw.btn(st, { class: 'ir-subtab' + ((ctx.sub || 'imgs') === k ? ' on' : '') });
				Vw.sT(b, t(key));
				Vw.click(b, () => {
					ctx.sub = k;
					this.renderRoom(rid);
				});
			}
			if (ctx.sub && ctx.sub !== 'imgs') {
				this.qrPanel(ctx);
				return;
			}
		}
		if (ctx.mode === 'server') this.urlQrBlock(ctx); // サーバーモードは URL QR 常時表示（追加仕様）
		// 同期ゾーン（v2.2 §26: 同期モード時は共有欄〜カレンダーを枠線で囲み色を変える）
		const srv = ctx.room.srvOn === true || ctx.room.srvOn === 'true';
		const zone = Vw.div(this.main, { class: 'ir-seczone' + (srv ? ' ir-srvon' : '') });
		ctx._zone = zone;
		// 共有部（§9.1: ファイル input → share → setThumb → rebuild → M broadcast[スロットル]）
		const sb = Vw.div(zone, { class: 'ir-sec' });
		const up = Vw.div(sb, { class: 'ir-uparea' }); // v2.3 §27: 明色は画像登録エリアのみ
		const fi = Vw.ipt(up, { type: 'file', accept: 'image/*', multiple: 'multiple' });
		Vw.aC(fi, 'ir-file');
		Vw.change(fi, async () => {
			const files = Array.prototype.slice.call(fi.files || []);
			if (!files.length) return;
			fi.disabled = true;
			ctx._sharing = true; // 退避の安全点判定（転送中はリロードしない）
			try {
				let shared = 0;
				// 部屋毎アップロード上限（追加仕様: C 配信で最新化）
				ctx.collection.cfg.MAX_IMG_BYTES = +ctx.room.mx > 0 ? +ctx.room.mx : this.cfg.MAX_IMG_BYTES;
				// §17 大きな画像・形式ポリシー（v1.4）: 非対応形式は即お断り。256MB 超確実も即お断り。
				// 上限超（既定 10MB）は JPEG 縮小変換での共有を確認。
				const MX_HARD = 256 * 1048576;
				const OKM = { 'image/png': 1, 'image/jpeg': 1, 'image/webp': 1, 'image/gif': 1, 'image/bmp': 1, 'image/avif': 1 };
				for (const f of files) {
					const mx = ctx.collection.cfg.MAX_IMG_BYTES;
					let use = f;
					if (!OKM[(f.type || '').toLowerCase()]) {
						Toast(t('msg.share.unsupported', { name: f.name })); // ブラウザ非対応形式 → 上記以前にお断り
						continue;
					}
					if (f.size > MX_HARD) {
						Toast(t('msg.share.tooBig'));
						continue;
					}
					if (f.size > mx) {
						let d = null;
						try {
							d = ImgProc.sniffDims(new Uint8Array(await f.slice(0, 65536).arrayBuffer()), (f.type || '').toLowerCase());
						} catch (e) { /* ヘッダ読めぬものはデコードテストへ委ねる */ }
						if (d && d.w > 0 && d.h > 0 && d.w * d.h * 4 > MX_HARD) {
							Toast(t('msg.share.tooBig')); // デコードで 256MB を明らかに超える寸法 → お断り
							continue;
						}
						if (!window.confirm(t('msg.share.over', { name: f.name, mb: (f.size / 1048576).toFixed(1), lim: Math.round(mx / 1048576) }))) continue;
						const s = await ImgProc.shrink(f); // 縮小+JPEG 再圧縮（失敗=実質非対応）
						if (!s) {
							Toast(t('msg.share.unsupported', { name: f.name }));
							continue;
						}
						use = new File([s.blob], f.name.replace(/\.[^.]*$/, '') + '.jpg', { type: 'image/jpeg' });
					}
					const r = await ctx.collection.share(use, { name: use.name, mime: use.type, defer: true }); // 一括: manifest 保存は末尾 1 回
					if (r.error === 'tooBig') Toast(t('msg.share.tooBig', { limit: Math.round((+ctx.room.mx > 0 ? +ctx.room.mx : this.cfg.MAX_IMG_BYTES) / 1048576) })); // §11 上限（部屋 mx）
					else if (r.error) Toast(t('msg.share.fail'));
					else {
						shared++;
						try {
							ctx.sheet.setThumb(r.h10, await ImgProc.thumb(use, this.cfg.THUMB_BASE_PX || 128)); // §9.2 コマ（v1.6 §20: 基準 128 contain）
						} catch (e) {
							ef(e, 'room_app.thumb');
						}
					}
				}
				if (shared) {
					await ctx.collection.saveManifest(); // v1.5 §19: 一括共有の manifest 確定（差分行の一括追記）
					await ctx.sheet.rebuild(ctx.collection.manifestEntries()); // 変更シートのみ queueBroadcast→スロットル送出（§8.6）
					Toast(t('msg.share.ok'));
				}
			} catch (e) {
				ef(e, 'room_app.share');
				Toast(t('msg.share.fail'));
			}
			ctx._sharing = false;
			fi.value = '';
			fi.disabled = false;
		});
		// カレンダー（§5.5。RoomCalendar が窓制御・grayscale・progress 内蔵）
		// v2.0 §24: 日/週/月とサムネサイズはサムネ下のタブ行へ統合（上部ピッカー/モード行は廃止）
		const szBtns = [];
		const mkSzPick = host => {
			const l = Vw.add(host, 'span', { class: 'ir-mut' });
			Vw.sT(l, t('lbl.thumb.size'));
			Vw.sS(l, { margin: '0 6px 0 2px' });
			for (const v of this.cfg.THUMB_OPTS || [32, 64, 96, 128]) {
				const b = Vw.btn(host, { class: 'ir-btn ir-tsz' });
				Vw.sT(b, String(v));
				Vw.tC(b, 'on', v === this.cfg.THUMB_PX);
				Vw.click(b, () => applySz(v));
				szBtns.push([v, b]);
			}
		};
		const applySz = v => {
			this.cfg.THUMB_PX = v;
			this.setCssVars();
			for (const [val, b] of szBtns) Vw.tC(b, 'on', val === v);
			if (ctx.cal) ctx.cal.setThumbPx(v);
			if (this.opfsOk) AppSettings.set('THUMB_PX', v).catch(() => {}); // 永続（次回起動時も同サイズ）
		};
		const calHost = Vw.div(zone, {});
		if (!ctx.cal) {
			ctx.cal = new RoomCalendar({ parent: calHost, cfg: this.cfg, collection: ctx.collection, slices: { slicesOf: (u, i) => ctx.sheet.slicesOf(u, i) }, transfer: ctx.transfer, img: { bodyOf: h10 => this.bodyOf(h10) }, keep: ctx.mode === 'keep', afterBody: (h10, ab) => this.keepAdopt(ctx, h10, ab) });
			ctx.cal.online = () => { const s = ctx.session && ctx.session.state; return !!(s && s.online && s.authed); }; // v2.21 §48: 接続断で fetch 禁止（表示は OPFS 実在分のみ）
			ctx.cal.sc.max = ctx.mode === 'server' ? (this.cfg.SRV_SCACHE_MAX || 8) : (this.cfg.SCACHE_MAX || 64); // サーバーモード低メモリ化 v1.3
			ctx.cal.onBody = (h10, blob) => this.viewer(h10, blob); // §5.4 ビューア橋渡し
			ctx.cal.setMode(this.cfg.CAL_VIEW || 'month');
		} else calHost.appendChild(ctx.cal.root);
		ctx.setItems();
		ctx.cal.refresh();
		const ctrl = Vw.div(this.main, { class: 'ir-ctrlbar' }); // v2.1 §25: 日週月&サムネサイズを左下固定（スマホでも常時表示）
		const btmTab = Vw.div(ctrl, { class: 'ir-calbar' }); // v2.0 §24: 日/週/月タブ（v2.1 で左下固定バー内）
		if (ctx.cal.bar) btmTab.appendChild(ctx.cal.bar); // RoomCalendar のバーを下部へ統合（ハンドラ/on 同期は要素ごと移動）
		for (const [m, mb] of ctx.cal._modeBtns) Vw.ael(mb, 'click', () => {
			this.cfg.CAL_VIEW = m; // モード永続化（下部タブ統合に伴いここで記録）
		});
		const btm = Vw.div(ctrl, { class: 'ir-row ir-botrow' }); // サムネサイズはタブの次の行（§24: 行高ギリギリ・行間 1px）
		mkSzPick(btm);
		// フッター（同期モード時のみ、§9.9）
		ctx.foot = Vw.add(this.main, 'div', { class: 'ir-mut' });
		Vw.sS(ctx.foot, { display: ctx.sync.enabled ? '' : 'none' });
		Vw.sT(ctx.foot, t('lbl.sync.footer', { total: 0, fetched: 0 }));
		if (ctx.mode === 'server') this.serverPanel(ctx); // §5.7
	}

	async serverPanel(ctx) {
		const s = Vw.div(this.main, { class: 'ir-sec' });
		Vw.add(s, 'h4').textContent = t('lbl.participants');
		const pl = Vw.div(s);
		const paintSrv = list => { // サーバーパネル側の参加者一覧（保持数併記・S 明示）
			Vw.rc(pl);
			for (const pt of (list || ctx.session.state.participants || [])) {
				const row = Vw.div(pl, { class: 'ir-row' });
				Vw.add(row, 'span').textContent = pt.uid + (pt.md === 'server' ? ' [S]' : '');
				const hs = ctx.collection.peerHolds.get(pt.uid);
				if (hs) Vw.add(row, 'span', { class: 'ir-mut' }).textContent = hs.size;
			}
		};
		paintSrv(ctx.session.state.participants);
		Vw.add(s, 'h4').textContent = t('lbl.pastParticipants');
		const hl = Vw.div(s);
		try {
			const ab = await OPFS.r(STORAGE.history(ctx.rid));
			const h = ab && ab.byteLength ? JSON.parse(Y.u2s(ab)) : {};
			for (const uid of Object.keys(h || {})) {
				const e = h[uid] || {};
				const row = Vw.div(hl, { class: 'ir-row' });
				Vw.add(row, 'span').textContent = uid;
				Vw.add(row, 'span', { class: 'ir-mut' }).textContent = (e.n || 0) + ' × ' + new Date(e.t || 0).toLocaleString();
			}
		} catch (e) { /* history 未作成 */ }
		// OPFS 使用量: 全体 + この部屋の共有分（bodies+meta+sheet、§9.11）
		Vw.add(s, 'h4').textContent = t('lbl.opfs.total');
		this.usageNow();
		const roomSz = Vw.add(s, 'div', { class: 'ir-mut' });
		Vw.sT(roomSz, t('lbl.opfs.room') + ': …');
		(async () => {
			try {
				const hs = ctx.collection.roomItems().filter(it => !it.trashed).map(it => it.h10);
				const sz = await this.store.sizesOf(hs);
				let sh = 0;
				for (const e of await OPFS.ls(STORAGE.sheet(ctx.rid))) if (e && e.s !== undefined) sh += e.s;
				Vw.sT(roomSz, t('lbl.opfs.room') + ': ' + useLabel((sz.bytes || 0) + sh) + ' (' + (sz.count || 0) + ')');
			} catch (e) {
				Vw.sT(roomSz, t('lbl.opfs.room') + ': -');
			}
		})();
		// 自動ダウンロード（§5.7 ON/OFF・クリア・件数）
		Vw.add(s, 'h4').textContent = t('btn.autodl');
		const ar = Vw.div(s, { class: 'ir-row' });
		const at = Toggle({ parent: ar, label: 'btn.autodl', onChange: on => ctx.sync.autodlEnable(on) });
		at.set(ctx.sync.autodlEnabled());
		const cnt = Vw.add(ar, 'span', { class: 'ir-mut' });
		const paintCnt = () => Vw.sT(cnt, t('lbl.autodl.count') + ': ' + ctx.sync.autodlCount());
		paintCnt();
		const cl = Vw.btn(ar, { class: 'ir-btn warn' }); // クリア（確認ダイアログ付き）
		Vw.sT(cl, t('btn.autodl.clear'));
		Vw.click(cl, async () => {
			if (!window.confirm(t('btn.autodl.clear'))) return;
			await ctx.sync.autodlClear().catch(e => ef(e, 'room_app.autodlClear'));
			Toast(t('msg.autodl.cleared'));
			paintCnt();
		});
	}
	// ---- 一括 DL（§9.10: 分割 ZIP → msg.zip.part({n}) → a[download]）----
	async bulkDl() {
		const ctx = this.activeCtx();
		if (!ctx) return;
		try {
			const bulk = new BulkDL({ collection: ctx.collection, store: this.store, ridNameB64U: ctx.nb, cfg: this.cfg });
			let n = 0;
			await bulk.run(p => {
				n++;
				Toast(t('msg.zip.part', { n }));
				this.dl(p.blob, p.name);
			});
			if (n) Toast(t('msg.dl.ok'), 10000); // v2.2 §26: 一括 DL も完了表示
			this.usageDirty();
		} catch (e) {
			ef(e, 'room_app.bulk');
			Toast(t('msg.fetch.fail'));
		}
	}
	// ---- ログアウト系（§12 強制ログアウトは forcedMsg をホーム表示）----
	forcedLogout(rid) { // session 側で leave 済みの想定（monthExpire/conflict/srvOff）
		this.disposeRoom(rid);
		this.home();
	}
	disposeRoom(rid) {
		const ctx = this.rooms.get(rid);
		if (!ctx) return;
		try {
			ctx.session.leave();
			ctx.session.destroy(); // v1.3.1 C1: BC/購読/参照の完全解除（幽霊セッション保持の防止）
		} catch (e) {
			ef(e, 'room_app.leave');
		}
		try {
			if (ctx.transfer) ctx.transfer.destroy(); // v1.3.1 C2: 転送状態・タイマ・待機の解放
			if (ctx._mTmr) clearTimeout(ctx._mTmr); // L5: M バースト遅延
			if (ctx.peerMap) ctx.peerMap.clear(); // M2
			ctx.sync.dispose();
			if (ctx.cal) ctx.cal.destroy();
			if (ctx.sheet) ctx.sheet.destroy();
			ctx.slices.releaseAll();
		} catch (e) {
			ef(e, 'room_app.dispose');
		}
		this.rooms.delete(rid);
		if (this.active === rid) this.active = '';
		AppSettings.setState('roomLogin.' + rid, null).catch(e => ef(e, 'room_app.rlClear')); // §11 app_state
		if (RoomApp.hashName() === ctx.nb) location.hash = '';
	}
	logout(rid) {
		if (!rid) return;
		this.disposeRoom(rid);
		this.home();
	}
	// ---- ゴミ箱ビュー（§5.6: 復元/即時物理削除/空にする）----
	trashView() {
		const ctx = this.activeCtx();
		if (!ctx) return;
		const box = this.dlg(t('btn.trash'));
		const top = Vw.div(box, { class: 'ir-row' });
		const list = Vw.div(box);
		const paint = () => {
			Vw.rc(list);
			const items = ctx.collection.trashList();
			if (!items.length) {
				Vw.add(list, 'div', { class: 'ir-mut' }).textContent = t('lbl.trash.empty');
				return;
			}
			for (const it of items) {
				const m = it.meta || {};
				const row = Vw.div(list, { class: 'ir-tr' });
				const info = Vw.div(row, {});
				Vw.add(info, 'b').textContent = RoomApp.unB64(m.n) || m.n || it.h10;
				Vw.add(info, 'div', { class: 'ir-mut' }).textContent =
					t('lbl.meta.ts') + ': ' + new Date(m.ts || 0).toLocaleString() +
					' | ' + t('btn.trash') + ': ' + new Date(m.d || 0).toLocaleString() +
					' | ' + t('lbl.meta.u') + ': ' + (m.u || '') +
					' | ' + t('lbl.meta.r') + ': ' + (m.r || []).map(u => RoomApp.unB64(u) || u).join(', ');
				const ops = Vw.div(row, { class: 'ir-row' });
				const rs = Vw.btn(ops, { class: 'ir-btn' }); // 復元（§9.8 投稿者本人のみ。flags で M 再送出）
				Vw.sT(rs, t('btn.trash.restore'));
				Vw.click(rs, async () => {
					const r = await ctx.collection.restore(it.h10).catch(e => ef(e, 'room_app.restore'));
					if (!r || !r.restored) return;
					if (r.resendM && ctx.session.state.authed) {
						for (const fr of ctx.sheet.mFrames()) ctx.session.sendFrame(fr); // §9.2 M 再 broadcast
						ctx.sheet.markBroadcast();
					}
					paint();
				});
				const pu = Vw.btn(ops, { class: 'ir-btn warn' }); // 削除（即時物理削除）
				Vw.sT(pu, t('btn.trash.purge'));
				Vw.click(pu, async () => {
					if (!window.confirm(t('btn.trash.purge'))) return;
					await ctx.collection.purge(it.h10).catch(e => ef(e, 'room_app.purge'));
					Toast(t('msg.trash.purged'));
					this.usageDirty();
					paint();
				});
			}
		};
		const em = Vw.btn(top, { class: 'ir-btn warn' }); // ゴミ箱を空にする
		Vw.sT(em, t('btn.trash.empty'));
		Vw.click(em, async () => {
			if (!window.confirm(t('btn.trash.empty'))) return;
			await ctx.collection.emptyTrash().catch(e => ef(e, 'room_app.empty'));
			Toast(t('msg.trash.sweep'));
			this.usageDirty();
			paint();
		});
		paint();
	}
	// ---- 本体ビューア（追加仕様: タイトル=ファイル名・サイズ切替・ゴミ箱右端・保存不要(表示で OPFS 確定)・☓ 右上）----
	slStop() {
		// スライドショー停止（状態 + タイマ、v1.8 §22）
		this._slOn = false;
		if (this._slTimer) clearInterval(this._slTimer);
		this._slTimer = 0;
	}
	slArm() {
		if (this._slTimer) clearInterval(this._slTimer);
		this._slTimer = setInterval(() => this.slNext(), this.cfg.SLIDE_MS || 3000);
	}
	async slNext() {
		// 保有画像（meta を持つ非ゴミ箱項目）のみを-ts 降順-に次へ。全画面/slideshow は新ビューアで再開
		if (!this._slOn) return;
		const box = this._vBox;
		if (!box || !box._h10 || !box._mdl || !box._mdl.isConnected) return;
		const seq = this._slSeq || [];
		if (seq.length < 2) return;
		const i = (seq.indexOf(box._h10) + 1 + seq.length) % seq.length;
		const nxt = seq[i];
		if (nxt === box._h10) return;
		const b = await this.bodyOf(nxt).catch(() => null);
		if (!b) {
			this.slStop(); // 実体を取り出せない項目は進めない（保有対象のみ送る仕様の維持）
			return;
		}
		this._fsPend = true;
		this._slPend = true;
		this.viewer(nxt, b);
	}
	async slStep(dir) { // v2.5 §30: キー左右で次へ/戻る（全画面・スライドショー共通。ts 降順シーケンス）
		const box = this._vBox;
		if (!box || !box._h10 || !box._mdl || !box._mdl.isConnected) return;
		const seq = this._slSeq || [];
		if (seq.length < 2) return;
		const start = seq.indexOf(box._h10);
		// v2.8 §34: 隣接項目が実体欠損でも同じ方向の次候補へスキップ（キー送りは送り停止しない。§22 の停止方針はタイマ送りの slNext のみ）
		for (let sc = 1; sc <= seq.length; sc++) {
			const i = ((start + dir * sc) % seq.length + seq.length) % seq.length,
				nxt = seq[i];
			if (nxt === box._h10) continue;
			const b = await this.bodyOf(nxt).catch(() => null);
			if (b) {
				this._fsPend = true;
				this._slPend = this._slOn === true;
				this.viewer(nxt, b);
				return;
			}
		}
	}
	// ================= v2.19 §46: 部屋タグ登録表（一括管理ファイル）=================
	// OPFS に rooms 単位の実ファイル `tagreg/<rid>.json`（{ver,tags:[{t,last,n}]}）。
	// TG フレームで q=照会/reg=一括配布。加算マージ（last=最大・n=max+ローカル再計算なし）、500 件上限で last 古い順に落とす
	_tagReg(rid) {
		return (this._regs && this._regs.get(rid)) || [];
	}
	async _regLoad(ctx) {
		if (!this._regs) this._regs = new Map();
		if (this._regs.has(ctx.rid)) return this._regs.get(ctx.rid);
		let tags = [];
		try {
			const p = 'tagreg/' + ctx.rid + '.json';
			if (await OPFS.isEf(p)) {
				const o = JSON.parse(Y.u2s(await OPFS.r(p)));
				if (o && Array.isArray(o.tags)) tags = o.tags.filter(x => x && Collection.normTag(x.t)).map(x => ({ t: Collection.normTag(x.t), last: Number(x.last) || 0, n: Number(x.n) || 0 }));
			}
		} catch (e) {
			ef(e, 'room_app.regLoad');
		}
		tags.sort((a, b) => b.last - a.last);
		this._regs.set(ctx.rid, tags);
		return tags;
	}
	async _regSave(ctx) {
		try {
			await OPFS.w('tagreg/' + ctx.rid + '.json', Y.s2u(JSON.stringify({ ver: 1, ts: Date.now(), tags: this._tagReg(ctx.rid).slice(0, 500) })));
		} catch (e) {
		 ef(e, 'room_app.regSave');
		}
	}
	_tagTouch(ctx, tags) {
		// 使用（画像への付与/クラウドクリック）で last を更新、n を++（新規タグは追加）
		const list = this._tagReg(ctx.rid),
			now = Date.now();
		for (const raw of tags) {
			const t = Collection.normTag(raw);
			if (!t) continue;
			const it = list.find(x => x.t === t);
			if (it) { it.last = now; it.n++; }
			else list.push({ t, last: now, n: 1 });
		}
		list.sort((a, b) => b.last - a.last);
		if (list.length > 500) list.length = 500;
		this._regSave(ctx);
	}
	_tagAnnounce(ctx) {
		try {
			ctx.session.sendFrame(Protocol.mk(IR.TG, { uid: ctx.session.uid, reg: { tags: this._tagReg(ctx.rid).slice(0, 500) } }));
		} catch (e) {
			ef(e, 'room_app.tagAnnounce');
		}
	}
	_tagAsk(ctx) {
		const ps = ((ctx.session.state && ctx.session.state.participants) || []).filter(x => x && x.uid && x.uid !== ctx.session.uid);
		if (!ps.length) return;
		const pick = ps[Math.floor(Math.random() * ps.length)].uid;
		ctx.session.sendFrame(Protocol.mk(IR.TG, { uid: ctx.session.uid, to: pick, q: 1 }));
	}
	async _onTG(ctx, p, from) {
		const me = ctx.session.uid;
		if (p.to && p.to !== me) return; // 宛先指定は自宛のみ処理（ループ防止）
		if (p.q === 1) { // 照合: 自登録表を送り返す（未所持=空）
			await this._regLoad(ctx);
			ctx.session.sendFrame(Protocol.mk(IR.TG, { uid: me, to: p.uid || from, reg: { tags: this._tagReg(ctx.rid).slice(0, 500) } }));
			return;
		}
		if (p.reg && Array.isArray(p.reg.tags)) { // 一括受信 → 不足分を自分の配下ファイルへ加算
			const list = await this._regLoad(ctx);
			let ch = false;
			for (const x of p.reg.tags) {
				if (!x) continue;
				const t = Collection.normTag(x.t);
				if (!t) continue;
				const it = list.find(y => y.t === t);
				if (!it) { list.push({ t, last: Number(x.last) || 0, n: Number(x.n) || 0 }); ch = true; }
				else if ((Number(x.last) || 0) > it.last || (Number(x.n) || 0) > it.n) { it.last = Math.max(it.last, Number(x.last) || 0); it.n = Math.max(it.n, Number(x.n) || 0); ch = true; }
			}
			if (ch) {
				list.sort((a, b) => b.last - a.last);
				if (list.length > 500) list.length = 500;
				await this._regSave(ctx);
				if (this._tagCloudRep) this._tagCloudRep(); // 開いているビューアのクラウド更新
			}
		}
	}
	async _tagAdd(ctx, h10, raw) {
		const t = Collection.normTag(raw);
		if (!t) return;
		const m = ctx.collection.metas.get(h10);
		const cur = Array.isArray(m && m.tg) ? m.tg : [];
		if (!cur.includes(t)) {
			if (cur.length >= 16) { Toast(I18N.t('msg.tag.limit')); return; }
			await ctx.collection.mergeTags(h10, [t]);
			ctx.sheet.rebuild(ctx.collection.manifestEntries()).then(() => ctx.sheet.broadcastMNow()).catch(e => ef(e, 'room_app.tagRebuild')); // 再構築後 M 全周知（タグのみの変更はシート差分に出ないため強制、§9.4）
		}
		this._tagTouch(ctx, [t]); // last/n 更新（自ファイル）
		this._tagAnnounce(ctx); // 登録表も即周知（同期を待たず反映。加算マージ）
		if (this._tagCloudRep) this._tagCloudRep();
	}

	async viewer(h10, blob) {
		// 同一画像の再クリック無視・別画像表示時は旧ビューアを閉じる（モーダル多重防止、追加仕様 v1.2）
		if (this._vPend === h10) return;
		if (this._vBox && this._vBox._mdl && this._vBox._mdl.isConnected) this._vBox._close();
		this._vPend = h10;
		const ctx = this.activeCtx();
		const meta = await this.store.metaGet(h10).catch(() => null);
		const nm = meta ? RoomApp.unB64(meta.n) || meta.n || '' : '';
		const box = this.dlg(nm || t('lbl.meta.n')); // ハッシュ表示ではなくファイル名をタイトルに（追加仕様）
		this._vBox = box;
		// v2.8 §34: 送りキーの取りこぼし防止。リスナは即時登録し、全画面配線(askExit/enterFs/seq)完了までは無視する
		const onFKey = e => {
			if (!box.isConnected) {
				Vw.rel(document, 'keydown', onFKey);
				return;
			}
			if (!box._fsWire || box._fsc) return; // v2.16 §43: 全画面でなくても左右キーで前後切替
			if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
				e.preventDefault();
				const dir = e.key === 'ArrowRight' ? 1 : -1;
				if (box.classList.contains('ir-fs')) {
					if (this._slOn && !this._slPaused) this.slArm();
					this.slStep(dir).catch(er => ef(er, 'room_app.fsStep'));
				} else if (box._navStep) box._navStep(dir).catch(er => ef(er, 'room_app.navKey'));
			}
		};
		Vw.ael(document, 'keydown', onFKey);
		box._onClose = () => {
			this._vBox = null;
			this._vPend = null;
			if (!this._slPend && !this._fsPend) this.slStop(); // slideshow の送器による差し替え時は停止しない（v1.8 §22）
			im.removeAttribute('src'); // デコード済み画像を閉時速やかに解放（低メモリ化 v1.3）
		};
		let ab0 = await blob.arrayBuffer();
		try {
			// 同期/表示経路で OPFS 保存を確定（保存ボタン廃止、追加仕様）
			await this.store.put(ab0);
			this.usageDirty();
		} catch (e) {
			ef(e, 'room_app.autosave');
		}
		const url = `data:${blob.type || 'image/jpeg'};base64,${Y.a2B(ab0)}`; // サーバー既定 CSP が img-src data: のため objectURL 不可（解放は閉時）
		const wrap = Vw.div(box, { class: 'ir-imgwrap fit' });
		const im = Vw.add(wrap, 'img', { class: 'ir-img', alt: nm });
		im.src = url;
		const szr = Vw.add(box, 'div', { class: 'ir-row' }); // 表示サイズ ⇄ ネイティブサイズ切替（追加仕様）
		Vw.add(szr, 'span', { class: 'ir-mut' }).textContent = t('lbl.view.size');
		const szv = Vw.add(szr, 'span', { class: 'ir-mut' });
		// 表示幅/1/4/1/2/ネイティブ/2倍/4倍。選択中ボタンは .on で示す（追加仕様 v1.2）
		const ZM = [['btn.view.fit', 0], ['btn.view.z4', 0.25], ['btn.view.h2', 0.5], ['btn.view.native', 1], ['btn.view.x2', 2], ['btn.view.x4', 4]];
		const zBtns = [];
		const paintSz = () => {
			if (im.naturalWidth) Vw.sT(szv, `${im.clientWidth}x${im.clientHeight} / ${im.naturalWidth}x${im.naturalHeight}`);
		};
		const setZoom = i => {
			Vw.tC(wrap, 'fit', i === 0);
			Vw.tC(wrap, 'native', i === 3);
			Vw.tC(wrap, 'zoom', i !== 0 && i !== 3);
			im.style.width = i === 0 || i === 3 ? '' : Math.round(im.naturalWidth * ZM[i][1]) + 'px';
			zBtns.forEach((b, j) => Vw.tC(b, 'on', j === i));
			setTimeout(paintSz, 0);
		};
		ZM.forEach(([k, f], i) => {
			const b = Vw.btn(szr, { class: 'ir-btn' });
			Vw.sT(b, t(k));
			Vw.click(b, () => setZoom(i));
			zBtns.push(b);
		});
		im.onload = paintSz;
		setZoom(0);
		// ---- 全画面表示 & スライドショー（追加仕様 v1.8 §22）----
		box._h10 = h10;
		const fsr = Vw.add(box, 'div', { class: 'ir-row ir-fsrow' });
		const bFs = Vw.btn(fsr);
		Vw.sT(bFs, t('btn.fs'));
		const bSl = Vw.btn(fsr);
		Vw.sT(bSl, t('btn.slide'));
		const heldSeq = () => {
			const cs = ctx && ctx.collection;
			if (!cs) return [h10];
			const list = cs.roomItems()
				.filter(it => it && it.h10 && !it.trashed && cs.metas.has(it.h10)) // 保有画像のみ（v1.8 §22）
				.sort((a, b) => (b.ts || 0) - (a.ts || 0))
				.map(it => it.h10);
			return list.length ? list : [h10];
		};
		const askExit = () => {
			// 解除はタップ → コンファームでのみ確定（v1.8 §22）。v1.9 §23: 確認中は送りタイマをポーズ（継続で再開）
			if (box._fsc) return;
			if (this._slOn && this._slTimer) {
				clearInterval(this._slTimer);
				this._slTimer = 0;
				this._slPaused = true;
			}
			box._fsc = Vw.add(box, 'div', { class: 'ir-fsc' });
			const pn = Vw.add(box._fsc, 'div', { class: 'ir-fsp' });
			Vw.add(pn, 'div').textContent = t(this._slOn ? 'msg.slide.exit' : 'msg.fs.exit');
			const kp = Vw.btn(pn);
			Vw.sT(kp, t('btn.confirm.keep'));
			Vw.click(kp, () => {
				Vw.rm(box._fsc);
				box._fsc = null;
				if (this._slPaused && this._slOn) {
					this._slPaused = false;
					this.slArm();
				}
			});
			const sp = Vw.btn(pn, { class: 'ir-btn warn' });
			Vw.sT(sp, t('btn.confirm.stop'));
			Vw.click(sp, () => {
				Vw.rm(box._fsc);
				box._fsc = null;
				this.slStop();
				Vw.tC(box, 'ir-fs', false);
				try {
					if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
				} catch (e) { /* 非対応環境は無視（アプリ内オーバーレイが本体） */ }
			});
		};
		const enterFs = slide => {
			Vw.aC(box, 'ir-fs');
			try {
				if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
			} catch (e) { /* 拒否/null 不可視はオーバーレイのみで成立 */ }
			this._slSeq = heldSeq(); // v2.5 §30: 全画面のみでも左右キーで送れるよう seq は常時
			if (slide) {
				this._slOn = true;
				this.slArm();
			}
		};
		Vw.click(bFs, () => (box.classList.contains('ir-fs') ? askExit() : enterFs(false)));
		Vw.click(bSl, () => (this._slOn ? askExit() : enterFs(true)));
		let tapTs = 0;
		Vw.ael(wrap, 'click', () => {
			if (box.classList.contains('ir-fs')) {
				askExit(); // 全画面中の画像タップは解除確認
				return;
			}
			const now = Date.now(); // v2.16 §43: 画像中央のダブルクリック/ダブルタップ（クリック間隔 320ms 以内）で全画面
			if (now - tapTs < 320) {
				tapTs = 0;
				enterFs(false);
			} else tapTs = now;
		});
		// v2.5 §30: ←/→ は冒頭登録の onFKey で処理（v2.8 §34 で即時登録化）
		if (this._fsPend) {
			const sl = this._slPend === true;
			this._fsPend = false;
			this._slPend = false;
			enterFs(sl); // slideshow の送器で開き直したセッションを全画面+自動送りで再開
		}
		box._fsWire = true; // v2.8 §34: askExit/enterFs/seq 配線完了（以降のキーは処理）
		// ---- v2.16 §43: 表示領域 3 分割の両端クリックで前後の画像へ（添付データ込みで開き直し）。
		// 単クリック=切替（260ms 遅延でダブルと区別）、同一ゾーン連続クリック=全画面。順は部屋全項目の ts 降順（未保有はそのつど取得）
		const navSeq = () => {
			const cs = ctx && ctx.collection;
			if (!cs) return [h10];
			const list = cs.roomItems()
				.filter(it => it && it.h10 && !it.trashed)
				.sort((a, b) => (b.ts || 0) - (a.ts || 0))
				.map(it => it.h10);
			return list.length ? list : [h10];
		};
		box._navStep = async dir => {
			if (!this._vBox || this._vBox !== box || !box._mdl || !box._mdl.isConnected) return;
			const seq = navSeq(),
				start = seq.indexOf(box._h10);
			if (seq.length < 2 || start < 0) return;
			for (let sc = 1; sc <= seq.length; sc++) { // 取得失敗項目は同じ方向の次候補へ（キー送りと同じ方針）
				const i = ((start + dir * sc) % seq.length + seq.length) % seq.length,
					nxt = seq[i];
				if (nxt === box._h10) continue;
				const b = (await this.bodyOf(nxt).catch(() => null)) || (ctx.cal ? await ctx.cal.fetchBody(nxt) : null);
				if (b) {
					this.viewer(nxt, b); // 通常ビューアのまま開き直し（画像も添付データも切替）
					return;
				}
			}
		};
		let navT = 0, zoneTap = 0;
		const mkZone = side => {
			const z = Vw.add(wrap, 'div', { class: 'ir-navz ' + side });
			Vw.add(z, 'span', { class: 'ir-navz-a' }).textContent = side === 'l' ? '‹' : '›';
			Vw.ael(z, 'click', e => {
				e.stopPropagation();
				if (box.classList.contains('ir-fs')) { // 全画面中は帯タップでも送り（キーと共通の保持 seq）
					if (this._slOn && !this._slPaused) this.slArm();
					this.slStep(side === 'l' ? -1 : 1).catch(er => ef(er, 'room_app.navFs'));
					return;
				}
				const now = Date.now();
				if (navT || now - zoneTap < 320) { // ダブル（2 回目）→ 全画面表示、単独切替は取り消し
					clearTimeout(navT);
					navT = 0;
					zoneTap = 0;
					enterFs(false);
					return;
				}
				zoneTap = now;
				navT = setTimeout(() => {
					navT = 0;
					box._navStep(side === 'l' ? -1 : 1).catch(er => ef(er, 'room_app.navz'));
				}, 300);
			});
		};
		mkZone('l');
		mkZone('r');
		// 画像下は 3 行のみ: 投稿者・部屋 / 投稿日・MimeType / SHA256Sum（追加仕様 v1.2）
		const mb = Vw.add(box, 'div', { class: 'ir-meta3' });
		if (meta) {
			const mrow = pairs => {
				const r = Vw.add(mb, 'div', { class: 'ir-row' });
				pairs.forEach(([k, v], i) => {
					if (i) Vw.add(r, 'span', { class: 'ir-sep' }).textContent = '・';
					Vw.add(r, 'span', { class: 'ir-mut' }).textContent = t(k);
					Vw.add(r, 'span').textContent = v;
				});
			};
			mrow([['lbl.meta.u', meta.u || ''], ['lbl.meta.r', (meta.r || []).map(u => RoomApp.unB64(u) || u).join(', ')]]);
			mrow([['lbl.meta.ts', new Date(meta.ts || 0).toLocaleString()], ['lbl.meta.t', meta.t || '']]);
		}
		const shr = Vw.add(mb, 'div', { class: 'ir-row' });
		Vw.add(shr, 'span', { class: 'ir-mut' }).textContent = t('lbl.meta.sha');
		const shv = Vw.add(shr, 'span', { class: 'ir-sha' });
		shv.textContent = '...';
		(async () => { // 表示中のバイトから SHA-256 をその場で計算（ハッシュ保管は内容アドレス h10 のため、追加仕様 v1.2）
			try {
				const d = await crypto.subtle.digest('SHA-256', ab0);
				shv.textContent = [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
			} catch (e) {
				ef(e, 'room_app.sha');
				shv.textContent = '(N/A)';
			}
			ab0 = null; // SHA 計算まで保持したら即時解放（低メモリ化 v1.3）
		})();
		// ---- v2.19 §46: タグ編集行とタグクラウド（直近使用 10 個=下段、残り=部分一致 10 個まで）----
		{
			const tgs = () => { const mm = ctx.collection.metas.get(h10); return Array.isArray(mm && mm.tg) ? mm.tg : []; };
			const row = Vw.add(mb, 'div', { class: 'ir-row ir-tgrow' });
			Vw.add(row, 'span', { class: 'ir-mut' }).textContent = I18N.t('lbl.tags');
			const chips = Vw.div(row, { class: 'ir-tgchips' });
			const can = !ctx.collection.isTrashed(h10);
			let inp = null;
			if (can) {
				inp = Vw.add(row, 'input', { class: 'ir-tgin', type: 'text', maxlength: '32', placeholder: I18N.t('lbl.tag.ph') });
				inp.autocomplete = 'off';
				const ab2 = Vw.btn(row, { class: 'ir-btn ir-tgadd', type: 'button' });
				Vw.sT(ab2, I18N.t('btn.tag.add'));
				const doAdd = () => { const v = inp.value.trim(); if (v) { inp.value = ''; this._tagAdd(ctx, h10, v); } };
				Vw.click(ab2, doAdd);
				Vw.ael(inp, 'keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
				Vw.ael(inp, 'input', () => cloudRep());
			}
			const filt = Vw.add(mb, 'div', { class: 'ir-row ir-tgfilt' });
			const rec = Vw.add(mb, 'div', { class: 'ir-row ir-tgrecent' });
			const mkB = (par, x) => {
				const b = Vw.btn(par, { class: 'ir-tgbtn', type: 'button' });
				b.textContent = '#' + x;
				b.dataset.tg = x;
				Vw.click(b, () => this._tagAdd(ctx, h10, x));
			};
			const cloudRep = () => {
				if (!this._vBox || this._vBox !== box) return;
				Vw.rc(chips);
				for (const x of tgs()) Vw.add(chips, 'span', { class: 'ir-tgchip' }).textContent = '#' + x;
				const list = this._tagReg(ctx.rid);
				Vw.rc(rec);
				for (const it of list.slice(0, 10)) mkB(rec, it.t); // 直近使用順 10 個を下段
				Vw.rc(filt);
				const q = ((inp && inp.value) || '').trim().toLowerCase();
				if (q) for (const it of list.slice(10).filter(x => x.t.toLowerCase().includes(q)).slice(0, 10)) mkB(filt, it.t); // 残りは部分一致 10 個まで
			};
			this._tagCloudRep = cloudRep;
			cloudRep();
			this._regLoad(ctx).then(() => cloudRep()).catch(() => {});
		}
		const ext = (meta && meta.t ? String(meta.t).split('/')[1] : '') || 'jpg';
		const row = Vw.div(box, { class: 'ir-mbtns' });
		const dl = Vw.btn(row, { class: 'ir-btn' }); // DL のみ（保存は自動確定のため廃止、追加仕様）
		Vw.sT(dl, t('btn.dl'));
		Vw.click(dl, () => this.dl(blob, (nm || h10) + '.' + ext, true)); // v2.2 §26
		if (ctx && !ctx.collection.isTrashed(h10)) { // ごみ箱へ（§9.8）。ボタンは右端（追加仕様）
			const tr = Vw.btn(row, { class: 'ir-btn warn ir-trright' });
			Vw.sT(tr, t('btn.trash'));
			Vw.click(tr, async () => {
				const r = await ctx.collection.trash(h10).catch(e => ef(e, 'room_app.trash'));
				if (!r || !r.trashed) return;
				if (r.x) ctx.session.sendFrame(Protocol.mk('X', { h: r.x.h, by: r.x.by }));
				ctx.sheet.rebuild(ctx.collection.manifestEntries()).catch(e => ef(e, 'room_app.rebuild'));
				this.usageDirty();
				box._close();
			});
		}
	}
	// ---- QR ユーティリティ（追加仕様: URL QR / パスワード QR 共通生成）----
	roomUrl(ctx) { // 参加用 URL。v2.15 §42: #<部屋名>:<b64url(実効 WS ベース)> を付け、リンク/QR で接続先も運ぶ
		const base = location.href.split('#')[0].split('?')[0];
		let b64 = '';
		try {
			const ws = wsNorm(getWsBase()) || getWsBase(); // 既定でも実効値を常に同梱（http→ws 正規化、§28 と同じ wsNorm）
			b64 = ws ? Y.B2U(Y.u2B(Y.s2u(ws))) : '';
		} catch (e) { /* ef(e, 'room_app.roomUrl'); */ }
		const cl = this._claimFor(ctx); // v2.20 §47: 3 節目に作成者クレーム（旧クライアントは ws 部以後を無視するため後方互換）
		return `${base}#${encodeURIComponent(ctx.nb)}${b64 || cl ? ':' + (b64 || '') : ''}${cl ? ':' + cl : ''}`;
	}
	async qrInto(host, text, { size, file, note, secret } = {}) {
		Vw.rc(host);
		// QR 画像と URL/ボタン/説明を横並びにする行。パスワード QR は秘密鍵色系（追加仕様 v1.2）
		const row = Vw.div(host, { class: secret ? 'ir-qrrow ir-secret' : 'ir-qrrow' });
		try {
			const r = await QRTool.make(text, { size: size || this.cfg.QR_SIZE_PX, level: this.cfg.QR_CORRECT_LEVEL, retry: this.cfg.QR_VERIFY_RETRY });
			if (r.failed) {
				Vw.add(host, 'div', { class: 'ir-mut' }).textContent = t('msg.qr.verify.fail');
				return;
			}
			Vw.aC(r.canvas, 'ir-qrimg');
			Vw.add(row, 'div', { class: 'ir-qrpic' }).appendChild(r.canvas);
			const side = Vw.add(row, 'div', { class: 'ir-qrside' });
			const tx = Vw.ipt(side, { type: 'text', readonly: 'readonly' });
			tx.value = r.data || text;
			const rowq = Vw.div(side, { class: 'ir-row' });
			const cp = Vw.btn(rowq, { class: 'ir-btn' });
			Vw.sT(cp, t('btn.copy'));
			Vw.click(cp, () => Vw.copy(tx.value));
			const png = Vw.btn(rowq, { class: 'ir-btn' });
			Vw.sT(png, t('btn.qr.png'));
			Vw.click(png, async () => {
				const b = await QRTool.pngBlob(r.canvas);
				if (b) this.dl(b, file || 'qr.png', true); // v2.2 §26: 「ダウンロードしました」10 秒
			});
			if (note) Vw.add(side, 'div', { class: 'ir-qrnote' }).textContent = note;
		} catch (e) {
			ef(e, 'room_app.qr');
			Vw.add(host, 'div', { class: 'ir-mut' }).textContent = t('msg.qr.verify.fail');
		}
	}
	// v2.7 §33: 「パスワードのみコピー」行。QR パック（TMIWR1:…）ではなく本体だけを書き出す。
	// v2.12 §39: 平文 pw 非保持（未発行）ときはボタンを無効化。メニューでは QR の直下（mkQr の再生成に従属）に配置
	pwCopyRow(host, ctx) {
		const row = Vw.div(host, { class: 'ir-row' });
		const bp = Vw.btn(row, { class: 'ir-btn' });
		Vw.sT(bp, t('btn.copy.pw'));
		const has = !!ctx.plainPw;
		bp.disabled = !has;
		Vw.click(bp, () => {
			if (!ctx.plainPw) {
				Toast(t('msg.qr.needpw'));
				return;
			}
			Vw.copy(ctx.plainPw);
			Toast(t('msg.copied.pw'));
		});
		Vw.add(row, 'span', { class: 'ir-mut' }).textContent = t('qr.pw.note');
	}
	qrPanel(ctx) { // サブタブの QR パネル（qrurl: 部屋 URL / qrpw: 認証 QR。作成者のみ呼ばれる）
		const sec = Vw.div(this.main, { class: 'ir-sec' });
		Vw.add(sec, 'h4').textContent = (ctx.sub === 'qrpw' ? '\ud83d\udd11 ' : '') + (ctx.sub === 'qrpw' ? t('tab.view.qrpw') : t('tab.view.qrurl'));
		if (ctx.sub === 'qrpw') {
			if (!ctx.plainPw) {
				Vw.add(sec, 'div', { class: 'ir-mut' }).textContent = t('msg.qr.needpw');
				return;
			}
			// 秘密鍵色系の独立エリア（URL QR とは明確に区別、追加仕様 v1.2）
			this.qrInto(sec, qrPack(ctx.nb, ctx.plainPw, this._claimFor(ctx)), {
				file: ctx.rid + '.pw.png',
				secret: true,
				note: t('lbl.qr.secret') + ' ' + t('lbl.qr.scan.pw'),
			});
			this.pwCopyRow(sec, ctx); // v2.7 §33: プレフィックス無しのパスワード本体コピー
			return;
		}
		this.qrInto(sec, this.roomUrl(ctx), {
			file: ctx.rid + '.url.png',
			note: t('lbl.qr.scan.url'), // スキャン時の挙動説明（追加仕様 v1.2）
		});
	}
	urlQrBlock(ctx) { // サーバーモード参加者は URL QR 常時表示（追加仕様）。v2.15 §42: 平文 pw 保持時はパスワード QR も同時表示するオプション（部屋単位で記憶）
		const sec = Vw.div(this.main, { class: 'ir-sec' });
		const draw = () => {
			Vw.rc(sec);
			Vw.add(sec, 'h4').textContent = t('lbl.qr.url');
			this.qrInto(Vw.div(sec, {}), this.roomUrl(ctx), {
				size: 160,
				file: ctx.rid + '.url.png',
				note: t('lbl.qr.scan.url'),
			});
			const row = Vw.div(sec, { class: 'ir-row' });
			const cb = Vw.ipt(row, { type: 'checkbox', class: 'ir-chk' });
			cb.checked = !!(AppSettings.state && (AppSettings.state['PWQR.' + ctx.rid] === true || (AppSettings.state.PWQR || {})[ctx.rid] === true)); // v2.9 §35 と同じ二重読み（平坦/ネスト）
			cb.disabled = !ctx.plainPw;
			Vw.add(row, 'span').textContent = t('lbl.qr.pw.always');
			Vw.change(cb, () => {
				const v = cb.checked ? true : null,
					st = AppSettings.state;
				if (st) { // AppSettings は 500ms デバウンスなのでメモリキャッシュを即反映（flush 時の base にも同じ op が入る）
					st.PWQR = st.PWQR || {};
					if (v === null) delete st.PWQR[ctx.rid];
					else st.PWQR[ctx.rid] = true;
					st['PWQR.' + ctx.rid] = v;
				}
				AppSettings.setState('PWQR.' + ctx.rid, v).catch(e => ef(e, 'room_app.pwqr'));
				draw();
			});
			if (cb.checked && ctx.plainPw) {
				this.qrInto(Vw.div(sec, {}), qrPack(ctx.nb, ctx.plainPw, this._claimFor(ctx)), {
					size: 160,
					file: ctx.rid + '.pw.png',
					secret: true,
					note: t('lbl.qr.secret') + ' ' + t('lbl.qr.scan.pw'),
				});
			}
		};
		draw();
	}
	// ---- 作成者メニュー（§5.2: QR 表示/DL・パスワード再発行・oa 管理・srvOn 切替・退室）----
	roomMenu() {
		const ctx = this.activeCtx();
		if (!ctx || ctx.room.cr !== ctx.uid) return; // 作成者本人のみ（§5.3/§6.2）
		const box = this.dlg(t('btn.room.menu'));
		// QR（§6.4: 生成→検証→PNG DL。平文 pw は作成/再発行後のセッション中のみ保持）
		let qrBox = null; // v1.9 §23: QR 欄はメニュー末尾（QR とその情報の下に要素を置かない）
		const mkQr = () => {
			if (!ctx.plainPw) {
				Vw.rc(qrBox);
				Vw.add(qrBox, 'div', { class: 'ir-mut' }).textContent = t('msg.qr.needpw');
				this.pwCopyRow(qrBox, ctx); // v2.12 §39: 未発行でもボタンは QR 直下に無効表示
				return;
			}
			this.qrInto(qrBox, qrPack(ctx.nb, ctx.plainPw, this._claimFor(ctx)), { file: ctx.rid + '.png', secret: true, note: t('lbl.qr.secret') });
			this.pwCopyRow(qrBox, ctx); // v2.12 §39: QR の直下（発行で再生成され有効化）
		};
		// パスワード再発行（新 seed 算出 → C 送出、§6.3/§8.3）
		const r1 = Vw.div(box, { class: 'ir-row' });
		const iss = Vw.btn(r1, { class: 'ir-btn' });
		Vw.sT(iss, t('btn.pw.issue'));
		Vw.click(iss, async () => {
			try {
				const pw = await AuthChallenge.newPw(this.cfg.PW_BITS);
				const salt = AuthChallenge.saltNormal();
				const seed = await AuthChallenge.seed(pw, ctx.nb, salt, this.cfg.HASH_ROUNDS); // v2.11 §38: origin 無し
				ctx.plainPw = pw;
				ctx.room.pw = seed;
				ctx.room.pwSalt = salt;
				ctx.room.cg = Date.now();
				await this.pushC(ctx);
				Toast(t('msg.pw.issued'));
				mkQr();
			} catch (e) {
				ef(e, 'room_app.issue');
			}
		});
		// 許可オリジン管理（§6.6。xorig=true の部屋のみ実効）
		Vw.add(box, 'h4').textContent = t('btn.oa.manage');
		const oaBox = Vw.div(box, {});
		const paintOa = () => {
			Vw.rc(oaBox);
			for (const o of (ctx.room.oa || [])) {
				const row = Vw.div(oaBox, { class: 'ir-tr' });
				Vw.add(row, 'span').textContent = RoomApp.unB64(o) || o;
				const del = Vw.btn(row, { class: 'ir-btn warn' });
				Vw.sT(del, '×');
				Vw.click(del, () => {
					ctx.room.oa = (ctx.room.oa || []).filter(x => x !== o);
					pushOa();
				});
			}
		};
		const pushOa = async () => {
			ctx.room.cg = Date.now();
			await this.pushC(ctx);
			Toast(t('msg.oa.updated'));
			paintOa();
		};
		const orow = Vw.div(box, { class: 'ir-row' });
		const oin = Vw.ipt(orow, { type: 'text', placeholder: t('btn.oa.manage') });
		const oadd = Vw.btn(orow, { class: 'ir-btn' });
		Vw.sT(oadd, '+');
		Vw.click(oadd, () => {
			const v = (oin.value || '').trim().replace(/\/+$/, '');
			if (!/^https?:\/\//.test(v)) return;
			ctx.room.oa = ctx.room.oa || [];
			const b = RoomApp.nb(v);
			if (!ctx.room.oa.includes(b)) ctx.room.oa.push(b);
			oin.value = '';
			pushOa();
		});
		paintOa();
		// モード切替（§6.8 作成者専権）。v2.2 §26: ON/OFF トグルの代わりに 同期/通常 のラジオスイッチ
		const r2 = Vw.div(box, { class: 'ir-row' });
		Vw.add(r2, 'span').textContent = t('lbl.mode');
		const srvCur = ctx.room.srvOn === true || ctx.room.srvOn === 'true';
		const rs = Vw.add(r2, 'span', { class: 'ir-rsw' });
		const mkMode = (on, key) => {
			const lb = Vw.add(rs, 'label', { class: 'ir-rw' });
			const ip = Vw.ipt(lb, { type: 'radio', name: 'ir-mode' });
			ip.checked = srvCur === on;
			Vw.add(lb, 'span').textContent = t(key);
			Vw.ael(ip, 'change', async () => {
				if (!ip.checked) return;
				try {
					ctx.room.srvOn = on;
					ctx.room.cg = Date.now();
					await this.pushC(ctx);
					Toast(t(on ? 'msg.srv.on' : 'msg.srv.off'));
					this.renderRoom(ctx.rid); // 同期枠（§26）を即時反映
				} catch (e) {
					ef(e, 'room_app.srvMode');
				}
			});
		};
		mkMode(true, 'mode.sync');
		mkMode(false, 'mode.normal');
		// 退室・タブ閉じる（§5.2）
		const r3 = Vw.div(box, { class: 'ir-row' });
		const lv = Vw.btn(r3, { class: 'ir-btn warn' });
		Vw.sT(lv, t('btn.leave'));
		Vw.click(lv, () => {
			box._close(); // H4: dlg.close() 経由（keydown 解除）
			this.logout(ctx.rid);
		});
		// QR（§6.4）は最終セクション（v1.9 §23: QR+情報の下に表示要素なし）
		Vw.add(box, 'h4').textContent = t('btn.qr');
		qrBox = Vw.div(box, {});
		mkQr();
	}
	// C フレーム送出 + room.json 永続化（§8.3。cg 単調増加、旧い C は受信側無視）
	async pushC(ctx) {
		const o = {
			rid: ctx.rid, uid: ctx.uid, cr: ctx.room.cr, cg: ctx.room.cg,
			pw: ctx.room.pw, pwSalt: ctx.room.pwSalt,
			srvOn: ctx.room.srvOn === true || ctx.room.srvOn === 'true',
			xorig: ctx.room.xorig === true || ctx.room.xorig === 'true',
			oa: ctx.room.oa || [],
			mx: +ctx.room.mx || 0, // 追加仕様: 単一画像上限（bytes）
		};
		try {
			ctx.session.sendFrame(Protocol.mk('C', o));
		} catch (e) {
			ef(e, 'room_app.sendC');
		}
		if (!this.opfsOk) return;
		try {
			await OPFS.w(STORAGE.roomFile(ctx.rid), Y.s2u(JSON.stringify({
				rid: ctx.rid, nm: ctx.room.nm, pw: o.pw, pwSalt: o.pwSalt, srvOn: o.srvOn,
				cr: o.cr, cg: o.cg, xorig: o.xorig, oa: o.oa, mx: o.mx || 0, seedV: 2, // v2.11 §38: 現行 seed 方式の版印
			})).buffer);
		} catch (e) {
			ef(e, 'room_app.saveRoom');
		}
	}
}
