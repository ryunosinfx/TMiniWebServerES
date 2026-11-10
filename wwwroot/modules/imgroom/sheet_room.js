/** @module modules/imgroom/sheet_room.js @version 0.1.0 @see docs/img_room_spec.md §9.2 / §7.4 / §8.2(S,T) / §8.6 */
// 部屋 × 投稿者のシート（GRID_COLS×GRID_ROWS = 32 コマ）生成・索引・S/T/chunk 交換・スライス提供。
//
// p2p_file との接続方針（chunk 機構共有）:
//   FileTransfer.startSend({h10, ab, hdr, comp}) と FileTransfer.expectTransfer({h10, l, s, c, verify, rounds, fromUid})
//   が公開されていることを確認済み（p2p_file.js:120 / p2p_file.js:149）なので、これらを直接使う。
//   ・S ヘッダはここで組み立てて hdr として渡す。FileTransfer._drive は hdr を最初に送出してから
//     chunk（FileTransfer.mkChunk = `~<h10>.<i>.<c>.<b64u>`）を CHUNK_GAP_MS で連投するため、
//     S 本文 + chunk 列が 1 本の送出レールに載る（sendFrame は transfer 側の send と同一トランスポート前提）。
//   ・chunk 受信側の照合は h10 キーのみ（_chunk は in.get(pc.h)）。S/H の区別がないので expectTransfer 一本で受ける。
//   ・gzip は startSend にやらせず（comp: F）こちらで l/s/c を確定させてから S に載せる。
//     受信側 _complete は s < l のとき gunzip（Y.d）→ h10 再計算検証（verify: T）を行う（§9.3.4 と同一経路）。
//   ・S/T/chunk 以外の Q/H/A/G は p2p_file.feed が吸収するので、本モジュールの onM/onS/onT は
//     ルータ（room_session 想定）が feed() の false 戻り後に ir で振り分けて呼び出す。
import { OPFS } from '../../OPFS.js';
import { Y, H, B, E, T, F, N, cb, w, gBl } from '../../Y.js';
import { ImgProc, SliceCache } from '../img_proc.js';
import { CFG, IR, STORAGE } from './ir_const.js';

const MAX_M = 64; // §8.4 M ページ上限（エントリ数）
const SHEET_RE = /^(.*)_(\d+)\.s(\d+)\.([A-Za-z0-9_-]{8,})$/; // <uid>_<idx>.s<px>.<h10>（v1.6 §20: 基準 px 焼込み）
const isFn = v => typeof v === 'function';

export class SheetRoom {
	/**
	 * @param {{rid:string, uid:string, store?:object, img?:object, cfg?:object,
	 *   sendFrame:(s:string)=>*, transfer?:object}} o transfer は FileTransfer 共有インスタンス
	 */
	constructor({ rid, uid, store, img, cfg, sendFrame, transfer } = {}) {
		this.rid = rid || E;
		this.uid = uid || E;
		this.store = store || N; // HashStore（本体バイトの thumb 生成時のみ使用）
		this.ip = isFn(img && img.collage) ? img : ImgProc; // img はクラス/インスタンス両対応
		this.cfg = { ...CFG, ...(cfg || {}) };
		this.sendFrame = isFn(sendFrame) ? sendFrame : () => cb(w('sheet_room: sendFrame 未注入'));
		this.transfer = transfer && isFn(transfer.expectTransfer) && isFn(transfer.startSend) ? transfer : N;
		if (!this.transfer) cb(w('sheet_room: transfer（startSend/expectTransfer）未注入 → シート交換不可'));

		this.slices = new SliceCache(); // `${uid}.${idx}.${p}` -> objectURL（表示用併用）
		this.index = new Map(); // `${uid}.${idx}` -> {uid, idx, h, total}
		this._gfp = new Map(); // idx -> [fp, h]（v1.5 §19 群指紋。scan で sheetidx 読込、rebuild で書換）
		this.placed = new Map(); // 自 h10 -> {sid, p}（§7.4 m の sid/p 補完用）
		this.thumbs = new Map(); // h10 -> Blob（collage 入力。SliceCache 併用のサムネイル）
		this.cells = new Map(); // `${uid}.${idx}` -> Blob[]（row-major 32）
		this.pending = new Map(); // sid -> {uid, idx, h, n, to, tries, t}（T 送出済み・S 待ち）
		this.receiving = new Set(); // 受信中 h10（expectTransfer 重複登録ガード）
		this.dirty = new Set(); // 再配布すべき自 sid（§9.2.3 変更シートのみ）
		this.handlers = new Map(); // evt -> Set<fn>
		this.timers = new Set();
		this._lastBcast = 0;
		this._nextAt = 0; // §8.6 SHEET_BCAST_MIN_MS + ≤SHEET_JITTER_MS の次回可能時刻
		this._bcastTimer = N;
		this._entries = []; // 直近 rebuild の対象（mPages 用）
		this.dead = F;
	}

