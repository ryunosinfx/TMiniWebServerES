// Firefox での ws_chat2 ファイル共有の失敗原因を console.info(io) の内容から特定する一時デバッグ
import { launchEngine } from './lib.mjs';

const { browser } = await launchEngine();
const ROOM = 'ffdbg5-' + Date.now();

const mk = async id => {
	const ctx = await browser.newContext();
	const p = await ctx.newPage();
	await p.addInitScript(() => {
		const oi = console.info.bind(console);
		console.info = (...a) => {
			const parts = a.map(x => {
				if (typeof x !== 'object') return String(x);
				if (x instanceof Error) return x.name + ':' + x.message;
				try {
					return JSON.stringify(x);
				} catch {
					return String(x);
				}
			});
			oi(parts.join(' ').slice(0, 220));
		};
		const oe = console.error.bind(console);
		console.error = (...a) => oe(...a);
	});
	p.on('console', m => {
		const t = m.type();
		if (t !== 'log') console.log('P' + id, t, m.text().slice(0, 230));
	});
	await p.goto('http://127.0.0.1:8080/ws_chat2.html', { waitUntil: 'load' });
	await p.fill('input[name="inputUrl"]', 'ws://127.0.0.1:8080/ws/chat/' + ROOM);
	await p.fill('input[name="userId"]', id);
	await p.click('button:has-text("入室")');
	return p;
};

const A = await mk('FA');
const B = await mk('FB');
for (const [p, id] of [
	[A, 'FA'],
	[B, 'FB'],
])
	await p.waitForFunction(i => document.body.innerText.includes(i + 'さんが入室'), id, { timeout: 8000 });

await A.setInputFiles('input[type="file"]', 'out/ws_test.png');
await A.waitForTimeout(2000);
await A.click('button:has-text("画像共有")');
await A.waitForTimeout(9000);
console.log('A imgs:', await A.evaluate(() => document.images.length));
console.log('A tail:', JSON.stringify((await A.evaluate(() => document.body.innerText)).slice(-200)));
console.log('B imgs:', await B.evaluate(() => document.images.length));
console.log('B tail:', JSON.stringify((await B.evaluate(() => document.body.innerText)).slice(-200)));
await browser.close();
