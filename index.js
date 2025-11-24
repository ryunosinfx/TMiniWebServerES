// index.js
const net = require('net');
const { resolve } = require('path');
const { PicoCYW43 } = require('pico_cyw43');
const { WiFi } = require('wifi');
const pico_cyw43 = new PicoCYW43();
const wifi = new WiFi();
// Blink on-board LED
const state = { s: null, c: 0 };
const L = m => console.log(`${Date.now()} ${m}`);
setInterval(() => {
	const sym2 = Symbol('foo');
	if (pico_cyw43.getGpio(0)) {
		pico_cyw43.putGpio(0, false); // turn-off LED
	} else {
		pico_cyw43.putGpio(0, true); // turn-on LED
		if (state.c % 10 < 1) L(`ON! ${Date.now()} / s:${state.s ? state.s.destroyed : state.s}`);
		state.c++;
	}
}, 300);
// const L = m => storage.setItem('test', `${storage.getItem('test')}${Date.now()} ${m}\n`);

L(`8`);
wifi.scan((err, scanResults) => {
	L(`80`);
	if (err) {
		L(`90 /${err}`);
		console.error(err);
	} else {
		L(`91 `);
		try {
			const l = scanResults.length;
			L(`92 /${l}`);
			for (let i = 0; i < l; i++) L(`93 /${i}/${JSON.stringify(scanResults[i])}`);
		} catch (e) {
			L(`9e /${e}`);
		}
	}
});
L(`Aa `);
wifi.on('associated', a => {
	L('associated to Wi-Fi! 1');
	L(`associated to Wi-Fi! 2 ${a}`);
});

L(`Ab `);
wifi.on('connect', conn => {
	L('Connected to Wi-Fi!IP 1:');
	// L(`Connected to Wi-Fi!IP 2 Address: ${conn}`);
	L(`Connected to Wi-Fi!IP 3 Address: ${conn.addr}`);
});

L(`90`);

const ping = async (options = {}) => {
	L(`ping 01`);
	const opt = { results: [], i: 0 };
	opt.host = options.address || 'localhost';
	opt.port = options.port || 80;
	opt.attempts = options.attempts || 10;
	opt.timeout = options.timeout || 5000;
	L(`ping 02 host:${opt.host}/port:${opt.port}`);

	const isEnd = opt => {
		L(`ping isEnd 01`);
		if (opt.i < opt.attempts) return L(`ping isEnd 02 i:${opt.i}/attempts${opt.attempts}`) || false;
		L(`ping isEnd 03`);
		const results = opt.results;
		const src = results.reduce((prev, curr) => prev + curr.time, 0);
		L(`ping isEnd 04`);
		return {
			address: opt.host,
			port: opt.port,
			attempts: opt.attempts,
			avg: src / results.length,
			max: results.reduce((prev, curr) => (prev > curr.time ? prev : curr.time), results[0].time),
			min: results.reduce((prev, curr) => (prev < curr.time ? prev : curr.time), results[0].time),
			results,
		};
	};
	const awaitF = (n = 100) => new Promise(resolve => setTimeout(() => resolve(), n));
	const getSocket = () => {
		const f = async resolve => {
			L(`getSocket 01`);
			const a = { s: null, e: null, c: false };
			while ((!a.s || a.s.destroyed) && !a.c) {
				L(`getSocket 02 c:${a.c}`);
				a.s = new net.createConnection(opt, () => {
					a.c = true;
					L(`getSocket conn! 01`);
					resolve(a);
					L(`getSocket conn! 02`);
				});
				L(`getSocket 03`);
				a.s.on('data', data => {
					L(data);
					a.s.end();
				});
				L(`getSocket 04`);
				a.s.on('error', e => resolve({ s: a.s, e: e }));
				L(`getSocket 05 destroyed:${a.s.destroyed}`);
				state.s = a.s;
				for (let i = 0; i < 3; i++) {
					await awaitF(100);
					L(`getSocket 06 destroyed:${a.s.destroyed}/i:${i}`);
					if (!a.s.destroyed) break;
				}
			}
		};
		return new Promise(f);
	};
	const closeSocket = s =>
		new Promise(resolve => {
			L(`closeSocket 01`);
			s.on('end', () => {
				L('disconnected from server');
				resolve();
				s.destroy();
			});
			L(`closeSocket 02`);
			s.end();
			L(`closeSocket 03`);
		});
	// const destroy = s => s.destroy();
	const showIp = s => L(`localAddress:${s.localAddress}`);
	L(`ping 03`);
	let output = false;
	while (output === false) {
		L(`ping connect 01`);
		const start = Date.now();
		L(`ping connect 02`);
		const { s, e } = await getSocket();
		L(`ping connect onConnect 01 e:${e}`);
		opt.results.push(e ? { seq: opt.i, time: undefined, err: e } : { seq: opt.i, time: Date.now() - start });
		showIp(s);
		L(`ping connect 03`);
		await closeSocket(s);
		opt.i++;
		L(`ping connect onConnect 02 i:${opt.i}`);
		output = isEnd(opt);
		L(`ping connect 04 output:${output}`);
	}
	return output;
};
L(`9 `);
wifi.connect(async err => {
	L(`B err:${err}`);
	err ? console.error(err) : L(`B1 `);
	L(`C `);
	wifi.getConnection((err, info) => {
		if (err) {
			console.error('Failed to get connection info:', err);
			// eslint-disable-next-line no-undef
			L(`D err:${err}`);
		}
		L(`E info:${info}`);
		L(`F info.ip:${info.ip}`);
	});
	try {
		const out = await ping({ address: '192.168.2.1' });
		L(`addr:${out.address},port:${out.port},attempts:${out.attempts}`);
		for (const r of out.results) L(`i:${r.seq},time:${r.time},err:${r.err}`);
		L(`avg:${out.avg},min:${out.min},max:${out.max}`);
	} catch (e) {
		L(`Ge /${e}`);
	}
});
L(`Ad `);
// L(`A1 /${wifi}`);
// L(`A2 /${typeof wifi.on}`);
L(`Az `);
