// browserTest/tests/img-sec.mjs — v1.7 §21 見出し行ベース時系列リストの仕様検査:
// 1 画像 1 枠 / 日毎・週毎・月毎の改行 / 空日の扱い(無し=今日のみ・隣接空日・直近空アンカー) /
// 見出し整形(YYYY-MM-DD: 変わったらフル、同じなら省略 / 週=週初めフル / 月=YYYY/MM)。
import { launchEngine } from './lib.mjs';

const BASE = 'http://127.0.0.1:8080';
const ROOM = 'IRSC' + Math.random().toString(36).slice(2, 5);
const fails = [];
const ck = (name, ok, extra) => {
	console.log((ok ? 'ok ' : 'FAIL ') + name + (extra ? ' ' + extra : ''));
	if (!ok) fails.push(name);
};
const { browser } = await launchEngine();
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ja-JP' });
const p = await ctx.newPage();
p.on('pageerror', e => errors.push('' + e));
p.on('console', m => {
	if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push('console: ' + m.text().slice(0, 160));
});
await p.goto(BASE + '/img_room.html');
await p.waitForSelector('button:has-text("参加")');
await p.click('button:has-text("部屋作成")');
await p.fill('input[name="ir-cn"]', ROOM);
await p.fill('input[name="ir-cuid"]', 'PON');
await p.fill('input[name="ir-cpw"]', 'PW');
await p.click('.ir-frm button:has-text("部屋作成")');
await p.waitForFunction(() => window.__IRAPP.activeCtx()?.session?.state.authed, null, { timeout: 30000 });

// E1: 画像なし → 今日のセクション 1 個だけ（ラベルは日付のみ・画像スロットなし）
await p.waitForTimeout(800);
const e1 = await p.evaluate(() => ({
	secs: document.querySelectorAll('.cal-cell').length,
	head: document.querySelector('.cal-ch') ? document.querySelector('.cal-ch').textContent : '',
	thumbs: document.querySelectorAll('.ir-thumb').length,
	now: (() => {
		const d = new Date(),
			p2 = n => (n < 10 ? '0' + n : '' + n);
		return `${d.getFullYear()}/${p2(d.getMonth() + 1)}`;
	})(),
}));
ck('emptyTodayOnly', e1.secs === 1 && e1.thumbs === 0 && e1.head.startsWith(e1.now), JSON.stringify(e1));
await p.click('.ir-calmode:text-is("日")');
await p.waitForTimeout(600);
const e1d = await p.evaluate(() => ({
	secs: document.querySelectorAll('.cal-day').length,
	head: document.querySelector('.cal-ch') ? document.querySelector('.cal-ch').textContent : '',
})) ;
ck('emptyTodayDay', e1d.secs === 1 && /^\d{4}\/\d{2}\/\d{2}$/.test(e1d.head), JSON.stringify(e1d));

// 散在投入: 1 日前(2 枚)・2 日前・9 日前・10 日前（3〜8 日前は空）。10 日前は前月に入り得る
const N = 5;
await p.evaluate(async n => {
	const { OPFS } = await import('/OPFS.js');
	const c = window.__IRAPP.activeCtx();
	const DAY = 86400000,
		now = Date.now();
	const offs = [1, 1, 2, 9, 10].slice(0, n);
	const man = [],
		byDay = new Map();
	for (let i = 0; i < offs.length; i++) {
		const ts = now - offs[i] * DAY - 3600000 * (1 + (i % 10));
		const hh = 'sec' + String(i).padStart(4, '0') + 'AAAAAAAAAAAAAAAA';
		const m = { h: hh, n: 'c2Nhbg' + i, r: [c.nameB64U], u: c.uid, ts, t: 'image/png', l: 500, s: 400, d: null };
		const day = Math.floor(ts / DAY);
		if (!byDay.has(day)) byDay.set(day, []);
		byDay.get(day).push(JSON.stringify(m));
		man.push(JSON.stringify({ h: hh, n: m.n, r: m.r, u: c.uid, ts, t: m.t, l: m.l, s: m.s }));
	}
	for (const [day, ls] of byDay) await OPFS.w(`meta/d${day}.jsonl`, new TextEncoder().encode(ls.join('\n') + '\n'));
	await OPFS.ap(`rooms/${c.rid}/manifest.${c.uid}.jsonl`, new TextEncoder().encode(man.join('\n') + '\n'));
	return byDay.size;
}, N);
await p.reload();
await p.waitForFunction(() => window.__IRAPP && window.__IRAPP.view, null, { timeout: 30000 });
await p.waitForFunction(() => {
	const a = window.__IRAPP.activeCtx();
	if (a && a.session && a.session.state.authed) return true;
	return !!document.querySelector('input[name="ir-pw"]');
}, null, { timeout: 30000 });
if (await p.evaluate(() => !window.__IRAPP.activeCtx()?.session?.state.authed)) {
	await p.fill('input[name="ir-pw"]', 'PW');
	await p.click('.ir-frm button:has-text("ログイン")');
}
await p.waitForFunction(() => window.__IRAPP.activeCtx()?.session?.state.authed, null, { timeout: 90000 });
await p.waitForTimeout(2500);
await p.click('.ir-calmode:text-is("日")');
await p.waitForTimeout(1200);