	// ---- イベント ----
	on(evt, fn) {
		if (!isFn(fn)) return;
		const s = this.handlers.get(evt) || new Set();
		s.add(fn);
		this.handlers.set(evt, s);
	}
	off(evt, fn) {
		const s = this.handlers.get(evt);
		if (s) s.delete(fn);
	}
	_emit(evt, ...a) {
		const s = this.handlers.get(evt);
		if (!s) return;
		for (const fn of [...s]) try {
			fn(...a);
		} catch (e) {
			cb(w('sheet_room: emit handler', evt, e && e.message));
		}
	}

	// ---- タイマ ----
	_t(fn, ms) {
		const h = setTimeout(() => {
			this.timers.delete(h);
			if (this.dead) return;
			try {
				fn();
			} catch (e) {
				cb(w('sheet_room: timer', e && e.message));
			}
		}, ms);
		this.timers.add(h);
		return h;
	}
	_cw(h) {
		if (h) clearTimeout(h), this.timers.delete(h);
	}
	_per() {
		return Math.max(1, (this.cfg.GRID_COLS || 4) * (this.cfg.GRID_ROWS || 8));
	}

	// ---- §8.6 シート再配布スロットル ----
	canBroadcast(nowMs = Date.now()) {
		return nowMs >= this._nextAt;
	}
	nextDelay(nowMs = Date.now()) {
		return Math.max(0, this._nextAt - nowMs);
	}
	// 送出直前に呼んでスロットルを進める（SHEET_BCAST_MIN_MS + [0, SHEET_JITTER_MS]）
	markBroadcast(nowMs = Date.now()) {
		this._lastBcast = nowMs;
		const j = Math.max(0, this.cfg.SHEET_JITTER_MS || 0);
		this._nextAt = nowMs + Math.max(0, this.cfg.SHEET_BCAST_MIN_MS || 0) + Math.floor(Math.random() * (j || 1));
	}
	// 認証完了時に自保持索引を 1 回周知（§9.4 拡散の基礎。authOk から room_app が呼ぶ）
	// 参加/退出時の 1 回限りなので §8.6 の 30s スロットル枠は消費しない（新規投稿 M を遅らせない）
	broadcastMNow() {
		if (this.dead || !this.transfer) return;
		this.gen = (this.gen || 0) + 1;
		for (const fr of this.mFrames(this.gen)) this._send(fr);
	}
	// 変更シッドをスロットルに従って自動送出（rebuild 後はこちらに任せてよい）
	queueBroadcast(sids) {
		for (const s of sids || []) this.dirty.add(s);
		this._scheduleBcast();
	}
	_scheduleBcast() {
		if (this._bcastTimer || !this.dirty.size || this.dead) return;
		this._bcastTimer = this._t(() => {
			this._bcastTimer = N;
			this.flushBroadcast().catch(e => cb(w('sheet_room: flushBroadcast', e && e.message)));
		}, this.nextDelay());
	}
	async flushBroadcast() {
		if (this.dead || !this.transfer || !this.dirty.size) return F;
		if (!this.canBroadcast()) {
			this._scheduleBcast();
			return F;
		}
		this.dirty.clear();
		this.markBroadcast();
		// §9.2: 変更時は M（manifest + sheets 索引）のみ broadcast。本体は受信側の T 要求で差分交換
		let ok = F;
		this.gen = (this.gen || 0) + 1;
		for (const fr of this.mFrames(this.gen)) {
			this._send(fr);
			ok = T;
		}
		return ok;
	}

