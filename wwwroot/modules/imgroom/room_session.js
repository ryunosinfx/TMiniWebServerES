/** @module modules/imgroom/room_session.js @version 0.1.0 @see docs/img_room_spec.md */
// RoomSession — ImageRoom の部屋セッション単一化（仕様 §6.1/§6.2/§6.6〜§6.9, §8.2/§8.3, §9.1/§9.7/§9.12）。
// オーナータブ選出: StoreTX 排他ロック 'room.<rid>' を long-running 所有（fn が settle する/タブが閉じるまで保持）。
// 　オーナー: WS 接続・フレーム実送信・room.json/history.json 書込・採決・参加者表更新の担当。
// 　ミラータブ: WS を開かず BC `imgroom.session.<rid>` の状態スナップショットで state/イベントを再現。
// 　操作（sendFrame/login/leave）は BC 経由でオーナーへ委譲。ロック引き取りで takeover→同一 uid 自動再参加（§9.12）。
import { Y, ef, T, F, N } from '../../Y.js';
import { OPFS } from '../../OPFS.js';
import { WSClient } from '../ws_client.js';
import { StoreTX } from '../store_tx.js';
import { AuthChallenge } from '../auth_challenge.js';
import { STORAGE, wsUrl } from './ir_const.js';
import { Protocol } from './ir_protocol.js';

const MONTH_MARGIN_MS = 5000; // 月境界タイマの余裕（翌月 UTC 0 時+offset、タスク指示）
const OWN_WAIT_MS = 800; // 所有者選出確定待ち（login 前に owner/mirror を確定させる）
const LG_REPLY_MS = 20000; // ミラー→オーナー login 委譲の応答待ち
const MODES = ['normal', 'sync', 'server'];

