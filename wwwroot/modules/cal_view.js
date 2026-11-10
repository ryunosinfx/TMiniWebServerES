/**
 * @module modules/cal_view.js
 * @version 0.2.0
 * @see docs/img_room_spec.md (§5.5 カレンダービュー / §19 表示上限 / §21 見出し行ベース時系列リスト)
 */
import { w, ef } from '../Y.js';
import { Vw } from '../Vw.js';
import { VirtList } from './virt_list.js';

const DY = 86400000, // 1 日 ms（週/月ユニット換算。DST ±1h は日差 Math.round で吸収）
	HH = 26, // セクションヘッダ行高さ px
	MD = ['month', 'week', 'day']; // 表示モード集合（配列完全一致で判定。文字列 includes は部分一致誤通しになるため使用禁止）

const p2 = n => (n < 10 ? `0${n}` : `${n}`),
	dmy = d => `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())}`, // 'YYYY/MM/DD'（Intl 不使用・ローカルタイム）
	mmy = d => `${d.getFullYear()}/${p2(d.getMonth() + 1)}`, // 'YYYY/MM'
	mdy = d => `${p2(d.getMonth() + 1)}/${p2(d.getDate())}`, // 'MM/DD'
	d0 = d => {
		d.setHours(0, 0, 0, 0); // ローカル 0 時へ丸め
		return d;
	};

/*
 * v1.7 §21 見出し行ベースの時系列リスト（全モード共通）:
 *  - ページ = 1 セクション（見出し + 画像スロットの横流れ折返し。1 画像 1 枠）で、
 *    日モードは日毎 / 週モードは週毎 / 月モードは月毎に改行（セクション区切り）。
 *  - 空セクション（画像のない日/週/月）の見出しは日付のみ。
 *  - 項目なしなら「今日」1 セクションのみ。項目ありなら
 *    ①画像ユニット ②画像ユニットの隣接(±1)空ユニット(≤現在) ③現在以降に画像がない場合の最新空ユニット
 *    を含む（長い空白の途中は省略。無限増殖防止）。
 *  - 見出し整形（日モード）: 前セクションと YYYY が変われば YYYY/MM/DD、MM まで変われば MM/DD、
 *    同月なら DD。週=週開始日の YYYY/MM/DD、月=YYYY/MM を常にフル表示。
 *  - 1 セクションの表示上限 cellCap（0=無制限。既定 12）と「+N 件」展開は v1.5 §19 と同じ。
 * ページ窓（CAL_WINDOW_PAGES 既定 3）と窓外 DOM 開放は VirtList に委譲（全セクション同高）。
 */