	// ---- 索引の読み込み（起動・§9.7 オフライン再構築） ----
	async scan() {
		await OPFS.rd;
		if (this.dead) return this.index;
		const dir = STORAGE.sheetDir(this.rid);
		let list = [];
		try {
			list = await OPFS.ls(dir);
		} catch (e) {
			cb(w('sheet_room: scan 失敗', dir, e && e.message));
		}
		for (const e of list) {
			if (!e || e.s === undefined) continue; // ディレクトリ要素は無視（HashStore.isf と同じ判定）
			const m = SHEET_RE.exec(e.k || E);
			if (!m) {
				// v1.6 §20: 旧形式（px 無し）や基準 px 不一致のシートは失効→削除（再生成で新 px 版に置換）
				try {
					await OPFS.rmf(`${dir}/${e.k}`);
				} catch (er) { /* 消えない分は放置 */ }
				continue;
			}
			const idx = +m[2];
			this.index.set(`${m[1]}.${idx}`, { uid: m[1], idx, h: m[4], total: this._per() });
		}
		// v1.5 §19: 群指紋（sheetidx）読込。rebuild 側で manifest membership が一致した群は collage 再計算を省略する
		try {
			const p = STORAGE.sheetIdx(this.rid, this.uid);
			if (await OPFS.isEf(p)) {
				const arr = JSON.parse(Y.u2s(await OPFS.r(p)));
				if (Array.isArray(arr)) for (const r of arr) if (Array.isArray(r) && r.length >= 3) this._gfp.set(+r[0], [r[1], r[2]]);
			}
		} catch (e) {
			cb(w('sheet_room: sheetIdx 読込失敗', e && e.message));
		}
		return this.index;
	}
	has(uid, idx, h) {
		const r = this.index.get(`${uid}.${idx}`);
		return !!r && (h === undefined || r.h === h);
	}
	// collage 入力用サムネイルの差し込み（アップロード側が Thumb 生成済みの場合に共有）
	setThumb(h10, blob) {
		if (h10 && blob) this.thumbs.set(h10, blob);
	}

