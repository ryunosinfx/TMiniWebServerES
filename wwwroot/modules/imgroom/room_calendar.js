/**
 * @module wwwroot/modules/imgroom/room_calendar.js
 * @version 0.1.0
 * @see docs/img_room_spec.md §5.5（カレンダービュー）/ docs/impl_contracts.md room_calendar 節
 * RoomCalendar — CalView（ページ窓 CAL_WINDOW_PAGES）+ 項目レベルの自前窓制御（IO 不使用・
 * getBoundingClientRect で可視日セルの項目のみサムネイル DOM 生成、他は高さ THUMB_PX の
 * placeholder）。サムネイル objectURL は私有 SliceCache。窓外（スクロール/ページ窓）で
 * <img> 除去 + release。グレースケール + msg.offline.gray Badge。取得中 Progress は
 * クラス ir-prog + data-h10 で照合し、窓外でも Map に保持して再描画時反映。
 * collection / slices / transfer / img は注入依存（import しない）。
 */
import { Vw } from '../../Vw.js';
import { CalView } from '../cal_view.js';
import { ImgProc, SliceCache } from '../img_proc.js';
import { Progress, Badge, Toast } from '../widgets.js';
import { I18N } from '../i18n.js';
import { CFG } from './ir_const.js';

const PROG_CLS = 'ir-prog'; // 取得中サムネイルのクラス（onProgress 照合用）
const GRAY_CLS = 'ir-gray'; // §5.5 全保持者不参加（allDeparted）
const MODES = ['day', 'week', 'month'];
const USER_PRIO = 10; // ユーザー操作 prio（自動同期=0 より高、§8.6）
const WIN_PAD_PX = 96; // 窓の先読み/後読み余白（スクロール対策）
const PASS_MS = 80; // 窓再評価のスロットル

export class RoomCalendar {
	/**
	 * new RoomCalendar({ parent, cfg, collection, slices, transfer, img })
	 * slices: SheetRoom.slicesOf(uid, idx) -> Promise<Blob[]>
	 * transfer: fetch({h10,holders,prio}) / onProgress(h10,n,m) / cancel(h10)
	 * img: 任意。bodyOf(h10)->Promise<Blob|null>（thumb 索引なし項目の遅延生成用）
	 * onBody: 設定可。fn(h10, blob) — サムネイルクリックで fetchBody 成功時に呼ぶ（ビューアは呼び出し側）
	 */
	constructor({ parent, cfg, collection, slices, transfer, img } = {}) {
		this.cfg = { ...CFG, ...(cfg || {}) };
		this.col = collection || null;
		this.sl = slices || null;
		this.tr = transfer || null;
		this.img = img || null;
		this.dead = false;
		this.onBody = null;

		this.items = []; // 生 items（setItems で差し替え）
		this.md = 'month'; // 既定: 月
		this.progs = new Map(); // h10 -> ratio(0..1)。窓外でも保持し再描画時反映
		this.mounts = new Map(); // mount id -> wrap el（renderItem で生成済みの窓内項目）
		this.seq = 0;
		this.sc = new SliceCache(); // サムネイル専用 objectURL キャッシュ
		this.wanted = new Set(); // 現在望まれている objectURL key（非同期解決の取り違え防止）
		this.fetches = new Map(); // h10 -> Promise（多重 fetch 防止）
		this._pt = 0; // schedulePass のスロットルタイマ
		this._bx = null; // CalView のスクロールコンテナ（reb で差し替わる）
		this._sf = null; // scroll リスナ（removeEventListener 用）

		// transfer.onProgress は他実装と共有のため前ハンドラをチェーンして保持
		this._prevProg = this.tr ? this.tr.onProgress : null;
		if (this.tr) this.tr.onProgress = (h10, n, m) => {
			this.setProg(h10, n, m);
			if (typeof this._prevProg === 'function') this._prevProg(h10, n, m);
		};

		this.root = Vw.div(parent, { class: 'ir-roomcal' });
		this._tpx = this.cfg.THUMB_PX; // v1.6 §20: 表示サイズ（setThumbPx で変更可）
		this.bar = Vw.div(this.root, { class: 'ir-calbar' });
		this._modeBtns = new Map();
		for (const m of MODES) {
			const b = Vw.btn(this.bar, { class: 'ir-calmode', type: 'button' });
			b.textContent = I18N.t(`btn.cal.${m}`);
			Vw.click(b, () => this.setMode(m));
			this._modeBtns.set(m, b);
		}
		this.calBox = Vw.div(this.root, { class: 'ir-calbox' });
		this.mkCal();
		// 言語切替（I18N.onChange は RoomApp 等の所有者。グローバル上書きせず
		// 再ラベル+refresh は呼び出し側から refresh()/再構築で反映してもらう）
	}

