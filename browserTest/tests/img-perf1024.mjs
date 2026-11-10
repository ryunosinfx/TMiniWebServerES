// browserTest/tests/img-perf1024.mjs — 1024 枚投入ストレッサー（低スペック/低メモリ破綻検証）
// 画像は index 番号+模様を埋め込み全件ユニーク。実アプリと同じ file input→share 経路で 1 括投入。
// 計測: 共有中の進行（heap/metas）、共有完了、月/週/日窓（1024 件同日）、ビューア、ZIP(1024)、
// リロード boot(1024 meta)、ログアウト/再ログイン×2（破綻・増加速度）、error 収集。
import { launchEngine } from './lib.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const N = 1024;
const BASE = 'http://127.0.0.1:8080';
const OUT = fileURLToPath(new URL('../out/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const ROOM = 'K1024' + Math.random().toString(36).slice(2, 5);
const PW = 'PW';
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
});
const cdp = await ctx.newCDPSession(p);
await cdp.send('Performance.enable').catch(() => {});
const snaps = [];
async function snap(label, note = '') {
	try {
		await cdp.send('HeapProfiler.collectGarbage');
	} catch (e) { /* 設定により不可なら素計測 */ }
	const { metrics } = await cdp.send('Performance.getMetrics');
	const g = n => (metrics.find(x => x.name === n) || {}).value ?? -1;
	const i = await p.evaluate(() => {
		const x = window.__IRAPP && window.__IRAPP.activeCtx();
		return {
			metas: x ? x.collection.metas.size : null,
			thumbs: x ? x.sheet.thumbs.size : null,
			mounts: x && x.cal ? x.cal.mounts.size : null,
			items: x && x.cal ? x.cal.items.length : null,
			dom: document.querySelectorAll('*').length,
			imgs: document.querySelectorAll('.ir-thumb img').length,
			sheets: x ? x.sheet.index.size : null,
		};
	});
	const row = {
		label,
		heapMB: +(g('JSHeapUsedSize') / 1048576).toFixed(1),
		totalMB: +(g('JSHeapTotalSize') / 1048576).toFixed(1),
		nodes: g('Nodes'),
		lstn: g('JSEventListeners'),
		taskS: +g('TaskDuration').toFixed(2),
		...i,
		...(note ? { note } : {}),
	};
	snaps.push(row);
	console.log(JSON.stringify(row));
	return row;
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

// ---- 1024 枚生成（index 埋め込み・全件ユニーク）: 64 枚/バッチで CDP 転送 ----
await p.evaluate(() => {
	window.__genB = (w, h, i) => {
		const c = document.createElement('canvas');
		c.width = w;
		c.height = h;
		const g = c.getContext('2d');
		for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) {
			const v = (i * 61 + x * 7 + y * 13 + ((x * y) >> 4)) % 210;
			g.fillStyle = `rgb(${v + 15},${(v * (3 + (i % 5))) % 256},${(v * (2 + (i % 9)) + i) % 256})`;
			g.fillRect(x, y, 8, 8);
		}
		g.fillStyle = '#fff';
		g.fillRect(4, 4, 92, 26);
		g.fillStyle = '#000';
		g.font = 'bold 20px monospace';
		g.fillText('#' + i, 8, 25);
		return new Promise(r => c.toBlob(r, 'image/png'));
	};
});
const files = [];
const tGen = Date.now();
for (let b0 = 0; b0 < N; b0 += 64) {
	const b64s = await p.evaluate(async from => {
		const out = [];
		for (let i = from; i < from + 64 && i < 1024; i++) {
			const blob = await window.__genB(240, 180, i);
			const u8 = new Uint8Array(await blob.arrayBuffer());
			let s = '';
			for (let k = 0; k < u8.length; k += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(k, k + 0x8000));
			out.push(btoa(s));
		}
		return out;
	}, b0);
	for (let k = 0; k < b64s.length; k++) {
		const i = b0 + k;
		files.push({ name: `img${String(i).padStart(4, '0')}.png`, mimeType: 'image/png', buffer: Buffer.from(b64s[k], 'base64') });
	}
}
const totalBytes = files.reduce((a, f) => a + f.buffer.length, 0);
console.log(`gen ${files.length} imgs ms=${Date.now() - tGen} bytes=${(totalBytes / 1048576).toFixed(2)}MB`);
ck('genUnique', new Set(files.map(f => f.buffer.toString('base64'))).size === N, `unique=${new Set(files.map(f => f.buffer.toString('base64'))).size}`);