	// 自タブ実在の本体 h10 集合を ls 1 回で（v1.5 §19。rebuild の存在確認を Map 参照へ）
	async _bodySet() {
		const s = new Set();
		try {
			for (const e of await OPFS.ls('bodies')) if (e && e.s !== undefined) s.add(e.k);
		} catch (e) {
			cb(w('sheet_room: bodies ls 失敗', e && e.message));
		}
		return s;
	}
	// 群 manifest 指紋: h10+ts の順序列ハッシュ+基準 px（v1.6 §20）。一致群は保存シートを再利用（v1.5 §19）
	async gfp(grp) {
		try {
			return Y.B2U(await H.d(Y.s2u(grp.map(e => e.h + ':' + (Number(e.ts) || 0)).join('|') + ':px' + (Number(this.cfg.THUMB_BASE_PX) || 96)), 1));
		} catch (e) {
			return E;
		}
	}
	// ---- §9.2.1/2 シート再生成 ----
	// entries: §7.4 m と同形の manifest エントリ配列（h, ts, …）。ts 降順 → 32 コマ/シート。
	async rebuild(entries) {
		if (this.dead) return;
		const cols = this.cfg.GRID_COLS, rows = this.cfg.GRID_ROWS, per = this._per(), px = this.cfg.THUMB_BASE_PX || 96; // v1.6 §20: シートコマは基準 128
		const uniq = [];
		const seen = new Set();
		for (const e of [...(entries || [])].sort((a, b) => ((b && b.ts) || 0) - ((a && a.ts) || 0))) {
			if (!e || !e.h || seen.has(e.h)) continue; // §7.5 h10 はグローバル 1 個
			seen.add(e.h);
			uniq.push(e);
		}
		this._entries = uniq;
		this.placed.clear();
		const prev = this.index;
		const next = new Map();
		const changed = [];
		const gRows = []; // 保存する群指紋行 [idx, fp, h, total]（v1.5 §19）
		let have = N; // 本体存在判定の遅延セット（初 miss で ls 1 回。10 万 miss × isEf 0.7ms を回避）
		for (let i = 0; i < uniq.length || (i === 0 && !uniq.length); i += per) {
			const grp = uniq.slice(i, i + per);
			const idx = i / per;
			if (!grp.length) break;
			const fp = await this.gfp(grp);
			const rec = this.index.get(`${this.uid}.${idx}`);
			const saved = this._gfp.get(idx);
			if (rec && saved && saved[0] === fp && saved[1] === rec.h) {
				// 高速パス: 群の membership 不変かつ保存シート実在 → decode/collage 無しで索引だけ復元（10 万件起動の秒化）
				next.set(`${this.uid}.${idx}`, { uid: this.uid, idx, h: rec.h, total: grp.length });
				gRows.push([idx, fp, rec.h, grp.length]);
				const sid0 = `${this.rid}.${this.uid}.${idx}`;
				grp.forEach((e, k) => this.placed.set(e.h, { sid: sid0, p: k }));
				continue;
			}
			const cells = [];
			for (const e of grp) {
				const t = this.thumbs.get(e.h);
				if (t) {
					cells.push(t);
					continue;
				}
				if (this.store && isFn(this.store.get)) {
					if (!have) have = await this._bodySet();
					if (have.has(e.h)) cells.push(await this._thumbOf(e.h)); // 自タブ実在のみ decode（欠損セルは白）
				}
			}
			if (!cells.some(Boolean)) continue; // v1.5 §19: 全コマ未所持の空シートは生成しない（10 万件で数千の白 collage + sheets イベント嵐防止。末尾掃除で旧も除去）
			const sheetBlob = await this.ip.collage(cells, cols, rows, px, this.cfg.SHEET_Q);
			const ab = await this.ip.blob2ab(sheetBlob);
			const h = Y.B2U(await H.d(B.u8(ab), this.cfg.HASH_ROUNDS)); // h10（HashStore.put と同一手順）
			const p = STORAGE.sheet(this.rid, this.uid, idx, h);
			if (!(await OPFS.isEf(p))) await OPFS.w(p, ab); // 解凍済み生 JPEG bytes で保存
			next.set(`${this.uid}.${idx}`, { uid: this.uid, idx, h, total: grp.length });
			const sid = `${this.rid}.${this.uid}.${idx}`;
			grp.forEach((e, k) => this.placed.set(e.h, { sid, p: k })); // p は行優先（x=p%GRID_COLS）
			const old = prev.get(`${this.uid}.${idx}`);
			if (!old || old.h !== h) {
				changed.push(sid);
				if (old && old.h !== h) await this._rmSheet(old.uid, old.idx, old.h);
			}
			this._dropCells(this.uid, idx);
			this.cells.set(`${this.uid}.${idx}`, cells.slice(0, per)); // 自シートはセルをそのまま再利用
			this._emit('sheets', this.uid, idx, cells.slice(0, per));
			gRows.push([idx, fp, h, grp.length]);
		}
		// 枚数減少で消えた末尾シートを掃除
		for (const [k, old] of prev) {
			if (old.uid !== this.uid || next.has(k)) continue;
			await this._rmSheet(old.uid, old.idx, old.h);
			this._dropCells(old.uid, old.idx);
		}
		this.index = next;
		// 群指紋保存（次回起動の高速パス用。10 万件でも 2〜3 千行の小型 JSON）
		try {
			await OPFS.w(STORAGE.sheetIdx(this.rid, this.uid), Y.s2u(JSON.stringify(gRows)));
			this._gfp = new Map(gRows.map(r => [r[0], [r[1], r[2]]]));
		} catch (e) {
			cb(w('sheet_room: sheetIdx 書換失敗', e && e.message));
		}
		// v1.3.1 H1: thumbs は現 manifest 分のみ保持（投稿入替・削除での無制限成長防止）
		if (this.thumbs.size) {
			const keep = new Set(uniq.map(e => e.h));
			for (const h of [...this.thumbs.keys()]) if (!keep.has(h)) this.thumbs.delete(h);
		}
		this._emit('index', [...next.values()]);
		this.queueBroadcast(changed); // §9.2.3 変更のあったシートのみ再配布（§8.6 スロットル）
	}
	async _thumbOf(h) {
		const t = this.thumbs.get(h);
		if (t) return t;
		if (!this.store || !isFn(this.store.get)) return N;
		try {
			const ab = await this.store.get(h);
			if (!ab) return N;
			const b = await (isFn(this.ip.thumb) ? this.ip.thumb(ImgProc.ab2blob(ab, this.cfg.SHEET_FMT), this.cfg.THUMB_BASE_PX || 96) : N);
			if (b) this.thumbs.set(h, b);
			return b || N;
		} catch (e) {
			cb(w('sheet_room: thumb 生成失敗', h, e && e.message));
			return N;
		}
	}
	async _rmSheet(uid, idx, h) {
		try {
			await OPFS.rmf(STORAGE.sheet(this.rid, uid, idx, h));
		} catch (e) {
			cb(w('sheet_room: 旧シート削除失敗', uid, idx, h, e && e.message));
		}
	}
	_dropCells(uid, idx) {
		this.cells.delete(`${uid}.${idx}`);
		for (let p = 0; p < this._per(); p++) {
			const key = `${uid}.${idx}.${p}`;
			this.slices.release(key);
		}
	}

