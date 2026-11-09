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
	}
	static bp = h => 'bodies' + P + h; //本体パス
	static mp = h => 'meta' + P + h + '.json'; //メタパス
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
		await OPFS.w(HashStore.mp(h), Y.s2u(JSON.stringify(metaObj))); //JSON→UTF-8
		return h;
	}
	async metaGet(h10) {
		await OPFS.rd;
		const p = HashStore.mp(HashStore.chk(h10));
		if (!(await OPFS.isEf(p))) return null;
		try {
			return JSON.parse(Y.u2s(await OPFS.r(p))); //UTF-8→文字列→JSON
		} catch (e) {
			return null;
		}
	}
	async metaAll() {
		await OPFS.rd;
		const l = await OPFS.ls('meta'),
			out = [];
		for (const e of l) {
			if (!HashStore.isf(e)) continue;
			try {
				out.push(JSON.parse(Y.u2s(await OPFS.r(HashStore.fp(e)))));
			} catch (err) {} //破損メタは読み飛ばす
		}
		return out;
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
			kept = new Set();
		for (const m of ms) {
			if (!m || !RE_H.test(m.h)) continue;
			if (m.d && m.d < cut) await OPFS.rmf(HashStore.mp(m.h)); //期限切れ meta 物理削除
			else kept.add(m.h); //論理削除中(d 設定済み・未経過)も参照有効(§9.8)
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
		// bodies+meta 実測。ls は平坦配列なので p 一致で絞り、s を map 参照
		const bs = new Map(),
			ms = new Map();
		for (const e of await OPFS.ls('bodies')) if (HashStore.isf(e)) bs.set(e.k, e.s);
		for (const e of await OPFS.ls('meta')) if (HashStore.isf(e)) ms.set(e.k, e.s);
		let bytes = 0,
			count = 0;
		for (const h of h10s || []) {
			if (!RE_H.test(h)) continue;
			const b = bs.get(h),
				m = ms.get(h + '.json');
			if (b === undefined && m === undefined) continue;
			bytes += (b || 0) + (m || 0);
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
