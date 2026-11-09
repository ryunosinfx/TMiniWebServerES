// デバッグ: A(作成)→B(参加)→A(投稿) の M/T/S/chunk 交換を ws フレームログで追う
import { launchEngine, instrumentPage } from './lib.mjs';
const BASE = 'http://127.0.0.1:8080';
const ROOM = 'DBG' + Date.now().toString(36).slice(-4).toUpperCase();
const PW = 'PWDBG';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const { name, browser } = await launchEngine();
const mk = async () => {
	const c = await browser.newContext({ locale: 'en-US' });
	const p = await c.newPage();
	const inst = instrumentPage(p);
	return { p, inst };
};
const A = await mk(), B = await mk();

await A.p.goto(`${BASE}/img_room.html`);
await A.p.waitForSelector('button:has-text("Create room")');
await A.p.click('button:has-text("Create room")');
await A.p.fill('input[name="ir-cn"]', ROOM);
await A.p.fill('input[name="ir-cuid"]', 'PONTA');
await A.p.fill('input[name="ir-cpw"]', PW);
await A.p.click('.ir-frm button:has-text("Create room")');
await A.p.waitForSelector('input[type=file]', { timeout: 20000 });
console.log('A: room view OK');

await B.p.goto(`${BASE}/img_room.html`);
await B.p.waitForSelector('button:has-text("Join")');
await B.p.click('button:has-text("Join")');
await B.p.fill('input[name="ir-nm"]', ROOM);
await B.p.fill('input[name="ir-uid"]', 'PONKO');
await B.p.fill('input[name="ir-pw"]', PW);
await B.p.click('.ir-frm button:has-text("Log in")');
await B.p.waitForSelector('input[type=file]', { timeout: 20000 });
console.log('B: room view OK (authOk)');

const summarize = frames => frames.map(f => {
	const dir = f.slice(0, 4), d = f.slice(5);
	if (d[0] === '~') return `${dir}~${d.slice(0, 16)}`;
	try {
		const j = JSON.parse(d);
		const ir = j.ir || j.cmd;
		return `${dir}${ir}${ir === 'M' ? `(m:${(j.m || []).length},sh:${(j.sheets || []).length},gen:${j.gen})` : ir === 'T' ? `(to:${j.to},sid:${j.sid})` : ir === 'S' ? `(h:${String(j.h).slice(0, 6)})` : ir === 'W' ? `(uid:${j.uid})` : ir === 'O' ? `(to:${j.to},ok:${j.ok})` : ir === 'J' ? `(uid:${j.uid})` : ''}${j.cmd ? `(inner:${String(j.msg).slice(0, 40)})` : ''}`;
	} catch {
		return dir + ':' + d.slice(0, 40);
	}
});

await A.p.setInputFiles('input[type=file]', { name: 'photo.png', mimeType: 'image/png', buffer: PNG });
await A.p.waitForTimeout(15000);

console.log('--- A frames ---');
console.log(summarize(A.inst.frames).join('\n'));
console.log('--- B frames ---');
console.log(summarize(B.inst.frames).join('\n'));
console.log('--- errors A/B ---');
console.log(A.inst.errors.slice(0, 6).join('\n'));
console.log(B.inst.errors.slice(0, 6).join('\n'));
console.log('B body:', (await B.p.evaluate(() => document.body.innerText.slice(0, 300))).replace(/\n/g, ' | '));
console.log('B thumbs:', await B.p.evaluate(() => document.querySelectorAll('.ir-thumb').length), 'imgs:', await B.p.evaluate(() => document.querySelectorAll('.ir-thumb img').length));
await browser.close();