export class CalView {
	constructor(opt = {}) {
		this.pt = opt.parent;
		this.md = MD.includes(opt.mode) ? opt.mode : 'month';
		this.rI = opt.renderItem || (() => Vw.div(null));
		this.oP = opt.onPage || null;
		this.it = [];
		this.bk = []; // 画像あり日バケット [{k: 0 時 ms, d: Date, v: [item 降順]}]（現在→過去）
		this.sec = []; // セクション [{u: ユニット鍵, d: Date(見出し日), v: [item 降順], today: bool}]（現在→過去）
		this.wp = opt.winPages > 0 ? opt.winPages : 3; // 窓ページ数下限（既定 CAL_WINDOW_PAGES=3）
		this.ch = opt.cellPx > 0 ? opt.cellPx : 88; // サムネイル枠高さ px（THUMB_PX+24。スロット寸法導出用）
		this.fPg = opt.pagePx > 0 ? opt.pagePx : 0; // ページ高さ上書き px（0=自動）
		this.cap = opt.cellCap > 0 ? opt.cellCap : 0; // 1 セクション表示上限（0=無制限）
		this._exp = new Map(); // ユニット鍵 -> 表示数（展開状態）
		this.moreTxt = opt.moreText || (n => '+' + n);
		this.oE = opt.onExpand || null;
		this.oS = opt.onScroll || null; // セクション内部スクロールでも窓実体化を追従させる（v1.6 §20）
		this.vl = null;
		this.box = null;
		this.dead = false;
		if (opt.items) this.it = opt.items;
		this.mk();
	}
	setMode(m) {
		// 表示モード切替（'day'|'week'|'month'）
		if (this.dead || !MD.includes(m) || m === this.md) return;
		this.md = m;
		this.reb();
	}
	setItems(items) {
		// 表示項目 [{ts,...}] 差し替え（現在より未来の投稿は除外し、バケット/セクション再構築）
		if (this.dead) return;
		this.it = Array.isArray(items) ? items : [];
		this.reb();
	}
	refresh() {
		// 再計算（count 変化・レイアウト変化時。窓評価のみ）
		if (this.dead) return;
		if (this.vl) this.vl.refresh();
	}
	destroy() {
		// 後始末（VirtList 破棄 = 窓内 DOM 開放 + コンテナ除去）
		if (this.dead) return;
		this.dead = true;
		if (this.vl) this.vl.destroy();
		this.vl = null;
		Vw.rm(this.box);
		this.box = null;
		this.bk = [];
		this.sec = [];
		this.it = [];
		this.oP = null;
		this.rI = null;
		this._exp.clear();
		this.oE = null;
		this.oS = null;
		this.moreTxt = null;
	}
	mk() {
		// スクロールボックス生成（高さは呼び出し側 parent 側で決める。DOM はこの時点から触る）
		this.box = Vw.div(this.pt, { class: 'cal-box' }, { overflow: 'auto', height: '100%' });
		this.reb();
	}
	reb() {
		// 再構築: バケット再集計 → セクション構築 → VirtList 作り直し（mode/項目差し替え）
		if (this.dead || !this.box) return;
		if (this.vl) {
			this.vl.destroy();
			this.vl = null;
		}
		this.bkt();
		this.buildSec();
		const pg = this.pgPx(),
			bx = this.box,
			h = Math.max(1, Math.ceil(((bx.clientHeight || 480) + 2) / pg)), // 窓は最低でもビューポート+α を覆う
			wp = Math.max(this.wp, h);
		this.vl = new VirtList({
			container: this.box,
			page: pg,
			winPages: wp,
			count: () => this.pgCnt(),
			render: i => this.pgEl(i),
			onWindow: (lo, hi, cur) => {
				if (this.oP) this.oP(lo, hi, cur);
			},
		});
	}
	bkt() {
		// items をローカルタイム日別バケットへ（未来項目は仕様 §5.5 で表示対象外→除外。不正 ts は警告除外）
		const nw = Date.now(),
			m = new Map();
		let fut = 0,
			bad = 0;
		for (const it of this.it || []) {
			const t = it && it.ts;
			if (typeof t !== 'number' || !Number.isFinite(t)) {
				bad++;
				continue;
			}
			if (t > nw) {
				fut++;
				continue;
			}
			const k = d0(new Date(t)).getTime(),
				a = m.get(k);
			if (a) a.push(it);
			else m.set(k, [it]);
		}
		if (fut) w(`CalView: 現在より未来の項目 ${fut} 件を表示から除外`);
		if (bad) w(`CalView: 不正 ts の項目 ${bad} 件を表示から除外`);
		this.bk = [...m.keys()]
			.sort((a, b) => b - a)
			.map(k => {
				const d = new Date(k);
				return { k, d, v: m.get(k).sort((x, y) => y.ts - x.ts) };
			});
	}
	// ---- ユニット算術（モード別: 日=当日 0 時 ms / 週=周日 0 時 ms / 月=通月番号） ----
	uOf(k) {
		// 日 0 時 ms → 所属ユニット鍵
		if (this.md === 'day') return k;
		if (this.md === 'week') {
			const d = new Date(k);
			return k - d.getDay() * DY; // 周日起点（DST 換算は dayKey 基準のまま近似。境界ずれても同一週内まとめに支障なし）
		}
		const d = new Date(k);
		return d.getFullYear() * 12 + d.getMonth();
	}
	uShift(u, n) {
		// ユニット ±n（隣接ユニット）
		if (this.md === 'day') return u + n * DY;
		if (this.md === 'week') return u + n * 7 * DY;
		return u + n;
	}
	uDate(u) {
		// ユット見出し日（日=当日、週=週初周日、月=1 日）
		if (this.md === 'month') return new Date(Math.floor(u / 12), u % 12, 1);
		return new Date(u);
	}
	buildSec() {
		// 画像ユニット + 隣接空ユニット + 直近空アンカーからセクション列（現在→過去）を構築
		const tk = d0(new Date()).getTime(),
			cur = this.uOf(tk);
		if (!this.bk.length) {
			// 画像がひとつもない: 今日のセクション（見出し＝日付のみ）だけ
			this.sec = [{ u: cur, d: new Date(tk), v: [], today: true }];
			return;
		}
		const img = new Map(); // ユニット鍵 -> [item 降順]
		for (const b of this.bk) {
			const u = this.uOf(b.k);
			const a = img.get(u);
			if (a) a.push(...b.v);
			else img.set(u, [...b.v]);
		}
		for (const a of img.values()) a.sort((x, y) => y.ts - x.ts);
		const units = new Set(img.keys());
		for (const u of img.keys()) {
			// 画像ユニットの隣接空ユニット（現在より未来側は u+1 ≤ cur のみ。過去側は常に）
			for (const n of [-1, 1]) {
				const v = this.uShift(u, n);
				if (v <= cur && !units.has(v)) units.add(v);
			}
		}
		// 直近空アンカー: 現在ユニットから過去へ、画像を含まない最初のユニット（§21: 画像がある場合は画像がない最新日付）
		let anc = null,
			g = 0;
		for (let u = cur; g < 10000; u = this.uShift(u, -1), g++) {
			if (!img.has(u)) { // 画像ユニットのみ除外対象（隣接空ユニットは走査に加えない）
				anc = u;
				break; // 現在ユニットが空なら今日。そうでなければ最古画像ユニットの 1 個前まで探せば必ず空に到達
			}
		}
		if (anc !== null) units.add(anc);
		this.sec = [...units]
			.sort((a, b) => b - a)
			.map(u => ({ u, d: this.uDate(u), v: img.get(u) || [], today: this.uOf(tk) === u }));
	}
	pgCnt() {
		return this.sec.length;
	}
	pgPx() {
		// 全セクション共通の高さ: ヘッダ + cap 相当の行（flex 折返し）。超過分はセクション内スクロール
		if (this.fPg) return this.fPg;
		const ts = Math.max(24, this.ch - 24), // サムネイル一辺（cellPx=THUMB_PX+24 で RoomCalendar が渡す）
			wpx = Math.max(120, (this.box && this.box.clientWidth) || 320) - 10,
			per = Math.max(1, Math.floor(wpx / (ts + 6)));
		let rows = Math.max(1, Math.ceil((this.cap > 0 ? this.cap : 36) / per));
		rows = Math.min(rows, 6);
		return HH + rows * (ts + 8);
	}
	pgEl(i) {
		const s = this.sec[i];
		if (!s) return Vw.div(null);
		const cls = 'cal-cell cal-sec' + (this.md === 'day' ? ' cal-day' : '');
		const bl = Vw.div(null, { class: cls }, {
			overflowY: 'auto',
			boxSizing: 'border-box',
			display: 'flex',
			flexWrap: 'wrap',
			alignContent: 'flex-start',
			justifyContent: 'flex-start', // v1.8 §22: 画像は左寄せ（枠線なし・ヘッダのみで区切る）
		});
		if (this.oS) Vw.ael(bl, 'scroll', this.oS); // セクション内部スクロール追従
		let hd = this.secLabel(i);
		if (s.today && s.v.length && this.md === 'day') {
			const nw = new Date(); // 当日+項目ありは時刻を添える（日モードのみ。週/月はラベルを YYYY/MM/DD・YYYY/MM に限定 §21）
			hd += ` ${p2(nw.getHours())}:${p2(nw.getMinutes())}`;
		}
		Vw.div(bl, { class: 'cal-ch', text: hd }, {
			flexBasis: '100%',
			minHeight: `${HH - 4}px`,
			lineHeight: `${HH - 4}px`,
		}); // sticky/配色/コントラストは CSS .cal-ch（v1.8 §22）
		const ih = Vw.div(bl, {});
		Vw.sS(ih, { display: 'contents' });
		this.fill(ih, s, s.u);
		return bl;
	}
	secLabel(i) {
		// 見出し整形（§21）: 週=週開始日フル / 月=YYYY/MM / 日=変わったらフル、同じなら省略
		const s = this.sec[i];
		if (this.md === 'month') return mmy(s.d);
		if (this.md === 'week') return dmy(s.d);
		if (i === 0) return dmy(s.d);
		const p = this.sec[i - 1];
		if (!p) return dmy(s.d);
		if (p.d.getFullYear() !== s.d.getFullYear()) return dmy(s.d);
		if (p.d.getMonth() !== s.d.getMonth()) return mdy(s.d);
		return p2(s.d.getDate());
	}
	fill(host, s, k) {
		// 項目ホストへの renderItem 展開（cap 超過分は「+N 件」ボタンで cap×4 ずつ取り込み）
		if (this.dead || !s || !s.v.length) return;
		const shown = this.cap ? Math.min(s.v.length, this._exp.get(k) || this.cap) : s.v.length;
		for (let i = 0; i < shown; i++) this.rit(host, s.v[i]);
		if (s.v.length > shown) {
			// セクションは内側スクロールを持つため sticky bottom で可視域下端に常時表示
			const btn = Vw.add(host, 'button', { class: 'cal-more', text: this.moreTxt(s.v.length - shown) }, {
				display: 'block',
				margin: '2px 0',
				position: 'sticky',
				bottom: '0',
				background: 'inherit',
				flexBasis: '100%',
				textAlign: 'center',
			});
			Vw.click(btn, () => {
				this._exp.set(k, shown + Math.max(this.cap, 4) * 4);
				Vw.rc(host);
				this.fill(host, s, k);
				if (this.oE) this.oE(k);
			});
		}
	}
	rit(p, it) {
		// 呼び出し側 renderItem の実行（例外は Y.ef でログし当該項目のみスキップ）
		try {
			const el = this.rI(it);
			if (el && el.nodeType) p.appendChild(el);
		} catch (e) {
			ef(e, `CalView.renderItem(${it && it.ts})`);
		}
	}
}

