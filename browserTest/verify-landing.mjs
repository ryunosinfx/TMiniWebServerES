// landing.html 検証: file:// 読み込み・エラー・リンク整合・スクリーンショット
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
const root = path.resolve(import.meta.dirname, '..');
const b = await chromium.launch();
const errs = [];
const pg = await b.newPage();
pg.on('pageerror', e => errs.push('pageerror: ' + e.message));
pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 120)); });
const url = 'file://' + root + '/landing.html';
await pg.goto(url, { waitUntil: 'load' });
await pg.waitForTimeout(700);
const t = await pg.evaluate(() => ({
	title: document.title,
	h1: !!document.querySelector('.hero .logo'),
	hrefs: [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')),
	txt: (document.body.innerText.includes('WebSocket') && document.body.innerText.includes('Raspberry Pi')) ? 'key-ok' : 'key-miss',
	stor: (() => { const t = document.body.innerText; return (t.includes('OPFS') && t.includes('IndexedDB') && t.includes('localStorage') && t.includes('ストレージを消去') && t.includes('秘密鍵')) ? 'stor-ok' : 'stor-miss'; })(),
	overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
}));
const miss = t.hrefs.filter(h => !h.startsWith('#') && !h.startsWith('https://') && !h.startsWith('http://')).map(h => {
	const f = h.replace(/^\.\//, '');
	return fs.existsSync(path.join(root, f)) ? null : h;
}).filter(Boolean);
await pg.setViewportSize({ width: 1280, height: 900 });
await pg.screenshot({ path: '/tmp/landing_desktop.png', fullPage: true });
const mp = await b.newPage({ viewport: { width: 390, height: 844 } });
await mp.goto(url, { waitUntil: 'load' });
await mp.waitForTimeout(500);
const mof = await mp.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
await mp.screenshot({ path: '/tmp/landing_mobile.png', fullPage: true });
await b.close();
console.log(JSON.stringify({ ...t, miss, errs: errs.slice(0, 4), mobileOverflow: mof }));
