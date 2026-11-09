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
import { CFG, STORAGE, ridOf, qrPack, qrUnpack, IR } from './ir_const.js';
import { Protocol } from './ir_protocol.js';
import { RoomSession } from './room_session.js';
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
		I18N.onChange = () => this.redraw(); // §11 言語変更で全 UI 即時再描画
		this.mkCss();
		this.mkShell();
		this.sweepOnce(); // §9.8 起動時スイープ（lastSweep 判定）
		const h = decodeURIComponent((location.hash || '').replace(/^#/, ''));
		if (h) await this.homeLogin(h); // §5.1 hash=部屋名 b64url → ログイン画面
		else await this.home();
		this.autoJoin(); // §5.7 サーバーモードは起動時に自動再参加
		Vw.ael(window, 'beforeunload', () => AppSettings.flush()); // §11 書き戻し flush
		if (!this.opfsOk) Toast(t('msg.opfs.unavail'));
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
	dl(blob, name) { // <a download> 発火（§9.10 ビューア保存/DL 共通）
		try {
			const a = Vw.ce('a');
			a.href = URL.createObjectURL(blob);
			a.download = name || 'image';
			Vw.gB().appendChild(a);
			a.click();
			Vw.rm(a);
			setTimeout(() => URL.revokeObjectURL(a.href), 6000);
		} catch (e) {
			ef(e, 'room_app.dl');
		}
	}
	// ---- CSS（最小・クラス prefix ir-、モバイル縦一列想定）----
	mkCss() {
		if (Vw.gi('ir-css')) return;
		const s = Vw.ce('style');
		s.id = 'ir-css';
		s.textContent = `
body{margin:0;background:#181c22;color:#e8ecf2;font:14px/1.5 system-ui,sans-serif}
.ir-hd{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 10px;border-bottom:1px solid #2c333d}
.ir-hd b{font-size:15px}
.ir-tabs{display:flex;flex-wrap:wrap;gap:4px;padding:6px 10px;border-bottom:1px solid #2c333d}
.ir-tab{display:inline-flex;gap:6px;align-items:center;padding:9px 12px;border:1px solid #2c333d;border-radius:8px;background:#20262e;color:#e8ecf2;font:inherit;min-height:40px}
.ir-tab.on{background:#3d7dd8;border-color:#3d7dd8}
.ir-btn{padding:9px 13px;border:1px solid #2c333d;border-radius:8px;background:#242b34;color:#e8ecf2;font:inherit;min-height:40px}
.ir-btn.warn{background:#6a2b2b}
.ir-btn.on{background:#2b6b3a}
.ir-main{padding:10px;max-width:1100px;margin:0 auto}
.ir-frm{display:flex;flex-direction:column;gap:10px;max-width:560px}
.ir-frm label{display:flex;flex-direction:column;gap:4px;color:#9aa6b2}
.ir-frm input,.ir-frm select,.ir-frm textarea{padding:10px;border:1px solid #2c333d;border-radius:8px;background:#11151a;color:#e8ecf2;font:inherit;min-height:42px}
.ir-crd{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px;border:1px solid #2c333d;border-radius:10px;margin-bottom:8px}
.ir-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.ir-bdg{display:inline-block;padding:2px 7px;border-radius:9px;font-size:12px;background:#31415a}
.ir-bdgon{display:inline-block;padding:2px 7px;border-radius:9px;font-size:12px;background:#2b6b3a}
.ir-bdgoff{display:inline-block;padding:2px 7px;border-radius:9px;font-size:12px;background:#5b2f2f}
.ir-sec{margin:10px 0;padding:8px 10px;border:1px solid #2c333d;border-radius:10px}
.ir-sec h4{margin:2px 0 6px;font-size:13px;color:#9aa6b2}
.ir-mdl{position:fixed;inset:0;background:rgba(0,0,0,.62);display:flex;align-items:center;justify-content:center;z-index:99;padding:10px}
.ir-mbx{background:#1d232b;border:1px solid #2c333d;border-radius:12px;padding:12px;max-width:min(680px,100%);max-height:92%;overflow:auto;width:100%}
.ir-tr{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;border-bottom:1px solid #2c333d;padding:8px 0}
.ir-mut{color:#9aa6b2;font-size:12px}
.ir-img{max-width:100%;max-height:60vh;display:block;margin:6px 0}
.ir-rd{display:inline-flex;gap:4px;align-items:center;padding:8px 10px;border:1px solid #2c333d;border-radius:8px;min-height:40px}
`;
		Vw.gB().appendChild(s);
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
		e.lblN = Vw.add(e.modeWrap, 'span', { class: 'ir-mut' });
		e.tgl = Toggle({ parent: e.modeWrap, label: '', onChange: on => this.setMode(on) });
		e.lblS = Vw.add(e.modeWrap, 'span', { class: 'ir-mut' });
		e.lang = Vw.add(this.hd, 'select'); // 言語 auto/ja/en
		Vw.sS(e.lang, { padding: '8px', background: '#11151a', color: '#e8ecf2', border: '1px solid #2c333d', borderRadius: '8px', minHeight: '40px' });
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
		Vw.sT(e.lblN, t('hdr.mode.normal'));
		Vw.sT(e.lblS, t('hdr.mode.sync'));
		const opts = e.lang.options;
		opts[0].textContent = t('hdr.lang') + ': auto';
		opts[1].textContent = t('hdr.lang') + ': 日本語';
		opts[2].textContent = t('hdr.lang') + ': English';
		e.lang.value = (AppSettings.cfg && AppSettings.cfg.LANG) || 'auto';
		Vw.sT(e.trash, t('btn.trash'));
		Vw.sT(e.bulk, t('btn.bulkdl'));
		Vw.sT(e.menu, t('btn.room.menu'));
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
		if (ctx && e.tgl) e.tgl.set(ctx.sync && ctx.sync.enabled);
		for (const k of ['trash', 'bulk', 'logout']) Vw.sS(e[k], { display: ctx ? disp(true) : disp(false) });
		Vw.sS(e.menu, { display: ctx && ctx.room.cr === ctx.uid ? '' : 'none' }); // 作成者のみ §5.3
	}
	activeCtx() {
		return this.rooms.get(this.active) || null;
	}
	setMode(on) { // ヘッダートグル: 通常⇄同期（§9.9。server は来ない）
		const ctx = this.activeCtx();
		if (!ctx || ctx.mode === 'server') return;
		ctx.sync.enable(!!on);
		AppSettings.setNested('MODE.' + ctx.rid, on ? 'sync' : 'normal').catch(e => ef(e, 'room_app.mode'));
		if (ctx.foot) Vw.sS(ctx.foot, { display: ctx.sync.enabled ? '' : 'none' });
	}
	redraw() { // 言語切替等: 現在画面を作り直し
		this.lblHdr();
		this.renderTabs();
		if (this.view.t === 'room' && this.rooms.has(this.view.rid)) this.renderRoom(this.view.rid);
		else this.home();
	}
	// ---- ホーム（§5.1: 部屋一覧は OPFS rooms/*/room.json の nm、§10）----
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
		const list = await this.roomList();
		for (const { rid, room } of list) {
			const c = Vw.div(this.main, { class: 'ir-crd' });
			Vw.add(c, 'b').textContent = RoomApp.unB64(room.nm) || room.nm || rid;
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
		}
		const row = Vw.div(this.main, { class: 'ir-row' });
		const bc = Vw.btn(row, { class: 'ir-btn' });
		Vw.sT(bc, t('btn.create')); // §5.3 作成
		Vw.click(bc, () => this.createForm());
		const bj = Vw.btn(row, { class: 'ir-btn' });
		Vw.sT(bj, t('btn.join'));
		Vw.click(bj, () => this.loginForm('', null));
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
		const f = Vw.div(this.main, { class: 'ir-frm' });
		Vw.add(f, 'h3').textContent = t('btn.login');
		const nmIn = Vw.ipt(f, { type: 'text', name: 'ir-nm', placeholder: t('lbl.room.name') });
		if (room && room.nm) nmIn.value = RoomApp.unB64(room.nm) || room.nm;
		else if (preNb) nmIn.value = RoomApp.unB64(preNb);
		const uidIn = Vw.ipt(f, { type: 'text', name: 'ir-uid', placeholder: t('lbl.username') });
		const rl = rid && AppSettings.state && (AppSettings.state.roomLogin || {})[rid];
		if (rl) uidIn.value = rl.uid || '';
		const pwIn = Vw.ipt(f, { type: 'password', name: 'ir-pw', placeholder: t('lbl.password') });
		// モード選択（サーバーはログイン時のみ、srvOn=false 部屋では disabled、§5.1/§5.7/§6.8）
		Vw.add(f, 'label').textContent = t('lbl.mode');
		const mr = Vw.div(f, { class: 'ir-row' });
		const modes = [['normal', 'hdr.mode.normal'], ['sync', 'hdr.mode.sync'], ['server', 'hdr.mode.server']];
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
		const go = Vw.btn(row, { class: 'ir-btn' });
		Vw.sT(go, t('btn.login'));
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
		const sc = Vw.btn(row, { class: 'ir-btn' }); // QR スキャン（§5.4 カメラ→PNG→ペースト縮退）
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
	async tryLogin({ rid, room, nb, uid, pw, mode, f }) {
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
		const f = Vw.div(this.main, { class: 'ir-frm' });
		Vw.add(f, 'h3').textContent = t('btn.create');
		const nmIn = Vw.ipt(f, { type: 'text', name: 'ir-cn', placeholder: t('lbl.room.name') });
		const uidIn = Vw.ipt(f, { type: 'text', name: 'ir-cuid', placeholder: t('lbl.username') });
		const pwIn = Vw.ipt(f, { type: 'text', name: 'ir-cpw', placeholder: t('lbl.password') });
		const row = Vw.div(f, { class: 'ir-row' });
		const gen = Vw.btn(row, { class: 'ir-btn' }); // 自動生成（512bit b64url）
		Vw.sT(gen, t('btn.pw.auto'));
		Vw.click(gen, async () => {
			try {
				pwIn.value = await AuthChallenge.newPw(this.cfg.PW_BITS);
			} catch (e) {
				ef(e, 'room_app.newPw');
			}
		});
		const xo = Toggle({ parent: row, label: 'btn.xorig', onChange: () => {} }); // xorig=true で以後メニューから oa 管理（§6.6）
		const go = Vw.btn(row, { class: 'ir-btn' });
		Vw.sT(go, t('btn.create'));
		Vw.click(go, async () => {
			const nmRaw = nmIn.value.trim(),
				uid = uidIn.value.trim(),
				pw = pwIn.value;
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
			await this.doCreate({ rid, nb, nmRaw, uid, pw, xorig: xo.get() });
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
	async doCreate({ rid, nb, nmRaw, uid, pw, xorig }) {
		// 作成者は room.json に seed を保管 → session.login の初回採決不要ショートカット（§5.3/§6.2）
		const salt = AuthChallenge.saltNormal();
		const seed = await AuthChallenge.seed(pw, nb, location.origin, salt, this.cfg.HASH_ROUNDS);
		const room = { rid, nm: nb, pw: seed, pwSalt: salt, srvOn: false, cr: uid, cg: Date.now(), xorig: !!xorig, oa: [] };
		await OPFS.w(STORAGE.roomFile(rid), Y.s2u(JSON.stringify(room)).buffer);
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
	}
	// ---- QR スキャン（§5.4: camera→error なら PNG file→text paste）----
	scanFlow(onFound) {
		const box = this.dlg(t('btn.scan'));
		Vw.add(box, 'div', { class: 'ir-mut' }).textContent = t('msg.scan.paste');
		const cam = Vw.btn(box, { class: 'ir-btn' });
		Vw.sT(cam, t('btn.scan'));
		const done = data => {
			boxClose();
			onFound(data);
		};
		let stop = null;
		const boxClose = () => {
			if (stop) try {
				stop();
			} catch (e) { /* stop 失敗無視 */ }
			Vw.rm(box._mdl);
		};
		if (QRScan.canCamera()) {
			const r = QRScan.camera(done);
			if (r && r.stop) stop = r.stop;
			else {
				Vw.sS(cam, { display: 'none' });
				Toast(t('msg.scan.cameraUnavail')); // §12/§5.4 フォールバック UI
			}
		} else Vw.sS(cam, { display: 'none' });
		Vw.click(cam, () => {
			const r = QRScan.camera(done);
			if (r && r.stop) stop = r.stop;
			else Toast(t('msg.scan.cameraUnavail'));
		});
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
	dlg(title) { // 共通モーダル（body 直下。戻り値は .ir-mbx、閉じるは _mdl 除去）
		const mdl = Vw.add(Vw.gB(), 'div', { class: 'ir-mdl' });
		const bx = Vw.div(mdl, { class: 'ir-mbx' });
		Vw.add(bx, 'h3').textContent = title;
		bx._mdl = mdl;
		Vw.click(mdl, ev => {
			if (ev.target === mdl) Vw.rm(mdl);
		});
		return bx;
	}
	async autoJoin() { // §5.7 サーバーモードは起動時に room.json があれば自動ログイン
		if (!this.opfsOk) return;
		const st = (AppSettings.state && AppSettings.state.roomLogin) || {};
		for (const rid of Object.keys(st)) {
			const rl = st[rid];
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
	// ---- 部屋セッション組立て（契約 boot 節 6: RoomSession+HashStore+FileTransfer+各モジュール）----
	async openRoom({ rid, nb, room, uid, mode }) {
		if (this.rooms.has(rid)) return this.rooms.get(rid);
		const cfg = this.cfg,
			ctx = {
				rid, nb, uid, mode, title: RoomApp.unB64((room && room.nm) || nb) || rid, plainPw: '',
				room: Object.assign({ nm: nb, pw: '', pwSalt: '', srvOn: false, cr: '', cg: 0, xorig: false, oa: [] }, room || {}),
			};
		// send は session 経由（ミラーは BC 委譲、§9.12）。生成順循環回避の遅延バインド
		ctx.transfer = new FileTransfer({ send: s => (ctx.session ? ctx.session.sendFrame(s) : false), cfg, uid });
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
		await ctx.collection.loadManifest();
		await ctx.collection.refreshMetas();
		ctx.collection.sweepIfNeeded( // §9.8 部屋起動スイープ（lastSweep は app_state）
			() => (AppSettings.state && AppSettings.state.lastSweep) || 0,
			() => AppSettings.setState('lastSweep', Date.now()).catch(e => ef(e, 'room_app.sweepSet'))
		).catch(e => ef(e, 'room_app.sweepRoom'));
		ctx.sheet = new SheetRoom({ rid, uid, store: this.store, img: ImgProc, cfg, sendFrame: s => ctx.session.sendFrame(s), transfer: ctx.transfer });
		await ctx.sheet.scan().catch(e => ef(e, 'room_app.sheetScan'));
		// 起動時: manifest→シート索引を復元（無変更なら送出なし。§9.7 オフライン再構築）
		await ctx.sheet.rebuild(ctx.collection.manifestEntries()).catch(e => ef(e, 'room_app.sheetRebuild'));
		ctx.sync = new SyncMode({ rid, uid, collection: ctx.collection, transfer: ctx.transfer, session: ctx.session, settings: AppSettings, cfg, store: this.store });
		ctx.sync.onProgress = s => { // §9.9 フッター進捗
			if (ctx.foot) Vw.sT(ctx.foot, t('lbl.sync.footer', { total: s.total, fetched: s.fetched }));
		};
		ctx.sync.start();
		ctx.slices = new SliceCache();
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
				if (!m) await this.store.metaPut({ h: e.h, n: e.n, r: e.r || [nb], u: e.u, ts: e.ts, t: e.t, l: e.l, s: e.s, c: e.c, d: null });
				else if (!(m.r || []).includes(nb)) {
					(m.r = m.r || []).push(nb); // §9.5 部屋横断: r マージ
					await this.store.metaPut(m);
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
				if (p.uid !== ctx.session.uid)
					setTimeout(() => {
						try {
							ctx.sheet.broadcastMNow();
						} catch (e) {
							ef(e, 'room_app.renotify');
						}
					}, 1000 + Math.random() * 3000);
			} else if (p.ir === IR.B) hk.onB(p, from);
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
			if (ctx.sheet) ctx.sheet.broadcastMNow(); // §9.4 自保持索引の周知
			ctx.setItems();
			if (this.active === rid) this.renderRoom(rid);
		});
		ctx.session.on('authFail', reason => Toast(t(reason || 'msg.auth.fail'))); // §12
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
		// 共有部（§9.1: ファイル input → share → setThumb → rebuild → M broadcast[スロットル]）
		const sb = Vw.div(this.main, { class: 'ir-sec' });
		const fi = Vw.ipt(sb, { type: 'file', accept: 'image/*', multiple: 'multiple' });
		Vw.sS(fi, { minHeight: '44px' });
		Vw.change(fi, async () => {
			const files = Array.prototype.slice.call(fi.files || []);
			if (!files.length) return;
			fi.disabled = true;
			try {
				let shared = 0;
				for (const f of files) {
					const r = await ctx.collection.share(f, { name: f.name, mime: f.type });
					if (r.error === 'tooBig') Toast(t('msg.share.tooBig')); // §11 MAX_IMG_BYTES
					else if (r.error) Toast(t('msg.share.fail'));
					else {
						shared++;
						try {
							ctx.sheet.setThumb(r.h10, await ImgProc.thumb(f, this.cfg.THUMB_PX)); // §9.2 コマ
						} catch (e) {
							ef(e, 'room_app.thumb');
						}
					}
				}
				if (shared) {
					await ctx.sheet.rebuild(ctx.collection.manifestEntries()); // 変更シートのみ queueBroadcast→スロットル送出（§8.6）
					Toast(t('msg.share.ok'));
				}
			} catch (e) {
				ef(e, 'room_app.share');
				Toast(t('msg.share.fail'));
			}
			fi.value = '';
			fi.disabled = false;
		});
		// カレンダー（§5.5。RoomCalendar が窓制御・grayscale・progress 内蔵）
		const tb = Vw.div(this.main, { class: 'ir-row' });
		for (const m of ['day', 'week', 'month']) {
			const b = Vw.btn(tb, { class: 'ir-btn' });
			Vw.sT(b, t('btn.cal.' + m));
			Vw.click(b, () => {
				this.cfg.CAL_VIEW = m;
				if (ctx.cal) ctx.cal.setMode(m);
			});
		}
		const calHost = Vw.div(this.main, {});
		if (!ctx.cal) {
			ctx.cal = new RoomCalendar({ parent: calHost, cfg: this.cfg, collection: ctx.collection, slices: { slicesOf: (u, i) => ctx.sheet.slicesOf(u, i) }, transfer: ctx.transfer, img: { bodyOf: h10 => this.bodyOf(h10) } });
			ctx.cal.onBody = (h10, blob) => this.viewer(h10, blob); // §5.4 ビューア橋渡し
			ctx.cal.setMode(this.cfg.CAL_VIEW || 'month');
		} else calHost.appendChild(ctx.cal.root);
		ctx.setItems();
		ctx.cal.refresh();
		// フッター（同期モード時のみ、§9.9）
		ctx.foot = Vw.add(this.main, 'div', { class: 'ir-mut' });
		Vw.sS(ctx.foot, { display: ctx.sync.enabled ? '' : 'none' });
		Vw.sT(ctx.foot, t('lbl.sync.footer', { total: 0, fetched: 0 }));
		if (ctx.mode === 'server') this.serverPanel(ctx); // §5.7
	}
	// ---- サーバーモード表示（§5.7: 参加者/過去参加者/OPFS 内訳/autodl）----
	async serverPanel(ctx) {
		const s = Vw.div(this.main, { class: 'ir-sec' });
		Vw.add(s, 'h4').textContent = t('lbl.participants');
		const pl = Vw.div(s);
		ctx.paintParts = list => {
			Vw.rc(pl);
			for (const p of (list || ctx.session.state.participants || [])) {
				const row = Vw.div(pl, { class: 'ir-row' });
				Vw.add(row, 'span').textContent = p.uid;
				const hs = ctx.collection.peerHolds.get(p.uid);
				if (hs) Vw.add(row, 'span', { class: 'ir-mut' }).textContent = hs.size;
			}
		};
		ctx.paintParts(ctx.session.state.participants);
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
		} catch (e) {
			ef(e, 'room_app.leave');
		}
		try {
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
		if (decodeURIComponent((location.hash || '').replace(/^#/, '')) === ctx.nb) location.hash = '';
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
	// ---- 本体ビューア（§5.4: フルサイズ+メタ+保存/DL/閉じる）----
	async viewer(h10, blob) {
		const ctx = this.activeCtx();
		const box = this.dlg(t('lbl.meta.h'));
		const ab0 = await blob.arrayBuffer(),
			url = `data:${blob.type || 'image/jpeg'};base64,${Y.a2B(ab0)}`; // CSP img-src 'self' data: 準拠（objectURL 不可）
		const im = Vw.add(box, 'img', { class: 'ir-img' });
		im.src = url;
		const meta = await this.store.metaGet(h10).catch(() => null);
		const nm = meta ? RoomApp.unB64(meta.n) || meta.n || '' : '';
		const ext = (meta && meta.t ? String(meta.t).split('/')[1] : '') || 'jpg';
		const rowOf = (k, v) => {
			const r = Vw.add(box, 'div', { class: 'ir-row' });
			Vw.add(r, 'span', { class: 'ir-mut' }).textContent = t(k);
			Vw.add(r, 'span').textContent = v;
		};
		rowOf('lbl.meta.n', nm);
		if (meta) {
			rowOf('lbl.meta.u', meta.u || '');
			rowOf('lbl.meta.ts', new Date(meta.ts || 0).toLocaleString());
			rowOf('lbl.meta.r', (meta.r || []).map(u => RoomApp.unB64(u) || u).join(', '));
			rowOf('lbl.meta.t', meta.t || '');
			rowOf('lbl.meta.h', String(h10).slice(0, 8));
		}
		const row = Vw.div(box, { class: 'ir-row' });
		const sv = Vw.btn(row, { class: 'ir-btn' }); // 保存（OPFS bodies+meta 確定、§9.6）
		Vw.sT(sv, t('btn.save'));
		Vw.click(sv, async () => {
			try {
				await this.store.put(await blob.arrayBuffer());
				this.usageDirty();
				Toast(t('msg.settings.saved'));
			} catch (e) {
				ef(e, 'room_app.save');
			}
		});
		const dl = Vw.btn(row, { class: 'ir-btn' }); // DL（OPFS 保存+ブラウザ DL）
		Vw.sT(dl, t('btn.dl'));
		Vw.click(dl, async () => {
			try {
				await this.store.put(await blob.arrayBuffer());
			} catch (e) {
				ef(e, 'room_app.save2');
			}
			this.dl(blob, (nm || h10) + '.' + ext);
			this.usageDirty();
		});
		if (ctx && !ctx.collection.isTrashed(h10)) { // ごみ箱へ（§9.8。X flags → 実送出、削除は投稿者本人のみ）
			const tr = Vw.btn(row, { class: 'ir-btn warn' });
			Vw.sT(tr, t('btn.trash'));
			Vw.click(tr, async () => {
				const r = await ctx.collection.trash(h10).catch(e => ef(e, 'room_app.trash'));
				if (!r || !r.trashed) return;
				if (r.x) ctx.session.sendFrame(Protocol.mk('X', { h: r.x.h, by: r.x.by }));
				ctx.sheet.rebuild(ctx.collection.manifestEntries()).catch(e => ef(e, 'room_app.rebuild'));
				this.usageDirty();
				Vw.rm(box._mdl);
			});
		}
		const cl = Vw.btn(row, { class: 'ir-btn' });
		Vw.sT(cl, t('btn.close'));
		Vw.click(cl, () => {
			URL.revokeObjectURL(url);
			Vw.rm(box._mdl);
		});
	}
	// ---- 作成者メニュー（§5.2: QR 表示/DL・パスワード再発行・oa 管理・srvOn 切替・退室）----
	roomMenu() {
		const ctx = this.activeCtx();
		if (!ctx || ctx.room.cr !== ctx.uid) return; // 作成者本人のみ（§5.3/§6.2）
		const box = this.dlg(t('btn.room.menu'));
		// QR（§6.4: 生成→検証→PNG DL。平文 pw は作成/再発行後のセッション中のみ保持）
		const qrBox = Vw.div(box, {});
		const mkQr = async () => {
			Vw.rc(qrBox);
			if (!ctx.plainPw) {
				Vw.add(qrBox, 'div', { class: 'ir-mut' }).textContent = t('msg.qr.needpw');
				return;
			}
			try {
				const r = await QRTool.make(qrPack(ctx.nb, ctx.plainPw), {
					size: this.cfg.QR_SIZE_PX, level: this.cfg.QR_CORRECT_LEVEL, retry: this.cfg.QR_VERIFY_RETRY,
				});
				if (r.failed) {
					Toast(t('msg.qr.verify.fail'));
					return;
				}
				Vw.sS(r.canvas, { maxWidth: '100%', background: '#fff' });
				qrBox.appendChild(r.canvas);
				Vw.add(qrBox, 'div', { class: 'ir-mut' }).textContent = t('lbl.qr.text');
				const tx = Vw.ipt(qrBox, { type: 'text', readonly: 'readonly' });
				tx.value = r.data || qrPack(ctx.nb, ctx.plainPw);
				const rowq = Vw.div(qrBox, { class: 'ir-row' });
				const cp = Vw.btn(rowq, { class: 'ir-btn' });
				Vw.sT(cp, t('btn.copy'));
				Vw.click(cp, () => Vw.copy(tx.value));
				const png = Vw.btn(rowq, { class: 'ir-btn' });
				Vw.sT(png, t('btn.qr.png'));
				Vw.click(png, async () => {
					const b = await QRTool.pngBlob(r.canvas);
					if (b) this.dl(b, ctx.rid + '.png');
				});
			} catch (e) {
				ef(e, 'room_app.qr');
				Toast(t('msg.qr.verify.fail'));
			}
		};
		Vw.add(box, 'h4').textContent = t('btn.qr');
		mkQr();
		// パスワード再発行（新 seed 算出 → C 送出、§6.3/§8.3）
		const r1 = Vw.div(box, { class: 'ir-row' });
		const iss = Vw.btn(r1, { class: 'ir-btn' });
		Vw.sT(iss, t('btn.pw.issue'));
		Vw.click(iss, async () => {
			try {
				const pw = await AuthChallenge.newPw(this.cfg.PW_BITS);
				const salt = AuthChallenge.saltNormal();
				const seed = await AuthChallenge.seed(pw, ctx.nb, location.origin, salt, this.cfg.HASH_ROUNDS);
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
		// サーバーモード許可 ON/OFF（作成者専権・随時、§6.8）
		const r2 = Vw.div(box, { class: 'ir-row' });
		const svOn = Toggle({ parent: r2, label: 'btn.srv.toggle', onChange: async on => {
			ctx.room.srvOn = !!on;
			ctx.room.cg = Date.now();
			await this.pushC(ctx);
			Toast(t(on ? 'msg.srv.on' : 'msg.srv.off'));
		} });
		svOn.set(ctx.room.srvOn === true || ctx.room.srvOn === 'true');
		// 退室・タブ閉じる（§5.2）
		const r3 = Vw.div(box, { class: 'ir-row' });
		const lv = Vw.btn(r3, { class: 'ir-btn warn' });
		Vw.sT(lv, t('btn.leave'));
		Vw.click(lv, () => {
			Vw.rm(box._mdl);
			this.logout(ctx.rid);
		});
	}
	// C フレーム送出 + room.json 永続化（§8.3。cg 単調増加、旧い C は受信側無視）
	async pushC(ctx) {
		const o = {
			rid: ctx.rid, uid: ctx.uid, cr: ctx.room.cr, cg: ctx.room.cg,
			pw: ctx.room.pw, pwSalt: ctx.room.pwSalt,
			srvOn: ctx.room.srvOn === true || ctx.room.srvOn === 'true',
			xorig: ctx.room.xorig === true || ctx.room.xorig === 'true',
			oa: ctx.room.oa || [],
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
				cr: o.cr, cg: o.cg, xorig: o.xorig, oa: o.oa,
			})).buffer);
		} catch (e) {
			ef(e, 'room_app.saveRoom');
		}
	}
}