// ---- 1 括投入（file input 1024 files → 実 share ループ）+ 進行監視 ----
const tShare = Date.now();
await p.setInputFiles('.ir-file', files);
let lastM = -1;
const deadline = Date.now() + 420000;
while (Date.now() < deadline) {
	const m = await p.evaluate(() => window.__IRAPP.activeCtx()?.collection?.metas?.size ?? 0);
	if (m !== lastM) {
		const mm = (await cdp.send('Performance.getMetrics')).metrics;
		const h = +(((mm.find(x => x.name === 'JSHeapUsedSize') || {}).value || 0) / 1048576).toFixed(1);
		console.log(`share progress: metas=${m} heapMB=${h} ms=${Date.now() - tShare}`);
		lastM = m;
	}
	if (m >= N) break;
	await p.waitForTimeout(2500);
}
const shareMs = Date.now() - tShare;
ck('shareAll', lastM >= N, `metas=${lastM} ms=${shareMs}`);
// シート再構築完了待ち（thumbs は manifest 件数に一致）
const th = await p.evaluate(() => window.__IRAPP.activeCtx()?.sheet?.thumbs?.size ?? 0);
ck('thumbsBuilt', th >= N, `thumbs=${th}`);
await snap('shared:1024', `shareMs=${shareMs}`);

// ---- カレンダー: 月窓（1024 件が同日セルに集中）----
const tC = Date.now();
await p.click('.ir-calmode:text-is("月")');
try {
	await p.waitForFunction(() => document.querySelectorAll('.ir-thumb img').length >= 5, null, { timeout: 60000 });
	console.log('month render ms:', Date.now() - tC);
} catch (e) {
	ck('monthRender', false, 'img<5 in 60s');
}
// シート再生成(setItems 再描画)が走るため、snap 直前で img 再現を再待機（v1.5: cap で DOM 少量化→再描画後の再読込が相対的に目立つ）
await p.waitForFunction(() => document.querySelectorAll('.ir-thumb img').length >= 5, null, { timeout: 90000 }).catch(() => {});
const monthRow = await snap('cal:month1024');
// v1.5 §19: 日セル表示上限 CELL_CAP=12（DOM 定数化）。items 全件は inner 側で保持。
ck('monthCapped', monthRow.items >= N && monthRow.mounts > 0 && monthRow.mounts <= 12 * 42, `mounts=${monthRow.mounts} items=${monthRow.items}`); // 月ページ=最大42セル×cap12
ck('monthImgs', monthRow.imgs > 0, `imgs=${monthRow.imgs}`);
await p.evaluate(() => {
	const bx = window.__IRAPP.activeCtx().cal._bx;
	if (bx) bx.scrollTop = 100000;
});
await p.waitForTimeout(1500);
await snap('cal:scrolled');

// ---- 週 / 日 ----
await p.click('.ir-calmode:text-is("週")');
await p.waitForTimeout(1500);
await snap('cal:week');
await p.click('.ir-calmode:text-is("日")');
await p.waitForTimeout(1500);
const dayRow = await snap('cal:day');
ck('dayCapped', dayRow.mounts > 0 && dayRow.mounts <= 100, `mounts=${dayRow.mounts}`);
await p.click('.ir-calmode:text-is("月")');
await p.waitForTimeout(1200);

