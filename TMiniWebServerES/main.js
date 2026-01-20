///これはバンドル用でnodejsでは使用しません。
import { WiFi } from 'wifi';
// import fs from 'fs';
import net from 'net';
// import { Flash } from 'flash';
import { PicoCYW43 } from 'pico_cyw43';
import { startSampleServer } from './SampleServer';
import { TMiniWebServerUtil } from './TMiniWebServerUtil.js';
import { awaitF, L } from './Utils.js';
TMiniWebServerUtil.isKaluma = true;
// const rangeOfFlash = { start: 384, end: 767 };
// async function mountFs(range) {
// 	const { VFSLittleFS } = require('vfs_lfs');

// 	// register lfs filesystem type
// 	fs.register('lfs', VFSLittleFS);

// 	try {
// 		console.log('Flash', Flash);
// 		const blockDevice = new Flash(range.start, range.end - range.start + 1);
// 		console.log('blockDevice', blockDevice);
// 		fs.mount('/', blockDevice, 'lfs');
// 		console.log('fs', fs);
// 		console.log('fs.cwd()', fs.cwd());
// 		console.log('fs.readdir("/")', fs.readdir('/'));
// 		console.log('fs.readdir("/")', await TMiniWebServerUtil.listFiles('/'));
// 	} catch (e) {
// 		console.error('err mount littleFS', e);
// 	}
// }
// mountFs(rangeOfFlash);

const N = null,
	state = { s: N, c: 0 },
	testIPaddr = '192.168.2.1',
	pc43 = new PicoCYW43(),
	interval = 300,
	lu = () => pc43.putGpio(0, true), // turn-on LED
	ld = () => pc43.putGpio(0, false), // turn-off LED
	Lchika = async (l = 30) => (pc43.getGpio(0) ? ld() : N) & lu() & (await awaitF(l)) & ld();
// Blink on-board LED
setInterval(async () => {
	await Lchika();
}, interval);

/**
 *HttpにPingを打つやつ。
 */
const HttpPinger = {
	isEnd: opt => {
		L(`ping isEnd 01`);
		if (opt.i < opt.attempts) return L(`ping isEnd 02 i:${opt.i}/attempts${opt.attempts}`) || false;
		L(`ping isEnd 03`);
		const r = opt.results,
			src = r.reduce((prev, curr) => prev + curr.time, 0);
		L(`ping isEnd 04`);
		return {
			address: opt.host,
			port: opt.port,
			attempts: opt.attempts,
			avg: src / r.length,
			max: r.reduce((prev, curr) => (prev > curr.time ? prev : curr.time), r[0].time),
			min: r.reduce((prev, curr) => (prev < curr.time ? prev : curr.time), r[0].time),
			results: r,
		};
	},
	getSocket: opt => {
		const i = opt.i,
			f = async r => {
				L(`getSocket 01`);
				const a = { s: N, e: N, c: false, d: false, t: Date.now() };
				while (!a.s || a.s.destroyed || !a.c) {
					L(`getSocket 02 c:${a.c}/i:${i}`);
					const s = new net.createConnection(opt, () => {
						a.c = true;
						L(`getSocket conn! 01 destroyed:${a.s.destroyed}/a.d:${a.d}/a.t:${a.t}/i:${i}`);
						r(a);
						L(`getSocket conn! 02 destroyed:${a.s.destroyed}/a.d:${a.d}/a.t:${a.t}/i:${i}`);
					});
					a.s = s;
					s.on('data', data => {
						L(data);
						s.end();
					});
					s.on(
						'error',
						e =>
							L(`getSocket error! 01 destroyed:${a.s.destroyed}/a.d:${a.d}/a.t:${a.t}/i:${i}`) ||
							r({ s: s, e: e })
					);
					s.on('end', () => {
						L(`getSocket 05z destroyed:${s.destroyed}/${a.d}/a.t:${a.t}/i:${i}`);
						a.d = true;
					});
					if (a.c && a.d) return L(`getSocket 05a/a.c:${a.c}/a.d:${a.d}/a.t:${a.t}/i:${i}`) || r(a);
					await awaitF(20);
					L(`getSocket 05b destroyed:${s.destroyed}/a.d:${a.d}/a.t:${a.t}/i:${i}`);
					state.s = s;
					if (a.c && a.d) return L(`getSocket 05e/a.c:${a.c}/a.d:${a.d}/a.t:${a.t}/i:${i}`);
					for (let i = 0; i < 3; i++) {
						if (a.d) return;
						if (!s.destroyed) break;
						await awaitF(10);
						L(`getSocket 06 destroyed:${s.destroyed}/i:${i} /a.c:${a.c}/a.d:${a.d}/a.t:${a.t}/i:${i}`);
						if (!s.destroyed) break;
					}
					L(`getSocket 07 c:${a.c}/a.s:${a.s}/a.t:${a.t}/i:${i}`);
				}
				L(`getSocket 08 c:${a.c}/a.s:${a.s}/a.t:${a.t}/i:${i}`);
				r(a);
			};
		return new Promise(f);
	},
	closeSocket: s =>
		new Promise(r => {
			L(`closeSocket 01`);
			s.on('end', () => L('disconnected from server') & r() & s.destroy());
			s.end();
			L(`closeSocket 03`);
		}),
	// eslint-disable-next-line no-undef
	showIp: s => L(`localAddress:${s.localAddress}`) || storage.setItem('ip', `${s.localAddress}`),
	ping: async (options = { address: testIPaddr }) => {
		L(`ping 01`);
		const opt = { results: [], i: 0 };
		opt.host = options.address || 'localhost';
		opt.port = options.port || 80;
		opt.attempts = options.attempts || 10;
		opt.timeout = options.timeout || 5000;
		L(`ping 02 host:${opt.host}/port:${opt.port}`);
		const H = HttpPinger,
			getSocket = H.getSocket,
			showIp = H.showIp,
			closeSocket = H.closeSocket,
			isEnd = H.isEnd;
		let op = false;
		while (op === false) {
			L(`ping connect 01`);
			const start = Date.now();
			L(`ping connect 02${JSON.stringify(opt)}`);
			const o = await getSocket(opt),
				s = o.s,
				e = o.e;
			L(`ping connect 02a onConnect 01 e:${e}/start:${start}/opt.i:${opt.i}`);
			opt.results.push(e ? { seq: opt.i, time: undefined, err: e } : { seq: opt.i, time: Date.now() - start });
			showIp(s);
			L(`ping connect 03`);
			await closeSocket(s);
			opt.i++;
			L(`ping connect onConnect 02 i:${opt.i}`);
			op = isEnd(opt);
			L(`ping connect 04 output:${op}`);
		}
		L(`ping connect 05 output:${op}`);
		return op;
	},
};
const wifi = new WiFi();

wifi.connect(err => {
	L('wifi.connect!!');
	if (err) {
		console.error('WiFi connect error:', err);
		wifi.close(); // ← エラー時も必ず close()
		return;
	}

	wifi.getConnection((err, info) => {
		L(`getConnection 01 err:${err} / info:${info}`);

		if (err) {
			console.error('Failed to get connection info:', err);
			wifi.close(); // ← エラー時に close()
			return;
		}

		try {
			(async () => {
				//await HttpPinger.ping();
				// eslint-disable-next-line no-undef
				L(`####1#getConnection ip:${storage.getItem('ip')}######`);
				await awaitF(1000);
				startSampleServer('/wwwroot');
				L('END INIT AFTER CONNECT!');
			})();
		} catch (e) {
			L('ping error:', e);
		} finally {
			// wifi.close(); // ← 最終的に必ず close() して unlock
		}
	});
});
