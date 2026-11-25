/**
 * @module modules/virt_list.js
 * @version 0.1.0
 * @see docs/img_room_spec.md (§5.5 仮想レンダリング・ページ窓 / §11 CAL_WINDOW_PAGES)
 */
import { now, ef } from '../Y.js';
import { Vw } from '../Vw.js';

const TL = 100; // スクロル更新の間隔 ms（スロットル）

export class VirtList {
	// ページ窓仮想レンダリング。コンテナ内に spacer で総高 count()×page(px) を確保。
	// 1 ページ = page(px) 高 = アイテム 1 枠（ページ番号 ≡ アイテム番号）。
	// 窓は [現在ページ−⌊winPages/2⌋ … 現在ページ+⌈winPages/2⌉−1] をスクロール位置から計算し、
	// 窓内のみ render(i) で DOM 生成、窓外は DOM 削除 + onEvict(i)（objectURL 開放用）。
	// scroll は passive 登録 + TL ms スロットル。窓端を跨ぐたびに窓は 1 ページずつ進む。
	constructor(opt = {}) {
		this.ct = opt.container;
		// v2.33 §60: page に関数 (i)=>px を渡すとセクション可変高さ（高さの前置和 _off で窓計算）
		this.pgFn = typeof opt.page === 'function' ? opt.page : null;
		this.pg = this.pgFn ? 0 : opt.page > 0 ? opt.page : 256; // ページ（アイテム 1 枠）高さ px（固定）
		this._off = new Float64Array(1); // 高さの累積（refresh で再構築）
		this._tot = 0;
		this.wp = opt.winPages > 0 ? opt.winPages : 3; // 窓ページ数（CAL_WINDOW_PAGES 既定）
		this.fnC = opt.count || (() => 0);
		this.fnR = opt.render || null;
		this.fnW = opt.onWindow || null;
		this.fnE = opt.onEvict || null;
		this.els = new Map(); // 窓内: ページ(=アイテム)番号 -> HTMLElement
		this.lo = -1; // 窓開始ページ
		this.hi = -1; // 窓終了ページ
		this.tm = 0; // スロットル後置タイマ
		this.tl = 0; // 最終更新時刻 ms
		this.dead = false; // destroy 済み
		this.sc = () => this.th(); // scroll ハンドラ（removeEventListener 対応用）
		this.ws = () => this.th(); // ページスクロール補完（v1.5 §19: 容器が高さ非拘束で箱が伸長するレイアウトでは窓が進まない）
		this.sp = Vw.div(this.ct, { class: 'vl-spacer' }, { position: 'relative', width: '100%' });
		// passive 指定は Vw.ael では渡せないため素の addEventListener（第三引数 capture 不一致なし）
		if (this.ct) this.ct.addEventListener('scroll', this.sc, { passive: true });
		window.addEventListener('scroll', this.ws, { passive: true });
		this.refresh();
	}
	hp(i) {
		return Math.max(1, this.pgFn ? this.pgFn(i) : this.pg);
	}
	build() {
		// 高さの前置和キャッシュ（refresh 時に再構築。可変高さの窓/配置はここから求める）
		const n = Math.max(0, this.fnC());
		if (this._off.length < n + 1) this._off = new Float64Array(n + 1);
		for (let i = 0; i < n; i++) this._off[i + 1] = this._off[i] + this.hp(i);
		this._tot = this._off[n];
	}
	pageAt(px) {
		// px を含むページ = 最大の i（_off[i] <= px）。固定高さでは floor(px/pg) と同値
		let lo = 0,
			hi = Math.max(0, this.fnC() - 1);
		while (lo < hi) {
			const m = (lo + hi + 1) >> 1;
			if (this._off[m] <= px) lo = m;
			else hi = m - 1;
		}
		return lo;
	}
	refresh(force) {
		// spacer 再確保 + 窓再評価（count 変化時に呼ぶ。窓内の既存 DOM は保持し窓外のみに削除/生成）
		// v2.33 §60: force=true で窓内も全再作成（セクション内容変化=+N 展開など）。既定は枠位置/高さだけ再適用
		if (this.dead) return;
		this.build();
		if (this.sp) Vw.sS(this.sp, { height: `${Math.max(0, this._tot)}px` });
		if (force) for (const i of [...this.els.keys()]) this.ev(i);
		else for (const [i, el] of this.els) Vw.sS(el, { top: `${this._off[i]}px`, height: `${this.hp(i)}px` });
		this.lo = this.hi = -1; // 強制再評価（既存窓内 DOM は upd() の has() で再利用される）
		this.upd();
	}
	destroy() {
		// 後始末: リスナ・タイマ解除、窓内 DOM 削除（onEvict も発火して objectURL 開放を促す）
		if (this.dead) return;
		this.dead = true;
		if (this.tm) clearTimeout(this.tm);
		this.tm = 0;
		if (this.ct) this.ct.removeEventListener('scroll', this.sc);
		window.removeEventListener('scroll', this.ws);
		for (const i of [...this.els.keys()]) this.ev(i);
		Vw.rm(this.sp);
		this.fnW = this.fnE = this.fnR = this.fnC = null;
	}
	th() {
		// scroll スロットル: TL ms 間隔で更新し、最後の scroll からも必ず 1 回後置更新する
		if (this.dead) return;
		const t = now(),
			d = TL - (t - this.tl);
		if (d <= 0) {
			this.tl = t;
			this.upd();
		} else if (!this.tm)
			this.tm = setTimeout(() => {
				this.tm = 0;
				this.tl = now();
				this.upd();
			}, d);
	}
	upd() {
		// 現在ページ = floor(scrollTop/page)。窓 [cur−⌊wp/2⌋ … cur+⌈wp/2⌉−1] をページ総数で丸め、
		// 差分で窓外削除・窓内生成を行う（スクロール 1 ページで窓も 1 ページ進む）
		if (this.dead) return;
		const n = this.fnC();
		if (n < 1) {
			if (this.els.size) for (const i of [...this.els.keys()]) this.ev(i);
			if (this.fnW) this.fnW(0, -1, 0);
			this.lo = 0;
			this.hi = -1;
			return;
		}
		const mx = n - 1; // 最終ページ（アイテム総数 = ページ総数）
		let cur;
		let visF = 0, visH = 844; // v2.34 §61: 可視範囲（最先頭ページ/高さ）— 窓の前方下限用
		const st = (this.ct && this.ct.scrollTop) || 0;
		if (st) { cur = this.pageAt(st); visF = cur; visH = (this.ct && this.ct.clientHeight) || visH; }
		else {
			// v1.5 §19: 容器が高さ非拘束（spacer が箱を伸長させページ全体がスクロールする）レイアウトでは
			// scrollTop が常に 0 で窓が進まない。箱の viewport 上位置（rect.top の負方向）から現在ページを求める
			const r = this.ct ? this.ct.getBoundingClientRect() : null;
			// 窓は「最初に見えるページ」を下限に、ビューポート下端のページを必ず覆う中央位置へ（下端到達で末尾ページが窓から漏れない）
			if (r) {
				const vh = (this.ct && this.ct.ownerDocument && this.ct.ownerDocument.documentElement.clientHeight) || 844,
					first = this.pageAt(Math.max(0, -r.top)),
					last = this.pageAt(Math.max(0, vh - r.top));
				visF = first;
				visH = vh;
				cur = Math.max(first, last - Math.floor(this.wp / 2));
			} else cur = 0;
		}
		if (cur < 0) cur = 0;
		if (cur > mx) cur = mx;
		const h = Math.floor(this.wp / 2); // 前側ページ数
		let lo = cur - h,
			hi = cur + (this.wp - 1 - h);
		if (lo < 0) hi += -lo; // 先頭端: 窓幅を削らず前に寄せる
		hi = Math.min(hi, mx);
		if (this.pgFn) {
			// 可変高さ: セクションが低くても窓がビューポート高を覆い切るまで後ろへ延ばす（下端の取りこぼし防止）。
			// v2.34 §61: 前方も最先頭可視ページ（visF）まで確実に覆う — セクション低めのとき
			// cur 基準の窓幅だと可視の上側ページが未マウントになる（img-sec scanAllSlots で露見）
			if (lo > visF) lo = visF;
			while (hi < mx && this._off[hi + 1] - this._off[lo] < visH + 50) hi++;
		}
		lo = Math.min(Math.max(lo, 0), hi);
		if (lo === this.lo && hi === this.hi) return; // 窓端を跨いでいない: 窓は進めない
		for (const i of [...this.els.keys()]) if (i < lo || i > hi) this.ev(i);
		for (let i = lo; i <= hi; i++) if (!this.els.has(i)) this.mk(i);
		this.lo = lo;
		this.hi = hi;
		if (this.fnW) this.fnW(lo, hi, cur);
	}
	mk(i) {
		// 窓内アイテム生成: render(i) を spacer に absolute 配置（top = i × page）
		if (!this.fnR || this.els.has(i)) return;
		let el = null;
		try {
			el = this.fnR(i);
		} catch (e) {
			return ef(e, `VirtList.render(${i})`);
		}
		if (!el || !el.nodeType) return;
		Vw.sS(el, {
			position: 'absolute',
			left: '0',
			width: '100%',
			top: `${this._off[i]}px`,
			height: `${this.hp(i)}px`,
		});
		this.els.set(i, el);
		this.sp.appendChild(el);
	}
	ev(i) {
		// 窓外アイテム除去: DOM 削除後に onEvict(i)（<img> 除去相当。呼び出し側で revokeObjectURL）
		const el = this.els.get(i);
		if (!el) return;
		this.els.delete(i);
		Vw.rm(el);
		if (this.fnE) this.fnE(i);
	}
}
