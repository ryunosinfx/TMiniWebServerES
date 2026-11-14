// browserTest/tests/img-perf.mjs — 低スペック/低メモリ端末想定の処理量・メモリ実測（中間性能チェック）
// 測定向け: CDP page.metrics()（JS heap/Nodes/Listeners/TaskDuration）+ アプリ内部 Map サイズ + DOM ノード数。
// シナリオ: 起動 → 部屋作成 → 40 画像共有 → カレンダー窓 → 大画像ビューア(開/閉) → 一括 ZIP(ピーク) →
// ログアウト/再ログイン×3（リーク傾向）→ リロード(データ有り boot) → CPU 4x スロットル時の表示時間。
import { launchEngine } from './lib.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = 'http://127.0.0.1:8080';
const OUT = fileURLToPath(new URL('../out/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const ROOM = 'IRPERF' + Math.random().toString(36).slice(2, 5);
const PW = 'PW';
const { browser } = await launchEngine();
const errors = [];
const ctx = await browser.newContext({ locale: 'ja-JP', acceptDownloads: true });
const p = await ctx.newPage();
p.on('pageerror', e => errors.push('' + e));
const cdp = await ctx.newCDPSession(p);
await cdp.send('Performance.enable').catch(() => {});
const snaps = [];
const inner = () =>
	p.evaluate(() => {
		const x = window.__IRAPP && window.__IRAPP.activeCtx();
		return {
			metas: x ? x.collection.metas.size : null,
			thumbs: x ? x.sheet.thumbs.size : null,
			mounts: x && x.cal ? x.cal.mounts.size : null,
			progs: x && x.cal ? x.cal.progs.size : null,
			rr: x && x.transfer ? x.transfer.rr.size : null,
			dom: document.querySelectorAll('*').length,
		};
	});
async function snap(label, forceGc = true) {
	if (forceGc) {
		try {
			await cdp.send('HeapProfiler.collectGarbage');
		} catch (e) { /* headless 設定により不可なら素計測 */ }
	}
	const { metrics } = await cdp.send('Performance.getMetrics');
	const g = n => {
		const e2 = metrics.find(x => x.name === n);
		return e2 ? e2.value : -1;
	};
	const m = { JSHeapUsedSize: g('JSHeapUsedSize'), Nodes: g('Nodes'), JSEventListeners: g('JSEventListeners'), TaskDuration: g('TaskDuration'), LayoutCount: g('LayoutCount'), RecalcStyleCount: g('RecalcStyleCount') };
	const i = await inner();
	const row = {
		label,
		heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1),
		nodes: m.Nodes,
		lstn: m.JSEventListeners,
		dom: i.dom,
		metas: i.metas,
		thumbs: i.thumbs,
		mounts: i.mounts,
		progs: i.progs,
		rr: i.rr,
		taskS: +m.TaskDuration.toFixed(2),
		layout: m.LayoutCount,
		style: m.RecalcStyleCount,
	};
	snaps.push(row);
	console.log(JSON.stringify(row));
}

// ---- 起動・部屋作成 ----
await p.goto(BASE + '/img_room.html');
await p.waitForSelector('button:has-text("参加")');
await snap('boot:home');
await p.click('button:has-text("部屋作成")');
await p.fill('input[name="ir-cn"]', ROOM);
await p.fill('input[name="ir-cuid"]', 'PONTA');
await p.fill('input[name="ir-cpw"]', PW);
await p.click('.ir-frm button:has-text("部屋作成")');
await p.waitForFunction(() => window.__IRAPP.activeCtx()?.session?.state.authed, null, { timeout: 30000 });
await snap('room:created');

// ---- 41 画像共有（40 小 + 1 大 2.6MB）: fi.files 経由（実アプリと同じ経路）----
await p.evaluate(async () => {
	// ページ内で PNG を生成し、DataTransfer 経由で file input に設定する準備（setInputFiles 用の生成関数を保持）
	window.__gen = async (w, h, noise, label, seed) => {
		const c = document.createElement('canvas');
		c.width = w;
		c.height = h;
		const g = c.getContext('2d');
		for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) {
			const sd = seed || 0;
			const v = (7 + sd * 37 + x * (3 + (sd % 7)) + y * (5 + (sd % 11)) + ((x * y) >> (sd % 4))) % noise;
			g.fillStyle = `rgb(${v + 20},${(v * (3 + (sd % 5))) % 256},${(v * (2 + (sd % 9)) + sd) % 256})`;
			g.fillRect(x, y, 8, 8);
		}
		g.fillStyle = '#000';
		g.font = '20px sans-serif';
		g.fillText(label, 10, 30);
		const blob = await new Promise(r => c.toBlob(r, 'image/png'));
		return new Uint8Array(await blob.arrayBuffer());
	};
});
const files = [];
for (let i = 0; i < 40; i++) files.push({ name: `perf${i}.png`, mimeType: 'image/png', buffer: Buffer.from(await p.evaluate(async k => Array.from(await window.__gen(480, 360, 40, 'small' + k, k)), i)) });
const t0 = Date.now();
files.push({ name: 'perfBIG.png', mimeType: 'image/png', buffer: Buffer.from(await p.evaluate(async () => Array.from(await window.__gen(1900, 1900, 250, 'big', 99)))) });
console.log('gen ms:', Date.now() - t0);
await p.setInputFiles('.ir-file', files);
await p.waitForFunction(() => window.__IRAPP.activeCtx().collection.metas.size >= 41, null, { timeout: 120000 });
await p.waitForFunction(() => window.__IRAPP.activeCtx().sheet.thumbs.size >= 41, null, { timeout: 60000 });
await snap('shared:41');

