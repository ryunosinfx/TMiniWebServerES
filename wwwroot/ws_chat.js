import { Vw, C } from './Vw.js';
const WS_URL = 'http://localhost:8080/ws/chat/room1', // /終わりでないこと。
	m1 = { margin: '1px' },
	m1Textarea = { margin: '1px', width: '90vw', height: '2em' },
	m1w100 = { margin: '1px', width: '100px' },
	m1w120 = { margin: '1px', width: '100px' },
	m1Flex = { margin: '1px', display: 'flex' },
	m10 = { margin: '10px' },
	t4 = { margin: '5px 0px 2px 0px' },
	names = [
		'PONTA',
		'PONKICHI',
		'PONSUKE',
		'PONJIRO',
		'PONKO',
		'PONMI',
		'PONPON',
		'PONKEI',
		'PONSHIROU',
		'PONPOKO',
		'PONYA',
		'PONKA',
		'PONMURA',
		'PONGAMI',
		'PONBARA',
		'PONNAKA',
		'PONCHAN',
		'PONSAMA',
		'PONYAROU',
		'PONZAWA',
		'PONYAMA',
		'PONKAWA',
		'PONROU',
		'PONNOMIYA',
		'PONAKI',
		'PONHIRO',
		'PONMASA',
		'PONJI',
		'PONKAGA',
		'PONNOSE',
		'PONGAWARA',
		'PONGI',
		'PONNOKI',
		'PONJOU',
		'PONJIMA',
		'PONGASHIRA',
		'PONNOJOU',
		'PONSUGI',
		'PONNOIN',
		'PONBAYASHI',
		'PNMORI',
		'PONTANI',
		'PONBUCHI',
		'PONNAMI',
		'PONZATO',
		'PONMATSU',
		'PONROGI',
		'PONZAKI',
		'PONNO',
		'PONDA',
		'PONNOJI',
		'PONMAKI',
		'PONGAHAMA',
		'PONDO',
		'PONNOGI',
		'PONGUCHI',
		'PONWAKA',
		'PONMACHI',
		'PONJOUJI',
	],
	cmds = { CHAT: 'C', ENTER: 'E', LEAVE: 'L' };
class WSClient {
	constructor() {
		this.socket = null;
		this.callback = null;
		this.userId = null;
	}
	connect(url, userId = '') {
		if (this.userId) return; //再利用防止
		const s = new WebSocket(url);
		s.addEventListener('open', evt => {
			console.log(`event:${evt}/send InitMsg:${userId}`);
			s.send(WSClient.makeMsg(cmds.ENTER, userId, ''));
			this.onOpen();
		});
		this.socket = s;
		this.userId = userId;
		s.addEventListener('message', data => this.onChat(data));
		s.addEventListener('close', () => this.onClose());
		s.addEventListener('error', () => this.onError());
	}
	send(msg) {
		return this.socket ? this.socket.send(msg) : null;
	}

