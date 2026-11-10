// browserTest/tests/img-mobile.mjs — スマホ解像度(390×844, DevTools モバイルモード相当)で
// ログイン/画像一覧/モーダルが破綻しないことの検証（v1.5 §19: 10 万件合成でも DOM/レイアウト維持）
import { launchEngine } from './lib.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = 'http://127.0.0.1:8080';
const OUT = fileURLToPath(new URL('../out/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const ROOM = 'IRMOB' + Math.random().toString(36).slice(2, 5);
const PW = 'PW';
const N = 100000;
const fails = [];
const ck = (name, ok, extra) => {
	console.log((ok ? 'ok ' : 'FAIL ') + name + (extra ? ' ' + extra : ''));
	if (!ok) fails.push(name);
};
const { browser } = await launchEngine();
const errors = [];
const ctx = await browser.newContext({
	viewport: { width: 390, height: 844 }, // Pixel/iPhone 相当（DevTools device mode と同じ解像度）
	deviceScaleFactor: 2,
	isMobile: true,
	hasTouch: true,
	locale: 'ja-JP',
});
const p = await ctx.newPage();
p.on('pageerror', e => errors.push('' + e));
p.on('console', m => {
	if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push('console: ' + m.text().slice(0, 160));
});
const noOverflow = () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const shot = async name => {
	await p.screenshot({ path: OUT + name });
	console.log('shot:', name);
};

// ---- 1) ログイン（初回 join 画面 → 部屋作成 → reload でログインフォーム）----
await p.goto(BASE + '/img_room.html');
await p.waitForSelector('button:has-text("参加")');
await shot('img_mob_1_join.png');
ck('joinNoOverflow', await noOverflow());
await p.click('button:has-text("部屋作成")');
await p.fill('input[name="ir-cn"]', ROOM);
await p.fill('input[name="ir-cuid"]', 'PON');
await p.fill('input[name="ir-cpw"]', PW);
await shot('img_mob_2_createform.png');
ck('formNoOverflow', await noOverflow());
await p.click('.ir-frm button:has-text("部屋作成")');
await p.waitForFunction(() => window.__IRAPP.activeCtx()?.session?.state.authed, null, { timeout: 30000 });

// ---- 2) 画像一覧: 同日 15 枚 → cap12 + 「+3 件」（v1.5 ①）----
await p.evaluate(async () => {
	const c = window.__IRAPP.activeCtx();
	for (let i = 0; i < 15; i++) {
		const cc = document.createElement('canvas');
		cc.width = 420;
		cc.height = 300;
		const g = cc.getContext('2d');
		g.fillStyle = `hsl(${i * 24},70%,55%)`;
		g.fillRect(0, 0, 420, 300);
		g.fillStyle = '#fff';
		g.font = 'bold 120px sans-serif';
		g.fillText(String(i + 1), 150, 200);
		const b = await new Promise(r => cc.toBlob(r, 'image/jpeg', 0.85));
		await c.collection.share(new File([b], `mob${i}.jpg`, { type: 'image/jpeg' }), { name: `mob${i}.jpg`, mime: 'image/jpeg', defer: true });
	}
	await c.collection.saveManifest();
	await c.sheet.rebuild(c.collection.manifestEntries());
});
await p.waitForFunction(() => document.querySelectorAll('.ir-thumb img').length >= 3, null, { timeout: 60000 }).catch(() => {});
await p.waitForTimeout(1500);
const cal = await p.evaluate(() => ({
	thumbs: document.querySelectorAll('.cal-cell .ir-thumb').length,
	more: [...document.querySelectorAll('.cal-more')].map(x => x.textContent),
	overflowX: document.documentElement.scrollWidth - window.innerWidth,
}));
ck('capBadge', cal.thumbs > 0 && cal.thumbs <= 12 && cal.more.some(x => /\+3 件/.test(x)), JSON.stringify(cal));
ck('calNoOverflow', cal.overflowX <= 1, `overflowX=${cal.overflowX}`);
// v2.1 §25: 日週月&サムネサイズはスマホでも左下固定で常時表示
ck('ctrlVisiblePhone', await p.evaluate(() => {
	const c = document.querySelector('.ir-ctrlbar');
	if (!c || getComputedStyle(c).position !== 'fixed') return false;
	const r = c.getBoundingClientRect();
	return r.left <= 12 && innerHeight - r.bottom <= 12 && r.top >= 0 && r.width > 40 && c.querySelectorAll('.ir-calmode').length === 3 && c.querySelectorAll('.ir-tsz').length === 4;
}));
await shot('img_mob_3_calendar.png');
await p.click('.cal-cell .cal-more');
await p.waitForTimeout(1200);
const cal2 = await p.evaluate(() => document.querySelectorAll('.cal-cell .ir-thumb').length);
ck('expand15', cal2 >= 15, `thumbs=${cal2}`);
await shot('img_mob_4_expanded.png');

// ---- 3) モーダル（ビューア）: ビューポート内に収まる・横向ち溢れ無し----
const h = await p.evaluate(() => {
	const el = document.querySelector('.cal-cell .ir-thumb[data-h10]');
	return el ? el.dataset.h10 : null;
});
ck('thumbTarget', !!h);
await p.click(`.cal-cell .ir-thumb[data-h10="${h}"]`);
await p.waitForSelector('.ir-mclose', { timeout: 30000 });
await p.waitForTimeout(1200);
const mdl = await p.evaluate(() => {
	const m = document.querySelector('.ir-mdl') || document.querySelector('.ir-mclose').closest('div');
	const r = (document.querySelector('.ir-mdl') || document.querySelector('.ir-mclose')).getBoundingClientRect();
	const img = document.querySelector('.ir-mdl img, .ir-modal img');
	return {
		top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right),
		vw: innerWidth, vh: innerHeight,
		imgs: document.querySelectorAll('.ir-mdl img, .ir-modal img').length,
		overflowX: document.documentElement.scrollWidth - window.innerWidth,
	};
});
ck('modalInView', mdl.top >= -1 && mdl.left >= -1 && mdl.right <= mdl.vw + 1 && mdl.bottom <= mdl.vh + 1, JSON.stringify(mdl));
ck('modalHasImg', mdl.imgs >= 1, JSON.stringify(mdl));
ck('modalNoOverflow', mdl.overflowX <= 1, `overflowX=${mdl.overflowX}`);
await shot('img_mob_5_viewer.png');
await p.click('.ir-mclose');
await p.waitForTimeout(800);

// ---- 4) 10 万合成（当日以外 400 日へ day/manifest jsonl 直書き）→ スマホ画面で破綻しない----
const synth = await p.evaluate(async n => {
	const { OPFS } = await import('/OPFS.js');
	const c = window.__IRAPP.activeCtx();
	const DAY = 86400000,
		now = Date.now();
	const byDay = new Map(),
		man = [];
	for (let i = 0; i < n; i++) {
		const ts = now - (1 + i % 400) * DAY - ((i * 7919) % DAY);
		const hh = 'syn' + String(i).padStart(6, '0') + 'AAAAAAAAAAAAAAAA';
		const m = { h: hh, n: 'c2Nhbg' + i, r: [c.nameB64U], u: c.uid, ts, t: 'image/png', l: 5000 + (i % 5000), s: 4000, d: null };
		const day = Math.floor(ts / DAY);
		if (!byDay.has(day)) byDay.set(day, []);
		byDay.get(day).push(JSON.stringify(m));
		man.push(JSON.stringify({ h: hh, n: m.n, r: m.r, u: c.uid, ts, t: m.t, l: m.l, s: m.s }));
	}
	for (const [day, ls] of byDay) await OPFS.w(`meta/d${day}.jsonl`, new TextEncoder().encode(ls.join('\n') + '\n'));
	await OPFS.ap(`rooms/${c.rid}/manifest.${c.uid}.jsonl`, new TextEncoder().encode(man.join('\n') + '\n'));
	return byDay.size;
}, N);
console.log('SYNTH days:', synth);
await p.reload();
await p.waitForFunction(() => window.__IRAPP && window.__IRAPP.view, null, { timeout: 30000 });
await p.waitForFunction(() => {
	const a = window.__IRAPP.activeCtx();
	if (a && a.session && a.session.state.authed) return true;
	return !!document.querySelector('input[name="ir-pw"]');
}, null, { timeout: 30000 });
if (await p.evaluate(() => !window.__IRAPP.activeCtx()?.session?.state.authed)) {
	await shot('img_mob_6_100k_login.png');
	await p.fill('input[name="ir-pw"]', PW);
	await p.click('.ir-frm button:has-text("ログイン")');
}
const tL = Date.now();
await p.waitForFunction(() => window.__IRAPP.activeCtx()?.session?.state.authed, null, { timeout: 90000 });
console.log('100k login ms:', Date.now() - tL);
await p.waitForTimeout(4000);
const big = await p.evaluate(() => ({
	metas: window.__IRAPP.activeCtx().collection.metas.size,
	thumbs: document.querySelectorAll('.ir-thumb').length,
	more: document.querySelectorAll('.cal-more').length,
	dom: document.querySelectorAll('*').length,
	overflowX: document.documentElement.scrollWidth - window.innerWidth,
	scrollable: (() => {
		const b = document.querySelector('.cal-box');
		return b ? b.scrollHeight > b.clientHeight : false;
	})(),
	box: (() => {
		const b = document.querySelector('.cal-box');
		const x = window.__IRAPP.activeCtx().cal.cal;
		return b ? { sh: b.scrollHeight, ch: b.clientHeight, mode: x.md, pg: x.pgPx(), cnt: x.pgCnt() } : null;
	})(),
}));
ck('bigMetas', big.metas >= N, `metas=${big.metas}`);
ck('bigDomBounded', big.thumbs <= 1200 && big.dom <= 6000, JSON.stringify(big));
ck('bigHasBadges', big.more >= 1, `cal-more=${big.more}`);
ck('bigNoOverflow', big.overflowX <= 1, `overflowX=${big.overflowX}`);
await shot('img_mob_7_100k_month.png');
// 上部（当月・実 body の自分の投稿）は img が実体化していること
const top = await p.evaluate(() => [...document.querySelectorAll('.ir-thumb img')].filter(el => {
	const r = el.getBoundingClientRect();
	return r.top < innerHeight && r.bottom > 0 && el.getAttribute('src');
}).length);
ck('topImgs', top >= 3, `viewport imgs=${top}`);
// .cal-box は高さ非拘束（既存レイアウト: 箱自体が伸長しページ側がスクロールする）。10 万でもページスクロールで全月が破綻なく見えること
await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
await p.waitForTimeout(1200);
const bot = await p.evaluate(() => ({
	viewThumbs: [...document.querySelectorAll('.ir-thumb')].filter(el => {
		const r = el.getBoundingClientRect();
		return r.top < innerHeight && r.bottom > 0;
	}).length,
	viewImgs: [...document.querySelectorAll('.ir-thumb img')].filter(el => {
		const r = el.getBoundingClientRect();
		return r.top < innerHeight + 80 && r.bottom > -80 && el.getAttribute('src');
	}).length,
	cellMax: (() => {
		let mx = 0;
		for (const c of document.querySelectorAll('.cal-cell')) mx = Math.max(mx, c.querySelectorAll('.ir-thumb').length);
		return mx;
	})(),
	scrolled: document.documentElement.scrollTop > 1500, // v1.7 §21: 月セクション ~15 個×pg で総高は 4k px 程度（grid 期より縮小）
secs: (() => {
	const x = window.__IRAPP.activeCtx().cal.cal;
	return { cnt: x.pgCnt(), last: [...document.querySelectorAll('.cal-cell .cal-ch')].pop() ? [...document.querySelectorAll('.cal-cell .cal-ch')].pop().textContent : '' };
})(),
}));
// 下部（約 13 か月前の合成月 + 直近空アンカー月: body 非所持 → プレースホルダ）も窓が進みセクションが cap 内で描画されること
ck('bigPageScroll', bot.scrolled && bot.viewThumbs > 0 && bot.cellMax <= 12, JSON.stringify(bot));
ck('bigSecBounded', bot.secs.cnt >= 14 && bot.secs.cnt <= 17, 'sec=' + bot.secs.cnt + ' last=' + bot.secs.last);
await shot('img_mob_9_100k_bottom.png');
// 10 万件下でもモーダル（実体のある自分の 1 枚）が開き破綻しない
const h2 = await p.evaluate(() => {
	// 合成(syn*)は body 無し → 実 body を持つ自分の投稿(mob*)から選ぶ
	for (const el of document.querySelectorAll('.cal-cell .ir-thumb[data-h10]')) {
		if (!el.dataset.h10.startsWith('syn')) return el.dataset.h10;
	}
	return null;
});
if (h2) {
	await p.click(`.cal-cell .ir-thumb[data-h10="${h2}"]`);
	await p.waitForSelector('.ir-mclose', { timeout: 30000 });
	await p.waitForTimeout(1000);
	const m2 = await p.evaluate(() => ({
		overflowX: document.documentElement.scrollWidth - window.innerWidth,
		inView: (() => {
			const r = (document.querySelector('.ir-mdl') || document.querySelector('.ir-mclose')).getBoundingClientRect();
			return r.left >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
		})(),
	}));
	ck('bigModalOk', m2.inView && m2.overflowX <= 1, JSON.stringify(m2));
	await shot('img_mob_8_100k_viewer.png');
	await p.click('.ir-mclose');
}
ck('noPageErrors', errors.length === 0, errors.slice(0, 3).join(' | '));
if (fails.length) {
	console.log('MOBILE FAIL:', fails.join(','));
	await browser.close();
	process.exit(1);
}
console.log('MOBILE OK');
await browser.close();
process.exit(0);
