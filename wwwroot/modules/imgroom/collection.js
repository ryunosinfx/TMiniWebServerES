/**
 * @module modules/imgroom/collection.js
 * @version 0.1.0
 * @see docs/impl_contracts.md (collection 節) / docs/img_room_spec.md (§7.1 meta, §7.4 manifest, §9.1 共有, §9.5 複数部屋, §9.8 ゴミ箱)
 * Collection — 部屋単位のアセット管理: meta(部屋横断・h10 キー)/自房 manifest/ゴミ箱/保持者追跡。
 * X 等の送出は行わない。trash/restore 等は flags を返し、実送出は呼び出し側の sendFrame に委ねる。
 */
import { OPFS } from '../../OPFS.js';
import { Y } from '../../Y.js';
import { HashStore } from '../hash_store.js';
import { CFG, STORAGE } from './ir_const.js';

const DAY_MS = 86400000;

export class Collection {
	constructor({ rid, nameB64U, uid, store, cfg = {}, sendFrame } = {}) {
		this.rid = rid; // ファイルシステム上の部屋 ID (STORAGE.manifest 用)
		this.nameB64U = nameB64U; // meta.r に載る部屋名 b64url (§7.1/§7.2)
		this.uid = uid;
		this.store = store; // HashStore (metaGet/metaPut/put/has/rm/sweep)
		this.cfg = Object.assign({}, CFG, cfg || {});
		this.sendFrame = sendFrame; // 保持のみ(実送出は呼び出し側。flags を返す)
		this.metas = new Map(); // h10 -> meta(§7.1)
		this.manifest = []; // 自房 manifest エントリ(§7.4 m に準拠、ゴミ含む)
		this.mset = new Set(); // manifest 内 h10 集合
		this.peerHolds = new Map(); // uid -> Set(h10) (M 受信側が onPeers で供給)
		this.holdersEver = new Set(); // 過去に保持宣言した uid(オンライン判定用)
		this.online = new Set([uid]); // setOnline で更新(自分は常に online 扱い)
		this.listeners = new Map(); // evt -> [fn]
	}

	on(evt, fn) {
		if (!this.listeners.has(evt)) this.listeners.set(evt, []);
		this.listeners.get(evt).push(fn);
	}
	emit(evt, data) {
		for (const fn of this.listeners.get(evt) || []) {
			try {
				fn(data);
			} catch (e) {
				console.error('Collection listener:', evt, e);
			}
		}
	}

	// ---- meta/manifest ローディング ----
	async loadManifest() {
		await OPFS.rd;
		const p = STORAGE.manifest(this.rid, this.uid),
			pj = p.replace(/\.json$/, '.jsonl');
		const m = new Map(); // h -> entry（x 行で除去。last-wins）
		this._mLines = 0;
		if (await OPFS.isEf(pj)) {
			for (const line of Y.u2s(await OPFS.r(pj)).split('\n')) {
				if (!line) continue;
				this._mLines++;
				let e;
				try {
					e = JSON.parse(line);
				} catch (er) {
					continue;
				}
				if (!e || !e.h) continue;
				if (e.x) m.delete(e.h);
				else m.set(e.h, e);
			}
		} else if (await OPFS.isEf(p)) {
			// legacy 全量 JSON → jsonl（初回のみ移行）
			let arr = [];
			try {
				arr = JSON.parse(Y.u2s(await OPFS.r(p))) || [];
			} catch (er) {
				arr = [];
			}
			if (Array.isArray(arr)) for (const e of arr) if (e && e.h) m.set(e.h, e);
		}
		this.manifest = [...m.values()];
		this.mset = new Set(this.manifest.map(e => e.h));
		this._dirty = { add: [], del: [] };
		if (!(await OPFS.isEf(pj))) await this._writeManifestFull(); // 全書き（jsonl）+ legacy 削除
		await this.refreshMetas(); // roomItems()/entriesForM() が meta 未取得で空にならないよう同時読み
		return this.manifest;
	}
	async _writeManifestFull() {
		const p = STORAGE.manifest(this.rid, this.uid),
			pj = p.replace(/\.json$/, '.jsonl');
		await OPFS.w(pj, Y.s2u(this.manifest.map(e => JSON.stringify(e)).join('\n') + (this.manifest.length ? '\n' : '')));
		this._mLines = this.manifest.length;
		if (await OPFS.isEf(p)) await OPFS.rmf(p); // legacy 全量 JSON 除去
	}
	async saveManifest() {
		// v1.5 §19: 差分行の追記のみ（共有毎の全量 stringify=O(N²) を解消）。行数が逸脱で compact 全書き。
		await OPFS.rd;
		const d = this._dirty || { add: [], del: [] };
		this._dirty = { add: [], del: [] };
		if (!d.add.length && !d.del.length) return this.manifest;
		const pj = STORAGE.manifest(this.rid, this.uid).replace(/\.json$/, '.jsonl');
		if (this._mLines <= this.manifest.length * 1.6 + 8) {
			await OPFS.ap(pj, Y.s2u([...d.add.map(e => JSON.stringify(e)), ...d.del.map(h => JSON.stringify({ x: 1, h }))].join('\n') + '\n'));
			this._mLines += d.add.length + d.del.length;
		} else {
			await this._writeManifestFull();
		}
		return this.manifest;
	}
	async refreshMetas() {
		this.metas.clear();
		for (const m of await this.store.metaAll()) if (m && m.h) this.metas.set(m.h, m);
		return this.metas;
	}