	setEventListener(fn) {
		this.socket.addEventListener('message', event => {
			fn(event.data);
			console.log('Message from server ', event.data);
		});
	}
	chat(msg) {
		this.send(WSClient.makeMsg(cmds.CHAT, this.userId, msg));
	}
	logout(cb) {
		this.send(WSClient.makeMsg(cmds.LEAVE, this.userId, 'Good bye!'));
		cb();
	}
	onOpen() {}
	onChat() {}
	onClose() {}
	onError() {}
	static makeMsg = (cmd, userId, msg) => JSON.stringify({ cmd, userId, msg });
}
export class ESWsMainView {
	constructor() {
		this.hash = location.hash;
	}
	async build() {
		const frame = Vw.add(null, 'div', {}, m10),
			body = document.getElementsByTagName('body')[0];
		body.appendChild(frame);

		Vw.add(frame, 'h1', { t: 'WebSocket Chat' }, t4);
		Vw.add(frame, 'hr');
		const form1 = Vw.add(frame, 'form', { action: './', method: 'GET', onsubmit: 'return false;' }),
			rowCurlWS = Vw.add(form1, 'div', {}, m10),
			colCurlWS1 = Vw.add(rowCurlWS, 'div', {}, m1);
		Vw.add(colCurlWS1, 'h4', { t: 'URL' }, t4);
		const input1url = Vw.add(colCurlWS1, 'input', { n: 'inputUrl' }, { margin: '5px', width: '90vw' }),
			rowCurlWSDetail = Vw.add(form1, 'div', {}, m10),
			colCurlWSDetail = Vw.add(rowCurlWSDetail, 'div', {}, m1);
		Vw.add(colCurlWSDetail, 'p', { t: '/ws/chat/<roomId> です' }, t4);

		input1url.value = WS_URL;

		const rowLoginId = Vw.add(form1, 'div', {}, m10),
			colLoginIdLabel = Vw.add(rowLoginId, 'div', {}, m1);
		Vw.add(colLoginIdLabel, 'p', { t: 'ログインID' }, m1);
		const colLoginId = Vw.add(rowLoginId, 'div', {}, m1),
			inputLoginId = Vw.add(colLoginId, 'input', { n: 'userId' }, { margin: '5px', width: '90vw' }),
			rowCTextWS = Vw.add(form1, 'div', {}, m10),
			colG2 = Vw.add(rowCTextWS, 'div', {}, m1);
		Vw.add(colG2, 'h4', { t: 'Message' }, t4);
		const textarea1 = Vw.add(colG2, 'textarea', { t: '' }, m1Textarea),
			rowCBtntWS = Vw.add(form1, 'div', {}, m10),
			colG3 = Vw.add(rowCBtntWS, 'div', {}, m1Flex),
			buttonLogin = Vw.add(colG3, 'button', { t: '入室' }, m1),
			buttonLogOut = Vw.add(colG3, 'button', { t: '退室' }, m1),
			buttonEmit = Vw.add(colG3, 'button', { t: '投稿' }, m1);
		Vw.styleSet(buttonLogOut, C.dNone);
		Vw.styleSet(buttonEmit, C.dNone);
		const conn = {};
		Vw.click(buttonEmit, () => {
			const v = textarea1.value;
			conn.wsc && conn.wsc.chat(v);
			textarea1.value = '';
		});
		Vw.styleSet(colG2, C.dNone);
		const rowCLogWS = Vw.add(form1, 'div', {}, m10),
			colWSlog = Vw.add(rowCLogWS, 'div', {}, { margin: '12px', whiteSpace: 'pre', fontSize: '60%' }),
			joinFunc = () => {
				Vw.styleSet(buttonLogin, C.dNone);
				Vw.styleSet(buttonLogOut, C.dBlock);
				Vw.styleSet(buttonEmit, C.dBlock);
				Vw.styleSet(colG2, C.dBlock);
			};
		const onChatFunc = data => {
			ESWsMainView.add(colWSlog, data);
		};
		const onClose = () => {
			ESWsMainView.add(colWSlog, {
				t: Date.now(),
				msg: '切断されました。',
				userId: conn.wsc ? conn.wsc.userId : null,
			});
		};
		Vw.click(buttonLogin, () => {
			const wsc = new WSClient();
			wsc.onOpen = joinFunc;
			wsc.onChat = onChatFunc;
			wsc.onClose = onClose;
			wsc.connect(input1url.value, inputLoginId.value);
			conn.wsc = wsc;
		});
		const logoutFunc = () => {
			console.log('logoutFunc');
			Vw.styleSet(colG2, C.dNone);
			Vw.styleSet(buttonLogin, C.dBlock);
			Vw.styleSet(buttonLogOut, C.dNone);
			Vw.styleSet(buttonEmit, C.dNone);
		};
		Vw.click(buttonLogOut, () => {
			conn.wsc && conn.wsc.logout(logoutFunc);
			conn.wsc = null;
		});
		inputLoginId.value = names[Date.now() % names.length];
	}
	static add = (parent, data) => ESWsMainView.makeRow(Vw.add(parent, 'div', {}, m1Flex), data);
	static makeRow(rowElm, data) {
		const d = data.data ? data.data : data;
		if (typeof d === 'string')
			try {
				return ESWsMainView.mkRow(JSON.parse(d), rowElm);
			} catch (e) {
				console.debug(e);
			}
		if (!d || typeof d === 'string' || typeof d === 'number') return Vw.add(rowElm, 'div', { t: d }, m1);
		return ESWsMainView.mkRow(d, rowElm);
	}
	static mkRow(d, rowElm) {
		const elms = [];
		elms.push(Vw.add(rowElm, 'div', { t: d.t }, m1w100));
		elms.push(Vw.add(rowElm, 'div', { t: d.userId }, m1w120));
		elms.push(Vw.add(rowElm, 'div', { t: d.msg }, m1));
		return elms;
	}
}
window.onload = event => {
	console.log(`page is fully loaded event:${event}`);
	new ESWsMainView().build();
};
