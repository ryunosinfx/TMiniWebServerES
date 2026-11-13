/** @module modules/p2p_file.js @version 0.1.0 @see docs/img_room_spec.md */
// 本体/シート転送エンジン（仕様 §8.2〜§8.6, §9.3〜§9.4、契約 impl_contracts.md p2p_file 節）。
// Q/H/A/G とチャンク `~h.i.c.r` の生成・解析・chunk 送受信・G 再送・ウォッチドッグ・キューをこのモジュールに閉じる。
// S/T（シート）は imgroom 側だが、chunk 機構は startSend/expectTransfer でシートにも共有する
// （S/H ヘッダの JSON 内容は呼び出し側が作り hdr で渡す。h10 はコンテンツハッシュで共通）。
// 制御フレーム（§8.2(a) 例）:
//   Q {"ir":"Q","to":uid,"h":h10}          H {"ir":"H","uid","h","n","t","l","s","c"}
//   A {"ir":"A","to":uid,"h":h10,"st":"ok|nf|busy"}   G {"ir":"G","to":uid,"h":h10,"miss":[i...]}
// チャンクフレーム（§8.2(b)、JSON 化しない）: `~<h10>.<i>.<c>.<r>`
import { Y, H, B, isFn, isStr, isArr, cb, w, err, ef, T, F, N, E, gBl, now } from '../Y.js';

// 既定値（ir_const CFG と同値。modules/* は imgroom/* を import できないため局所定義。cfg で注入可）
const DEF_CFG = {
	CHUNK_RAW: 8192,
	CHUNK_GAP_MS: 100,
	IN_TRANSFERS: 1,
	OUT_TRANSFERS: 2,
	REQ_TIMEOUT: 8000,
	STALL_MS: 10000,
	MAX_RETRY: 2,
	HASH_ROUNDS: 10,
};
// §8.4: msg ≒ 11.1KB（r = ceil(8192*4/3) = 10923）。生成・送信前に照合、超過フレームは送出禁止
const MAX_FRAME = 15000;
const CHUNK_RE = /^~([\w-]{20,})\.(\d+)\.(\d+)\.([\w-]*)$/; // `~h.i.c.r`

