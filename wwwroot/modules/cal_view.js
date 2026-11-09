/**
 * @module modules/cal_view.js
 * @version 0.1.0
 * @see docs/img_room_spec.md (§5.5 カレンダービュー / §11 CAL_WINDOW_PAGES)
 */
import { w, ef } from '../Y.js';
import { Vw } from '../Vw.js';
import { VirtList } from './virt_list.js';

const DY = 86400000, // 1 日 ms（週/月のページ数換算に使用。週割は Math.round で DST ±1h を吸収）
	HH = 20, // 日付ヘッダ 1 行高さ px
	MR = 6, // 月ブロックの固定週行数（6 行で桁高さ統一）
	MD = ['month', 'week', 'day']; // 表示モード集合（配列完全一致で判定。文字列 includes は部分一致誤通しになるため使用禁止）

const p2 = n => (n < 10 ? `0${n}` : `${n}`),
	dmy = d => `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())}`, // 'YYYY/MM/DD'（Intl 不使用・ローカルタイム）
	mmy = d => `${d.getFullYear()}/${p2(d.getMonth() + 1)}`,
	d0 = d => {
		d.setHours(0, 0, 0, 0); // ローカル 0 時へ丸め（日別バケットの鍵）
		return d;
	};

export class CalView {
	// 日/週/月カレンダービュー。現在基準降順・日別バケット（ローカルタイム日付割）。
	// month: 現在月基準に過去へスクロール（週ヘッダなし・1 日=1 セルブロック・6 週行固定）
	// week:  7 列週幅。現在週基準で以降の未来日は空白
	// day:   1 日=1 ページの時系列降順の横列（flex wrap）
	// ページ窓（CAL_WINDOW_PAGES 既定 3）と窓外 DOM 開放は VirtList に委譲。
	// 各アイテムの実体 DOM は呼び出し側注入の renderItem(item) で生成する。
	constructor(opt = {}) {
		this.pt = opt.parent;
		this.md = MD.includes(opt.mode) ? opt.mode : 'month';
		this.rI = opt.renderItem || (() => Vw.div(null));
		this.oP = opt.onPage || null;
		this.it = [];
		this.bk = []; // 日バケット [{k: 0 時 ms, d: Date, v: [item 降順]}]（現在→過去）
		this.wp = opt.winPages > 0 ? opt.winPages : 3; // 窓ページ数下限（既定 CAL_WINDOW_PAGES=3）
		this.ch = opt.cellPx > 0 ? opt.cellPx : 64; // 1 日セル高さ px
		this.fPg = opt.pagePx > 0 ? opt.pagePx : 0; // ページ高さ上書き px（0=モード自動）
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
		// 表示項目 [{ts,...}] 差し替え（現在より未来の投稿は除外し、バケット再構築）
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
		this._bm = null;
		this.it = [];
		this.oP = null;
		this.rI = null;
	}
	mk() {
		// スクロールボックス生成（高さは呼び出し側 parent 側で決める。DOM はこの時点から触る）
		this.box = Vw.div(this.pt, { class: 'cal-box' }, { overflow: 'auto', height: '100%' });
		this.reb();
	}
	reb() {
		// 再構築: バケット再集計 → VirtList 作り直し（mode/項目差し替え）
		if (this.dead || !this.box) return;
		if (this.vl) {
			this.vl.destroy();
			this.vl = null;
		}
		this.bkt();
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
		this._bm = null; // 日鍵キャッシュ無効化（件数同一でも内容が変わるため長さ照合だけでは stale）
	}
	pgCnt() {
		// ページ総数: month=現在月→最古項目月 / week=現在週→最古項目週 / day=日バケット数
		if (!this.bk.length) return 1;
		const f = d0(new Date(this.bk[this.bk.length - 1].k)), // 最古バケット日
			t = d0(new Date());
		if (this.md === 'day') return this.bk.length;
		if (this.md === 'week') return Math.floor((Math.round((t.getTime() - f.getTime()) / DY) - t.getDay() + f.getDay()) / 7) + 1; // 週割は周日起点（pgEl の週アンカーと一致。日差は Math.round で DST ±1h 吸収）
		const mi = d => d.getFullYear() * 12 + d.getMonth(); // 通月番号
		return mi(t) - mi(f) + 1;
	}
	pgPx() {
		// 1 ページ高さ px（VirtList の page。1 ページ = 1 アイテム枠）
		if (this.fPg) return this.fPg;
		return this.md === 'week' ? this.ch : HH + MR * this.ch;
	}
	pgEl(i) {
		// ページ i（0=現在）のブロック DOM。month=月グリッド / week=7 列 1 行 / day=1 日リスト
		if (this.md === 'day') return this.dayBlk(i);
		const bl = Vw.div(null, { class: `cal-${this.md}` }, {
			display: 'grid',
			gridTemplateColumns: 'repeat(7,1fr)',
			gridAutoRows: `${this.ch}px`,
			boxSizing: 'border-box',
		});
		if (this.md === 'month') {
			Vw.sS(bl, { gridTemplateRows: `${HH}px repeat(${MR},1fr)`, height: `${this.pgPx()}px` });
			const t = d0(new Date()),
				y = t.getFullYear(),
				m = t.getMonth(),
				tk = t.getTime(),
				mi = y * 12 + m - i; // 現在月起点で過去へ
			Vw.div(bl, { class: 'cal-mh', text: mmy(new Date(Math.floor(mi / 12), mi % 12, 1)) }, {
				gridColumn: '1/-1',
				fontWeight: 'bold',
			});
			const fy = Math.floor(mi / 12),
				fm = mi % 12,
				dim = new Date(fy, fm + 1, 0).getDate(), // 当月日数
				wd = new Date(fy, fm, 1).getDay(); // 1 日の曜日（0=日曜始まり）
			for (let c = 0; c < wd; c++) Vw.div(bl, { class: 'cal-blank' }); // 前月分の空桁
			for (let d = 1; d <= dim; d++) {
				const dd = new Date(fy, fm, d),
					k = dd.getTime();
				if (k > tk) {
					Vw.div(bl, { class: 'cal-blank' }); // 未来日は空白
					continue;
				}
				this.cell(bl, dd, k, tk);
			}
		} else {
			Vw.sS(bl, { height: `${this.ch}px` });
			const t = d0(new Date()),
				tk = t.getTime(),
				sw = t.getDate() - t.getDay(); // 現在週の周日（0 時基準の当月日。列=曜日で月表示と揃え、以降の未来日は空白）
			for (let c = 0; c < 7; c++) {
				const dd = new Date(t.getFullYear(), t.getMonth(), sw - i * 7 + c),
					k = dd.getTime();
				if (k > tk) {
					Vw.div(bl, { class: 'cal-blank' }); // 現在週以降の未来日は空白
					continue;
				}
				this.cell(bl, dd, k, tk);
			}
		}
		return bl;
	}
	cell(bl, dd, k, tk) {
		// 1 日セル: ヘッダは i18n 'cal.head' 不使用・Date.now 由来（実体は当該日）の 'YYYY/MM/DD' 自前整形。
		// ローカルタイムで日付割。当該日アイテムは renderItem で新しい順に。当日は 0 時過ぎの分秒を表示
		const c = Vw.div(bl, { class: 'cal-cell' }, {
			border: '1px solid #ccc',
			overflowY: 'auto',
			boxSizing: 'border-box',
		});
		let hd = dmy(dd);
		if (k === tk) {
			const nw = new Date(); // 当日は 0 時を過ぎた現在時分を表示（dd は 0 時丸め済のため使えない）
			hd += ` ${p2(nw.getHours())}:${p2(nw.getMinutes())}`;
		}
		Vw.div(c, { class: 'cal-ch', text: hd }, { position: 'sticky', top: '0', background: '#fff' });
		const b = this.bm().get(k);
		if (b) for (const it of b.v) this.rit(c, it);
		return c;
	}
	dayBlk(i) {
		// 日モード ページ i = i 番目に新しい日バケット（1 日時系列降順リスト）
		const b = this.bk[i],
			tk = d0(new Date()).getTime(),
			bl = Vw.div(null, { class: 'cal-day' }, {
				border: '1px solid #ccc',
				overflowY: 'auto',
				boxSizing: 'border-box',
				height: `${this.pgPx()}px`,
				display: 'flex', // 仕様 §5.5 日: 1 日の投稿を時系列降順の横列
				flexWrap: 'wrap',
			});
		if (!b) return bl;
		let hd = dmy(b.d);
		if (b.k === tk) {
			const nw = new Date(); // 当日は 0 時を過ぎた現在時分を表示（b.d は 0 時丸め済のため使えない）
			hd += ` ${p2(nw.getHours())}:${p2(nw.getMinutes())}`;
		}
		Vw.div(bl, { class: 'cal-dh', text: hd }, { position: 'sticky', top: '0', background: '#fff', fontWeight: 'bold', flexBasis: '100%' });
		for (const it of b.v) this.rit(bl, it);
		return bl;
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
	bm() {
		// 日鍵 → バケットの検索 Map（ページ生成ごとに再構築しないための小規模キャッシュ）
		if (!this._bm || this._bmN !== this.bk.length) {
			this._bm = new Map(this.bk.map(b => [b.k, b]));
			this._bmN = this.bk.length;
		}
		return this._bm;
	}
}