// ---- カレンダー表示・窓スクロール ----
const tC = Date.now();
await p.click('.ir-calmode:text-is("月")');
await p.waitForFunction(() => [...document.querySelectorAll('.ir-thumb img')].length >= 3, null, { timeout: 30000 });
console.log('month render ms:', Date.now() - tC);
await p.evaluate(() => { const bx = window.__IRAPP.activeCtx().cal._bx; if (bx) bx.scrollTop = 100000; });
await p.waitForTimeout(800);
await snap('cal:scrolled');

// ---- 大画像ビューア（開→表示→閉）----
const big = await p.evaluate(() => {
	const x = window.__IRAPP.activeCtx();
	return [...x.collection.metas.keys()].find(h => window.__IRAPP.constructor.unB64(x.collection.metas.get(h).n || '') === 'perfBIG.png');
});
await p.evaluate(() => {
	window.__pk = 0;
	window.__iv = setInterval(() => {
		if (performance.memory) window.__pk = Math.max(window.__pk, performance.memory.usedJSHeapSize);
	}, 60);
});
await p.click(`.ir-thumb[data-h10="${big}"]`); // 実アプリと同じクリック経路
await p.waitForSelector('.ir-mclose', { timeout: 30000 });
await p.waitForTimeout(2500);
const peak = await p.evaluate(() => {
	clearInterval(window.__iv);
	return { peakMB: +(window.__pk / 1048576).toFixed(1), hasPerfMemory: !!performance.memory };
});
console.log('viewer peak (in-page performance.memory):', JSON.stringify(peak));
await p.waitForSelector('.ir-mclose');
await p.click('.ir-mclose');
await p.waitForTimeout(400);
await snap('viewer:closed');

// ---- 一括 ZIP DL（ピークは GC なしの素計測で近傍観測）----
const tz = Date.now();
await p.click('button:has-text("一括 DL")');
const dl = await p.waitForEvent('download', { timeout: 60000 });
await snap('zip:done', false); // GC せず素の heap（blob 保持状態に近いか確認）
console.log('zip ms:', Date.now() - tz, 'file:', dl.suggestedFilename());
await p.waitForTimeout(1500);
await snap('zip:after');