// ① 日モード: 今日(空アンカー)+画像日の隣接空日+画像日。間 3〜8 日前は不表示
// セクション構成はウィンドウ実体化と無関係にモデル(sec)で検証。DOM はスクロール走査で別途確認
const day = await p.evaluate(() => {
	const x = window.__IRAPP.activeCtx().cal.cal;
	return {
		heads: x.sec.map((s, i) => x.secLabel(i)),
		lens: x.sec.map(s => s.v.length),
		mounted: document.querySelectorAll('.cal-day').length,
	};
});
const exp = await p.evaluate(() => {
	const p2 = n => (n < 10 ? '0' + n : '' + n),
		D = 86400000,
		t = new Date();
	t.setHours(0, 0, 0, 0);
	const offs = [0, -1, -2, -3, -8, -9, -10, -11];
	let prev = null;
	const out = [];
	for (const o of offs) {
		const d = new Date(t.getTime() + o * D);
		const y = d.getFullYear(),
			m = p2(d.getMonth() + 1),
			dd = p2(d.getDate());
		out.push(!prev || prev[0] !== y ? `${y}/${m}/${dd}` : prev[1] !== m ? `${m}/${dd}` : dd);
		prev = [y, m];
	}
	return out;
});
ck('daySections', day.heads.length === 8 && day.mounted >= 3, 'n=' + day.heads.length + ' mounted=' + day.mounted + ' heads=' + JSON.stringify(day.heads));
ck('dayLabels', JSON.stringify(day.heads) === JSON.stringify(exp), `exp=${JSON.stringify(exp)}`);
// 空日で表示されるのは隣接分のみ: 3 日前(07)は表示、4〜7 日前(06,05,04,03)は不表示
ck('dayGapHidden', !day.heads.some(h => ['03', '04', '05', '06'].includes(h)) && day.heads.includes('07'), JSON.stringify(day.heads));
ck('dayEmptyHeadsDateOnly', /^\d{4}\/\d{2}\/\d{2}$/.test(day.heads[0]) && day.lens[0] === 0 && day.lens[1] === 2, JSON.stringify(day.lens));
ck('oneImgOneSlot', day.lens.reduce((a, b) => a + b, 0) === 5 && JSON.stringify(day.lens) === JSON.stringify([0, 2, 1, 0, 0, 1, 1, 0]), JSON.stringify(day.lens));
// DOM 走査: ページを最後までスクロールして全スロットが重複なく 1 回描画されること（窓実体化の追従確認）
const seen = await p.evaluate(async () => {
	const u = new Set();
	let cellMax = 0;
	for (let y = 0; y <= document.documentElement.scrollHeight; y += 600) {
		window.scrollTo(0, y);
		await new Promise(r => setTimeout(r, 350));
		for (const e of document.querySelectorAll('.ir-thumb')) if (e.dataset.h10) u.add(e.dataset.h10);
		for (const c of document.querySelectorAll('.cal-day')) cellMax = Math.max(cellMax, c.querySelectorAll('.ir-thumb').length);
	}
	return { uniq: u.size, cellMax, lastHead: [...document.querySelectorAll('.cal-day .cal-ch')].pop().textContent.trim() };
});
ck('scanAllSlots', seen.uniq === 5 && seen.cellMax <= 12 && seen.lastHead === '30', JSON.stringify(seen));

// ② 月モード: 現月 + 隣接前月 + 直近空アンカー(前々月)。ラベルは YYYY/MM。空月は見出しのみ
await p.click('.ir-calmode:text-is("月")');
await p.waitForTimeout(1200);
const mo = await p.evaluate(() => {
	const x = window.__IRAPP.activeCtx().cal.cal;
	const now = (() => {
		const d = new Date(),
			p2 = n => (n < 10 ? '0' + n : '' + n);
		return `${d.getFullYear()}/${p2(d.getMonth() + 1)}`;
	})();
	return { heads: x.sec.map((s, i) => x.secLabel(i)), lens: x.sec.map(s => s.v.length), now };
});
ck('monthSections', mo.heads.length === 3 && mo.heads[0] === mo.now && mo.heads.every(h => /^\d{4}\/\d{2}$/.test(h)), JSON.stringify(mo.heads));
ck('monthEmptyTail', JSON.stringify(mo.lens) === JSON.stringify([4, 1, 0]), JSON.stringify(mo.lens));

// ③ 週モード: 見出しは週開始日(周日)の YYYY/MM/DD のみ。週毎に改行（セクション）
await p.click('.ir-calmode:text-is("週")');
await p.waitForTimeout(1200);
const wk = await p.evaluate(() => {
	const x = window.__IRAPP.activeCtx().cal.cal;
	const hs = x.sec.map((s, i) => x.secLabel(i));
	const sundays = hs.every(h => {
		const m = h.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
		if (!m) return false;
		return new Date(+m[1], +m[2] - 1, +m[3]).getDay() === 0;
	});
	const step7 = hs.length >= 2 && hs.every((h, i) => {
		if (i === 0) return true;
		const a = hs[i - 1].match(/^(\d{4})\/(\d{2})\/(\d{2})$/),
			b = h.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
		return new Date(+a[1], +a[2] - 1, +a[3]) - new Date(+b[1], +b[2] - 1, +b[3]) === 7 * 86400000;
	});
	const t = new Date();
	t.setHours(0, 0, 0, 0);
	const p2 = n => (n < 10 ? '0' + n : '' + n),
		su = new Date(t.getTime() - t.getDay() * 86400000);
	return { hs, lens: x.sec.map(s => s.v.length), sundays, step7, first: `${su.getFullYear()}/${p2(su.getMonth() + 1)}/${p2(su.getDate())}` };
});
ck('weekSections', wk.hs.length === 4 && wk.sundays && wk.step7 && wk.hs[0] === wk.first, JSON.stringify(wk.hs));
ck('weekEmptyTail', JSON.stringify(wk.lens) === JSON.stringify([3, 1, 1, 0]), JSON.stringify(wk.lens));
ck('noPageErrors', errors.length === 0, errors.slice(0, 3).join(' | '));
if (fails.length) {
	console.log('SEC FAIL:', fails.join(','));
	await browser.close();
	process.exit(1);
}
console.log('SEC OK');
await browser.close();
process.exit(0);