	// ---- §9.1 共有(画像投稿) ----
	// -> {h10,newEntry} | {error:'tooBig'|'badType'|'noName'}
	async share(blob, { name, mime, defer } = {}) {
		if (!blob || !name) return { error: 'noName' };
		if (blob.size > this.cfg.MAX_IMG_BYTES) return { error: 'tooBig' };
		if (!/^image\//.test(mime || blob.type || '')) return { error: 'badType' };
		const ab = await blob.arrayBuffer(); // §9.1: 検証→h10(put)→meta→manifest
		const h10 = await this.store.put(ab); // 内容アドレス。既存なら内部でスキップ(§7.5)
		let meta = this.metas.get(h10) || (await this.store.metaGet(h10));
		if (meta) {
			// §9.5 重複排除: 本体は既存、r マージのみ(ts/n/u は初回投稿者を保持)
			if (!meta.r.includes(this.nameB64U)) {
				meta.r.push(this.nameB64U);
				await this.store.metaPut(meta);
			}
		} else {
			meta = {
				h: h10,
				n: Y.B2U(Y.u2B(Y.s2u(String(name)))), // ファイル名 b64url(§7.2)
				r: [this.nameB64U],
				u: this.uid,
				ts: Date.now(),
				t: mime || blob.type || 'application/octet-stream',
				l: ab.byteLength,
				s: (await Y.c(ab)).byteLength, // gzip 後長(chunk 数計算用、§7.1)
				d: null,
			};
			await this.store.metaPut(meta);
		}
		this.metas.set(h10, meta);
		const newEntry = this._manifestAdd(meta);
		// v1.5 §19: manifest 未保存の潜在バグ修正（旧: trash/purge まで未保存）。defer=true で一括共有の末に 1 回保存（fsync 回数節約）
		if (newEntry && !defer) await this.saveManifest();
		this.emit('changed', { added: newEntry ? [h10] : [], removed: [] });
		return { h10, newEntry };
	}

	// ---- §9.5 複数部屋への同一画像(r マージ) ----
	async addRoom(h10, ridB64U) {
		let meta;
		try {
			meta = this.metas.get(h10) || (await this.store.metaGet(h10));
		} catch (e) {
			return false; // 不正 h10
		}
		if (!meta || !(await this.store.has(h10))) return false;
		if (!meta.r.includes(ridB64U)) {
			meta.r.push(ridB64U);
			await this.store.metaPut(meta);
		}
		this.metas.set(h10, meta);
		if (ridB64U === this.nameB64U && this._manifestAdd(meta)) {
			await this.saveManifest(); // v1.5 §19
			this.emit('changed', { added: [h10], removed: [] });
		}
		return true;
	}

	_manifestAdd(meta) {
		if (this.mset.has(meta.h)) return false;
		const e = { h: meta.h, n: meta.n, r: meta.r, u: meta.u, ts: meta.ts, t: meta.t, l: meta.l, s: meta.s };
		this.manifest.push(e);
		this.mset.add(meta.h);
		if (this._dirty) this._dirty.add.push(e); // v1.5: saveManifest で 1 行追記
		return true;
	}
	// v2.13 §40: 既存 meta を自房 manifest に採用（取得保持モード）。meta 自体は書かない（既に存在）
	adopt(meta) {
		if (!meta || !meta.h) return false;
		return this._manifestAdd(meta);
	}
	_manifestRemove(h10) {
		const i = this.manifest.findIndex(e => e && e.h === h10);
		if (i < 0) return false;
		this.manifest.splice(i, 1);
		this.mset.delete(h10);
		if (this._dirty) this._dirty.del.push(h10); // v1.5: x 行追記
		return true;
	}

	// ---- 表示用(§5.5/§9.9 除外の Material。ts 降順) ----
	roomItems() {
		const out = [];
		for (const m of this.metas.values()) {
			if (!m || !m.h) continue;
			const inManifest = this.mset.has(m.h);
			if (!inManifest && !(m.r || []).includes(this.nameB64U)) continue;
			out.push({ h10: m.h, meta: m, mine: m.u === this.uid, trashed: !!m.d, inManifest });
		}
		return out.sort((a, b) => (b.meta.ts || 0) - (a.meta.ts || 0));
	}
	isTrashed(h10) {
		const m = this.metas.get(h10);
		return !!(m && m.d);
	}
	// M フレーム(m[])用のエントリ: 自房 manifest ∩ 非ゴミ(§9.8)。sid/p(§7.4)はシート担当が付与
	entriesForM() {
		return this.manifest
			.filter(e => e && !this.isTrashed(e.h))
			.map(e => ({ ...e }));
	}
	manifestEntries() {
		return this.manifest.map(e => ({ ...e }));
	}

	// ---- 保持者追跡(§9.4 拡散の Material) ----
	// list: M 受信リスト [{uid, entries:[{h,...}]}]。uid ごとに Set を再構築
	onPeers(list) {
		for (const { uid: puid, entries } of list || []) {
			const hs = new Set();
			for (const e of entries || []) if (e && e.h) hs.add(e.h);
			this.peerHolds.set(puid, hs);
			this.holdersEver.add(puid);
		}
	}
	setOnline(uids) {
		this.online = new Set(uids || []);
		this.online.add(this.uid);
	}
	holdersOf(h10) {
		const uids = [];
		const mine = this.mset.has(h10) && !this.isTrashed(h10);
		if (mine) uids.push(this.uid);
		const offline = [];
		for (const [puid, hs] of this.peerHolds) {
			if (!hs.has(h10)) continue;
			if (this.online.has(puid)) {
				if (puid !== this.uid) uids.push(puid);
			} else if (this.holdersEver.has(puid)) offline.push(puid);
		}
		return { uids, offline, allDeparted: uids.length === 0 };
	}

	// ---- §9.8 ゴミ箱(論理削除→期限で物理削除)。X 送出 flags を返す ----
	async trash(h10) {
		const m = this.metas.get(h10) || (await this.store.metaGet(h10));
		if (!m || m.d) return { trashed: false };
		m.d = Date.now();
		await this.store.metaPut(m);
		this.metas.set(h10, m);
		this.emit('changed', { added: [], removed: [] });
		// §9.5: X broadcast 可は投稿者本人(u)のみ。flags.x={h,by} を送れば呼び出し側が送出
		return { trashed: true, x: m.u === this.uid ? { h: h10, by: this.uid } : null };
	}
	async restore(h10) {
		const m = this.metas.get(h10) || (await this.store.metaGet(h10));
		if (!m || !m.d) return { restored: false };
		if (m.u !== this.uid) return { restored: false }; // §9.8 復元は投稿者本人のみ
		m.d = null;
		await this.store.metaPut(m);
		this.metas.set(h10, m);
		this.emit('changed', { added: [], removed: [] });
		return { restored: true, resendM: true }; // M 再 broadcast は呼び出し側
	}
	// 個別「削除」= 即時物理削除。bodies はグローバル共有なので参照完走后才削除(§9.8)
	async purge(h10) {
		const gone = this._manifestRemove(h10);
		let m = this.metas.get(h10) || null;
		if (!m) {
			try {
				m = await this.store.metaGet(h10);
			} catch (e) {
				m = null;
			}
		}
		if (m && !m.d) {
			// 他部屋で生存中(meta 生存): manifest 解除のみで本体/meta は温存
			await this.saveManifest();
			if (gone) this.emit('changed', { added: [], removed: [h10] });
			return { purged: 'entry', removedBody: false };
		}
		// 他部屋の自端末 manifest が参照していれば本体温存(meta を走査する代替の実参照チェック)
		if (await this._otherRoomRefs(h10)) {
			await this.saveManifest();
			if (gone) this.emit('changed', { added: [], removed: [h10] });
			return { purged: 'entry', removedBody: false };
		}
		await this.store.rm(h10); // bodies/<h10>(未存在は no-op)
		await OPFS.rmf(HashStore.mp(h10)); // meta/<h10>.json
		this.metas.delete(h10);
		await this.saveManifest();
		if (gone) this.emit('changed', { added: [], removed: [h10] });
		return { purged: true, removedBody: true };
	}
	async _otherRoomRefs(h10) {
		await OPFS.rd;
		const self = STORAGE.manifest(this.rid, this.uid);
		// OPFS.ls は dir 要素 {k:全文字パス,p,l:再帰配列} を返す(2 階層目の ls 不要、fp は dir に不可)
		for (const d of await OPFS.ls(STORAGE.rooms)) {
			if (!Collection._isDir(d)) continue;
			for (const f of d.l || []) {
				if (Collection._isDir(f) || !/^manifest\./.test(f.k) || !/\.json$/.test(f.k)) continue;
				const p = HashStore.fp(f);
				if (p === self) continue;
				try {
					const arr = JSON.parse(Y.u2s(await OPFS.r(p)));
					if (Array.isArray(arr) && arr.some(e => e && e.h === h10)) return true;
				} catch (e) {
					/* 壊れた manifest は無視 */
				}
			}
		}
		return false;
	}
	static _isDir(e) {
		return e && e.s === undefined; // HashStore.isf の逆(ディレクトリは l を持つ)
	}

	trashList() {
		return this.roomItems()
			.filter(it => it.trashed)
			.sort((a, b) => (b.meta.d || 0) - (a.meta.d || 0));
	}
	async emptyTrash() {
		let n = 0;
		for (const it of this.trashList()) {
			const r = await this.purge(it.h10);
			if (r.purged === true) n++;
		}
		return n;
	}
	// 起動時スイープ(§9.8 条件3)。getLastSweep/onSwept は部屋状態ファイル担当の getter/saver
	async sweepIfNeeded(getLastSweep, onSwept) {
		const now = Date.now();
		const last = getLastSweep ? await getLastSweep() : null;
		if (Number.isFinite(last) && now - last < DAY_MS) return null; // 起動毎でも日次でも、間隔で抑制
		const refs = this.manifestEntries().map(e => e.h); // 外部参照(manifest 生存分)
		const { deleted } = await this.store.sweep(now, this.cfg.TRASH_KEEP_DAYS, refs);
		const removed = [];
		for (const e of [...this.manifest]) {
			// スイープで meta が消えたエントリは manifest から除去(本体は次回スイープで孤児化)
			if (!e) continue;
			const live = await this.store.metaGet(e.h); // 権威判定(この Map は陳腐化しうる)
			if (live) {
				this.metas.set(e.h, live);
				continue;
			}
			if (this._manifestRemove(e.h)) {
				removed.push(e.h);
				this.metas.delete(e.h);
			}
		}
		await this.saveManifest();
		if (removed.length) this.emit('changed', { added: [], removed });
		if (onSwept) await onSwept(now, deleted);
		return { deleted, removed };
	}

	// ---- X 受信(§9.8 受信側は論理削除のみ。X 再送出しない) ----
	async onDeleteX(x, fromUid) {
		const h10 = x && x.h;
		if (!h10) return { applied: false };
		let m;
		try {
			m = this.metas.get(h10) || (await this.store.metaGet(h10));
		} catch (e) {
			return { applied: false }; // 不正 h10
		}
		if (!m || m.d) return { applied: false };
		m.d = Date.now();
		await this.store.metaPut(m);
		this.metas.set(h10, m);
		this.emit('changed', { added: [], removed: [] });
		return { applied: true, trashed: true, by: x.by || fromUid };
	}
}
