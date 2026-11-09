/** @module modules/ws_client.js @version 0.1.0 @see docs/img_room_spec.md */
import { cmds } from '../const.js';
import { w, ef, T, F, N } from '../Y.js';

export class WSClient { // 契約準拠: connect/chat/leave/close/isOpen + onOpen/onMessage/onClose({intentional})/onRetry
	constructor({url = N, userId = N, cmds: cm = cmds, reconnectMs = [1000, 2000, 4000, 8000, 16000]} = {}) {
		this.url = url; // WS URL（rid は呼び出し側が組み立てる）
		this.userId = userId;
		this.cmds = cm; // const.js cmds を既定に、注入可能（テスト容易性）
		this.reconnectMs = reconnectMs; // 指数バックオフ表（上限を超えたら最終値で継続）
		this.ws = N;
		this.timer = N; //再接続タイマー
		this.retryN = 0; //連番（onRetry の n。open でリセット）
		this.intentional = F; // close()/leave() 以降は再接続しない
		this.waiters = []; // open 解決待ち {res,rej}
		this.onOpen = this.onMessage = this.onClose = this.onRetry = N;
	}
	get isOpen() {
		return !!this.ws && this.ws.readyState === 1; // WebSocket.OPEN
	}
	mk(cmd, msg = '') {
		return JSON.stringify({cmd, userId: this.userId, msg}); // envelope 順序は既存 ws_chat.js makeMsg と一致
	}
	send(s) {
		return this.isOpen ? (this.ws.send(s), T) : F;
	}
	chat(msgStr) {
		return this.send(this.mk(this.cmds.CHAT, msgStr));
	}
	connect() {
		this.intentional = F;
		if (this.isOpen) return Promise.resolve(); // open 完了で resolve
		if (this.ws || this.timer) return new Promise((res, rej) => this.waiters.push({res, rej})); // 接続/再接続中は open まで待つ
		return this.open();
	}
	open() { // WebSocket 生成（ブラウザ API は実行時のみ触る）。open で resolve、生成失敗のみ reject
		return new Promise((res, rej) => {
			this.waiters.push({res, rej});
			let s = N;
			try {
				s = new WebSocket(this.url);
			} catch (e) {
				ef(e, 'ws_client.open');
				this.waiters = this.waiters.filter(x => x.res !== res);
				rej(e);
				return;
			}
			this.ws = s;
			s.addEventListener('open', () => {
				this.retryN = 0; // open 時リセット
				this.send(this.mk(this.cmds.ENTER)); // open 時 ENTER 自動送信
				const ws = this.waiters.splice(0);
				this.onOpen && this.onOpen();
				ws.forEach(x => x.res());
			});
			s.addEventListener('message', ev => this.onMessage && this.onMessage(ev.data));
			s.addEventListener('error', ev => w('ws_client.error', ev && ev.message ? ev.message : '')); //その後 close が発火
			s.addEventListener('close', () => {
				if (this.ws === s) this.ws = N;
				const ins = this.intentional;
				this.onClose && this.onClose({intentional: ins});
				if (ins) {
					const ws = this.waiters.splice(0); //意図的切断で connect 待ちは解雇
					ws.forEach(x => x.rej(new Error('ws closed')));
				} else this.retry();
			});
		});
	}
	retry() {
		const i = Math.min(this.retryN, this.reconnectMs.length - 1), d = this.reconnectMs[i];
		this.retryN++;
		this.onRetry && this.onRetry(this.retryN, d); // (n, delayMs)
		this.timer = setTimeout(() => {
			this.timer = N;
			if (!this.intentional) this.open().catch(() => {}); //失敗時は close→retry 連鎖でバックオフ継続
		}, d);
	}
	close() { // 意図的切断: 再接続しない
		this.intentional = T;
		this.stopTimer();
		if (this.ws) this.ws.close(); // close イベントで onClose({intentional:true})
		else this.onClose && this.onClose({intentional: T});
	}
	leave() { // LEAVE 送信後 close
		this.send(this.mk(this.cmds.LEAVE));
		this.close();
	}
	stopTimer() {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = N;
		}
	}
}
