/** @module modules/imgroom/sync_mode.js @version 0.1.0 @see docs/img_room_spec.md */
// 同期モード（仕様 §9.9）とサーバーモード自動ダウンロード台帳（§5.7）。
// 未所持キュー再構築: mine=false / trashed=false / holders あり / autodl ON 時は autodl.json done 済み除外 /
// 消滅（vanished）除外 / 投稿時刻 ts 降順。取得は常に 1 件ずつ（transfer は IN_TRANSFERS=1。ここでは pump を 1 本だけ走らせ自前直列）。
// 優先度: transfer.fetch の prio を使い自動は prio=0。ユーザー操作（prio>0 / 進行中の転送 / 外部 interlock）が
// 存在する間は自動取得を開始せず、transfer がアイドルになるまで待機する（§9.9「中断・待機」の実装。p2p_file に
// 途中プリエンプト API は無いので「次の取得を出さない」形で優先を保証する）。
import { CFG, STORAGE } from './ir_const.js';
import { OPFS } from '../../OPFS.js';
import { Y } from '../../Y.js';

const AUTODL_DEBOUNCE_MS = 200; // §5.7 autodl.json 保存の debounce
const IDLE_RECHECK_MS = 250; // アイドル再チェックの安全弁（onProgress が止まった際の復帰）
const VANISH_WHY = /検証不一致|h10 不一致|不一致|: ?nf|^nf$|not ?found|不存在|abandoned/i; // §9.9 検証失敗・保持者なし=消滅
const IGNORE_WHY = /cancelled|destroyed/i; // 自前取消・破棄。消滅扱いも失敗扱いもしない

export class SyncMode {
	constructor({ rid, uid, collection, transfer, session, settings, cfg, store } = {}) {
		this.rid = rid || '';
		this.uid = uid || '';
		this.collection = collection || null;
		this.transfer = transfer || null;
		this.session = session || null;
		this.settings = settings || null;
		this.store = store || null;
		this.cfg = { ...CFG, ...(cfg || {}) };
		this.onProgress = null; // fn(stats) — フッター進捗（lbl.sync.footer）

		this._enabled = false;
		this._started = false;
		this._built = false; // 初回 onManifestUpdate 済みフラグ
		this._queue = []; // [{h10,holders,ts}] ts 降順
		this._inflight = null;
		this._pumping = null;
		this._vanished = new Set(); // §9.9 消滅。セッション中保持（再試行しない）
		this._failed = new Set(); // 再試行上限（cfg.MAX_RETRY）超過
		this._retry = new Map(); // h10 -> 試行回数（セッション中保持）
		this._fetched = 0;
		this._fails = 0;
		this._total = 0;
		this._interlock = false; // 外部（閲覧・一括DL 等）が transfer.onProgress 経由で立てる優先フラグ
		this._wakeRes = [];
		this._off = []; // 購読解除関数
		this._autodlDone = new Set();
		this._autodlLoad = null;
		this._autodlOn = false;
		this._saveTimer = 0;
		this._saveChain = Promise.resolve();

		// 進行イベントを横取りしてアイドル復帰の wake に使う（既存ハンドラは維持）
		if (this.transfer) {
			const prev = typeof this.transfer.onProgress === 'function' ? this.transfer.onProgress : null;
			this.transfer.onProgress = (h10, bytes, total) => {
				this._wake();
				if (prev) prev(h10, bytes, total);
			};
		}
		// サーバーモードは同期 ON 固定（§5.7。解除はログアウトのみ）
		this._autodlOn = this.isServer() && this._stGet(`AUTODL.${this.rid}`) === true;
		this._enabled = this.isServer() || this._stGet(`MODE.${this.rid}`) === 'sync';
	}

	// ---- モード ----
	isServer() {
		if (this.session && this.session.state && this.session.state.mode === 'server') return true;
		return this._stGet(`MODE.${this.rid}`) === 'server';
	}

	get enabled() {
		return this._enabled;
	}