	// ---- §7.4 M ペイロード ----
	// 自 manifest エントリを 64 個/ページに分割して返す（呼び出し側は {ir:'M', uid, gen, sheets, m} で包む）
	mPages() {
		const pages = [];
		let page = [];
		for (const e of this._entries) {
			const pl = this.placed.get(e.h) || {};
			page.push({
				h: e.h, n: e.n, r: e.r, u: e.u, ts: e.ts, t: e.t, l: e.l, s: e.s, c: e.c,
				sid: pl.sid, p: pl.p,
			});
			if (page.length >= MAX_M) pages.push(page), (page = []);
		}
		if (page.length) pages.push(page);
		return pages;
	}
	sheetsIndex() {
		return [...this.index.values()].filter(v => v.uid === this.uid).map(v => ({ id: `${this.rid}.${v.uid}.${v.idx}`, h: v.h, n: v.total }));
	}
	// 送信用 M フレーム列（sheets 索引は全ページに同梱 = 受信側が単ページでも索引復元可能）
	mFrames(gen = 0) {
		const sheets = this.sheetsIndex();
		return this.mPages().map(m => ({ ir: IR.M, uid: this.uid, gen, sheets, m }));
	}

	// ---- M 受信 → 索引差分 → T 要求 ----
	async onM(mframe, fromUid) {
		if (this.dead || !mframe) return;
		const from = mframe.uid || fromUid || E;
		if (!from || from === this.uid) return;
		for (const s of mframe.sheets || []) {
			if (!s || !s.h) continue;
			const loc = this._sid(s.id);
			if (!loc) continue;
			const mine = this.index.get(`${loc.uid}.${loc.idx}`);
			if (mine && mine.h === s.h) continue; // 同一 h10 を所持 → 転送不要（§9.2.3）
			this._ask(loc.uid, loc.idx, s.h, s.n, from);
		}
	}
	// `<rid>.<uid>.<idx>`（§7.4）。rid に '.' は含まれない前提（ridOf の生成形）
	_sid(id) {
		const a = String(id == null ? E : id).split('.');
		if (a.length !== 3 || a[0] !== this.rid) return N;
		const idx = Number(a[2]);
		if (!Number.isInteger(idx) || idx < 0) return N;
		return { rid: a[0], uid: a[1], idx };
	}
	_ask(uid, idx, h, n, to) {
		if (!this.transfer) return;
		const sid = `${this.rid}.${uid}.${idx}`;
		if (this.pending.has(sid) || this.receiving.has(h)) return;
		this.pending.set(sid, { uid, idx, h, n, to, tries: 0, t: N });
		this._send({ ir: IR.T, to, sid }); // 取得要求（§8.2 表）
		this._armPend(sid);
	}
	// REQ_TIMEOUT で T 再送、MAX_RETRY 超過で諦める（§8.6 ウォッチドッグ相当）
	_armPend(sid) {
		const it = this.pending.get(sid);
		if (!it) return;
		this._cw(it.t);
		it.t = this._t(() => {
			const cur = this.pending.get(sid);
			if (!cur) return;
			cur.tries++;
			if (cur.tries > (this.cfg.MAX_RETRY || 0)) {
				this.pending.delete(sid);
				this._emit('sheetfail', cur.uid, cur.idx, cur.h);
				return;
			}
			this._send({ ir: IR.T, to: cur.to, sid });
			this._armPend(sid);
		}, this.cfg.REQ_TIMEOUT || 8000);
	}
	_send(obj) {
		if (this.dead) return F;
		try {
			return this.sendFrame(JSON.stringify(obj)) !== F;
		} catch (e) {
			return cb(w('sheet_room: 送出エラー', e && e.message)), F;
		}
	}

