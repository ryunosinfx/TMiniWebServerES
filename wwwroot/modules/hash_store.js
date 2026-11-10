/**
 * @module modules/hash_store.js
 * @version 0.1.0
 * @see docs/impl_contracts.md (hash_store 節) / docs/img_room_spec.md (§7.1 メタデータ, §9.8 ゴミ箱, §9.11 使用量集計, §10 OPFS 構成)
 * HashStore — 画像本体 bodies/<h10> とメタ meta/<h10>.json のコンテンツアドレスストア。
 * 前提: OPFS.i('imgroom') 初期化済み。全メソッド先頭で await OPFS.rd。
 */
import { OPFS } from '../OPFS.js';
import { Y, H, B, P, E } from '../Y.js';

const DEF_ROUNDS = 10, // HASH_ROUNDS (ir_const.js既定。循環import回避のため同一値のローカル既定)
	DAY_MS = 86400000,
	DEF_KEEP_DAYS = 30, // TRASH_KEEP_DAYS (仕様 §9.8)
	RE_H = /^[A-Za-z0-9_-]{8,}$/; // h10=b64url(SHA-256)。パス注入防止の安全検証

export class HashStore {
	constructor(cfg = {}) {
		this.rounds = Number.isFinite(cfg.rounds) && cfg.rounds > 0 ? cfg.rounds : DEF_ROUNDS;
		this._mmap = new Map(); // h10 -> meta（metaAll 後に全件・metaPut で増分。10 万件規模の metaGet 走査を消す）
	}
	static bp = h => 'bodies' + P + h; //本体パス
	static mp = h => 'meta' + P + h + '.json'; // legacy 1 件 1 ファイル（v1.5 で day jsonl へマイグレーション、読込のみ残置）
	static dp = day => 'meta' + P + 'd' + day + '.jsonl'; // per-day 差分ログ（v1.5 §19: 1 日 1 ファイル・追記）
	static chk(h) {
		if (!RE_H.test(h)) throw new Error('HashStore: invalid h10 ' + h);
		return h;
	}
	// OPFS.ls のファイル要素は {k:基底名, p:親相対パス, s:サイズ}。パス復元は p+'/'+k
	static fp = e => e.p + P + e.k;
	static isf = e => e.s !== undefined; //ファイル要素判定(ディレクトリ要素は l を持つ)

	async put(ab) {
		await OPFS.rd;
		// H.d は素の ArrayBuffer だと te.encode 文字列フォールバックに落ちる(Y.js:30)ため
		// 画像生バイト列を保持する Uint8Array に正規化してからハッシュする
		const u8 = ab instanceof Uint8Array ? ab : B.u8(ab),
			h = Y.B2U(await H.d(u8, this.rounds));
		HashStore.chk(h);
		if (await OPFS.isEf(HashStore.bp(h))) return h; //既存なら書かない(内容アドレス一意)
		await OPFS.w(HashStore.bp(h), u8.buffer);
		return h;
	}
	async get(h10) {
		await OPFS.rd;
		const p = HashStore.bp(HashStore.chk(h10));
		if (!(await OPFS.isEf(p))) return null; //OPFS.r は未存在時 mkFile で空ファイル生成するため事前確認必須
		return await OPFS.r(p);
	}
	async has(h10) {
		await OPFS.rd;
		return !!(await OPFS.isEf(HashStore.bp(HashStore.chk(h10))));
	}
	async rm(h10) {
		await OPFS.rd;
		await OPFS.rmf(HashStore.bp(HashStore.chk(h10))); //bodies のみ。未存在は rmf 内部で no-op
	}

	async metaPut(metaObj) {
		await OPFS.rd;
		const h = HashStore.chk(metaObj && metaObj.h);
		const ts = Number.isFinite(metaObj.ts) && metaObj.ts > 0 ? metaObj.ts : Date.now();
		// v1.5 §19: 1 件 1 行の追記（per-day jsonl）。r マージ等の更新も追記で last-wins。
		await OPFS.ap(HashStore.dp(Math.floor(ts / DAY_MS)), Y.s2u(JSON.stringify(metaObj) + '\n'));
		this._mmap.set(h, metaObj);
		return h;
	}
	async metaGet(h10) {
		await OPFS.rd;
		const h = HashStore.chk(h10);
		if (this._mmap.has(h)) return this._mmap.get(h);
		await this.metaAll(); // 未ロード時は day files 一括読込（legacy 1 件 1 ファイル走査を廃止）
		return this._mmap.get(h) || null;
	}
	async metaAll() {
		await OPFS.rd;
		const out = new Map(); // h10 -> meta（day jsonl を時系列 reduce、del で除去）
		const l = await OPFS.ls('meta');
		for (const e of l) {
			if (!HashStore.isf(e) || !/^d\d+\.jsonl$/.test(e.k)) continue;
			try {
				for (const line of Y.u2s(await OPFS.r(HashStore.fp(e))).split('\n')) {
					if (!line) continue;
					let m;
					try {
						m = JSON.parse(line);
					} catch (err) {
						continue; // 破損行は読み飛ばす
					}
					if (!m || !RE_H.test(m.h)) continue;
					if (m.del) out.delete(m.h);
					else out.set(m.h, m);
				}
			} catch (err) {} // 日ファイル自体の読込失敗はスキップ
		}
		// legacy meta/<h>.json → day jsonl へのマイグレーション（初回のみ。以後の起動は day のみで高速）
		const byDay = new Map();
		for (const e of l) {
			if (!HashStore.isf(e) || /\.jsonl$/.test(e.k) || !/\.json$/.test(e.k)) continue;
			if (!RE_H.test(e.k.slice(0, -5))) continue;
			let m;
			try {
				m = JSON.parse(Y.u2s(await OPFS.r(HashStore.fp(e))));
			} catch (err) {
				await OPFS.rmf(HashStore.fp(e)); // 破損 legacy は除去
				continue;
			}
			await OPFS.rmf(HashStore.fp(e));
			if (!m || !RE_H.test(m.h) || out.has(m.h)) continue; // day 側に既にあれば legacy は廃止のみ
			out.set(m.h, m);
			const day = Math.floor((Number.isFinite(m.ts) && m.ts > 0 ? m.ts : Date.now()) / DAY_MS);
			if (!byDay.has(day)) byDay.set(day, []);
			byDay.get(day).push(m);
		}
		for (const [day, ms] of byDay) {
			// 既存 day ファイルがあれば追記（w の全書換で既存行を消さない）
			await OPFS.ap(HashStore.dp(day), Y.s2u(ms.map(m => JSON.stringify(m)).join('\n') + '\n'));
		}
		this._mmap = out;
		return [...out.values()];
	}

