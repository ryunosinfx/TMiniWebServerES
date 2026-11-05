import { Vw, C } from './Vw.js';
import { WS_URL, m1, m1Textarea, m1w100, m1w120, m1Flex, m10, t4, names, cmds } from './const.js';
import { FileUtil } from './file_util.js';
import { Y, H, gBl, pr, io, now } from './Y.js';
import { OPFS } from './OPFS.js';
const US = 1024 * 10;
const wt = 100;
const dir = '_app_';
const DIV = 'div';
const SPAN = 'span';
const IMG = 'img';
class App {
	constructor(imgElm, fl, rElm) {
		this.cf = null;
		this.img = imgElm;
		this.rElm = rElm;
		this.fl = fl;
		this.wc = null;
		this.d = null;
		this.rd = {};
		this.rr = {};
		this.um = new Map();
		this.l = [];
	}
	init_(wc) {
		this.wc = wc;
		Vw.dN(this.img);
		Vw.dN(this.fl);
		Vw.ael(
			this.fl,
			'change',
			FileUtil.oFL(this.fl, (n, t, ab) => this.onFL(n, t, ab))
		);
		OPFS.i(dir);
	}
	onLogin(uid) {
		Vw.dI(this.img);
		Vw.dI(this.fl);
		this.um.set(uid, now());
	}
	onLogout(uid) {
		this.init_();
		this.um.delete(uid);
	}
	onFL(n, t, ab) {
		this.cf = { n, t, ab };
		const b = Y.a2B(ab);
		console.log('onFL cf:', this.cf);
		this.img.src = `data:${t};base64,${b}`;
	}
	async send() {
		const uids = this.um.keys().toArray();
		if (uids.length < 1 || !this.cf) return;
		const uid = uids.pop();
		console.log('send uid:' + uid + ' cf:', this.cf);
		const { n, t, ab } = this.cf;
		const l = gBl(ab);
		const s = await H.d(ab);
		const h = await App.mkH(uid, n, t, l, s);
		const a = [];
		const da = await Y.c(ab);
		const c = App.split(da, h, a);
		const m = App.mkM(uid, h, n, t, l, c, s);
		await App.w(wt);
		this.wc.send(m);
		console.log('send C:' + C + ' m:', m);
		for (let i = 0; i < C; i++) this.wc.send(m);
	}
	async onR(d) {
		try {
			if (d.indexOf('[') === 0) {
				const [uid, h, n, t, l, c, s] = JSON.parse(d);
				const rd = this.rd[uid] ? this.rd[uid] : {};
				this.rd[uid] = rd;
				rd[h] = { uid, h, n, t, l, c, s, v: new Array(c) };
				this.rr[h] = rd[h];
			} else if (d.indexOf('.') > 1) {
				const ts = d.split('.');
				if (ts.length !== 4) return;
				const [h, i, c, r] = ts;
				io(`${h}.${i}/${c}.${r.length}`);
				const rr = this.rr[h];
				const ab = App.gather(r, i, rr) ? await Y.d(Y.jus(rr.v).buffer) : null;
				if (ab) this.onCmpl(await App.save(rr.n, rr.t, ab)); //save to OPFS
			}
		} catch (e) {
			io(e);
		}
		return false;
	}
	//load to OPFS
	async onCmpl(obj) {
		this.l.push(obj);
		const ab = await App.load(obj.n, obj.t, obj.h);
		const fr = Vw.add(this.rElm, DIV);
		const ir = Vw.add(fr, DIV);
		const nr = Vw.add(fr, DIV);
		const n1 = Vw.add(nr, SPAN);
		Vw.sT(n1, obj.n);
		const n2 = Vw.add(nr, SPAN);
		Vw.sT(n2, obj.t);
		const n3 = Vw.add(nr, SPAN);
		Vw.sT(n3, gBl(ab));
		const i1 = Vw.add(ir, IMG, { width: 100, height: 100 });
		i1.src = Y.a2D(ab);
	}
	static gather(r, i, rr) {
		if (!rr) return;
		const v = rr.v;
		v[i] = Y.U2u(r);
		let isOK = true;
		for (const w of v) if (!w) isOK = false;
		return isOK;
	}
	static save = async (n, t, ab) => {
		const h = await H.d(ab);
		const p = OPFS.g(n, h);
		await OPFS.w(p, ab);
		return { t, n, h };
	};
	static load = async (n, t, h) => await OPFS.r(OPFS.g(n, h));
	static del = async (n, t, h) => await OPFS.rmf(OPFS.g(n, h));
	static split = (ab, h, a = []) => {
		const s = gBl(ab);
		const c = Math.ceil(s / US);
		for (let i = 0; i < c; i++) a.push(App.mkT(h, i, C, Y.u2U(Y.as(ab, i * US, (i + 1) * US))));
		return c;
	};
	static mkM = (uid, h, n, t, l, c, s) => JSON.stringify([uid, h, n, t, l, c, s]);
	static mkH = (uid, n, t, l, s) =>
		H.d(`${Y.u2U(Y.s2u(uid))}${Y.u2U(Y.s2u(n))}.${Y.u2U(Y.s2u(t))}.${Y.u2U(Y.i2u(l))}.${s}`, 2);
	static mkT = (h, i, c, r) => `${h}.${i}.${c}.${r}`;
	static w = t =>
		pr(r =>
			setTimeout(() => {
				r();
			}, t)
		);
}
class WSClient {
	constructor(app) {
		this.app = app;
		this.socket = null;
		this.callback = null;
		this.userId = null;
		app.init_(this);
	}
	connect(url, userId = '') {
		if (this.userId) return; //再利用防止
		const s = new WebSocket(url);
		s.addEventListener('open', evt => {
			console.log(`event:${evt}/send InitMsg:${userId}`);
			s.send(WSClient.makeMsg(cmds.ENTER, userId, ''));
			this.app.onLogin(userId);
			this.onOpen();
		});
		this.socket = s;
		this.userId = userId;
		s.addEventListener('message', data => this.onChat(data));
		s.addEventListener('close', () => this.app.onLogout(this.userId) & this.onClose());
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
		this.dFrame = {};
	}
	async build() {
		const frame = Vw.add(null, 'div', {}, m10),
			body = document.getElementsByTagName('body')[0];
		body.appendChild(frame);

		Vw.add(frame, 'h1', { t: 'WebSocket Chat With FileShare' }, t4);
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
			buttonEmit = Vw.add(colG3, 'button', { t: '投稿' }, m1),
			buttonLoad = Vw.add(colG3, 'input', { t: 'Load', type: 'file' }, m1),
			buttonSendImg = Vw.add(colG3, 'button', { t: '画像共有' }, m1),
			colG4 = Vw.add(rowCBtntWS, 'div', {}, m1Flex),
			imagElm = Vw.add(colG4, 'img', { width: 100, height: 100 }),
			colG5 = Vw.add(rowCBtntWS, 'div', {}, m1Flex);
		this.app = new App(imagElm, buttonLoad, colG5);
		FileUtil.oFL(buttonLoad);
		Vw.sS(buttonLogOut, C.dNone);
		Vw.sS(buttonEmit, C.dNone);
		Vw.sS(buttonSendImg, C.dNone);
		const conn = {};
		Vw.click(buttonEmit, () => {
			const v = textarea1.value;
			conn.wsc && conn.wsc.chat(v);
			textarea1.value = '';
		});
		Vw.click(buttonSendImg, () => {
			this.app.send();
		});
		Vw.sS(colG2, C.dNone);
		const rowCLogWS = Vw.add(form1, 'div', {}, m10),
			colWSlog = Vw.add(rowCLogWS, 'div', {}, { margin: '12px', whiteSpace: 'pre', fontSize: '60%' }),
			joinFunc = () => {
				Vw.sS(buttonLogin, C.dNone);
				Vw.sS(buttonLogOut, C.dBlock);
				Vw.sS(buttonEmit, C.dBlock);
				Vw.sS(buttonSendImg, C.dBlock);
				Vw.sS(colG2, C.dBlock);
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
			const wsc = new WSClient(this.app);
			wsc.onOpen = joinFunc;
			wsc.onChat = onChatFunc;
			wsc.onClose = onClose;
			wsc.connect(input1url.value, inputLoginId.value);
			conn.wsc = wsc;
		});
		const logoutFunc = () => {
			console.log('logoutFunc');
			Vw.sS(colG2, C.dNone);
			Vw.sS(buttonLogin, C.dBlock);
			Vw.sS(buttonLogOut, C.dNone);
			Vw.sS(buttonEmit, C.dNone);
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