export class RoomSession {
	constructor({ rid, room, uid, mode, settings, transfer } = {}) {
		if (!rid || !uid) throw new Error('room_session: rid/uid required');
		this.rid = rid;
		// 部屋設定（room.json と同形、§6.1）。pw/pwSalt はオーナーが OPFS からロードして上書き
		this.room = Object.assign({ nm: '', pw: '', pwSalt: '', srvOn: F, cr: '', cg: 0, xorig: F, oa: [] }, room || {});
		this.uid = uid;
		this.mode = MODES.includes(mode) ? mode : 'normal';
		this.settings = settings; // AppSettings（静的クラス注入）
		this.transfer = transfer; // FileTransfer（open 時に feed 接続）
		this.jGen = 0; // J フレームの gen（§9.7 再接続時 gen++。roomLogin 状態に永続化）
		this.onFrame = N; // 追加フック（契約外・報告済み）: データ系フレーム (M/S/T/X) のモジュールへの配線
		this.lastWarn = N; // xorig 不一致 C など「警告表示」用（UI が lastWarn を参照、§6.6/§8.3）
		this._st = { online: F, authed: F, participants: [], mode: this.mode, mirror: T };
		this._ev = new Map();
		this._seenA = new Set(); // 処理済み anonce（メンバー側・セッション中保持、§6.2）
		this._login = N; // 参加側の採決待ち {anonce, need:Set, got:Set, tries, res}
		this._pw = this.room.pw || ''; // 自分の保管 seedSaltedHash（§6.2 検証 3。room.json 由来）
		this._pwSalt = this.room.pwSalt || '';
		this._hist = N; // history.json メモリコピー（オーナーのみ読書）
		this._yieldLock = N; // 所有権放棄フック（run の fn プロミスを settle する）
		this._releasing = F; // 自発の StoreTX.release は AbortError を無視する
		this._owner = F;
		this._ownerP = N; // オーナー就任解決 {res}（login 前の待ち合わせ）
		this._loggedOut = F; // プロファイル全体ログアウト標識（takeover 時の自動再参加を抑止、§9.12）
		this._cDiff = F; // 自記録と cr/pw の異なる C を受理済み（§6.9 の競合判定材料）
		this._lastFail = N;
		this._histT = N;
		this._reauthPending = F;
		this._hadSession = F; // 他オーナーのスナップショットでセッションを見たことがある（takeover 判定）
		this._monthT = N;
		this._wT = N; // REQ_TIMEOUT 採決タイマ（1 回だけ W 再送、§6.2）
		this._bc = N;
		this.ws = N;
		this._origCache = new Map(); // origin 文字列 -> {ho,hor}（採決のオリジン検証キャッシュ）
		this._lgPend = new Map(); // ミラー側の login 委譲待機 id -> {res, timer}
		this._start();
	}
	// ---- 契約アクセサ ----
	get state() {
		return this._st;
	}
	on(evt, fn) {
		if (!this._ev.has(evt)) this._ev.set(evt, new Set());
		this._ev.get(evt).add(fn);
		return this;
	}
	off(evt, fn) {
		const s = this._ev.get(evt);
		if (s) s.delete(fn);
		return this;
	}
	// 処理済み anonce 判定（メンバー側、§6.2）。初出なら false を返し記録、再出なら true
	seenAnonce(s) {
		if (!s) return T;
		const has = this._seenA.has(s);
		this._seenA.add(s);
		return has;
	}
	// フレーム送出。オーナーは ws.chat で実送信、ミラーは BC 経由でオーナーへ中継（§9.12）。
	// 認証前に送出可は W（と採決応答 O、C は設定更新経路）のみ（§6.1/§8.2）
	sendFrame(o) {
		let s,
			ir;
		if (typeof o === 'string') {
			s = o;
			if (o[0] === '~') ir = '~'; // chunk フレーム（transfer.send 注入経由、§8.2(b)）
			else {
				const p = Protocol.parse(o);
				ir = p && p.ir;
			}
		} else {
			ir = o && o.ir;
			s = ir ? Protocol.mk(ir, this._rest(o)) : N;
		}
		if (!s || !ir) return F;
		if (!this._st.authed && ir !== 'W' && ir !== 'O' && ir !== 'C') return F; // 認証前送出可は W/O（O 採決応答）と C 設定（§8.2）
		if (this._owner) return this._wsSend(s);
		this._bcPost({ t: 'f', s }); // ミラー → オーナー実送信へ中継
		return T;
	}
	// 過去参加者一覧（§5.7/§9.12 history.json、オーナーのみ読）。{uid: {t:最終観測, n:参加回数}}
	history() {
		if (!this._owner) return Promise.resolve(this._hist || N);
		return this._readHist();
	}
	// 追加 API（契約外・報告済み）: 作成者専用の部屋設定更新。C を cg++ で broadcast + room.json 永続化（§8.3/§6.8/§6.6）
	updateSettings(patch = {}) {
		if (!this._owner || this.room.cr !== this.uid) return F;
		const c = {
			rid: this.rid,
			pw: patch.pw !== undefined ? patch.pw : this._pw,
			cr: this.room.cr,
			cg: (this.room.cg || 0) + 1,
			xorig: !!this.room.xorig, // xorig は作成後変更不可（§6.6）
			oa: patch.oa !== undefined ? patch.oa : this.room.oa || [],
			srvOn: patch.srvOn !== undefined ? !!patch.srvOn : !!this.room.srvOn,
		};
		this._onC(c); // 自分の C（作成者再発行）で room.json 更新（§8.3。cg++ 済みなので整合経路をそのまま通す）
		return this.sendFrame(Protocol.mk('C', c));
	}
	// ---- 内部: イベント/スナップショット ----
	_emit(evt, data) {
		const s = this._ev.get(evt);
		if (s) s.forEach(fn => {
			try {
				fn(data, this.rid);
			} catch (e) {
				ef(e, 'room_session.on.' + evt);
			}
		});
	}
	_rest(o) {
		const r = {};
		for (const k in o) if (k !== 'ir') r[k] = o[k];
		return r;
	}
	_snap() {
		// オーナー: BC へ状態スナップショット配信（§9.12 ミラーはこれで描画）
		if (this._owner) this._bcPost({ t: 'snap', s: { online: this._st.online, authed: this._st.authed, participants: this._st.participants.map(x => ({ uid: x.uid, t: x.t, md: x.md })), mode: this._st.mode } });
	}
	_applySnap(sn) {
		if (this._owner || !sn) return;
		const prevAuth = this._st.authed,
			prevOn = this._st.online;
		this._st.mirror = T;
		this._st.online = !!sn.online;
		this._st.authed = !!sn.authed;
		this._st.mode = sn.mode || this._st.mode;
		if (sn.online || sn.authed) this._hadSession = T;
		if (!this._mirrorAnnounced) {
			this._mirrorAnnounced = T;
			this._emit('mirror', N); // このタブがミラーであることの初回通知（契約イベント）
		}
		this._st.participants = (sn.participants || []).map(x => ({ uid: x.uid, t: x.t, md: x.md }));
		if (prevOn !== this._st.online) this._emit(this._st.online ? 'open' : 'close', N);
		if (!prevAuth && this._st.authed) this._emit('authOk', N);
		this._emit('participants', this._st.participants);
	}
	// ---- 内部: BC（imgroom.session.<rid>）----
	_start() {
		try {
			if (typeof BroadcastChannel !== 'undefined') {
				this._bc = new BroadcastChannel('imgroom.session.' + this.rid);
				this._bc.onmessage = ev => this._onBC(ev.data);
			}
		} catch (e) {
			ef(e, 'room_session.bc');
		}
		this._claim();
	}
	_bcPost(m) {
		if (this._bc) try {
			this._bc.postMessage(m);
		} catch (e) {
			ef(e, 'room_session.bcPost');
		}
	}
	_onBC(m) {
		if (this._dead) return; // v1.3.1: dispose 後の幽霊発火防止
		if (!m || typeof m !== 'object') return;
		switch (m.t) {
			case 'snap':
				this._applySnap(m.s);
				break;
			case 'off': // オーナーがログアウト（いずれかのタブの leave）。プロファイル全体で未接続表示（§9.12）
				this._loggedOut = T;
				if (m.r === 'monthExpire') this._emit('monthExpire', N); // §6.7 波及
				else if (m.r === 'srvOff') this._emit('srvOff', N); // §6.8 波及
				this._st.authed = F;
				this._st.online = F;
				this._st.participants = [];
				this._emit('close', N);
				this._emit('participants', this._st.participants);
				break;
			case 'f': // ミラーからのフレーム中継 → オーナーが実送信
				if (this._owner && typeof m.s === 'string') this._wsSend(m.s);
				break;
			case 'leave': // ミラーの leave 要求 → オーナーがleave()
				if (this._owner) this.leave();
				break;
			case 'req': // 新規ミラータブへのスナップショット即時配信
				this._snap();
				break;
			case 'lg': // ミラーの login 委譲（§9.12: オーナーが WS を持つ）
				if (this._owner) this.login(m.a || {}).then(ok => this._bcPost({ t: 'lgr', id: m.id, ok: !!ok, reason: this._lastFail })).catch(() => this._bcPost({ t: 'lgr', id: m.id, ok: F, reason: 'msg.auth.fail' }));
				break;
			case 'lgr': {
				const w = this._lgPend.get(m.id);
				if (w) {
					clearTimeout(w.timer);
					this._lgPend.delete(m.id);
					if (m.reason) this._lastFail = m.reason;
					w.res(!!m.ok);
				}
				break;
			}
			default:
				break;
		}
	}
	// ---- 内部: 所有者選出（StoreTX 'room.<rid>' を long-running 所有、§9.12/§11.1）----
	// run 内 fn は settle するまで解決しない → このタブがオーナー就任。他タブが保持中なら pending（=ミラー）。
	// StoreTX.release() では run の Promise が AbortError reject（契約報告済み）→ catch 必須。
	_claim() {
		StoreTX.run('room.' + this.rid, () => new Promise(res => {
			this._yieldLock = res;
			this._onAcquired();
		}))
			.then(() => {
				if (this._owner) this._lose(F); // fn settle（leave/dispose の自発放棄）
			})
			.catch(e => {
				// AbortError: release() 由来（自発）or ハートビート失効由来。いずれも権喪失として扱う
				if (!e || (e.name !== 'AbortError' && !this._releasing)) ef(e, 'room_session.lock.' + this.rid);
				if (this._owner) this._lose(T);
			});
	}
	_onAcquired() {
		const wasMirror = !!this._hadSession; // 他タブのセッション（online/authed スナップショット）を見ていた → 引き取り
		this._owner = T;
		this._st.mirror = F;
		this._mirrorAnnounced = F; // 以後ロック喪失→再ミラー化で 'mirror' 再発火可
		this._loggedOut = F; // 新しいセッション権を得た。以後の自動再参加判定は roomLogin/conflict に委ねる
		if (this._ownerP) {
			const op = this._ownerP;
			this._ownerP = N;
			op.res && op.res(T);
		}
		this._loadRoom().catch(e => ef(e, 'room_session.loadRoom.' + this.rid));
		if (wasMirror) {
			// §9.12 所有者タブ閉鎖: 引き取りタブが同一 uid で自動再参加（pwSalt 有効期間内のみ）
			this._emit('takeover', N);
			this.rejoin().catch(e => ef(e, 'room_session.takeoverRejoin.' + this.rid));
		}
		this._snap();
	}
	_lose(aborted) {
		this._owner = F;
		this._st.mirror = T;
		this._yieldLock = N;
		if (this.ws) {
			try {
				this.ws.close();
			} catch (e) {
				ef(e, 'room_session.wsClose');
			}
			this.ws = N;
		}
		this._clearTimers();
		this._st.online = F;
		if (!aborted) { // 自発放棄（leave 由来）: 認証状態もここでリセット済み。他タブが新オーナーになる
			this._st.authed = F;
			this._st.participants = [];
			this._emit('close', N);
			this._emit('participants', this._st.participants);
		}
		// aborted（外部由来の権喪失）はミラーとしてスナップショット追随
	}
	// login 前にオーナー/mirror を確定させる（fresh profile なら即オーナー、他タブ所有なら mirror 確定）
	_waitOwner(ms = OWN_WAIT_MS) {
		if (this._owner) return Promise.resolve(T);
		return new Promise(res => {
			let done = F;
			const fin = v => {
				if (done) return;
				done = T;
				clearTimeout(tm);
				res(v);
			};
			this._ownerP = { res: fin };
			const tm = setTimeout(() => {
				this._ownerP = N;
				fin(!!this._owner);
			}, ms);
		});
	}
	// ---- 内部: WS（オーナーのみ）----
	_startWs() {
		if (this.ws) return this.ws.connect();
		this.ws = new WSClient({ url: wsUrl(this.rid), userId: this.uid });
		this.ws.onOpen = () => this._onWSOpen();
		this.ws.onClose = o => this._onWSClose(o);
		this.ws.onMessage = d => this._onWSMsg(d);
		return this.ws.connect();
	}
	_wireTransfer() {
		// transfer 接続は ws.onMessage 経由（Q/H/A/G と ~chunk は生文字列のまま transfer.feed）
		if (this.transfer && this.transfer.onNeedBody === N) this.transfer.onNeedBody = () => Promise.resolve(N);
	}
	_onWSOpen() {
		this._wireTransfer(); // open 時に transfer 接続（受信 feed は onMessage 経由。onNeedBody 既定のみ注入）
		this._st.online = T;
		this._emit('open', N);
		this._snap();
		// §9.7 再接続時: room.json の seedSaltedHash で再認証 → J（gen++）→ 差分同期
		if (this._reauthPending) {
			this._reauthPending = F;
			this._reauth().catch(e => ef(e, 'room_session.reauth.' + this.rid));
		}
	}
	_onWSClose(o) {
		this._st.online = F;
		if (o && o.intentional) return; // leave() 由来
		this._reauthPending = this._st.authed; // 認証済みセッションの予期せぬ切断 → open 時に再認証
		this._emit('close', N);
		this._snap();
	}
	_wsSend(s) {
		return !!this.ws && this.ws.chat(s);
	}
	_onWSMsg(raw) {
		if (typeof raw !== 'string' || !raw) return;
		let env;
		try {
			env = JSON.parse(raw); // サーバ中継 envelope {cmd,userId,msg}（§8.1 既存 ws_chat 互換）
		} catch {
			return; // 「◯◯さんが入室しました」等の非 JSON 中継は無視
		}
		// サーバ中継 envelope: 送出 {cmd,userId,msg} → 中継は {userId,msg}(cmd は除去、SampleServer Chat.chat)。
		// 人間向け入室アナウンス等の非 JSON msg は後段の parse/feed で自然に破棄される。
		if (!env || typeof env !== 'object' || (env.cmd !== 'C' && env.cmd !== undefined) || typeof env.msg !== 'string') return;
		const from = env.userId;
		if (!from || from === this.uid) return; // 同一 uid（他タブ含む自タブ由来）のエコーは無視。状態は送信中に自前適用
		if (this._feedTransfer(env.msg, from)) return; // Q/H/A/G/~chunk は transfer.feed
		const p = Protocol.parse(env.msg);
		if (!p) return;
		this._onFrame(p, from);
	}
	// p2p_file エンジンへ渡すフレームなら feed（認証前ならデータ系は受理しない、§6.1/§8.2）
	_feedTransfer(msg, from) {
		if (!this.transfer) return F;
		const isChunk = msg[0] === '~';
		if (!isChunk) {
			const p = Protocol.parse(msg);
			if (!p || !Protocol.isP2P(p.ir)) return F;
		}
		if (!this._st.authed) return T; // 認証前のデータフレームは破棄（§6.1。feed せず消費のみ）
		try {
			this.transfer.feed(msg, from);
		} catch (e) {
			ef(e, 'room_session.feed');
		}
		return T;
	}
	// ---- 認証: login（参加側。W 送出→全オンライン既存メンバー OK で成功、§6.2）----
	async login({ password, seed, salt, mode, uid } = {}) {
		await this._waitOwner();
		if (!this._owner) return this._delegateLogin({ password, seed, salt, mode, uid }); // ミラーはオーナーへ委譲（§9.12）
		this._loggedOut = F;
		if (uid && uid !== this.uid) {
			if (this.ws || this._st.online) return this._fail('msg.auth.fail'); // ログイン中の別 uid はログアウト後（§9.12）
			this.uid = uid;
		}
		const m = MODES.includes(mode) ? mode : this.mode;
		await this._loadRoom();
		if (m === 'server' && this.room.srvOn !== T && this.room.srvOn !== true) return this._fail('msg.auth.srvDisabled'); // §6.8（room.json ロード後の実効設定で判定）
		// seed の決定優先度: 引数 seed > 平文 password からの再計算 > room.json 保管値（再参加、§6.2/§6.7）
		let s = seed || N,
			sl = salt || N;
		// 修正: seed の塩は常に月塩（保管 seed と検証側 seed を一致させる）。server モードの日付塩は採決 W/at の使い捨て塩のみ（§6.8）
		if (!sl) sl = m === 'server' ? AuthChallenge.saltServer() : AuthChallenge.saltNormal();
		if (m === 'server' && !/^\d{8}$/.test(sl)) sl = AuthChallenge.saltServer();
		const sSalt = m === 'server' ? AuthChallenge.saltNormal() : sl;
		if (!s) {
			if (password) s = await this._seedOf(password, sSalt);
			else if (this._pw && this._pwSalt === sSalt) s = this._pw; // 自動再参加は保管 seed（§9.12）
			else return this._fail('msg.auth.fail');
		}
		this._mode = m;
		// 作成者の初回参加は採決不要（§5.3 作成処理で設定確立、§6.2 注記）: room.json の cr==自 uid かつ既存メンバー 0
		// （保管 pw をまだ読んでいない作成直後でも確立できるよう _pw 未読は許容。cr==uid が作成者特権の根拠、§6.2）
		if (!this._st.participants.filter(x => x.uid !== this.uid).length && this.room.cr === this.uid && (!this._pw || s === this._pw)) {
			this._pwSalt = sl;
			await this._startWs(); // 作成者も ws 参加が必須（C/J/M の broadcast 経路。§8.3/§6.2）
			if (!this._st.online) return this._fail('msg.offline');
			return this._authOk(s, sl, m);
		}
		await this._startWs();
		if (!this._st.online) return this._fail('msg.offline');
		const need = this._st.participants.filter(x => x.uid !== this.uid).map(x => x.uid); // 既知 roster（J 見逃しは採決 O と W 時の J 再告知で補充、§6.2）
		const origin = location.origin,
			{ ho, hor } = await AuthChallenge.originHashes(origin, this._rounds()),
			an = AuthChallenge.newAnonce(),
			at = await AuthChallenge.at({ ho, seed: s, hor, uid: this.uid, salt: sl, anonce: an }, this._rounds());
		return new Promise(res => {
			this._login = { anonce: an, need: new Set(need), got: new Set(), seed: s, salt: sl, mode: m, res };
			this._sendW({ mode: m, salt: sl, anonce: an, ho, hor, at });
			this._armVoteTimer();
		});
	}
	_sendW({ mode, salt, anonce, ho, hor, at }) {
		this._wsSend(Protocol.mk('W', { uid: this.uid, mode, salt, anonce, ho, hor, at })); // 認証前に送出可は W（§8.2）
	}
	// §6.2 応答管理: REQ_TIMEOUT 以内に未応答なら W を 1 回再送。以後も未応答なら不 OK 扱い（再試行可）
	_armVoteTimer() {
		const to = (this.settings && this.settings.cfg && this.settings.cfg.REQ_TIMEOUT) || 8000;
		this._wT = setTimeout(() => {
			this._wT = N;
			const lg = this._login;
			if (!lg) return;
			if (!lg.sent2) {
				lg.sent2 = T;
				const w = { uid: this.uid, mode: lg.mode, salt: lg.salt, anonce: lg.anonce };
				AuthChallenge.originHashes(location.origin, this._rounds())
					.then(({ ho, hor }) => AuthChallenge.at({ ho, seed: lg.seed, hor, uid: this.uid, salt: lg.salt, anonce: lg.anonce }, this._rounds()).then(at => ({ ho, hor, at })))
					.then(({ ho, hor, at }) => this._sendW({ ...w, ho, hor, at }))
					.catch(e => ef(e, 'room_session.wResend'));
				this._armVoteTimer();
				return;
			}
			this._failLogin(lg.got.size ? 'msg.auth.fail' : 'msg.auth.noMember'); // 未応答メンバーを不 OK 扱い（§6.2）。応答 0 名=既存メンバー不在
		}, to);
	}
	_onVoteO(o, from) {
		const lg = this._login;
		if (!lg || o.anonce !== lg.anonce || (o.to && o.to !== this.uid)) return; // 他セッションの採決
		lg.need.add(from); // O 着信そのものが from の既存メンバー証明（§6.2。J 見逃しでも採決対象に合流）
		if (lg.got.has(from)) return;
		lg.got.add(from);
		if (o.ok !== T) {
			this._failLogin(this._cDiff ? 'msg.room.recreated' : 'msg.auth.fail'); // 1名でも ok=false（§6.2）。§6.9 後発側
			return;
		}
		if (lg.got.size && [...lg.need].every(u => lg.got.has(u))) {
			if (this._wT) {
				clearTimeout(this._wT);
				this._wT = N;
			}
			const ok = lg;
			this._login = N;
			this._authOk(ok.seed, ok.salt, ok.mode).then(r => ok.res(r), () => ok.res(F));
		}
	}
	_failLogin(reason) {
		if (this._wT) {
			clearTimeout(this._wT);
			this._wT = N;
		}
		const lg = this._login;
		this._login = N;
		if (lg) lg.res(F);
		this._fail(reason);
	}
	_fail(reason) {
		this._lastFail = reason;
		this._emit('authFail', reason);
		// §6.9 競合判定（後発ログイン）: 旧作成者の room.json と異なる設定の C を受理済みで採決 NOK →
		// conflict:true 保存 + 「別の管理者が部屋を立ち上げているようです」（msg.conflict.blocked / msg.room.recreated）
		if (this._cDiff && this.room.cr === this.uid) {
			this._markConflict();
			this._emit('conflict', { type: 'recreated', by: this.room.cr });
		}
		return F;
	}
	// 採決全 OK → authOk: J broadcast + room.json 更新（pw=seed/pwSalt=salt、§6.7 更新保存）+ roomLogin 保存（§9.12）
	async _authOk(seed, salt, mode) {
		this._pw = seed;
		this._pwSalt = /^\d{8}$/.test(salt) ? AuthChallenge.saltNormal() : salt; // 保管 pw の seed 塩は常に月塩（server 日付塩は採決のみ）
		this.mode = mode;
		this._st.mode = mode;
		this._st.authed = T;
		this._cDiff = F;
		const rl = await this._roomLogin();
		if (rl && rl.gen > this.jGen) this.jGen = rl.gen;
		this.jGen++;
		await this._saveRoom(seed, salt);
		await this._setRoomLogin({ uid: this.uid, mode, ts: Date.now(), gen: this.jGen });
		this._histTouch(this.uid, T);
		const cfg = (this.settings && this.settings.cfg) || {};
		this.sendFrame(Protocol.mk('J', { uid: this.uid, gen: this.jGen, grid: [cfg.GRID_COLS || 4, cfg.GRID_ROWS || 8], md: this.mode }));
		this._touchParticipant(this.uid, Date.now(), this.mode);
		this._armMonth();
		this._emit('authOk', N);
		this._snap();
		return T;
	}
	// §9.12 自動再参加: state.roomLogin.<rid> 保持時、pwSalt が有効期間内なら保管 seed で再参加
	async rejoin() {
		if (this._st.authed) return T;
		if (!this._owner) {
			await this._waitOwner();
			if (!this._owner) return this._st.authed; // 他タブがセッション保有（§5.1 ログイン済み表示）
		}
		if (this._loggedOut) return F;
		const rl = await this._roomLogin();
		if (!rl || rl.uid !== this.uid) return F;
		await this._loadRoom();
		if (this.room.conflict) return F; // §6.9 conflict 保存時は自動再参加禁止
		const m = MODES.includes(rl.mode) ? rl.mode : 'normal';
		if (m === 'server') {
			if (this.room.srvOn !== T && this.room.srvOn !== true) return F; // §6.8: srvOn false 間は自動再参加しない
			if (!/^\d{8}$/.test(this._pwSalt || '')) return F; // 参加日 salt（§6.7）。pwSalt 期間内=参加日ソルトで再計算可
			return this.login({ seed: this._pw, salt: this._pwSalt, mode: m, uid: rl.uid });
		}
		const nowSalt = AuthChallenge.saltNormal();
		if (this._pwSalt !== nowSalt) return F; // 過去月なら自動再参加不可（§6.7）。roomLogin は残すが再認証要
		return this.login({ seed: this._pw, salt: nowSalt, mode: m, uid: rl.uid });
	}
	// §9.7 再接続時再認証（room.json の seedSaltedHash で採決参加 → J gen++）
	async _reauth() {
		const rl = await this._roomLogin();
		if (!rl || this.room.conflict) return F;
		const m = this._st.mode;
		if (m === 'server') {
			if (this.room.srvOn !== T && this.room.srvOn !== true) {
				this._emit('srvOff', N);
				this.leave('srvOff');
				return F;
			}
			return this.login({ seed: this._pw, salt: this._pwSalt, mode: m });
		}
		const sl = AuthChallenge.saltNormal();
		if (this._pwSalt !== sl) {
			// 再接続までに月境界を跨いだ → 強制ログアウト扱い（§6.7）
			this._emit('monthExpire', N);
			this.leave('monthExpire');
			return F;
		}
		return this.login({ seed: this._pw, salt: sl, mode: m });
	}
	// ログアウト（いずれかのタブ → プロファイル全体、§9.12）。LEAVE+state 消+transfer 停止+StoreTX.release
	// reason（内部引数）: 'monthExpire'/'srvOff' 等を BC off で波及し各タブで同イベントを発火
	leave(reason) {
		if (this._owner) {
			if (this._st.authed && this.ws) this._wsSend(Protocol.mk('B', { uid: this.uid })); // 退出告知（§8.2）
			if (this.ws) try {
				this.ws.leave(); // LEAVE 送信後 close（WSClient）
			} catch (e) {
				ef(e, 'room_session.wsLeave');
			}
			this._bcPost({ t: 'off', r: reason || N });
		} else {
			this._bcPost({ t: 'leave' }); // オーナーに委譲。ローカルも下で未接続化
		}
		this._loggedOut = T;
		this._loginCancel();
		if (this.settings) {
			try {
				this.settings.setState('roomLogin.' + this.rid, N);
				this.settings.flush().catch(() => {});
			} catch (e) {
				ef(e, 'room_session.state');
			}
		}
		this._haltTransfer();
		this._clearTimers();
		this._st.authed = F;
		this._st.online = F;
		this._st.participants = [];
		this._seenA.clear();
		this._reauthPending = F;
		this._emit('close', N);
		this._emit('participants', this._st.participants);
		if (this._owner) {
			this._releasing = T; // 自発 release の AbortError は権喪失扱いしない（_claim の catch）
			try {
				StoreTX.release('room.' + this.rid);
			} catch (e) {
				ef(e, 'room_session.release');
			}
			this._releasing = F;
			this._yieldLock && this._yieldLock(); // run の fn を settle させ権を明釈する（release と二重でも安全）
		}
	}
	// 完全破棄（leave() 後に呼ぶ前提、v1.3.1 中間チェック C1）。BroadcastChannel・イベント購読・
	// transfer 参照を解き、セッショングラフ全体（collection.metas 等）の永久保持を防ぐ。
	// leave で postMessage 済みの BC メッセージは配送させるため onmessage は即無効化しつつ close は次 tick。
	destroy() {
		if (this._dead) return;
		this._dead = T;
		this._loginCancel();
		this._clearTimers();
		if (this._histT) {
			clearTimeout(this._histT);
			this._histT = N;
		}
		this._lgPend.forEach(w => clearTimeout(w.timer));
		this._lgPend.clear();
		if (this._bc) {
			const bc = this._bc;
			this._bc = N;
			setTimeout(() => {
				try {
					bc.onmessage = N;
					bc.close();
				} catch (e) { /* 二重 close 無視 */ }
			}, 0);
		}
		this._ev.clear();
		this.onFrame = N;
		this.transfer = N;
		this._hist = {};
		this._seenA.clear();
	}
	_loginCancel() {
		if (this._wT) {
			clearTimeout(this._wT);
			this._wT = N;
		}
		if (this._login) {
			this._login.res(F);
			this._login = N;
		}
	}
	// transfer 停止: FileTransfer 契約に global stop がないため応答/進捗フックを無効化して差し出しを止める
	// （進行中の fetch 自体は transfer.cancel(h10) の呼び出し側責務。逸脱として報告）
	_haltTransfer() {
		if (!this.transfer) return;
		this.transfer.onNeedBody = () => Promise.resolve(N);
		this.transfer.onProgress = N;
		this.transfer.onFetchDone = N;
		this.transfer.onFetchFail = N;
	}
	_clearTimers() {
		if (this._wT) {
			clearTimeout(this._wT);
			this._wT = N;
		}
		if (this._monthT) {
			clearTimeout(this._monthT);
			this._monthT = N;
		}
	}
	// 月境界タイマ（通常/同期のみ、§6.7）: 翌月 UTC 0 時+余裕 → leave + on('monthExpire')
	_armMonth() {
		if (this._monthT) clearTimeout(this._monthT);
		this._monthT = N;
		if (this._st.mode === 'server') return; // サーバーモードは月境界免除（§6.7）
		const d = new Date(),
			nx = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) + MONTH_MARGIN_MS - d.getTime();
		this._monthT = setTimeout(() => {
			this._monthT = N;
			this._emit('monthExpire', N);
			this.leave('monthExpire'); // 全タブへ波及（BC off）+ roomLogin null 化（§6.7/§9.12）
		}, Math.max(1000, nx));
	}
	_delegateLogin(a) {
		return new Promise(res => {
			const id = AuthChallenge.newAnonce();
			const tm = setTimeout(() => {
				this._lgPend.delete(id);
				res(F);
			}, LG_REPLY_MS);
			this._lgPend.set(id, { res, timer: tm });
			this._bcPost({ t: 'lg', id, a });
		});
	}
	// ---- 受信フレーム処理（オーナーのみ。認証前に受理可は W/O/C、§6.1/§8.2）----
	_onFrame(p, from) {
		switch (p.ir) {
			case 'W':
				this._voteW(p, from).catch(e => ef(e, 'room_session.vote'));
				break;
			case 'O':
				this._onVoteO(p, from);
				break;
			case 'C':
				this._onC(p);
				break;
			case 'J':
				if (p.to) { // 新参加者への折返し（追加仕様: 参加時刻 UnixTime + 名乗り me{uid,t,md}）。自宛のみ処理・onFrame 非伝播
					if (this._st.authed && p.to === this.uid) {
						const i = this._st.participants.findIndex(x => x.uid === this.uid);
						if (i >= 0 && Number.isFinite(p.at) && (this._st.participants[i].t == null || p.at < this._st.participants[i].t)) {
							this._st.participants[i].t = p.at; // 自身の参加時刻は他メンバー最早観測値で確定
							this._emit('participants', this._st.participants);
							this._snap();
						}
						if (p.me && p.me.uid && p.me.uid !== this.uid) this._touchParticipant(p.me.uid, p.me.t, p.me.md);
					}
					break;
				}
				if (this._login && !this._st.authed && p.uid !== this.uid) this._login.need.add(p.uid); // 採決中の roster 補充（§6.2）
				if (this._st.authed) {
					const isNew = p.uid && !this._st.participants.some(x => x.uid === p.uid);
					this._touchParticipant(p.uid, N, p.md);
					this._histTouch(p.uid, T);
					if (isNew && p.uid !== this.uid && this.room.cr === this.uid) this._sendC(); // 追加仕様: 新規参加者へ部屋設定(mx/srvOn 等)を再配信
					if (p.uid !== this.uid) { // 名乗り折返し（無条件）。再参加者は自 roster に残りするため isNew では拾えない（退避復帰 v1.3）。折返しは to 宛のみ処理でループなし
						const rec = this._st.participants.find(x => x.uid === p.uid),
							me = this._st.participants.find(x => x.uid === this.uid);
						this.sendFrame(Protocol.mk('J', { to: p.uid, uid: p.uid, at: (rec && rec.t) || Date.now(), me: { uid: this.uid, t: (me && me.t) || Date.now(), md: this.mode } }));
					}
					if (this.onFrame) try {
						this.onFrame(p, from, this.rid); // 参加者増で自索引再周知（§9.4）
					} catch (e) {
						ef(e, 'room_session.onFrame.J');
					}
				}
				break;
			case 'B':
				if (this._st.authed) {
					this._dropParticipant(p.uid);
					this._histTouch(p.uid, F);
					if (this.onFrame) try {
						this.onFrame(p, from, this.rid);
					} catch (e) {
						ef(e, 'room_session.onFrame.B');
					}
				}
				break;
			case 'M':
			case 'S':
			case 'T':
			case 'X':
				if (!this._st.authed) return; // データ系は認証後有効（§6.1）
				if (p.ir === 'M') this._touchParticipant(p.uid);
				if (this.onFrame) try {
					this.onFrame(p, from, this.rid);
				} catch (e) {
					ef(e, 'room_session.onFrame.' + p.ir);
				}
				break;
			default:
				break; // Q/H/A/G は feed 側で処理済み
		}
	}
	// ---- 採決側（既存メンバー、§6.2 検証 1〜3）----
	async _voteW(p, from) {
		if (!this._st.authed || !p.uid || !p.anonce || p.uid === this.uid) return; // 既存（認証済み）メンバーが採決
		// 参加側が J を見逃していると採決 roster が作れないため、採決応答時に自己 J を再告知する（§6.2）
		const cfg = (this.settings && this.settings.cfg) || {};
		this._wsSend(Protocol.mk('J', { uid: this.uid, gen: this.jGen, grid: [cfg.GRID_COLS || 4, cfg.GRID_ROWS || 8], md: this.mode }));
		if (this.seenAnonce(p.anonce)) return; // 処理済み anonce は再採決しない（§6.2/§6.5）
		const ok = await this._checkW(p);
		this._wsSend(Protocol.mk('O', { to: p.uid, anonce: p.anonce, ok }));
	}
	async _checkW(p) {
		const m = p.mode;
		if (!MODES.includes(m)) return F;
		// 1. salt 妥当性（§6.2/§6.7）: 通常/同期=現在 UTC 月。server=YYYYMMDD かつ参加当日以前かつ srvOn
		if (m === 'server') {
			if (this.room.srvOn !== T && this.room.srvOn !== true) return F; // mode=server & srvOn=false は即不 OK（§6.8）
			if (!/^\d{8}$/.test(p.salt || '') || +p.salt > +AuthChallenge.saltServer()) return F;
		} else if (p.salt !== AuthChallenge.saltNormal()) return F;
		// 2. オリジン整合（§6.2/§6.6）: oa 内の同一オリジン o について ho==H(o) かつ hor==H(reverse(o))
		const oas = this._effOa();
		let matched = F;
		for (const o of oas) {
			const hh = await this._origH(o);
			if (hh.ho === p.ho && hh.hor === p.hor) {
				matched = T;
				break;
			}
		}
		if (!matched) return F;
		// 3. パスワード整合: 自分の OPFS 保管 seedSaltedHash で at 再計算照合（§6.2）
		if (!this._pw) return F;
		const at = await AuthChallenge.at({ ho: p.ho, seed: this._pw, hor: p.hor, uid: p.uid, salt: p.salt, anonce: p.anonce }, this._rounds());
		return at === p.at;
	}
	// 許可オリジン実効値（§6.6）: xorig=true なら oa（b64url 化されたオリジン列）、false なら自己オリジン 1 個に強制上書き
	_effOa() {
		if (this.room.xorig === T || this.room.xorig === true) {
			return (this.room.oa || []).map(b => {
				try {
					return Y.u2s(Y.U2a(b));
				} catch {
					return N;
				}
			}).filter(x => x);
		}
		return [location.origin];
	}
	async _origH(origin) {
		let e = this._origCache.get(origin);
		if (!e) {
			e = await AuthChallenge.originHashes(origin, this._rounds());
			this._origCache.set(origin, e);
		}
		return e;
	}
	// C 自前送出（作成者。J 新規検知時の再配信。cg は現値のまま=受信側の採用条件を満たせば十分）
	_sendC() {
		this.sendFrame(Protocol.mk('C', {
			rid: this.rid, uid: this.uid, cr: this.room.cr, cg: this.room.cg || 0,
			pw: this._pw, pwSalt: this._pwSalt,
			srvOn: this.room.srvOn === T || this.room.srvOn === true,
			xorig: this.room.xorig === T || this.room.xorig === true,
			oa: this.room.oa || [], mx: +this.room.mx || 0,
		}));
	}
	// ---- C: 部屋設定通知（§8.3 整合 / §6.6 xorig / §6.8 srvOn / §6.9 再作成競合）----
	_onC(p) {
		if (p.rid && p.rid !== this.rid) return;
		if (!(p.cg > (this.room.cg || 0))) return; // cg 古いは無視（§8.3）
		if (!!p.xorig !== !!this.room.xorig) {
			this.lastWarn = { type: 'xorig', cg: p.cg }; // 自己記録と異なる xorig の C は無視+警告（§6.6/§8.3）
			return;
		}
		// cr 未学習（新規参加者の初 C）ならそのまま採用。cr 既知で不一致のみ §6.9 競合扱い
		if (!this.room.cr && p.cr) this.room.cr = p.cr;
		const sameCr = (p.cr || '') === (this.room.cr || '');
		if (!sameCr) {
			this._cDiff = T;
			if (this._st.authed) {
				// §6.9 参加中の再作成検知: cr 異なる C → 強制ログアウト+conflict 保存（自動再参加禁止）
				this._markConflict();
				this._emit('conflict', { type: 'recreated', by: p.cr, cg: p.cg });
				this.leave('conflict');
			}
			// 未ログイン側: 設定は採用しない（後発側は再登録要）。login 失敗時に _cDiff で conflict 判定
			return;
		}
		if (p.pw && p.pw !== this._pw) {
			// §8.3 再発行の伝搬: seedSaltedHash 更新。C に salt 欄がないため現在 UTC 月の salt で有効化（逸脱報告）
			this._pw = p.pw;
			this._pwSalt = AuthChallenge.saltNormal();
		}
		this.room.cg = p.cg;
		this.room.oa = p.oa || this.room.oa || [];
		this.room.srvOn = p.srvOn === T || p.srvOn === true;
		if (+p.mx > 0) this.room.mx = +p.mx; // 追加仕様: 部屋毎アップロード上限（作成者 C で配信）
		if (this.room.xorig === T || this.room.xorig === true) this.room.oa = this.room.oa.map(String);
		else this.room.oa = []; // xorig=false の oa は強制的に自オリジン扱い（§6.6。永続値は無視）
		if (this._login && this._login.mode === 'server' && !this.room.srvOn) this._failLogin('msg.auth.srvDisabled');
		if (this._st.authed && this._st.mode === 'server' && !this.room.srvOn) {
			// §6.8 サーバーモード参加中に srvOn=false → ただちに強制ログアウト（以後 srvOn true まで自動再参加しない）
			this._emit('srvOff', N);
			this.leave('srvOff');
			return;
		}
		this._saveRoom(this._pw, this._pwSalt).catch(e => ef(e, 'room_session.saveRoom')); // room.json 反映（§8.3）
		this._emit('roomUpdate', this.room); // 追加仕様: room_app 側 ctx.room（mx/srvOn 表示）へ同期
		this._snap();
	}
	// ---- 参加者表（J/B で更新・30h TTL なし=サーバ E/L 側で追跡、§9.12/§11.1 不在の表）----
	_touchParticipant(uid, at = N, md = N) {
		if (!uid) return;
		const i = this._st.participants.findIndex(x => x.uid === uid);
		if (i < 0) this._st.participants.push({ uid, t: at || Date.now(), md: md || N });
		else if (md && this._st.participants[i].md !== md) this._st.participants[i].md = md; // 参加時刻 t は初観測で固定（昇順表示の基準）
		this._emit('participants', this._st.participants);
		this._snap();
	}
	_dropParticipant(uid) {
		const before = this._st.participants.length;
		this._st.participants = this._st.participants.filter(x => x.uid !== uid);
		if (this._st.participants.length !== before) {
			this._emit('participants', this._st.participants);
			this._snap();
		}
	}
	// ---- room.json / history.json / roomLogin（room.json・history.json 读写はオーナータブのみ、§10/§9.12）----
	_rounds() {
		return (this.settings && this.settings.cfg && this.settings.cfg.HASH_ROUNDS) || 10;
	}
	_seedOf(password, salt) {
		if (!password || !this.room.nm) return Promise.reject(new Error('room_session: nm/password required'));
		// §4/§7.3: ridB64U は部屋名 b64url（= room.nm。QR に載る値）
		return AuthChallenge.seed(password, this.room.nm, location.origin, salt, this._rounds());
	}
	async _loadRoom() {
		if (!this._owner) return;
		try {
			const ab = await OPFS.r(STORAGE.roomFile(this.rid));
			if (ab && ab.byteLength) {
				const o = JSON.parse(Y.u2s(ab));
				if (o && typeof o === 'object') {
					this.room = Object.assign({ nm: '', pw: '', pwSalt: '', srvOn: F, cr: '', cg: 0, xorig: F, oa: [], mx: 0 }, this.room, o);
					this._pw = this.room.pw || this._pw;
					this._pwSalt = this.room.pwSalt || this._pwSalt;
				}
			}
			await this._readHist();
		} catch (e) {
			ef(e, 'room_session.room.' + this.rid); // 不存在は空ファイル → 設定なし（未作成部屋）
		}
	}
	async _saveRoom(pw, pwSalt) {
		if (!this._owner) return;
		this.room.pw = pw || '';
		this.room.pwSalt = pwSalt || '';
		const o = { rid: this.rid, nm: this.room.nm, pw: this.room.pw, pwSalt: this.room.pwSalt, srvOn: !!this.room.srvOn, cr: this.room.cr, cg: this.room.cg || 0, xorig: !!this.room.xorig, oa: this.room.oa || [], mx: +this.room.mx || 0 };
		if (this.room.conflict) o.conflict = T; // §6.9 競合時 conflict: true 追記
		await OPFS.w(STORAGE.roomFile(this.rid), Y.s2u(JSON.stringify(o)).buffer);
	}
	_markConflict() {
		this.room.conflict = T; // 以後の自動再参加禁止（§6.9。再登録は QR 再読込/パスワード再入力、rejoin が拒否）
		this._saveRoom(this._pw, this._pwSalt).catch(e => ef(e, 'room_session.conflict.' + this.rid));
	}
	// history.json: {uid: {t: 最終観測 ms, n: 参加回数}}（§9.12/§5.7。J/B/認証成功で更新）
	_histTouch(uid, joinInc) {
		if (!this._owner || !uid) return;
		if (!this._hist) this._hist = {};
		const e = this._hist[uid] || (this._hist[uid] = { t: 0, n: 0 });
		e.t = Date.now();
		if (joinInc) e.n++;
		if (this._histT) clearTimeout(this._histT);
		this._histT = setTimeout(() => {
			this._histT = N;
			OPFS.w(STORAGE.history(this.rid), Y.s2u(JSON.stringify(this._hist || {})).buffer).catch(e2 => ef(e2, 'room_session.hist'));
		}, 1000);
	}
	async _readHist() {
		if (!this._owner || this._hist) return this._hist;
		try {
			const ab = await OPFS.r(STORAGE.history(this.rid));
			if (ab && ab.byteLength) this._hist = JSON.parse(Y.u2s(ab)) || {};
		} catch {
			this._hist = {};
		}
		return this._hist;
	}
	// state.roomLogin.<rid>（§11 状態表。§9.12 のセッション単一化キード）
	async _roomLogin() {
		try {
			return (this.settings && this.settings.state && this.settings.state.roomLogin && this.settings.state.roomLogin[this.rid]) || N;
		} catch {
			return N;
		}
	}
	async _setRoomLogin(v) {
		if (!this.settings) return;
		this.settings.setState('roomLogin.' + this.rid, v);
		await this.settings.flush();
	}
}
