import { Vw } from './Vw.js';
const WS_URL = 'http://localhost:8080/ws/test', // /終わりでないこと
	m1 = { margin: '1px' },
	m10 = { margin: '10px' },
	t4 = { margin: '5px 0px 2px 0px' };
class WSClient {
	static socket = null;
	static connect(url, callback) {
		const s = new WebSocket(url);
		s.addEventListener('open', e => {
			console.log(`event:${e}`);
			s.send('Hello Server!');
			WSClient.socket = s;
		});
		s.addEventListener('message', callback);
	}
	static send = msg => (WSClient.socket ? WSClient.socket.send(msg) : null);

	static setEventListener = fn =>
		WSClient.socket.addEventListener('message', e => {
			fn(e.data);
			console.log('Message from server ', e.data);
		});
}

class MV {
	constructor() {
		this.hash = location.hash;
	}
	async build() {
		const frame = Vw.add(null, 'div', {}, m10),
			body = document.getElementsByTagName('body')[0];
		body.appendChild(frame);

		//----------------------------------------------------------------------------------------

		Vw.add(frame, 'h1', { text: 'WebSocket Test' }, t4);
		Vw.add(frame, 'hr');
		const form1 = Vw.add(frame, 'form', { action: './', method: 'GET', onsubmit: 'return false;' }),
			rowCurlWS = Vw.add(form1, 'div', {}, m10),
			colG1 = Vw.add(rowCurlWS, 'div', {}, m1);
		Vw.add(colG1, 'h4', { text: 'URL' }, t4);
		const input1url = Vw.add(colG1, 'input', { name: 'inputUrl' }, { margin: '5px', width: '90vw' }),
			rowCTextWS = Vw.add(form1, 'div', {}, m10),
			colG2 = Vw.add(rowCTextWS, 'div', {}, m1);
		input1url.value = WS_URL;
		Vw.add(colG2, 'h4', { text: 'Message' }, t4);
		const textarea1 = Vw.add(colG2, 'textarea', { text: '' });
		Vw.input(textarea1, () => {
			WSClient.send(textarea1.value);
		});
		const rowCBtntWS = Vw.add(form1, 'div', {}, m10),
			colG3 = Vw.add(rowCBtntWS, 'div', {}, m1),
			buttonInitWS = Vw.add(colG3, 'button', { text: 'testInitWS' }, m1),
			rowCLogWS = Vw.add(form1, 'div', {}, m10),
			colWSlog = Vw.add(rowCLogWS, 'div', {}, { margin: '12px', whiteSpace: 'pre', fontSize: '60%' }),
			callback = data => {
				const rows = colWSlog.textContent.split('\n');
				rows.push(data && data.data ? data.data : data);
				colWSlog.textContent = rows.join('\n');
			};
		Vw.click(buttonInitWS, () => WSClient.connect(input1url.value, callback));
	}
}
window.onload = e => {
	console.log(`page is fully loaded event:${e}`);
	new MV().build();
};