	// ---- T 受信 → S + chunk 送出 ----
	async onT(frame, fromUid) {
		if (this.dead || !frame) return;
		if (frame.to && frame.to !== this.uid) return; // 宛外は無視（broadcast で全員が受け取るため）
		const loc = this._sid(frame.sid);
		if (!loc || loc.uid !== this.uid) return; // 自投稿者のシートのみ供給
		await this.sendSheet(loc.rid + '.' + loc.uid + '.' + loc.idx); // S(hdr) + chunk（§8.2 broadcast）
	}
	// S ヘッダ（§8.2 broadcast 形）+ chunk 列を transfer の共有レールで送出
	async sendSheet(sid) {
		if (this.dead || !this.transfer) return F;
		const loc = this._sid(sid);
		if (!loc) return F;
		const rec = this.index.get(`${loc.uid}.${loc.idx}`);
		if (!rec) return F;
		const p = STORAGE.sheet(this.rid, rec.uid, rec.idx, rec.h);
		let ab = N;
		try {
			if (await OPFS.isEf(p)) ab = await OPFS.r(p); // 保存済みは解凍済み生 JPEG
		} catch (e) {
			cb(w('sheet_room: シート読み出し失敗', loc.uid, loc.idx, rec.h, e && e.message));
		}
		if (!ab) return F;
		const l = gBl(ab);
		let data = ab, s = l;
		try {
			const gz = await Y.c(ab); // s<l のときのみ gzip（受信側 _complete が gunzip）
			if (gBl(gz) && gBl(gz) < l) data = gz, s = gBl(gz);
		} catch (e) {
			cb(w('sheet_room: gzip 失敗（無圧縮で送出）', sid, e && e.message));
		}
		const c = Math.max(1, Math.ceil(s / (this.cfg.CHUNK_RAW || 8192)));
		const hdr = JSON.stringify({ ir: IR.S, uid: this.uid, sid: loc.rid + '.' + loc.uid + '.' + loc.idx, h: rec.h, t: this.cfg.SHEET_FMT, l, s, c });
		// comp: F = 圧縮済みバイトをそのまま chunk 化（startSend 内の再 gzip を避ける）
		const ok = await this.transfer.startSend({ h10: rec.h, ab: data, hdr, comp: F });
		if (ok) this._emit('sent', loc.uid, loc.idx, rec.h);
		return !!ok;
	}