// ---- ビューア（#1000 をクリック経路で）----
const h1000 = await p.evaluate(() => {
	const x = window.__IRAPP.activeCtx();
	for (const [h, mt] of x.collection.metas) {
		const nm = window.__IRAPP.constructor.unB64(mt.n || '');
		if (nm === 'img1000.png') return h;
	}
	return null;
});
ck('meta1000found', !!h1000);
if (h1000) {
	// v1.5 §19: cap により 1000 枚目が DOM に無いことがあるため、実際にマウントされたセルから選ぶ
	const shown = await p.evaluate(() => {
		const el = document.querySelector('.cal-cell .ir-thumb[data-h10]');
		return el ? el.dataset.h10 : null;
	});
	ck('viewerTarget', !!shown, shown ? 'ok' : 'no mounted thumb');
	if (!shown) { await snap('viewer:skipped'); }
	else await (async () => {
	await p.evaluate(() => {
		window.__pk = 0;
		window.__iv = setInterval(() => {
			if (performance.memory) window.__pk = Math.max(window.__pk, performance.memory.usedJSHeapSize);
		}, 60);
	});
	const tV = Date.now();
	await p.click(`.ir-thumb[data-h10="${shown}"]`);
	await p.waitForSelector('.ir-mclose', { timeout: 30000 }).catch(() => ck('viewerOpen', false));
	console.log('viewer open ms:', Date.now() - tV);
	await p.waitForTimeout(1500);
	const pk = await p.evaluate(() => {
		clearInterval(window.__iv);
		return +(window.__pk / 1048576).toFixed(1);
	});
	console.log('viewer peak (performance.memory):', pk, 'MB');
	await p.click('.ir-mclose');
	await p.waitForTimeout(600);
	await snap('viewer:closed');
	})();
}

// ---- 一括 ZIP（1024 件）----
const tZ = Date.now();
await p.click('button:has-text("一括 DL")');
const dls = [];
p.on('download', d => dls.push(d.suggestedFilename()));
await p.waitForTimeout(1500);
await snap('zip:mid', '');
const zok = await p.waitForEvent('download', { timeout: 120000 }).catch(() => null);
const zipMs = Date.now() - tZ;
ck('zipDownload', !!zok, `parts=${dls.length} ms=${zipMs}`);
await p.waitForTimeout(2500);
await snap('zip:after');

// ---- リロード（1024 meta の cold boot）----
const tR = Date.now();
await p.reload();
await p.waitForFunction(() => window.__IRAPP && window.__IRAPP.view, null, { timeout: 30000 });
console.log('reload→boot ms:', Date.now() - tR);
await p.waitForFunction(() => {
	const a = window.__IRAPP.activeCtx();
	if (a && a.session && a.session.state.authed) return true;
	return !!document.querySelector('input[name="ir-pw"]');
}, null, { timeout: 30000 });
const needForm = await p.evaluate(() => !window.__IRAPP.activeCtx()?.session?.state.authed);
if (needForm) {
	await p.fill('input[name="ir-nm"]', ROOM);
	await p.fill('input[name="ir-uid"]', 'PONTA');
	await p.fill('input[name="ir-pw"]', PW);
	await p.click('.ir-frm button:has-text("ログイン")');
}
const tLogin = Date.now();
await p.waitForFunction(() => window.__IRAPP.activeCtx()?.session?.state.authed, null, { timeout: 60000 });
console.log('login→authed ms:', Date.now() - tLogin);
await p.waitForTimeout(2500);
const bootRow = await snap('boot:with1024');
ck('bootMetas', bootRow.metas >= N, `metas=${bootRow.metas}`);

// ---- ログアウト/再ログイン ×2（1024 規模での増加速度・破綻確認）----
for (let i = 0; i < 2; i++) {
	await p.click('button:has-text("ログアウト")');
	await p.waitForFunction(() => !!document.querySelector('input[name="ir-nm"]') || [...document.querySelectorAll('button')].some(x => x.textContent.trim() === '参加' && x.offsetParent), null, { timeout: 20000 });
	await p.click('button:has-text("参加")').catch(() => {});
	await p.waitForFunction(() => !!document.querySelector('input[name="ir-pw"]'), null, { timeout: 15000 });
	await p.fill('input[name="ir-nm"]', ROOM);
	await p.fill('input[name="ir-uid"]', 'PONTA');
	await p.fill('input[name="ir-pw"]', PW);
	await p.click('.ir-frm button:has-text("ログイン")');
	await p.waitForFunction(() => window.__IRAPP.activeCtx()?.session?.state.authed, null, { timeout: 60000 });
	await p.waitForTimeout(2500);
	await snap('relogin#' + (i + 1));
}

// ---- スクリーンショット + 結果 ----
await p.screenshot({ path: OUT + 'img_perf1024.png' });
ck('noPageErrors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('SNAPS', JSON.stringify(snaps.map(r => [r.label, r.heapMB, r.nodes, r.metas, r.imgs])));
if (fails.length) {
	console.log('PERF1024 FAIL:', fails.join(','));
	await browser.close();
	process.exit(1);
}
console.log('PERF1024 OK');
await browser.close();
process.exit(0);