// ---- ログアウト/再ログイン ×3（C1/C2 修正後のリーク傾向確認）----
	const ensureLogin = async () => {
		// autoJoin（§5.1/§9.12 永続ログイン）の完了 or 失敗 UI 出現まで待つ
		await p.waitForFunction(() => {
			const a = window.__IRAPP.activeCtx();
			if (a && a.session && a.session.state.authed) return true;
			return !!document.querySelector('input[name="ir-pw"]') || [...document.querySelectorAll('button')].some(x => x.textContent.trim() === '参加' && x.offsetParent);
		}, null, { timeout: 20000 });
		if (await p.evaluate(() => !!window.__IRAPP.activeCtx()?.session?.state.authed)) return;
		if (!(await p.$('input[name="ir-pw"]'))) {
			// autoJoin 競合: 部屋ビュー切替後は認証完了を待つ（参加ボタンは消えている）。高負荷時 20s まで
			if (await p.evaluate(() => { const v = window.__IRAPP.view; return !!(v && v.t === 'room'); })) {
				await p.waitForFunction(() => !!window.__IRAPP.activeCtx()?.session?.state.authed, null, { timeout: 20000 });
				return;
			}
			await p.waitForFunction(() => !!window.__IRAPP.activeCtx()?.session?.state.authed, null, { timeout: 8000 }).catch(() => {});
			if (await p.evaluate(() => !!window.__IRAPP.activeCtx()?.session?.state.authed)) return;
			await p.click('button:has-text("参加")', { timeout: 8000 });
			await p.waitForSelector('input[name="ir-pw"]', { timeout: 15000 });
		}
		await p.fill('input[name="ir-nm"]', ROOM);
		await p.fill('input[name="ir-uid"]', 'PONTA');
		await p.fill('input[name="ir-pw"]', PW);
		await p.click('.ir-frm button:has-text("ログイン")');
	};
const reloginMbs = [];
for (let i = 0; i < 3; i++) {
	await p.click('button:has-text("ログアウト")');
	await ensureLogin();
	await p.waitForFunction(() => window.__IRAPP.activeCtx()?.session?.state.authed, null, { timeout: 30000 });
	await p.waitForTimeout(600);
	const mm = (await cdp.send('Performance.getMetrics')).metrics;
	reloginMbs.push(+(((mm.find(x => x.name === 'JSHeapUsedSize') || {}).value || 0) / 1048576).toFixed(1));
	await snap('relogin#' + (i + 1));
}

// ---- リロード（データ有り boot: OPFS 41 件の meta 読込）----
const tr = Date.now();
await p.reload();
await p.waitForFunction(() => window.__IRAPP && window.__IRAPP.view, null, { timeout: 30000 });
console.log('reload→boot ms:', Date.now() - tr);
await ensureLogin();
await p.waitForFunction(() => window.__IRAPP.activeCtx()?.session?.state.authed, null, { timeout: 30000 });
await snap('boot:with41');

// ---- CPU 4x スロットル（低スペック端末模擬）: 40 件月窓の再表示時間 ----
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
const tc4 = Date.now();
await p.click('.ir-calmode:text-is("週")');
await p.click('.ir-calmode:text-is("月")');
try {
	await p.waitForFunction(() => [...document.querySelectorAll('.ir-thumb img')].length >= 3, null, { timeout: 60000 });
	console.log('month render @4x ms:', Date.now() - tc4);
} catch (e) {
	console.log('month render @4x: FAIL', await p.evaluate(() => JSON.stringify({
		thumbs: document.querySelectorAll('.ir-thumb').length,
		imgs: document.querySelectorAll('.ir-thumb img').length,
		mode: window.__IRAPP.activeCtx()?.cal?.mode,
		mounts: window.__IRAPP.activeCtx()?.cal?.mounts?.size,
		scrollH: window.__IRAPP.activeCtx()?.cal?._bx?.scrollHeight })));
}
await p.waitForTimeout(600);
await snap('cal@4x');
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
await p.screenshot({ path: OUT + 'img_perf.png' });

// ---- 集計 ----
console.log(JSON.stringify({ engine: 'chromium', room: ROOM, snaps, errors }, null, 1));
console.log('PERF DONE');
await browser.close();
process.exit(0);