	mkCal() {
		// CalView: 時刻降順ページ窓（月=1 月/週=1 週/日=1 日）。renderItem は窓内項目のみ呼ばれる
		this.cal = new CalView({
			parent: this.calBox,
			mode: this.md,
			items: this.view(),
			winPages: this.cfg.CAL_WINDOW_PAGES,
			cellPx: this.cfg.THUMB_PX + 24,
			cellCap: this.cfg.CELL_CAP, // v1.5 §19: セル/日表示上限（超大規模で DOM 定数化）
			moreText: n => I18N.t('lbl.cal.more', { n }),
			onExpand: () => this.schedulePass(),
			onScroll: () => this.schedulePass(), // v1.6 §20: 月セル/日リストの内部スクロールでも実体化
			renderItem: it => this.renderItem(it),
			onPage: () => { this.bindScroll(); this.schedulePass(); },
		});
		this.bindScroll();
	}

	view() {
		// items → CalView 用（ゴミ箱除く・ts 正規化: 不正時刻は最終受信時刻/最終 resort で補正し警告）
		const out = [];
		for (const it of this.items) {
			if (!it || !it.h10 || it.trashed) continue;
			const m = it.meta || {};
			let ts = Number(m.ts);
			if (!Number.isFinite(ts) || ts <= 0) {
				ts = Number(it.rcv || m.g || 0) || Date.now();
				console.warn('RoomCalendar: 不正 ts を最終受信時刻で補正', it.h10);
			}
			out.push({ ...it, ts });
		}
		return out;
	}

	setItems(items) {
		if (this.dead) return;
		this.items = Array.isArray(items) ? items : [];
		if (this.cal) this.cal.setItems(this.view());
		this.bindScroll();
		this.schedulePass();
	}

	setMode(m) {
		if (this.dead || !MODES.includes(m)) return;
		this.md = m;
		for (const [k, b] of this._modeBtns) Vw.tC(b, 'on', k === m); // .ir-calmode.on（CSS）
		if (this.cal) this.cal.setMode(m);
		this.bindScroll();
		this.schedulePass();
	}

	setThumbPx(v) {
		// v1.6 §20: 表示サムネイルサイズ切替。CalView を cellPx 込みで再構築（シート/交換基準 128 は不変、CSS 変数で縮小表示）
		if (this.dead || !(v > 0) || v === this._tpx) {
			this._tpx = v;
			return;
		}
		this._tpx = v;
		this.cfg.THUMB_PX = v;
		if (this.cal) {
			this.cal.destroy();
			this.cal = null;
		}
		this.mounts.clear(); // 旧ページ DOM は除去済（スライス cache は h10 単位で保持、buildThumb が再利用）
		this.mkCal();
		this.bindScroll();
		this.schedulePass();
	}

	refresh() {
		if (this.dead) return;
		if (this.cal) this.cal.refresh();
		for (const el of this.mounts.values()) if (el.isConnected) { this.paintGray(el); this.paintProg(el); }
		this.schedulePass();
	}

	destroy() {
		if (this.dead) return;
		this.dead = true;
		if (this._pt) { clearTimeout(this._pt); this._pt = 0; }
		if (this._bx && this._sf) this._bx.removeEventListener('scroll', this._sf);
		if (this._sf) window.removeEventListener('scroll', this._sf);
		this._bx = null; this._sf = null;
		if (this.tr) {
			for (const h10 of this.fetches.keys()) { try { this.tr.cancel(h10); } catch (e) { /* 済完了分は無視 */ } }
			this.tr.onProgress = this._prevProg;
		}
		this.fetches.clear();
		if (this.cal) this.cal.destroy();
		this.cal = null;
		this.sc.releaseAll();
		this.wanted.clear();
		this.mounts.clear();
		this.progs.clear();
		Vw.rm(this.root);
	}