	// MODE.<rid> に永続化（§9.9）。サーバーモードでは OFF 化しない
	enable(on) {
		on = !!on;
		if (this.isServer() && !on) {
			this._enabled = true;
			this._stSet(`MODE.${this.rid}`, 'server');
			this._emit();
			return;
		}
		this._enabled = on;
		this._stSet(`MODE.${this.rid}`, on ? 'sync' : 'normal');
		if (on) {
			this.onManifestUpdate(); // 同期対象数 m を即表示（autodl 台帳は _drain 先頭で照合）
			this.pump();
		} else {
			this._cancelInflight();
			this._queue = [];
			this._emit();
		}
	}

	// ---- キュー再構築（§9.9）----
	onManifestUpdate() {
		const q = [];
		for (const it of this._items()) {
			const h10 = it && it.h10;
			if (!h10 || h10 === this._inflight) continue; // 進行中は完了で mine になるため触らない
			if (it.mine) continue;
			if (it.trashed || this._isTrashed(h10)) continue; // §9.9 ゴミ箱対象は無視（物理削除後は再対象化）
			if (this._vanished.has(h10) || this._failed.has(h10)) continue;
			if (this._autodlOn && this._autodlDone.has(h10)) continue; // §5.7 台帳優先（bodies 欠落でも再取得しない）
			const holders = this._holders(h10, it);
			if (!holders.length) continue; // 保持者全員退出 → 対象にしない
			q.push({ h10, holders, ts: this._ts(it) });
		}
		q.sort((a, b) => b.ts - a.ts); // 投稿時刻の降順（新しい順）
		this._built = true;
		this._queue = q;
		this._total = q.length + this._fetched + this._fails; // 対象 m（manifest 更新で再計算）
		this._emit();
	}

	// ---- 取得ループ（1 件ずつ・ユーザー操作優先）----
	pump() {
		if (!this._enabled || this._pumping) return this._pumping || Promise.resolve();
		this._pumping = this._drain().then(r => {
			this._pumping = null;
			return r;
		}, e => {
			this._pumping = null;
			if (typeof console !== 'undefined') console.warn('sync_mode pump', e);
		});
		return this._pumping;
	}

	async _drain() {
		if (this._autodlOn) await this._loadAutodl(); // §5.7 取得前に必ず台帳照合
		while (this._enabled) {
			if (!this._online()) break; // 離脱で停止（'open'/'authOk' で再開）
			if (!this._built) this.onManifestUpdate(); // 未構築ならここで構築（呼び出し順に依存しない）
			const item = this._queue.shift();
			if (!item) break;
			if (this._vanished.has(item.h10) || this._failed.has(item.h10)) continue;
			if (this._autodlOn && this._autodlDone.has(item.h10)) continue;
			await this._waitIdle(); // ユーザー操作の完了まで待つ（§9.9）
			if (!this._enabled || this._vanished.has(item.h10) || !this._online()) break;
			this._inflight = item.h10;
			this._emit();
			await this._fetchOne(item);
			this._inflight = null;
		}
		this._emit();
	}

	async _fetchOne(item) {
		const h10 = item.h10;
		if (!this.transfer || typeof this.transfer.fetch !== 'function') return;
		try {
			await this.transfer.fetch({ h10, holders: item.holders.slice(), prio: 0 }); // 自動は最低 prio
			this._fetched++;
			if (this._autodlOn) this._autodlAdd(h10); // §5.7 DL 済み台帳へ登録
		} catch (e) {
			const why = String((e && e.message) || e || '');
			if (IGNORE_WHY.test(why)) return; // 取消・destroyed は計上しない
			if (VANISH_WHY.test(why)) {
				this._markVanished(h10); // h10 検証失敗・保持者不在 → 破棄（同一セッションで再試行しない）
				return;
			}
			const n = (this._retry.get(h10) || 0) + 1;
			this._retry.set(h10, n);
			if (n <= (this.cfg.MAX_RETRY || 0)) {
				await this._sleepOrWake(IDLE_RECHECK_MS); // 失敗直後の空回し防止
				this._queue.push(item);
			} else {
				this._failed.add(h10);
				this._fails++;
			}
		}
	}

	// 外部（閲覧・一括DL・クリック取得）からの优先フラグ。transfer.onProgress だけでは拾えない操作の補完
	setInterlock(on) {
		this._interlock = !!on;
		if (on) this._wake();
	}

