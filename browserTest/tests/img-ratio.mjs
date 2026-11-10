// browserTest/tests/img-ratio.mjs — v1.6 §20: 12 種の別アスペクト比（大小混在）共有時、
// 全サムネイルが同一アスペクト比（正方形）の同一サイズ領域に contain 表示され、
// 表示領域に余白がある場合は中央寄せされることの検証。
// 主検査は日ビュー（全件が窓内＝全件実体化される）で行い、月ビューは同一領域の sanity 検査。
import { launchEngine } from './lib.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = 'http://127.0.0.1:8080';
const OUT = fileURLToPath(new URL('../out/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const ROOM = 'IRRT' + Math.random().toString(36).slice(2, 5);
const fails = [];
const ck = (name, ok, extra) => {
	console.log((ok ? 'ok ' : 'FAIL ') + name + (extra ? ' ' + extra : ''));
	if (!ok) fails.push(name);
};
const RATS = [
	[1920, 1080, '#1a7f37', '16:9'],
	[270, 480, '#b6232a', '9:16'],
	[800, 600, '#2456c9', '4:3'],
	[300, 400, '#c98a24', '3:4'],
	[2100, 900, '#6c2bd9', '21:9'],
	[500, 500, '#0e8080', '1:1'],
	[120, 240, '#a03060', '1:2'],
	[600, 300, '#33691e', '2:1'],
	[640, 512, '#37474f', '5:4'],
	[320, 400, '#8e24aa', '4:5'],
	[900, 600, '#ef6c00', '3:2'],
	[400, 600, '#1565c0', '2:3'],
];
const { browser } = await launchEngine();
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ja-JP' }); // 実機サイズ。日ビューは横折返し列で窓内に全件収まる
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

const r = await p.evaluate(async src => {
	const c = window.__IRAPP.activeCtx();
	const mk = (w, h, col, label) => {
		const cc = document.createElement('canvas');
		cc.width = w;
		cc.height = h;
		const g = cc.getContext('2d');
		g.fillStyle = col;
		g.fillRect(0, 0, w, h);
		g.fillStyle = '#fff';
		g.font = `bold ${Math.max(16, Math.min(w, h) / 4)}px sans-serif`;
		g.fillText(label, Math.max(6, w * 0.08), h / 2);
		return cc;
	};
	const hs = [];
	for (let i = 0; i < src.length; i++) {
		const b = await new Promise(rr => mk(src[i][0], src[i][1], src[i][2], src[i][3]).toBlob(rr, 'image/png'));
		const res = await c.collection.share(new File([b], `rt${i}.png`, { type: 'image/png' }), { name: `rt${i}.png`, mime: 'image/png', defer: true });
		hs.push(res.h10);
	}
	await c.collection.saveManifest();
	await c.sheet.rebuild(c.collection.manifestEntries());
	return hs;
}, RATS);
ck('shared12', r.length === 12, String(r.length));

// 日ビューへ（全 12 件がリスト表示＝窓内）
await p.click('.ir-calmode:text-is("日")');
await p.waitForFunction(() => document.querySelectorAll('.cal-day .ir-thumb img[src]').length >= 12, null, { timeout: 45000 });
await p.waitForTimeout(1000);

// ① 同一サイズ・正方形領域 + 128 基準
const geo = await p.evaluate(hs => hs.map(h => {
	const el = document.querySelector(`.cal-day .ir-thumb[data-h10="${h}"]`);
	if (!el) return null;
	const rc = el.getBoundingClientRect();
	const im = el.querySelector('img');
	return { w: Math.round(rc.width), h: Math.round(rc.height), nat: im ? im.naturalWidth + 'x' + im.naturalHeight : null };
}), r);
ck('thumbsFound12', geo.every(g => g), 'n=' + geo.filter(Boolean).length);
const w0 = geo[0] && geo[0].w,
	h0 = geo[0] && geo[0].h;
ck('sameBox', geo.every(g => g && g.w === w0 && g.h === h0), `n=${geo.length} box=${w0}x${h0}`);
ck('squareBox', w0 === h0 && w0 === 64, `box=${w0}x${h0}`);
ck('base128', geo.every(g => g && g.nat === '128x128'), geo.map(g => g && g.nat).join(','));

// ② 左寄せ(v1.8 §22・旧中央寄せから変更): 各行の開始 X = セクション左端（±6px）
const rows = await p.evaluate(hs => {
	const host = document.querySelector('.cal-day');
	const hr = host.getBoundingClientRect();
	const byRow = new Map();
	for (const h of hs) {
		const rc = document.querySelector(`.cal-day .ir-thumb[data-h10="${h}"]`).getBoundingClientRect();
		const k = Math.round(rc.top / 10) * 10;
		const g = byRow.get(k) || { l: Infinity, r: -Infinity, n: 0 };
		g.l = Math.min(g.l, rc.left);
		g.r = Math.max(g.r, rc.right);
		g.n++;
		byRow.set(k, g);
	}
	return {
		hostL: Math.round(hr.left * 10) / 10,
		rows: [...byRow.values()].map(g => ({ l: Math.round(g.l * 10) / 10, n: g.n })),
	};
}, r);
ck('leftAligned', rows.rows.length >= 2 && rows.rows.every(g => Math.abs(g.l - rows.hostL) <= 6), JSON.stringify(rows));

// ③ contain 全体表示（比率別白帯）: CSP 対策で img 要素から直接 canvas 描画
const contain = await p.evaluate(async hs => {
	const out = [];
	for (const h of hs) {
		const im = document.querySelector(`.cal-day .ir-thumb[data-h10="${h}"] img`);
		if (!im) {
			out.push('noimg');
			continue;
		}
		const c = document.createElement('canvas');
		c.width = im.naturalWidth;
		c.height = im.naturalHeight;
		c.getContext('2d').drawImage(im, 0, 0);
		const px = (x, y) => c.getContext('2d').getImageData(x, y, 1, 1).data;
		const white = q => q[0] > 240 && q[1] > 240 && q[2] > 240;
		out.push({
			square: c.width === 128 && c.height === 128,
			mid: px(64, 64),
			top: white(px(64, 3)),
			left: white(px(3, 64)),
		});
	}
	return out;
}, r);
let cok = true,
	cbad = [];
for (let i = 0; i < 12; i++) {
	const [w, h] = [RATS[i][0], RATS[i][1]];
	const o = contain[i];
	const colored = o && o.mid && o.mid[0] + o.mid[1] + o.mid[2] < 720;
	const ok = o && o.square && colored &&
		(w > h ? o.top && !o.left : w < h ? o.left && !o.top : !o.top && !o.left);
	if (!ok) {
		cok = false;
		cbad.push(RATS[i][3] + ':' + JSON.stringify({ square: o && o.square, top: o && o.top, left: o && o.left }));
	}
}
ck('containAll12', cok, cbad.join(' '));

// ④ ピッカー切换でも全 12 件の領域が同一正方形に維持（中央寄せも維持）
for (const v of [128, 32, 64]) {
	await p.click(`.ir-tsz:text-is("${v}")`);
	await p.waitForTimeout(v === 64 ? 500 : 800);
	const g2 = await p.evaluate(hs => hs.map(h => {
		const el = document.querySelector(`.cal-day .ir-thumb[data-h10="${h}"]`);
		if (!el) return null;
		const rc = el.getBoundingClientRect();
		return [Math.round(rc.width), Math.round(rc.height)];
	}), r);
	ck('sameBox' + v, g2.every(g => g && g[0] === v && g[1] === v), 'n=' + g2.filter(Boolean).length);
}

// ⑤ 月ビュー sanity: 同一セル内で全サムネイルの領域が同一サイズ・正方形（可见分は実体化）
await p.click('.ir-calmode:text-is("月")');
await p.waitForTimeout(1200);
const mo = await p.evaluate(hs => {
	const els = [...document.querySelectorAll('.cal-cell .ir-thumb')];
	return {
		n: els.length,
		imgs: document.querySelectorAll('.cal-cell .ir-thumb img[src]').length,
		box: els.map(e => {
			const rc = e.getBoundingClientRect();
			return Math.round(rc.width) + 'x' + Math.round(rc.height);
		}),
	};
}, r);
ck('monthUniform', mo.n >= 12 && mo.imgs >= 1 && mo.box.every(b => b === '64x64'), JSON.stringify({ n: mo.n, imgs: mo.imgs }));
await p.screenshot({ path: OUT + 'img_ratio_mixed.png' });
await p.click('.ir-calmode:text-is("日")');
await p.waitForTimeout(1200);
await p.screenshot({ path: OUT + 'img_ratio_day.png' });
// ⑥ 全画面実スクショ: 実測で異なるアスペクト比（16:9 横長 / 9:16 縦長）を画像のみ表示
const fsShot = async (h, tag, expAR) => {
	await p.click(`.cal-day .ir-thumb[data-h10="${h}"]`);
	await p.waitForSelector('img.ir-img', { timeout: 30000 });
	await p.waitForTimeout(900);
	await p.click('.ir-fsrow button:has-text("全画面表示")');
	await p.waitForTimeout(600);
	const st = await p.evaluate(() => {
		const bx = document.querySelector('.ir-mbx.ir-fs');
		if (!bx) return null;
		const im = bx.querySelector('img.ir-img');
		const r = im.getBoundingClientRect();
		const sc = Math.min(r.width / im.naturalWidth, r.height / im.naturalHeight); // object-fit: contain の実描画サイズ
		return {
			w: r.width,
			h: r.height,
			rw: im.naturalWidth * sc,
			rh: im.naturalHeight * sc,
			vw: innerWidth,
			vh: innerHeight,
			other: [...bx.children].filter(c => !c.classList.contains('ir-imgwrap') && !c.classList.contains('ir-fsc') && getComputedStyle(c).display !== 'none').length,
		};
	});
	await p.screenshot({ path: OUT + `img_ratio_fs_${tag}.png` });
	await p.keyboard.press('Escape'); // dlg 閉じる（エスケープ）
	await p.waitForTimeout(600);
	ck('fsOnly' + tag, !!st && st.other === 0, st ? 'other=' + st.other : 'no fs');
	return !!st && st.rw <= st.vw + 1 && st.rh <= st.vh + 1 && Math.abs(st.rw / st.rh - expAR) < 0.04 && (st.rw >= 0.95 * st.vw || st.rh >= 0.95 * st.vh); // v2.2 §26: 画面いっぱいまで拡大
};
ck('fsWide169', await fsShot(r[0], 'wide', 16 / 9));
ck('fsTall916', await fsShot(r[1], 'tall', 270 / 480));
ck('noPageErrors', errors.length === 0, errors.slice(0, 3).join(' | '));
if (fails.length) {
	console.log('RATIO FAIL:', fails.join(','));
	await browser.close();
	process.exit(1);
}
console.log('RATIO OK');
await browser.close();
process.exit(0);