	// ---- 項目レベル窓（IntersectionObserver 不使用・自前 rect 計算） ----
	bindScroll() {
		if (this.dead) return;
		const box = this.cal && this.cal.box;
		if (!box || box === this._bx) return;
		if (this._bx && this._sf) this._bx.removeEventListener('scroll', this._sf);
		this._bx = box;
		this._sf = () => this.schedulePass();
		box.addEventListener('scroll', this._sf, { passive: true });
		// v1.5 §19: 箱高さ非拘束レイアウト（ページ自体がスクロール）でも窓実体化を追従させる
		window.addEventListener('scroll', this._sf, { passive: true });
	}

	schedulePass() {
		if (this.dead || this._pt) return;
		this._pt = setTimeout(() => { this._pt = 0; this.winPass(); }, PASS_MS);
	}

	winPass() {
		// 窓内マウントを舐め、CalView スクロール窓に交わるものだけサムネイル実体化、
		// 窓外は placeholder div（高さ THUMB_PX）へ格下げ + objectURL release。
		// ページ窓外で CalView/VirtList が除去した DOM（isConnected=false）もここで回収。
		if (this.dead) return;
		const box = this._bx;
		if (!box) return;
		const bb = box.getBoundingClientRect();
		for (const [id, el] of this.mounts) {
			if (!el.isConnected) { this.releaseThumb(el); this.mounts.delete(id); continue; }
			const r = el.getBoundingClientRect();
			if (r.bottom > bb.top - WIN_PAD_PX && r.top < bb.bottom + WIN_PAD_PX) this.buildThumb(el);
			else this.releaseThumb(el);
		}
	}

	renderItem(it) {
		// CalView のページ窓内項目のみ呼ばれる。placeholder div（THUMB_PX 高）を返し、
		// winPass が可視項目だけ img を実体化する。
		const el = Vw.div(null, { class: 'ir-thumb', 'data-h10': it.h10 }); // 寸法は --ir-thumb（room_app が設定値から注入）
		el._irc = { it, key: null, img: null, prog: null, badge: null, built: false };
		this.mounts.set(++this.seq, el);
		this.paintGray(el);
		this.paintProg(el);
		Vw.click(el, () => {
			// 画像クリック→fetchBody→Blob 返却（objectURL・ビューアは呼び出し側。onBody に橋渡し）
			this.fetchBody(it.h10).then(b => { if (b && typeof this.onBody === 'function') this.onBody(it.h10, b); });
		});
		this.schedulePass();
		return el;
	}

	buildThumb(el) {
		const r = el._irc;
		if (r.built) return;
		r.built = true;
		const t = r.it.thumb;
		if (t && t.uid != null && t.idx != null && t.cell != null && this.sl && typeof this.sl.slicesOf === 'function') {
			const key = `irc:${t.uid}.${t.idx}.${t.cell}`;
			const url = this.sc.get(key);
			if (url) { this.setSrc(el, url, key); return; }
			this.wanted.add(key);
			Promise.resolve(this.sl.slicesOf(t.uid, t.idx)).then(async blobs => {
				// 未取得シート（[]）は transfer 経由の交換を待たず空白。Badge 進捗なし
				if (this.dead || !r.built || !this.wanted.has(key) || !el.isConnected) return;
				const b = blobs && blobs[t.cell];
				if (b) this.setSrc(el, await this.sc.set(key, b), key);
			}).catch(() => { /* 空白のまま（次入室で再試行） */ });
		} else {
			this.genFromBody(el); // thumb 索引なし: body から ImgProc.thumb 遅延生成
		}
	}

	async genFromBody(el) {
		// img.bodyOf（注入）で本体 Blob が取れる場合のみ遅延生成。取れなければ空白 placeholder
		const r = el._irc;
		try {
			if (!this.img || typeof this.img.bodyOf !== 'function') return;
			const body = await this.img.bodyOf(r.it.h10);
			if (this.dead || !r.built || !el.isConnected) return;
			const tb = body && await ImgProc.thumb(body, this.cfg.THUMB_BASE_PX || 128); // v1.6 §20: 基準 128 で生成し表示は --ir-thumb で縮小
			if (this.dead || !r.built || !el.isConnected || !tb) return;
			const key = `irb:${r.it.h10}`;
			this.wanted.add(key);
			this.setSrc(el, await this.sc.set(key, tb), key);
		} catch (e) { /* 空白のまま */ }
	}

	setSrc(el, url, key) {
		const r = el._irc;
		r.key = key;
		if (r.img) r.img.setAttribute('src', url);
		else r.img = Vw.add(el, 'img', { src: url, alt: '' }); // 寸法は .ir-thumb img
	}