	_userBusy() {
		if (this._interlock) return true;
		const t = this.transfer;
		if (!t) return false;
		const q = t.queue;
		if (Array.isArray(q)) for (const e of q) if (e && e.h10 !== this._inflight && (e.prio || 0) > 0) return true;
		const inm = t.in;
		if (inm && inm.size) {
			const mine = this._inflight && typeof inm.has === 'function' && inm.has(this._inflight) ? 1 : 0;
			if (inm.size - mine > 0) return true; // 他人由来の受信が進行中
		}
		return false;
	}

	async _waitIdle() {
		while (this._enabled && this._online() && this._userBusy()) await this._sleepOrWake(IDLE_RECHECK_MS);
	}

	// ---- 消滅処理（§9.9）----
	cancelVanished(h10) {
		if (!h10) return;
		this._queue = this._queue.filter(q => q.h10 !== h10);
		this._vanished.add(h10); // セッション中保持（manifest 更新でも復活しない）
		this._markVanished(h10);
	}

	_markVanished(h10) {
		this._vanished.add(h10); // §9.9 消滅・検証失敗はセッション中再試行しない
		try {
			if (this.transfer && typeof this.transfer.cancel === 'function') this.transfer.cancel(h10);
		} catch (e) { /* 不在は無視 */ }
		this._emit();
	}

	_cancelInflight() {
		const h = this._inflight;
		if (h && this.transfer && typeof this.transfer.cancel === 'function') {
			try {
				this.transfer.cancel(h);
			} catch (e) { /* ignore */ }
		}
	}

	// ---- 進捗（フッター）----
	stats() {
		return { total: this._total, fetched: this._fetched, failed: this._fails, vanished: this._vanished.size };
	}

	_emit() {
		if (typeof this.onProgress === 'function') {
			try {
				this.onProgress(this.stats());
			} catch (e) { /* UI 側例外で同期を止めない */ }
		}
	}

	// ---- 自動ダウンロード台帳（§5.7。rooms/<rid>/autodl.json {done:[h10…]}）----
	autodlPath() {
		return STORAGE.autodl(this.rid);
	}

	autodlEnable(on) {
		on = !!on && this.isServer(); // §11 AUTODL.<rid> はサーバーモードでのみ有効
		this._autodlOn = on;
		this._stSet(`AUTODL.${this.rid}`, on);
		this._loadAutodl().then(() => {
			this.onManifestUpdate();
			this.pump();
		});
		return on;
	}

	autodlEnabled() {
		return this._autodlOn;
	}

	autodlCount() {
		return this._autodlDone.size;
	}

	// クリアボタン（確認は呼び出し側）: 台帳を空にして即保存 → 全対象が再取得・再 DL 可能になる
	async autodlClear() {
		this._autodlDone.clear();
		if (this._saveTimer) clearTimeout(this._saveTimer);
		this._saveTimer = 0;
		await this._saveAutodl();
		this.onManifestUpdate();
		this.pump();
		return this._autodlDone.size;
	}

	_autodlAdd(h10) {
		if (this._autodlDone.has(h10)) return;
		this._autodlDone.add(h10);
		if (this._saveTimer) clearTimeout(this._saveTimer);
		this._saveTimer = setTimeout(() => {
			this._saveTimer = 0;
			this._saveAutodl();
		}, AUTODL_DEBOUNCE_MS); // 保存 debounce 200ms
	}

	_loadAutodl() {
		if (this._autodlLoad) return this._autodlLoad;
		this._autodlLoad = (async () => {
			try {
				const ab = await OPFS.r(this.autodlPath());
				const o = JSON.parse(Y.u2s(new Uint8Array(ab)) || '{}');
				if (o && Array.isArray(o.done)) for (const h of o.done) if (typeof h === 'string') this._autodlDone.add(h);
			} catch (e) { /* 未作成・不正 JSON は空台帳扱い */ }
			return this._autodlDone;
		})();
		return this._autodlLoad;
	}