	async listTrash(nowMs, keepDays) {
		await OPFS.rd;
		// ゴミ箱(d 非 null)の全メタを新しい順(d 降順)。nowMs/keepDays は契約署名互換のための許容引数
		return (await this.metaAll())
			.filter(m => m && RE_H.test(m.h) && m.d)
			.sort((a, b) => b.d - a.d);
	}
	async sweep(nowMs, keepDays, extraRefs) {
		await OPFS.rd;
		// 順序: ①期限切れ meta 削除 → ②残 meta(+extraRefs)の参照集合構築 → ③孤児 bodies 削除
		// (参照集合を meta 削除前に組むと期限切れ meta の参照で本体が生き残るため ①→② が必須)
		const now = Number.isFinite(nowMs) ? nowMs : Date.now(),
			kd = Number.isFinite(keepDays) && keepDays > 0 ? keepDays : DEF_KEEP_DAYS,
			cut = now - kd * DAY_MS, // now - d > kd日 ⇔ d < cut
			ms = await this.metaAll(),
			kept = new Set(),
			dirtyDays = new Set(),
			dropHs = new Set(); // 期限切れで物理削除する h（同一 h の全行を day から除去する）
		for (const m of ms) {
			if (!m || !RE_H.test(m.h)) continue;
			if (m.d && m.d < cut) {
				// 期限切れ meta 物理削除（v1.5: day ファイルから当該 h の全行を除去して書換。1 件 1 ファイル rmf ではない）
				dropHs.add(m.h);
				dirtyDays.add(Math.floor((Number.isFinite(m.ts) ? m.ts : m.d) / DAY_MS));
				this._mmap.delete(m.h);
			} else kept.add(m.h); //論理削除中(d 設定済み・未経過)も参照有効(§9.8)
		}
		for (const day of dirtyDays) {
			const p = HashStore.dp(day);
			if (!(await OPFS.isEf(p))) continue;
			const keep = [];
			for (const line of Y.u2s(await OPFS.r(p)).split('\n')) {
				if (!line) continue;
				let m;
				try {
					m = JSON.parse(line);
				} catch (err) {
					continue;
				}
				if (m && RE_H.test(m.h) && !dropHs.has(m.h)) keep.push(line);
			}
			await OPFS.w(p, Y.s2u(keep.length ? keep.join('\n') + '\n' : ''));
		}
		for (const h of extraRefs || []) if (RE_H.test(h)) kept.add(h); //部屋 manifest/autodl 等の外部参照
		const deleted = [];
		for (const e of await OPFS.ls('bodies')) {
			if (!HashStore.isf(e) || !RE_H.test(e.k) || kept.has(e.k)) continue;
			await OPFS.rmf(HashStore.fp(e)); //孤児本体削除
			deleted.push(e.k);
		}
		return { deleted }; //bodies を物理削除した h10
	}

	async sizesOf(h10s) {
		await OPFS.rd;
		// bodies 実測 + meta は day jsonl 平均（v1.5: 1 件 1 ファイルでないため 1 件あたり=総bytes/件数の概算。表示用途で粗さ許容）
		const bs = new Map();
		let metaBytes = 0;
		for (const e of await OPFS.ls('bodies')) if (HashStore.isf(e)) bs.set(e.k, e.s);
		for (const e of await OPFS.ls('meta')) if (HashStore.isf(e)) metaBytes += e.s;
		const mAvg = Math.ceil(metaBytes / Math.max(1, this._mmap.size));
		let bytes = 0,
			count = 0;
		for (const h of h10s || []) {
			if (!RE_H.test(h)) continue;
			const b = bs.get(h);
			if (b === undefined && !this._mmap.has(h)) continue;
			bytes += (b || 0) + mAvg;
			count++;
		}
		return { bytes, count };
	}
	async usage() {
		await OPFS.rd;
		// §9.11: bodies/ + meta/ + 全部屋 sheet/。ls は共有配列へ平坦化するため再帰せず p で選別
		const sum = (l, pred) => {
				let bytes = 0,
					count = 0;
				for (const e of l)
					if (HashStore.isf(e) && pred(e)) {
						bytes += e.s;
						count++;
					}
				return { bytes, count };
			},
			rooms = await OPFS.ls('rooms'); //rooms/<rid>/sheet/... を平坦列から拾う
		return {
			bodies: sum(await OPFS.ls('bodies'), e => e.p === 'bodies'),
			sheets: sum(rooms, e => /\/sheet$/.test(e.p || E)),
			meta: sum(await OPFS.ls('meta'), e => e.p === 'meta'),
		};
	}
	async estimate() {
		await OPFS.rd;
		try {
			return await navigator.storage.estimate(); //ブラウザ視点の {usage, quota}
		} catch (e) {
			return null;
		}
	}
}
