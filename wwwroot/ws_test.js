import { Vw } from './Vw.js';
const WS_URL = 'http://localhost:8080/ws/test'; // /終わりでないこと。
const m1 = { margin: '1px' };
const m10 = { margin: '10px' };
const t4 = { margin: '5px 0px 2px 0px' };
class WSClient {
	static socket = null;
	static connect(url, callback) {
		const socket = new WebSocket(url);
		socket.addEventListener('open', event => {
			console.log(`event:${event}`);
			socket.send('Hello Server!');
			WSClient.socket = socket;
		});
		socket.addEventListener('message', callback);
	}
	static send(msg) {
		return WSClient.socket ? WSClient.socket.send(msg) : null;
	}

	static setEventListener(fn) {
		WSClient.socket.addEventListener('message', event => {
			fn(event.data);
			console.log('Message from server ', event.data);
		});
	}
}
export class ESWsMainView {
	constructor() {
		this.hash = location.hash;
	}
	async build() {
		const frame = Vw.add(null, 'div', {}, m10);
		const body = document.getElementsByTagName('body')[0];
		body.appendChild(frame);

		//----------------------------------------------------------------------------------------

		Vw.add(frame, 'h1', { text: 'WebSocket Test' }, t4);
		Vw.add(frame, 'hr');
		const form1 = Vw.add(frame, 'form', { action: './', method: 'GET', onsubmit: 'return false;' });
		const rowCurlWS = Vw.add(form1, 'div', {}, m10);
		const colG1 = Vw.add(rowCurlWS, 'div', {}, m1);
		Vw.add(colG1, 'h4', { text: 'URL' }, t4);
		const input1url = Vw.add(colG1, 'input', { name: 'inputUrl' }, { margin: '5px', width: '90vw' });
		input1url.value = WS_URL;

		const rowCTextWS = Vw.add(form1, 'div', {}, m10);
		const colG2 = Vw.add(rowCTextWS, 'div', {}, m1);
		Vw.add(colG2, 'h4', { text: 'Message' }, t4);
		const textarea1 = Vw.add(colG2, 'textarea', { text: '' });
		Vw.input(textarea1, () => {
			WSClient.send(textarea1.value);
		});
		const rowCBtntWS = Vw.add(form1, 'div', {}, m10);
		const colG3 = Vw.add(rowCBtntWS, 'div', {}, m1);
		const buttonInitWS = Vw.add(colG3, 'button', { text: 'testInitWS' }, m1);
		const rowCLogWS = Vw.add(form1, 'div', {}, m10);
		const colWSlog = Vw.add(rowCLogWS, 'div', {}, { margin: '12px', whiteSpace: 'pre', fontSize: '60%' });
		const callback = data => {
			const rows = colWSlog.textContent.split('\n');
			rows.push(data && data.data ? data.data : data);
			colWSlog.textContent = rows.join('\n');
		};
		Vw.click(buttonInitWS, () => WSClient.connect(input1url.value, callback));
	}
}
window.onload = event => {
	console.log(`page is fully loaded event:${event}`);
	new ESWsMainView().build();
};
