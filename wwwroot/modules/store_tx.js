/** @module modules/store_tx.js @version 0.1.0 @see docs/img_room_spec.md */
import { Y, H, B, now, ef, T, F, N, crv } from '../Y.js';
import { OPFS } from '../OPFS.js';

export class StoreTX { // 契約: run(name,fn)/release(name)。§11.1 単一処理者・直列 tx
	static HB = 2000; // ハートビート宣言間隔 ms
	static EXP = 6000; // 失効 ms
	static q = new Map(); // name -> [{fn,res,rej}] 同一タブ内 FIFO（フォールバック）
	static busy = new Map(); // name -> T 処理中
	static hold = new Map(); // name -> {drop} ロック保持中の解放フック
	static tabId = N; // 契約式: Y.B2U(H.d(String(now)+random,4)) 文字列比較で最小優先
	static tabIdP = N;
	static bc = new Map(); // name -> BroadcastChannel(`dsh.stx.<name>`)
	static lead = new Map(); // name -> {id, ts, q} 現処理者（自身含む全タブが監視）
	static peer = new Map(); // name -> Map(id -> {ts, q}) 全タブのプレゼンス（選出・引き取り用）
	static beat = new Map(); // name -> setInterval id
	static mine = new Map(); // name -> T 自タブが処理者宣言中
	static idle = new Map(); // name -> 処理者のアイドル開始 ts（小さい id 側がpreempt 判定に使用）
	static locks = () => typeof navigator !== 'undefined' && !!navigator.locks; // 対応判定はメソッド実行時（契約: !!navigator.locks）
	static run(name, fn) {
		return this.locks() ? this.runLk(name, fn) : this.runFB(name, fn);
	}
	static release(name) { // 明示解放（セッション権放棄）
		const h = this.hold.get(name);
		if (h) {
			this.hold.delete(name);
			h.drop(); // locks 系: abort → run の Promise が AbortError で reject され権喪失を呼び出し側が検知
			return;
		}
		if (!this.locks()) this.relinq(name); // フォールバック系: 処理者宣言を放棄
	}
	static runLk(name, fn) { // 主機構: navigator.locks.request 排他（待機順は Web Locks 仕様の FIFO に依存）
		const ac = new AbortController(), e = {drop: () => ac.abort()};
		return navigator.locks.request(name, {mode: 'exclusive', signal: ac.signal}, async () => {
			this.hold.set(name, e);
			try {
				return await fn();
			} finally {
				if (this.hold.get(name) === e) this.hold.delete(name);
			}
		});
	}
	// ---- 以下 BroadcastChannel ハートビート代替系（Web Locks 非対応時。仕様 §11.1）----
	static runFB(name, fn) {
		return this.mkTab().then(() => new Promise((res, rej) => {
			this.ensureBC(name);
			this.beat0(name);
			if (!this.q.has(name)) this.q.set(name, []);
			this.q.get(name).push({fn, res, rej});
			this.tryClaim(name); // 処理者不在なら即取得（初回遅延なし）
			this.pump(name);
		}));
	}
	static mkTab() { // tabId 一回生成（crypto は実行時のみ触る）
		if (this.tabId) return Promise.resolve(this.tabId);
		if (!this.tabIdP) this.tabIdP = H.d(String(now()) + Array.from(crv(B.u8(8))).join(), 4).then(u => (this.tabId = Y.B2U(u)));
		return this.tabIdP;
	}
	static ensureBC(name) { // BC はメソッド実行時のみ触る
		if (this.bc.has(name)) return;
		const b = new BroadcastChannel(`dsh.stx.${name}`);
		b.onmessage = ev => this.onMsg(name, ev.data);
		this.bc.set(name, b);
	}
	static beat0(name) {
		if (this.beat.has(name)) return;
		this.beat.set(name, setInterval(() => this.beatFn(name), this.HB));
		this.post(name);
	}
	static beatFn(name) {
		this.post(name); // 全タブが 2s ごとにプレゼンス（処理者は lead:T）
		this.prune(name);
		this.chkLead(name);
		if (this.mine.has(name)) this.yieldIfIdle(name);
		this.tryClaim(name);
		this.pump(name);
	}
	static post(name) {
		const qn = this.pend(name);
		if (this.mine.has(name)) {
			const l = this.lead.get(name);
			if (l) {
				l.ts = now();
				l.q = qn;
			}
		}
		this.bc.get(name).postMessage({t: 'hb', id: this.tabId, lead: this.mine.has(name) ? T : F, q: qn});
	}
	static pend(name) {
		return (this.q.get(name) || []).length + (this.busy.has(name) ? 1 : 0);
	}
	static onMsg(name, m) {
		if (!m || m.id === this.tabId || (m.t !== 'hb' && m.t !== 'rel')) return;
		if (m.t === 'rel') { // 自発放棄通知: 当該処理者を降ろす
			const l = this.lead.get(name);
			if (l && l.id === m.id) {
				this.lead.delete(name);
				this.idle.delete(name);
			}
			return;
		}
		this.peerOf(name).set(m.id, {ts: now(), q: m.q || 0});
		if (!m.lead) return;
		const l = this.lead.get(name);
		if (this.mine.has(name)) { // 二重宣言: 小さい tabId が優先
			if (m.id < this.tabId) { // 降格
				this.mine.delete(name);
				this.idle.delete(name);
				this.lead.set(name, {id: m.id, ts: now(), q: m.q || 0}); // トークンファイルは新処理者が上書き
			}
			return;
		}
		if (l && now() - l.ts <= this.EXP) {
			if (m.q === 0) {
				if (l.q !== 0) this.idle.set(name, now()); // アイドル開始
			} else this.idle.delete(name);
			if (m.id < l.id) this.lead.set(name, {id: m.id, ts: now(), q: m.q || 0});
		} else this.lead.set(name, {id: m.id, ts: now(), q: m.q || 0});
	}
	static prune(name) {
		const ps = this.peerOf(name), t = now();
		ps.forEach((p, id) => {
			if (t - p.ts > this.EXP) ps.delete(id);
		});
	}
	static peerOf(name) {
		if (!this.peer.has(name)) this.peer.set(name, new Map());
		return this.peer.get(name);
	}
	static chkLead(name) { // 6s 応答途絶の処理者を降ろす（引き取りは tryClaim で最小 id 優先）
		const l = this.lead.get(name);
		if (l && !this.mine.has(name) && now() - l.ts > this.EXP) {
			this.lead.delete(name);
			this.idle.delete(name);
		}
	}
	static tryClaim(name) {
		if (this.mine.has(name) || !this.pend(name)) return; // 自タブに待機なしなら処理者に居座らせない
		const l = this.lead.get(name), my = this.tabId;
		if (!l || now() - l.ts > this.EXP) return this.claim(name); // 処理者不在/失効 → 引き取り
		if (l.id > my && !l.q) return this.claim(name); // アイドル処理者を小さい id が即preempt
		if (l.id < my && l.q === 0) {
			const i = this.idle.get(name); // 大きい id はアイドル継続 1 ハートビート後にpreempt
			if (i && now() - i >= this.HB) this.claim(name);
		}
	}
	static claim(name) {
		this.mine.set(name, T);
		this.lead.set(name, {id: this.tabId, ts: now(), q: this.pend(name)});
		this.idle.delete(name);
		this.post(name); // 即宣言
		this.token(name); // OPFS ロックトークン（状態可視化。best effort）
	}
	static relinq(name) {
		this.mine.delete(name);
		this.lead.delete(name);
		this.idle.delete(name);
		const b = this.bc.get(name);
		if (b) b.postMessage({t: 'rel', id: this.tabId});
		this.rmtoken(name);
	}
	static yieldIfIdle(name) { // 保留ゼロの処理者は待機中の小さい id へ譲る（最小優先）
		if (this.pend(name)) return;
		let lo = N, t = now();
		this.peerOf(name).forEach((p, id) => {
			if (p.q > 0 && id < this.tabId && t - p.ts < this.EXP) lo = lo === N || id < lo ? id : lo;
		});
		if (lo !== N) this.relinq(name); // 次ビートで当該タブが claim
	}
	static pump(name) { // 処理者は FIFO を直列実行（ロック再取得不要。待機の委譲は §11.1 注記参照）
		if (!this.mine.has(name) || this.busy.has(name)) return;
		const q = this.q.get(name);
		if (!q || !q.length) return;
		const it = q.shift();
		this.busy.set(name, T);
		const up = () => {
			const l = this.lead.get(name);
			if (l) l.q = this.pend(name);
		};
		up();
		Promise.resolve()
			.then(() => it.fn())
			.then(v => it.res(v), e => (ef(e, 'store_tx.run'), it.rej(e)))
			.finally(() => {
				this.busy.delete(name);
				up();
				this.pump(name);
			});
	}
	static async token(name) { // <hashed root>/locks/<name>.lock
		try {
			await OPFS.w(`locks/${name}.lock`, Y.s2u(JSON.stringify({tabId: this.tabId, ts: now()})).buffer);
		} catch (e) {
			ef(e, 'store_tx.token');
		}
	}
	static async rmtoken(name) {
		try {
			await OPFS.rmf(`locks/${name}.lock`);
		} catch (e) {
			ef(e, 'store_tx.rmtoken');
		}
	}
}
