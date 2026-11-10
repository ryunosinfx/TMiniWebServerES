// browserTest/tests/img-scale.mjs — v1.5 §19 スケール実装検証（cap 展開 / 10 万合成 boot / manifest O(1)）
import { launchEngine } from './lib.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = 'http://127.0.0.1:8080';
const OUT = fileURLToPath(new URL('../out/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const ROOM = 'KSCALE' + Math.random().toString(36).slice(2, 5);
const PW = 'PW';
const N = 100000;
const fails = [];
const ck = (name, ok, extra) => {
	console.log((ok ? 'ok ' : 'FAIL ') + name + (extra ? ' ' + extra : ''));
	if (!ok) fails.push(name);
};
const { browser } = await launchEngine();
const errors = [];
const ctx = await browser.newContext({ locale: 'ja-JP', acceptDownloads: true });
const p = await ctx.newPage();
p.on('pageerror', e => errors.push('' + e));
p.on('console', m => {
	if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push('console: ' + m.text().slice(0, 160));
	if (m.type() === 'warning') errors.push('warn: ' + m.text().slice(0, 160));
});
const cdp = await ctx.newCDPSession(p);
await cdp.send('Performance.enable').catch(() => {});
async function snap(label) {
	try {
		await cdp.send('HeapProfiler.collectGarbage');
	} catch (e) { /* noop */ }
	const { metrics } = await cdp.send('Performance.getMetrics');
	const g = n => (metrics.find(x => x.name === n) || {}).value ?? -1;
	const i = await p.evaluate(() => {
		const x = window.__IRAPP && window.__IRAPP.activeCtx();
		return {
			metas: x ? x.collection.metas.size : null,
			mounts: x && x.cal ? x.cal.mounts.size : null,
			thumbDom: document.querySelectorAll('.ir-thumb').length,
		};
	});
	const row = { label, heapMB: +(g('JSHeapUsedSize') / 1048576).toFixed(1), nodes: g('Nodes'), ...i };
	console.log(JSON.stringify(row));
	return row;
}
await p.goto(BASE + '/img_room.html');
await p.waitForSelector('button:has-text("参加")');
await p.click('button:has-text("部屋作成")');
await p.fill('input[name="ir-cn"]', ROOM);
await p.fill('input[name="ir-cuid"]', 'PON');
await p.fill('input[name="ir-cpw"]', PW);
await p.click('.ir-frm button:has-text("部屋作成")');
await p.waitForFunction(() => window.__IRAPP.activeCtx()?.session?.state.authed, null, { timeout: 30000 });

// ---- 1) 30 枚同日共有 → 当日セル cap=12 + 「+18 件」展開 ----
await p.evaluate(async () => {
	const c = window.__IRAPP.activeCtx();
	for (let i = 0; i < 30; i++) {
		const cc = document.createElement('canvas');
		cc.width = 64;
		cc.height = 64;
		const g = cc.getContext('2d');
		g.fillStyle = `hsl(${i * 12},70%,55%)`;
		g.fillRect(0, 0, 64, 64);
		g.fillStyle = '#000';
		g.fillText(String(i), 20, 34);
		const b = await new Promise(r => cc.toBlob(r, 'image/png'));
		await c.collection.share(new File([b], 'cap' + i + '.png', { type: 'image/png' }), { name: 'cap' + i + '.png', mime: 'image/png' });
	}
	await c.collection.saveManifest();
	await c.sheet.rebuild(c.collection.manifestEntries());
});
await p.waitForTimeout(1500);
const dom1 = await p.evaluate(() => ({
	thumbs: document.querySelectorAll('.cal-cell .ir-thumb').length,
	more: [...document.querySelectorAll('.cal-more')].map(x => x.textContent),
}));
ck('capShown12', dom1.thumbs > 0 && dom1.thumbs <= 12 && dom1.more.some(x => /\+18|18 more/.test(x)), JSON.stringify(dom1));
await p.click('.cal-cell .cal-more');
await p.waitForTimeout(1200);
const dom2 = await p.evaluate(() => ({
	thumbs: document.querySelectorAll('.cal-cell .ir-thumb').length,
	more: [...document.querySelectorAll('.cal-more')].map(x => x.textContent),
}));
ck('expand60', dom2.thumbs >= 24 && (dom2.more.length === 0 || dom2.more.every(x => /\+0|$/ === false)), JSON.stringify(dom2)); // 12+48=60 ≥ 30 → 全件、more 消滅
ck('expandAll', dom2.thumbs >= 30 && dom2.more.length === 0, JSON.stringify(dom2));

// ---- 2) 10 万合成（day jsonl + manifest jsonl を OPFS 直書き）→ cold boot 実測 ----
await p.evaluate(async n => {
	const { OPFS } = await import('/OPFS.js');
	const c = window.__IRAPP.activeCtx();
	const DAY = 86400000;
	const now = Date.now();
	const byDay = new Map();
	const man = [];
	for (let i = 0; i < n; i++) {
		const ts = now - (1 + i % 400) * DAY - ((i * 7919) % DAY); // 当日を避ける（既有の当日 meta/manifest を消さない）
		const h = 'syn' + String(i).padStart(6, '0') + 'AAAAAAAAAAAAAAAA';
		const m = { h, n: 'c2Nhbg' + i, r: [c.nameB64U], u: c.uid, ts, t: 'image/png', l: 5000 + (i % 5000), s: 4000 + (i % 4000), d: null };
		const day = Math.floor(ts / DAY);
		if (!byDay.has(day)) byDay.set(day, []);
		byDay.get(day).push(JSON.stringify(m));
		man.push(JSON.stringify({ h: m.h, n: m.n, r: m.r, u: m.u, ts, t: m.t, l: m.l, s: m.s }));
	}
	for (const [day, ls] of byDay) await OPFS.w(`meta/d${day}.jsonl`, new TextEncoder().encode(ls.join('\n') + '\n'));
	// manifest は既有行(cap30)へ追記（ap）→ 追記ログ互換の実地検証を兼ねる
	await OPFS.ap(`rooms/${c.rid}/manifest.${c.uid}.jsonl`, new TextEncoder().encode(man.join('\n') + '\n'));
	return { days: byDay.size, lines: man.length };
}, N).then(r => console.log('SYNTH:', JSON.stringify(r))).catch(e => console.log('SYNTH ERR:', '' + e));
const synthOk = await p.evaluate(async () => {
	const { OPFS } = await import('/OPFS.js');
	const l = await OPFS.ls('meta');
	const d = (l.filter(e => e.s !== undefined && /^d\d+\.jsonl$/.test(e.k))).length;
	const l2 = await OPFS.ls('rooms');
	return { days: d, mf: l2.filter(e => e.s !== undefined && /\.jsonl$/.test(e.k)).length };
});
console.log('SYNTH FILES:', JSON.stringify(synthOk));
ck('synthFiles', synthOk.days >= 300 && synthOk.mf >= 1, JSON.stringify(synthOk));
const tR = Date.now();
await p.reload();
await p.waitForFunction(() => window.__IRAPP && window.__IRAPP.view, null, { timeout: 30000 });
console.log('reload→boot ms:', Date.now() - tR);
await p.waitForFunction(() => {
	const a = window.__IRAPP.activeCtx();
	if (a && a.session && a.session.state.authed) return true;
	return !!document.querySelector('input[name="ir-pw"]');
}, null, { timeout: 30000 });
if (await p.evaluate(() => !window.__IRAPP.activeCtx()?.session?.state.authed)) {
	await p.fill('input[name="ir-nm"]', ROOM);
	await p.fill('input[name="ir-uid"]', 'PON');
	await p.fill('input[name="ir-pw"]', PW);
	await p.click('.ir-frm button:has-text("ログイン")');
}
const tL = Date.now();
for (let k = 0; k < 10; k++) {
	const st = await p.evaluate(() => ({
		v: window.__IRAPP && window.__IRAPP.view && window.__IRAPP.view.t,
		a: window.__IRAPP.activeCtx() ? window.__IRAPP.activeCtx().session.state.authed : null,
		m: window.__IRAPP.activeCtx() ? window.__IRAPP.activeCtx().collection.metas.size : null,
		s: window.__IRAPP.activeCtx() ? JSON.stringify(Object.entries(window.__IRAPP.activeCtx().session.state).filter(x => typeof x[1] !== 'object')) : null,
		rooms: window.__IRAPP.rooms.size,
		toasts: [...document.querySelectorAll('.ir-toast')].map(x => x.textContent).slice(0, 3),
	}));
	console.log('WAIT' + k + ':', JSON.stringify(st));
	if (st.a) break;
	await p.waitForTimeout(4000);
}
await p.waitForFunction(() => window.__IRAPP.activeCtx()?.session?.state.authed, null, { timeout: 30000 }).catch(async () => {
	let dump = 'eval fail';
	try {
		dump = JSON.stringify(await p.evaluate(() => ({
			view: window.__IRAPP && window.__IRAPP.view,
			authed: window.__IRAPP.activeCtx() && window.__IRAPP.activeCtx().session && window.__IRAPP.activeCtx().session.state.authed,
			metas: window.__IRAPP.activeCtx() && window.__IRAPP.activeCtx().collection.metas.size,
			form: !!document.querySelector('input[name="ir-pw"]'),
		})));
	} catch (e) { dump += ' ' + e; }
	console.log('BOOT DUMP:', dump);
	console.log('ERRS:', JSON.stringify(errors.slice(0, 8)));
	process.exit(2);
});
const bootMs = Date.now() - tL;
console.log('login→authed ms:', bootMs);
await p.waitForTimeout(3500);
const boot = await snap('boot:with100k');
ck('bootMetas', boot.metas >= N + 30, `metas=${boot.metas}`); // cap30 の meta は当日 day ファイル保持でサバイブ
ck('bootFast', bootMs < 30000, `login ms=${bootMs}`);
ck('domBounded', boot.thumbDom <= 1200, `dom thumbs=${boot.thumbDom}`); // 当月 ~7.7 千件でも窓×cap に収まる（cap 無しなら数千）
ck('heapBounded', boot.heapMB <= 80, `heap=${boot.heapMB}MB`);

// ---- 3) 10 万 manifest 下で 1 件 share の saveManifest が O(1) ----
const sm = await p.evaluate(async () => {
	const c = window.__IRAPP.activeCtx();
	const cc = document.createElement('canvas');
	cc.width = 32;
	cc.height = 32;
	cc.getContext('2d').fillRect(0, 0, 32, 32);
	const b = await new Promise(r => cc.toBlob(r, 'image/png'));
	const before = c.collection._mLines;
	const t0 = performance.now();
	const res = await c.collection.share(new File([b], 'one.png', { type: 'image/png' }), { name: 'one.png', mime: 'image/png' });
	await c.collection.saveManifest();
	return { ms: Math.round(performance.now() - t0), n: c.collection.mset.has(res.h10), grew: c.collection._mLines - before };
});
// 追記ログ: 行数がちょうど +1（full 全書きでなく append）+ 10 万 manifest 下でも share<3s（O(1) 追記。全書き O(N) とは規模が違う）
ck('saveManifestO1', sm.n && sm.grew === 1 && sm.ms < 3000, JSON.stringify(sm));

await p.screenshot({ path: OUT + 'img_scale.png' });
ck('noPageErrors', errors.length === 0, errors.slice(0, 3).join(' | '));
if (fails.length) {
	console.log('SCALE FAIL:', fails.join(','));
	await browser.close();
	process.exit(1);
}
console.log('SCALE OK');
await browser.close();
process.exit(0);
