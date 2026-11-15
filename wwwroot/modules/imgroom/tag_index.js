/*
 * TagIndex — v2.25 §52: タグ↔画像ハッシュの索引（IndexedDB）
 * - 部屋参加時・画像のタグデータ取得/変更時に当該部屋の行を再構築（更新）
 * - テーブル消失・DB 破損時の自己修復: open/stored 操作の失敗は deleteDatabase →
 *   次回 open の onupgradeneeded で object store を作り直し、次の sync で行を再投入
 * - フィルタはテーブル（ridtag 索引）からハッシュ集合を引く。IDB 永続不可時のみ
 *   呼び出し側がインメモリ meta にフォールバック（仕様 §52 に明記）
 */
import { ef } from '../../Y.js'; // imgroom/ 配下: wwwroot/Y.js への相対

export class TagIndex {
	static DB = 'imgroom_tagidx';
	static VER = 1;
	static ST = 'tags'; // keyPath ['rid','tag','h10']・索引 rid / ridtag

	constructor() { this._p = null; }

	_db() {
		if (!this._p) this._p = this._open();
		return this._p;
	}

	_open() {
		return new Promise((res, rej) => {
			let req;
			try {
				req = indexedDB.open(TagIndex.DB, TagIndex.VER);
			} catch (e) {
				rej(e);
				return;
			}
			req.onupgradeneeded = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains(TagIndex.ST)) {
					const os = db.createObjectStore(TagIndex.ST, { keyPath: ['rid', 'tag', 'h10'] });
					os.createIndex('rid', 'rid');
					os.createIndex('ridtag', ['rid', 'tag']);
				}
			};
			req.onsuccess = () => {
				const db = req.result;
				db.onversionchange = () => {
					try {
						db.close();
					} catch (e) { /* 無視 */ }
					this._p = null; // 次操作で再接続（別タブの移行に譲る）
				};
				res(db);
			};
			req.onerror = () => rej(req.error || new Error('idb-open'));
			req.onblocked = () => rej(new Error('idb-blocked'));
		});
	}

	_invalidate() {
		if (this._p) {
			this._p.then(db => {
				try {
					db.close();
				} catch (e) { /* 無視 */ }
			}).catch(() => {});
			this._p = null;
		}
	}

	// 破損時自己修復: 接続を捨てて DB ごと削除（open 再試行時に store も再作成される）
	_heal(e) {
		ef(e || new Error('idb'), 'TagIndex.heal');
		this._invalidate();
		return new Promise(res => {
			try {
				const d = indexedDB.deleteDatabase(TagIndex.DB);
				d.onsuccess = d.onerror = d.onblocked = () => res();
			} catch (e2) {
				res();
			}
		});
	}

	// プログラマ側キー誤用 (DataError/SyntaxError) で破損扱いの deleteDatabase をしない
	static _noHeal(e) {
		const n = (e && e.name) || '';
		return n === 'DataError' || n === 'SyntaxError' || n === 'TypeError';
	}
	async _op(fn, retry) {
		let db;
		try {
			db = await this._db();
		} catch (e) {
			if (TagIndex._noHeal(e)) throw e;
			await this._heal(e);
			db = await this._db();
		}
		try {
			return await fn(db);
		} catch (e) {
			if (retry !== false && !TagIndex._noHeal(e)) {
				await this._heal(e);
				return this._op(fn, false);
			}
			throw e;
		}
	}

	// 部屋の行を全再構築（参加時・タグ変化時。消えていればこの時点で復活）
	async rebuild(rid, items) {
		const rows = [];
		for (const x of items || []) {
			if (!x || !x.h10) continue;
			for (const t of x.tg || []) rows.push({ rid, tag: String(t), h10: x.h10 });
		}
		return this._op(db => new Promise((res, rej) => {
			const tx = db.transaction(TagIndex.ST, 'readwrite'),
				os = tx.objectStore(TagIndex.ST),
				rq = os.index('rid').openCursor(IDBKeyRange.only(rid));
			rq.onsuccess = () => {
				const cur = rq.result;
				if (cur) {
					cur.delete();
					cur.continue();
					return;
				}
				for (const r of rows) os.put(r);
			};
			rq.onerror = () => rej(rq.error);
			tx.oncomplete = () => res(rows.length);
			tx.onerror = () => rej(tx.error);
			tx.onabort = () => rej(tx.error || new Error('tx-abort'));
		}));
	}

	async dropRoom(rid) {
		return this.rebuild(rid, []);
	}

	async count(rid) {
		return this._op(db => new Promise((res, rej) => {
			const rq = db.transaction(TagIndex.ST, 'readonly').objectStore(TagIndex.ST).index('rid').count(IDBKeyRange.only(rid));
			rq.onsuccess = () => res(rq.result || 0);
			rq.onerror = () => rej(rq.error);
		}));
	}

	async tagsOfRoom(rid) {
		return this._op(db => new Promise((res, rej) => {
			const m = new Map(),
				tx = db.transaction(TagIndex.ST, 'readonly'),
				rq = tx.objectStore(TagIndex.ST).index('rid').openCursor(IDBKeyRange.only(rid));
			rq.onsuccess = () => {
				const cur = rq.result;
				if (cur) {
					m.set(cur.value.tag, (m.get(cur.value.tag) || 0) + 1);
					cur.continue();
					return;
				}
				res([...m.entries()].map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n || (a.tag < b.tag ? -1 : 1)));
			};
			rq.onerror = () => rej(rq.error);
		}));
	}

	// 複数タグは OR。選択なしは null（= フィルタ無し）
	async hashesForTags(rid, tags) {
		if (!tags || !tags.length) return null;
		return this._op(db => new Promise((res, rej) => {
			const out = new Set();
			const tx = db.transaction(TagIndex.ST, 'readonly'),
				os = tx.objectStore(TagIndex.ST);
			let k = 0;
			const step = () => {
				if (k >= tags.length) {
					res(out);
					return;
				}
				const rq = os.index('ridtag').openCursor(IDBKeyRange.only([rid, tags[k]])); // 索引キー=[rid,tag)・同 tag の複数 h10 を全走査
				rq.onsuccess = () => {
					const cur = rq.result;
					if (cur) {
						out.add(cur.value.h10);
						cur.continue();
						return;
					}
					k++;
					step();
				};
				rq.onerror = () => rej(rq.error);
			};
			step();
		}));
	}
}