export class FileTransfer {
	constructor({ send, cfg = {}, uid = E, gHoldMs = 0 } = {}) {
		this.send = isFn(send) ? send : () => cb(err('p2p_file: transport(send) 未注入'), F); // transport 注入（broadcast 前提・WebSocket 非依存）
		this.uid = uid; // 自分の uid（Q/H/A/G は to 宛先。自宛でなければ feed は false を返し呼び出し側ルータへ）
		this.cfg = { ...DEF_CFG, ...cfg };
		// フック（契約）:
		this.onNeedBody = N; // fn(h10, fromUid) -> Promise<ArrayBuffer | {ab,n?,t?,comp?} | null>（null=nf / throw=busy）
		this.onProgress = N; // fn(h10, receivedBytes, totalBytes)
		this.onFetchDone = N; // fn(h10, ab)
		this.onFetchFail = N; // fn(h10, reason)
		// 内部状態:
		this.queue = []; // 取得キュー {h10,holders,prio,res,rej,cancelled,it}（IN_TRANSFERS=1 直列、§9.3.7）
		this.pend = new Map(); // h10 -> Q 応答待機 {holder, aQ/hQ/aV/hV}（A/H）
		this.in = new Map(); // 受信転送 h10 -> {v:chunk bitmap,...}（§8.5.1 既知転送でなければ chunk 破棄）
		this.out = new Map(); // 送信中 h10 -> {chunks,...}
		this.outDone = new Map(); // 送信完了（G 再送に備え chunks を暫定保持）
		this.gHoldMs = gHoldMs > 0 ? gHoldMs : 30000; // 保持時間（サーバーモードは短縮、低メモリ化 v1.3）
		this.rr = new Map(); // h10 -> holder ラウンドロビン索引（§9.3.2/§9.4）
		this.busyOut = 0; // 同時送信数（OUT_TRANSFERS 上限、超過は busy 応答 §8.6）
		this.active = 0; // 同時取得数（IN_TRANSFERS 上限）
		this.timers = new Set(); // 全タイマ（destroy で解除）
		this.waiters = new Set(); // 待機 promise の rejecter（destroy で解雇）
		this.dead = F;
	}
	// ---- フレーム生成（§8.2 に完全一致。H の n/t は metaFields=呼び出し側提供）----
	static mkQ = (to, h) => JSON.stringify({ ir: 'Q', to, h });
	static mkA = (to, h, st) => JSON.stringify({ ir: 'A', to, h, st }); // st: ok|nf|busy
	static mkG = (to, h, miss) => JSON.stringify({ ir: 'G', to, h, miss });
	static mkHdr = (uid, h, c, m = {}) => JSON.stringify({ ir: 'H', uid, h, n: m.n ?? E, t: m.t ?? E, l: m.l, s: m.s, c });
	static ok = (h10, to) => h10 + (to ? '@' + to : E); // 送信追跡キー（to 無=ブロードキャスト配信は h10 単独）
	static mkChunk = (h, i, c, r) => `~${h}.${i}.${c}.${r}`; // §8.2(b)。~ = ImageRoom 識別接頭辞（ws_chat2 の h.i.c.r との混同回避）
	static parseChunk = s => {
		const m = CHUNK_RE.exec(s);
		return m ? { h: m[1], i: +m[2], c: +m[3], r: m[4] } : N;
	};
	// 受信フレーム供給（§8.5 順序固定）。処理したら true、他（S,T,W,O,C,J,B,M,X…）は false で呼び出し側ルータへ
	feed(d, fromUid = E) {
		if (this.dead || !isStr(d)) return F;
		if (d.charCodeAt(0) === 126) {
			// 1. "~" 始まり → 自アプリ chunk（既知転送でなければ破棄）
			const pc = FileTransfer.parseChunk(d);
			if (pc) cb(this._chunk(pc, fromUid));
			return T;
		}
		let o = N;
		try {
			o = JSON.parse(d);
		} catch {
			return F;
		}
		if (!o || typeof o !== 'object' || typeof o.ir !== 'string') return F; // 3. その他 → 無視
		if (o.to !== undefined && o.to !== this.uid) return F; // to 指定が自分以外 → 呼び出し側も無視してよい
		switch (o.ir) {
			case 'Q':
				cb(this._onQ(o, fromUid));
				return T;
			case 'H':
				cb(this._onH(o, fromUid));
				return T;
			case 'A':
				cb(this._onA(o));
				return T;
			case 'G':
				cb(this._onG(o, fromUid));
				return T;
		}
		return F;
	}
	// 取得 API（IN_TRANSFERS=1 で 1 ファイルずつ直列・FIFO。prio 高 = ユーザー操作優先、§8.6/§9.3.7）
	fetch({ h10, holders = [], prio = 0 }) {
		if (this.dead || !isStr(h10)) return Promise.reject(Error('p2p fetch: invalid'));
		if (this.pend.has(h10) || this.queue.some(q => q.h10 === h10)) return Promise.reject(Error(`p2p fetch: ${h10} 取得済み`)); // 重複要求ガード
		return new Promise((res, rej) => {
			cb(this.queue.push({ h10, holders: holders.slice(), prio, res, rej, cancelled: F }));
			cb(this._pump());
		});
	}
	// 消滅破棄（§9.9）。キュー除去 + 受信中転送破棄 + Q 待機中止
	cancel(h10) {
		for (let i = this.queue.length - 1; i >= 0; i--) {
			const q = this.queue[i];
			if (q.h10 === h10) {
				q.cancelled = T;
				cb(this.queue.splice(i, 1));
				q.rej(Error('cancelled'));
			}
		}
		const it = this.in.get(h10);
		if (it) cb(this._failIn(it, 'cancelled'));
		const p = this.pend.get(h10);
		if (p) cb(this._wake(p, 'a', N), this._wake(p, 'h', N)); // A/H 待機を打ち切り（N = タイアウト扱い）
		return T;
	}
	// ---- 共有 chunk 機構（シート S/T は imgroom 側。ヘッダ JSON は呼び出し側が作り hdr で渡す）----
	// 送信: ヘッダ文字列 hdr（自前構築可）+ chunk 列。gzip は auto（s<l の時 gzip。meta.comp で強制可）
	async startSend({ h10, ab, hdr = N, meta = {}, comp, ack = N, to = E }) {
		if (this.dead || !(ab instanceof ArrayBuffer)) return F;
		const l = gBl(ab);
		let gz = N;
		if (comp !== F) {
			try {
				gz = await Y.c(ab);
			} catch (e) {
				cb(ef(e, 'p2p gzip'));
			}
		}
		const gzed = gz !== N && (comp === T || gBl(gz) < l); // gzip 選択（comp）
		const data = gzed ? gz : ab;
		const s = gBl(data);
		const c = Math.max(1, Math.ceil(s / this.cfg.CHUNK_RAW));
		// §8.4: CHUNK_RAW スライス → Y.u2U。G 再送は同一 chunk を再利用するので事前生成
		const chunks = new Array(c);
		for (let i = 0; i < c; i++) {
			chunks[i] = FileTransfer.mkChunk(h10, i, c, Y.u2U(Y.as(data, i * this.cfg.CHUNK_RAW, Math.min((i + 1) * this.cfg.CHUNK_RAW, s))));
			if (chunks[i].length > MAX_FRAME) return cb(err(`p2p_file: chunk ${i} が ${MAX_FRAME}B 超過（CHUNK_RAW を下げる）`), F); // >15000B 生成禁止
		}
		const hdrStr = hdr ?? FileTransfer.mkHdr(this.uid, h10, c, { n: meta.n, t: meta.t, l, s });
		const k = FileTransfer.ok(h10, to), // 送信中/完了の追跡は要求者単位（配信済み h10 への別 uid の再 Q を握りつぶさない）
			tp = { h10, k, chunks, hdr: hdrStr, ack, last: now() };
		this.out.set(k, tp);
		this.busyOut++;
		cb(this._drive(tp));
		return T;
	}
	// 受信: chunk 到着で完成 → gunzip（s<l）→ h10 検証 → ArrayBuffer 解決。fetch 以外（シート）はこちらを使う
	expectTransfer({ h10, l, s, c, verify = T, rounds = this.cfg.HASH_ROUNDS, fromUid = E }) {
		if (this.dead || this.in.has(h10)) return Promise.reject(Error(`p2p expect: ${h10} 既知`));
		return new Promise((res, rej) => {
			cb(this._regIn({ h10, l, s, c, res, rej, verify, rounds, fromUid }));
		});
	}
	// 全タイマ・転送を解除
	destroy() {
		if (this.dead) return;
		this.dead = T;
		for (const t of this.timers) clearTimeout(t);
		this.timers.clear();
		for (const rb of this.waiters) cb(rb(Error('destroyed')));
		this.waiters.clear();
		for (const it of this.in.values()) cb(it.rej(Error('destroyed')));
		this.in.clear();
		this.pend.clear();
		this.out.clear();
		this.outDone.clear();
		this.rr.clear();
		for (const q of this.queue) cb(q.rej(Error('destroyed')));
		this.queue.length = 0;
	}
	// ---- 内部 ----
	_send(str) {
		if (this.dead) return F;
		if (str.length > MAX_FRAME) return cb(err(`p2p_file: 送出禁止（${str.length} > ${MAX_FRAME}B、§8.4）`), F); // send 前長さチェック
		try {
			return !!this.send(str);
		} catch (e) {
			return cb(ef(e, 'p2p send'), F);
		}
	}
	_w(fn, ms) {
		const t = setTimeout(() => {
			cb(this.timers.delete(t));
			if (!this.dead) cb(fn());
		}, ms);
		cb(this.timers.add(t));
		return t;
	}
	_cw(t) {
		if (t) cb(clearTimeout(t)), this.timers.delete(t);
	}
	_sleep(ms) {
		return new Promise(r => cb(this._w(r, ms)));
	}
	// ms ms 待っても p が解決しなければ N（タイムアウト）。destroy 時は reject で全待機を解雇
	_race(p, ms) {
		return new Promise((res, rej) => {
			const rb = e => {
				this._cw(t);
				rej(e);
			};
			const t = this._w(() => {
				this.waiters.delete(rb);
				res(N);
			}, ms);
			this.waiters.add(rb);
			p.then(
				v => {
					this._cw(t);
					this.waiters.delete(rb);
					res(v);
				},
				e => {
					this._cw(t);
					this.waiters.delete(rb);
					rej(e);
				}
			);
		});
	}
	// ---- 応答側（Q → onNeedBody → A → H + chunks）----
	async _onQ(o, fromUid) {
		const h = o.h;
		if (!isStr(h)) return;
		const k = FileTransfer.ok(h, fromUid); // 重複判定は要求者単位（他 uid への配信済みは自身の転送ではない）
		if (this.out.has(k)) return; // 同一要求者の重複 Q → 進行中送信に任せる
		if (this.outDone.has(k)) return; // 同一要求者への直近完了の再 Q → G で補完させる
		if (this.busyOut >= this.cfg.OUT_TRANSFERS) return cb(this._send(FileTransfer.mkA(fromUid, h, 'busy'))); // 超過分は busy 応答（§8.6）
		let r = N;
		try {
			r = await this.provide(h, fromUid); // 差し出しフック（既定は onNeedBody 委譲）
		} catch (e) {
			cb(ef(e, 'p2p provide'), this._send(FileTransfer.mkA(fromUid, h, 'busy'))); // throw=busy
			return;
		}
		let ab = r,
			meta = {};
		if (r && !(r instanceof ArrayBuffer)) ab = r.ab, meta = r; // {ab,n?,t?,comp?} でヘッダ metaFields を受け取る
		if (!(ab instanceof ArrayBuffer)) return cb(this._send(FileTransfer.mkA(fromUid, h, 'nf'))); // null=保持せず
		// h10 再検証（H.d は素の ArrayBuffer を "[object ArrayBuffer]" 化してハッシュする為 B.u8 必須）
		if (Y.B2U(await H.d(B.u8(ab), this.cfg.HASH_ROUNDS)) !== h) return cb(w(`p2p_file: provide h10 不一致 ${h}`), this._send(FileTransfer.mkA(fromUid, h, 'nf')));
		// A{st:ok} は送信準備（chunk 生成）成功後、パイプライン先頭で送出（§9.3.3: A ok → H → chunks）
		await this.startSend({ h10: h, ab, to: fromUid, meta, comp: meta.comp, ack: FileTransfer.mkA(fromUid, h, 'ok') });
	}
	// Q 受信時にエンジン内部から呼ばれる差し出し（契約署名の provide。onNeedBody = fn(h10, fromUid) へ委譲）
	async provide(h10, fromUid) {
		return this.onNeedBody ? await this.onNeedBody(h10, fromUid) : N;
	}
	async _drive(tp) {
		if (tp.ack) this._send(tp.ack); // A ok はヘッダより先（§8.2/H 前に A）
		if (!this._send(tp.hdr)) cb(this._endOut(tp)); // ヘッダ送出不可なら打ち切り
		else
			for (let i = 0; i < tp.chunks.length && !this.dead; i++) {
				this._send(tp.chunks[i]); // CHUNK_GAP_MS 間隔・OUT_TRANSFERS 上限（Pico 送信バッファ保護 §8.6）
				tp.last = now();
				await this._sleep(this.cfg.CHUNK_GAP_MS);
			}
		cb(this._endOut(tp));
	}
	_endOut(tp) {
		if (!this.out.delete(tp.k)) return; // 多重終了ガード
		this.busyOut--;
		// G 再送に備え chunks を暫定保持（§9.3.4）
		this.outDone.set(tp.k, { chunks: tp.chunks, at: now() });
		this._w(() => this.outDone.delete(tp.k), this.gHoldMs);
	}
	async _onG(o, fromUid) {
		const k = FileTransfer.ok(o.h, fromUid),
			e = this.outDone.get(k) || this.out.get(k);
		if (!e || !isArr(o.miss)) return;
		for (const i of o.miss) {
			const f = e.chunks[i];
			if (f && !this._send(f)) break;
			await this._sleep(this.cfg.CHUNK_GAP_MS);
			if (this.dead) return;
		}
	}
	// ---- 取得側（Q → A → H → chunks → G 再送 → 完成）----
	_pump() {
		while (!this.dead && this.active < this.cfg.IN_TRANSFERS) {
			let bi = -1; // 高 prio 優先・同 prio は FIFO（§9.3.7）
			for (let i = 0; i < this.queue.length; i++) if (bi < 0 || this.queue[i].prio > this.queue[bi].prio) bi = i;
			if (bi < 0) return;
			const q = this.queue.splice(bi, 1)[0];
			this.active++;
			this._fetchOne(q).finally(() => {
				this.active--;
				this._pump();
			});
		}
	}
	async _fetchOne(q) {
		const hs = q.holders,
			st = this.rr.get(q.h10) || 0;
		let why = 'no holders';
		for (let k = 0; k < hs.length && !this.dead && !q.cancelled; k++) {
			const holder = hs[(st + k) % hs.length]; // h10 ごとのラウンドロビン（§9.3.2/§9.4）
			const r = await this._attempt(q, holder).catch(e => ({ why: e.message }));
			if (r.ab) {
				this.rr.set(q.h10, (st + k + 1) % hs.length); // 次回は別 holder から（集中回避）
				return cb(q.res(r.ab), this.onFetchDone && this.onFetchDone(q.h10, r.ab));
			}
			why = r.why;
			if (r.nf) continue; // nf は即次候補（§9.4）
			await this._sleep(Math.max(50, this.cfg.REQ_TIMEOUT >> 2)); // busy/途絶は短クールダウン後次候補
		}
		if (hs.length) this.rr.set(q.h10, (st + 1) % hs.length);
		const e = Error(`p2p fetch ${q.h10} 失敗: ${why}`);
		cb(w(e.message), q.rej(e), this.onFetchFail && this.onFetchFail(q.h10, why));
	}
	async _attempt(q, holder) {
		const h10 = q.h10,
			p = { holder, aQ: [], hQ: [] }; // A/H deferred（p.aV / p.hV に解決値）
		this.pend.set(h10, p);
		this._send(FileTransfer.mkQ(holder, h10));
		try {
			const a = await this._race(this._take(p, 'a'), this.cfg.REQ_TIMEOUT); // A 待ち REQ_TIMEOUT
			if (a === N) return { why: `${holder}: A なし（REQ_TIMEOUT）` };
			if (a.st === 'nf') return { why: `${holder}: nf`, nf: T };
			if (a.st !== 'ok') return { why: `${holder}: ${a.st}` };
			const h = await this._race(this._take(p, 'h'), this.cfg.REQ_TIMEOUT); // H 待ち（同時に bitmap 登録済み）
			if (!h) return { why: `${holder}: H ヘッダなし/不正` };
			if (this.dead || q.cancelled) throw Error('cancelled');
			// v2.17 §44: chunk 収集の全体上限はチャンク数（＝ファイルサイズ）に比例させる。
			// 送出は CHUNK_GAP_MS 間隔（既定 100ms/chunk）なので 2MB でも 18s 固定では途中で落ちた。
			// 実停止は per-transfer の STALL ウォッチドッグ（フレーム到着で再武装、§8.6）が見るため、
			// ここは中継マージン 60ms/chunk を加えたサイズ比例値とする
			const it0 = p.it,
				budget = this.cfg.REQ_TIMEOUT + this.cfg.STALL_MS + (it0.c || 0) * (this.cfg.CHUNK_GAP_MS + 60);
			const ab = await this._race(it0.itP, budget);
			if (!(ab instanceof ArrayBuffer)) throw Error('転送破棄');
			return { ab };
		} finally {
			if (this.pend.get(h10) === p) this.pend.delete(h10);
			const it = p.it;
			if (it && !it.done) cb(this._failIn(it, 'abandoned')); // 途中受信は破棄（§8.6 ウォッチドッグ）
		}
	}
	_take(p, k) {
		return p[k + 'V'] !== undefined ? Promise.resolve(p[k + 'V']) : new Promise(r => p[k + 'Q'].push(r));
	}
	_wake(p, k, v) {
		if (p[k + 'V'] !== undefined) return;
		p[k + 'V'] = v;
		const qs = p[k + 'Q'];
		p[k + 'Q'] = [];
		for (const r of qs) cb(r(v));
	}
	_onA(o) {
		const p = this.pend.get(o.h);
		if (p) cb(this._wake(p, 'a', { st: o.st }));
	}
	_onH(o, fromUid) {
		const p = this.pend.get(o.h);
		if (!p || p.holder !== fromUid || p.it) return; // Q 送信先の応答のみ受理・重複 H 無視
		// H 到着と同一ティックで bitmap を登録する（直後の先頭 chunk を取りこぼさないため）
		if (!(o.c >= 1) || !(o.s >= 0)) return cb(this._wake(p, 'h', N)); // H ヘッダ不正 → 打ち切り
		const it = { h10: o.h, l: o.l ?? o.s, s: o.s, c: o.c, v: new Array(o.c), got: 0, bytes: 0, retry: 0, fromUid, done: F, verify: T, rounds: this.cfg.HASH_ROUNDS, res: N, rej: N };
		it.itP = new Promise((res, rej) => {
			it.res = res;
			it.rej = rej;
		});
		this.in.set(o.h, it);
		p.it = it;
		this._arm(it);
		cb(this._wake(p, 'h', { l: o.l, s: o.s, c: o.c }));
	}
	_regIn(d) {
		// 呼び出し側(expectTransfer)の resolve/reject をそのまま使う（別 Promise を作ると outer が永不解決になる）
		const it = { h10: d.h10, l: d.l ?? d.s, s: d.s, c: d.c, v: new Array(d.c), got: 0, bytes: 0, retry: 0, fromUid: d.fromUid, done: F, verify: d.verify ?? T, rounds: d.rounds ?? this.cfg.HASH_ROUNDS, res: d.res, rej: d.rej };
		if (d.q) d.q.it = it;
		this.in.set(it.h10, it);
		this._arm(it);
		return it;
	}
	_arm(it) {
		this._cw(it.stall); // ウォッチドッグ: 同一転送相手から STALL_MS 以上フレームが途絶えたら打鍵（§8.6）
		it.stall = this._w(() => this._stall(it), this.cfg.STALL_MS);
	}
	_chunk(pc, fromUid) {
		const it = this.in.get(pc.h); // 既知転送でなければ破棄（§8.5.1）
		if (!it || it.done) return;
		if (pc.i < it.c && !it.v[pc.i]) {
			let u = N;
			try {
				u = Y.U2u(pc.r);
			} catch (e) {
				cb(w('p2p_file: chunk b64u 不正', pc.h, pc.i));
			}
			if (u) it.v[pc.i] = u, it.got++, it.bytes += u.byteLength;
		}
		this._arm(it); // フレーム到着でウォッチドッグ更新
		if (this.onProgress) cb(this.onProgress(it.h10, it.bytes, it.s));
		if (it.got >= it.c) cb(this._complete(it));
	}
	async _complete(it) {
		if (it.done) return;
		it.done = T;
		this._cw(it.stall);
		let ab = Y.jus(it.v).buffer; // chunk 結合（gzip 時は圧縮バイト）
		if (it.s < it.l) ab = await Y.d(ab); // gunzip（s<l の時、§9.3.4。gzip 時は必ず s<l）
		// 伸長後の h10 検証（gzip 展開結果は ArrayBuffer → B.u8 必須、上記と同理由。不一致は破棄 §9.3.4）
		if (it.verify && Y.B2U(await H.d(B.u8(ab), it.rounds)) !== it.h10) return cb(this._failIn(it, 'h10 検証不一致'));
		if (this.in.get(it.h10) === it) this.in.delete(it.h10);
		cb(it.res(ab));
	}
	_stall(it) {
		if (it.done || this.dead) return;
		const miss = [];
		for (let i = 0; i < it.c; i++) if (!it.v[i]) miss.push(i);
		// G 再送要求は MAX_RETRY 回まで（§9.3.4）。全 chunk 欠落時は再送しても無意味なので即破棄
		if (miss.length < it.c && it.got > 0 && it.retry < this.cfg.MAX_RETRY) {
			it.retry++;
			this._send(FileTransfer.mkG(it.fromUid, it.h10, miss));
			return this._arm(it);
		}
		// §8.6: 破棄してキュー再登録→別保持者（fetch ループが次 holder へ進む）
		cb(this._failIn(it, `途絶（STALL_MS。欠落 ${miss.length}/${it.c}）`));
	}
	_failIn(it, why) {
		if (it.done) return;
		it.done = T;
		this._cw(it.stall);
		if (this.in.get(it.h10) === it) this.in.delete(it.h10);
		for (let i = 0; i < it.c; i++) it.v[i] = N; // bitmap 放棄（メモリ解放）
		if (it.rej) cb(it.rej(Error(why)));
	}
}