	// ---- S 受信 → expectTransfer → 保存 → スライス ----
	// room_session は feed() が false を返した ir:'S' をここに渡す（chunk は h10 キーで p2p 内部に届く）
	async onS(frame, fromUid) {
		if (this.dead || !this.transfer || !frame) return;
		const loc = this._sid(frame.sid);
		const h = frame.h;
		if (!loc || !h) return;
		const sid = `${loc.rid}.${loc.uid}.${loc.idx}`;
		const pend = this.pending.get(sid);
		if (pend) this._cw(pend.t);
		const mine = this.index.get(`${loc.uid}.${loc.idx}`);
		if (mine && mine.h === h) {
			this.pending.delete(sid);
			return; // 既知（重複 S / 他メンバー向け broadcast）
		}
		if (this.receiving.has(h)) return;
		if (!(frame.c >= 1) || !(frame.s >= 0)) {
			cb(w('sheet_room: S ヘッダ不正', sid, frame.l, frame.s, frame.c));
			return;
		}
		this.receiving.add(h);
		try {
			const ab = await this.transfer.expectTransfer({ h10: h, l: frame.l, s: frame.s, c: frame.c, verify: T, rounds: this.cfg.HASH_ROUNDS, fromUid: (pend && pend.to) || fromUid || E });
			await this._saveSheet(loc, h, ab, (pend && pend.n) || frame.n);
			this.pending.delete(sid);
		} catch (e) {
			cb(w('sheet_room: シート受信失敗', sid, h, e && e.message));
			if (pend && pend.tries < (this.cfg.MAX_RETRY || 0)) {
				pend.tries++;
				this._send({ ir: IR.T, to: pend.to, sid });
				this._armPend(sid);
			} else {
				this.pending.delete(sid);
				this._emit('sheetfail', loc.uid, loc.idx, h);
			}
		} finally {
			this.receiving.delete(h);
		}
	}
	async _saveSheet(loc, h, ab, n) {
		const p = STORAGE.sheet(this.rid, loc.uid, loc.idx, h);
		if (!(await OPFS.isEf(p))) await OPFS.w(p, ab); // gunzip + h10 検証済みの生 JPEG を保存
		const old = this.index.get(`${loc.uid}.${loc.idx}`);
		if (old && old.h !== h) await this._rmSheet(old.uid, old.idx, old.h);
		this.index.set(`${loc.uid}.${loc.idx}`, { uid: loc.uid, idx: loc.idx, h, total: n || this._per() });
		this._dropCells(loc.uid, loc.idx);
		const blobs = await this.slices2(loc.uid, loc.idx);
		this._emit('sheets', loc.uid, loc.idx, blobs);
	}
	async slices2(uid, idx) {
		const cols = this.cfg.GRID_COLS, rows = this.cfg.GRID_ROWS;
		const rec = this.index.get(`${uid}.${idx}`);
		if (!rec || !rec.h) return []; // 未所持（OPFS.r は未存在時 mkFile で空ファイル生成するため先行確認必須）
		const p = STORAGE.sheet(this.rid, uid, idx, rec.h);
		if (!(await OPFS.isEf(p))) return [];
		const ab = await OPFS.r(p);
		const blobs = await this.ip.slice(ImgProc.ab2blob(ab, this.cfg.SHEET_FMT), cols, rows, this.cfg.THUMB_BASE_PX || 96, this.cfg.SHEET_Q);
		this.cells.set(`${uid}.${idx}`, blobs);
		return blobs;
	}

	// ---- 表示用スライス ----
	async slicesOf(uid, idx) {
		const key = `${uid}.${idx}`;
		const hit = this.cells.get(key);
		if (hit) return hit;
		if (!this.index.has(key)) return [];
		try {
			return await this.slices2(uid, idx);
		} catch (e) {
			return cb(w('sheet_room: slicesOf 失敗', uid, idx, e && e.message)), [];
		}
	}
	// SliceCache 併用: 同一セルの objectURL を再利用して返す（呼び出し側は destroy で revoke）
	sliceUrl(uid, idx, p) {
		const key = `${uid}.${idx}.${p}`;
		const url = this.slices.get(key);
		if (url) return url;
		const arr = this.cells.get(`${uid}.${idx}`);
		const blob = arr && arr[p];
		return blob ? this.slices.set(key, blob) : N;
	}

	destroy() {
		if (this.dead) return;
		this.dead = T;
		for (const h of this.timers) clearTimeout(h);
		this.timers.clear();
		for (const it of this.pending.values()) this._cw(it.t);
		this.pending.clear();
		this.receiving.clear();
		this.dirty.clear();
		this.cells.clear();
		this.slices.releaseAll();
		this.thumbs.clear();
		this.placed.clear();
		this.handlers.clear();
		// transfer は共有（room_session 所有）なので destroy しない
	}
}