	releaseThumb(el) {
		// <img> 除去 + objectURL revoke（窓外）。placeholder 化
		const r = el._irc;
		if (!r.built && !r.img && !r.key) return;
		r.built = false;
		if (r.img) { Vw.rm(r.img); r.img = null; }
		if (r.key) { this.wanted.delete(r.key); this.sc.release(r.key); r.key = null; }
	}

	// ---- グレースケール + Badge（§5.5） ----
	paintGray(el) {
		const r = el._irc;
		if (r.badge) { Vw.rm(r.badge); r.badge = null; }
		el.classList.remove(GRAY_CLS); // filter: grayscale は .ir-gray（CSS）
		const ho = this.col && typeof this.col.holdersOf === 'function' ? this.col.holdersOf(r.it.h10) : null;
		if (ho && ho.allDeparted) {
			el.classList.add(GRAY_CLS);
			r.badge = Badge(el, 'ir-badge-off ir-graybadge', I18N.t('msg.offline.gray'));
		}
	}

	// ---- 取得インジケーター（Progress: 当該サムネイルの下。クラス ir-prog + data-h10） ----
	setProg(h10, n, m) {
		const total = Number(m) || 0;
		const ratio = total ? Math.max(0, Math.min(1, (Number(n) || 0) / total)) : 0;
		this.progs.set(h10, ratio); // 窓外でも Map に保持
		for (const el of this.mounts.values()) if (el.isConnected && el._irc.it.h10 === h10) this.paintProg(el);
	}

	clearProg(h10) {
		this.progs.delete(h10);
		for (const el of this.mounts.values()) if (el.isConnected && el._irc.it.h10 === h10) {
			el.classList.remove(PROG_CLS);
			if (el._irc.prog) { Vw.rm(el._irc.prog.el); el._irc.prog = null; }
		}
	}

	paintProg(el) {
		const r = el._irc;
		const ratio = this.progs.get(r.it.h10);
		if (typeof ratio !== 'number') {
			el.classList.remove(PROG_CLS);
			if (r.prog) { Vw.rm(r.prog.el); r.prog = null; }
			return;
		}
		el.classList.add(PROG_CLS); // data-h10 は renderItem 生成時 att
		if (!r.prog) {
			r.prog = Progress({ parent: el });
			Vw.aC(r.prog.el, 'ir-progbar');
		}
		r.prog.set(ratio);
	}

	// ---- 本体取得（ユーザー操作 prio。objectURL・ビューアは呼び出し側） ----
	fetchBody(h10) {
		if (this.dead || !h10) return Promise.resolve(null);
		const run = async () => {
			const ho = this.col && typeof this.col.holdersOf === 'function' ? this.col.holdersOf(h10) : null;
			if (ho && ho.allDeparted) { // 全保持者不参加: 取得不能（§5.5/§12）
				if (!this.dead) Toast(I18N.t('msg.offline.gray'));
				return null;
			}
			// v1.3.1 perf: 自タブの自宛エコーは session で無視されるため自画像の P2P 取得は永久に
			// REQ_TIMEOUT（作成者が自分の画像を開けないバグ）。自が保持者はローカル store から直接返す
			// （r マージ等で本体未保持なら null → 下の transfer 経路へフォールバック）。低スペック機でも即時。
			if (ho && ho.uids && this.col && ho.uids.includes(this.col.uid) && this.img && typeof this.img.bodyOf === 'function') {
				const b0 = await this.img.bodyOf(h10);
				if (b0) return b0;
			}
			if (!this.tr || typeof this.tr.fetch !== 'function') {
				if (!this.dead) Toast(I18N.t('msg.fetch.fail'));
				return null;
			}
			this.setProg(h10, 0, 1);
			try {
				const ab = await this.tr.fetch({ h10, holders: ho && ho.uids ? ho.uids.slice() : [], prio: USER_PRIO });
				this.clearProg(h10);
				if (this.dead) return null;
				if (!ab) { Toast(I18N.t('msg.fetch.fail')); return null; } // 失敗: null + Toast
				return new Blob([ab]); // transfer.fetch は ArrayBuffer 解決 → Blob 化
			} catch (e) {
				this.clearProg(h10);
				if (!this.dead) Toast(I18N.t('msg.fetch.fail'));
				return null;
			}
		};
		const p = run().then(b => { this.fetches.delete(h10); return b; }, e => { this.fetches.delete(h10); throw e; });
		this.fetches.set(h10, p);
		return p;
	}
}