	// 書込は直列チェーン（同一 rid の read-modify-write 無しの上書き競合回避）
	_saveAutodl() {
		const p = this._saveChain.then(async () => {
			const s = JSON.stringify({ done: Array.from(this._autodlDone) });
			await OPFS.w(this.autodlPath(), Y.s2u(s).buffer);
		}).catch(e => {
			if (typeof console !== 'undefined') console.warn('sync_mode autodl save', e);
		});
		this._saveChain = p;
		return p;
	}

	// ---- 購読（manifest 変化で再構築＋pump。ポーリングはしない）----
	start() {
		if (this._started) return;
		this._started = true;
		const up = () => {
			this.onManifestUpdate();
			if (this._enabled) this.pump();
		};
		const down = () => {
			this._cancelInflight();
			this._emit();
		};
		const c = this.collection;
		if (c && typeof c.on === 'function') {
			c.on('changed', up);
			this._off.push(() => { if (typeof c.off === 'function') c.off('changed', up); });
		}
		const s = this.session;
		if (s && typeof s.on === 'function') {
			for (const evt of ['open', 'authOk', 'participants']) {
				s.on(evt, up);
				this._off.push(() => { if (typeof s.off === 'function') s.off(evt, up); });
			}
			for (const evt of ['close', 'srvOff', 'monthExpire', 'conflict']) {
				s.on(evt, down);
				this._off.push(() => { if (typeof s.off === 'function') s.off(evt, down); });
			}
		}
		this._loadAutodl().then(up);
	}

	stop() {
		this._started = false;
		for (const f of this._off) {
			try {
				f();
			} catch (e) { /* ignore */ }
		}
		this._off = [];
		this._cancelInflight();
		this._queue = [];
		this._wake();
		if (this._saveTimer) {
			this._saveTimer = 0;
			this._saveAutodl(); // 保留分は flush
		}
		this._emit();
	}

	dispose() {
		this.stop();
		if (this.transfer) this.transfer.onProgress = null;
	}

	// ---- 注入依存の防御的アクセサ ----
	_items() {
		try {
			const a = this.collection && typeof this.collection.roomItems === 'function' ? this.collection.roomItems() : [];
			return Array.isArray(a) ? a : [];
		} catch (e) {
			return [];
		}
	}

	_holders(h10, it) {
		try {
			if (this.collection && typeof this.collection.holdersOf === 'function') {
				const h = this.collection.holdersOf(h10);
				if (Array.isArray(h)) return h;
			}
		} catch (e) { /* it.holders へフォールバック */ }
		return Array.isArray(it && it.holders) ? it.holders : [];
	}

	_isTrashed(h10) {
		try {
			return !!(this.collection && typeof this.collection.isTrashed === 'function' && this.collection.isTrashed(h10));
		} catch (e) {
			return false;
		}
	}

	_ts(it) {
		const t = (it && (it.ts !== undefined ? it.ts : it.meta && it.meta.ts)) || 0;
		const n = Number(t);
		return Number.isFinite(n) ? n : 0;
	}

	_online() {
		const st = this.session && this.session.state;
		return !st || st.online === undefined ? true : !!st.online;
	}

	_stGet(key) {
		const s = this.settings;
		if (!s) return undefined;
		try {
			if (typeof s.get === 'function') return s.get(key);
		} catch (e) { /* state 参照へフォールバック */ }
		const st = s.state || {};
		const dot = key.indexOf('.');
		if (dot < 0) return st[key];
		const grp = st[key.slice(0, dot)];
		return grp ? grp[key.slice(dot + 1)] : undefined;
	}

	_stSet(key, value) {
		const s = this.settings;
		if (!s) return;
		try {
			if (typeof s.setState === 'function') return s.setState(key, value);
			if (typeof s.setNested === 'function') return s.setNested(key, value);
			if (typeof s.set === 'function') return s.set(key, value);
		} catch (e) { /* 設定保存失敗でも同期は継続 */ }
	}

	_wake() {
		const r = this._wakeRes;
		this._wakeRes = [];
		for (const f of r) f();
	}

	_sleepOrWake(ms) {
		return new Promise(res => {
			const done = () => {
				clearTimeout(timer);
				res();
			};
			const timer = setTimeout(done, ms);
			this._wakeRes.push(done);
		});
	}
}
