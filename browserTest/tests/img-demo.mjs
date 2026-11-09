// ImageRoom デモ: 3 参加者・5 画像の交換シナリオ（ステップ合成スクリーンショット出力）
// 手順: 1) ログイン 2) 画像UP(A:2 B:2 C:1) 3) 未所持画像のリクエスト→シート交換 4) 手元で表示(ビューア)
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launchEngine } from './lib.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8080';
const OUT = fileURLToPath(new URL('../out/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const ROOM = '写真DEMO' + Date.now().toString(36).slice(-3);
const PW = 'demo-pass';

const { name, browser } = await launchEngine();
const errors = [];
const mk = async label => {
	const c = await browser.newContext({ locale: 'ja-JP', viewport: { width: 900, height: 1300 } });
	const p = await c.newPage();
	p.on('pageerror', e => errors.push(`[${label}] ${e}`));
	p.on('console', m => {
		if (m.type() === 'error') errors.push(`[${label}] console ${m.text().slice(0, 160)}`);
	});
	return p;
};
const A = await mk('A'), B = await mk('B'), C = await mk('C');

// ---- 画像 5 枚をブラウザ canvas で生成（視認しやすい単色+模様、ASCII ラベル）----
const maker = await browser.newPage();
await maker.goto(`${BASE}/index.html`);
const IMGS = await maker.evaluate(() => {
	const mk1 = (bg1, bg2, label, draw) => {
		const cv = document.createElement('canvas');
		cv.width = 800;
		cv.height = 600;
		const x = cv.getContext('2d'),
			g = x.createLinearGradient(0, 0, 800, 600);
		g.addColorStop(0, bg1);
		g.addColorStop(1, bg2);
		x.fillStyle = g;
		x.fillRect(0, 0, 800, 600);
		draw(x);
		x.fillStyle = '#fff';
		x.font = 'bold 56px sans-serif';
		x.fillText(label, 30, 80);
		return cv.toDataURL('image/jpeg', 0.9);
	};
	return [
		{ name: 'sakura.jpg', d: mk1('#ffd7e0', '#f49ac0', 'SAKURA', x => {
			x.fillStyle = '#e0538f';
			for (let i = 0; i < 9; i++) x.beginPath(), x.arc(120 + i * 72, 300 + 90 * Math.sin(i), 44, 0, 7), x.fill();
		}) },
		{ name: 'umi.jpg', d: mk1('#1b6fb8', '#0b3a66', 'UMI', x => {
			x.strokeStyle = '#cfe9ff';
			x.lineWidth = 14;
			for (let r = 0; r < 4; r++) {
				x.beginPath();
				for (let i = 0; i <= 800; i += 10) x.lineTo(i, 220 + r * 90 + 26 * Math.sin(i / 55 + r));
				x.stroke();
			}
		}) },
		{ name: 'yama.jpg', d: mk1('#7fbf7f', '#2e7d32', 'YAMA', x => {
			x.fillStyle = '#5d4037';
			x.beginPath();
			x.moveTo(120, 560);
			x.lineTo(400, 160);
			x.lineTo(680, 560);
			x.closePath();
			x.fill();
			x.fillStyle = '#fff';
			x.beginPath();
			x.moveTo(400, 160);
			x.lineTo(340, 250);
			x.lineTo(460, 250);
			x.closePath();
			x.fill();
		}) },
		{ name: 'sora.jpg', d: mk1('#87ceeb', '#e0f4ff', 'SORA', x => {
			x.fillStyle = '#ffd54f';
			x.beginPath();
			x.arc(640, 160, 90, 0, 7);
			x.fill();
			x.fillStyle = '#ffffff';
			for (const [cx, cy] of [[180, 260], [260, 250], [340, 270], [520, 420], [600, 410]]) x.beginPath(), x.arc(cx, cy, 60, 0, 7), x.fill();
		}) },
		{ name: 'mori.jpg', d: mk1('#1b5e20', '#003d00', 'MORI', x => {
			x.fillStyle = '#3e2723';
			for (let c = 0; c < 6; c++) x.fillRect(60 + c * 130, 200, 40, 360);
			x.fillStyle = '#a5d6a7';
			for (let c = 0; c < 6; c++) x.beginPath(), x.arc(80 + c * 130, 190, 70, 0, 7), x.fill();
		}) },
	].map(o => ({ name: o.name, b64: o.d.split(',')[1] }));
});
await maker.close();
const buf = f => Buffer.from(f.b64, 'base64');

// 合成スクショ: 3 ページ並べて 1 枚化
const shot = async (label, pages, tags, file) => {
	const bufs = [];
	for (const p of pages) bufs.push((await p.screenshot({ fullPage: true })).toString('base64'));
	const m = await browser.newPage();
	await m.setViewportSize({ width: 900 * pages.length + 40, height: 1300 });
	await m.setContent(`<html><body style="margin:0;background:#222;display:flex;gap:8px">
		${bufs.map((b, i) => `<div style="flex:1"><div style="color:#fff;font:14px sans-serif;padding:6px">${tags[i]}</div>
		<img src="data:image/png;base64,${b}" style="width:100%"/></div>`).join('')}</body></html>`);
	await m.screenshot({ path: OUT + file, fullPage: true });
	await m.close();
	console.log('shot:', file);
};

// ---- 1. ログイン: A 作成 / B,C 参加（入力完了時点を撮影）----
await A.goto(`${BASE}/img_room.html`);
await A.click('button:has-text("部屋作成")');
await A.fill('input[name="ir-cn"]', ROOM);
await A.fill('input[name="ir-cuid"]', 'PONTA');
await A.fill('input[name="ir-cpw"]', PW);
await B.goto(`${BASE}/img_room.html`);
await B.click('button:has-text("参加")');
await B.fill('input[name="ir-nm"]', ROOM);
await B.fill('input[name="ir-uid"]', 'PONKO');
await B.fill('input[name="ir-pw"]', PW);
await C.goto(`${BASE}/img_room.html`);
await C.click('button:has-text("参加")');
await C.fill('input[name="ir-nm"]', ROOM);
await C.fill('input[name="ir-uid"]', 'MIKE');
await C.fill('input[name="ir-pw"]', PW);
await shot('login', [A, B, C], ['A: PONTA(作成者)', 'B: PONKO(参加)', 'C: MIKE(参加)'], 'img_demo_1_login.png');
await A.click('.ir-frm button:has-text("部屋作成")');
await A.waitForSelector('input[type=file]', { timeout: 20000 });
await B.click('.ir-frm button:has-text("ログイン")');
await B.waitForSelector('input[type=file]', { timeout: 20000 });
await C.click('.ir-frm button:has-text("ログイン")');
await C.waitForSelector('input[type=file]', { timeout: 20000 });

// ---- 2. 画像 UP: A:2 B:2 C:1（1回の選択で複数枚 = M 1 通）----
await A.setInputFiles('input[type=file]', [
	{ name: 'sakura.jpg', mimeType: 'image/jpeg', buffer: buf(IMGS[0]) },
	{ name: 'umi.jpg', mimeType: 'image/jpeg', buffer: buf(IMGS[1]) },
]);
await B.setInputFiles('input[type=file]', [
	{ name: 'yama.jpg', mimeType: 'image/jpeg', buffer: buf(IMGS[2]) },
	{ name: 'sora.jpg', mimeType: 'image/jpeg', buffer: buf(IMGS[3]) },
]);
await C.setInputFiles('input[type=file]', [{ name: 'mori.jpg', mimeType: 'image/jpeg', buffer: buf(IMGS[4]) }]);
await A.waitForTimeout(2500); // 自サムネイル反映待ち
await shot('up', [A, B, C], ['AUP: sakura,umi', 'BUP: yama,sora', 'CUP: mori'], 'img_demo_2_up.png');

// ---- 3. 未所持分リクエスト(M→T→S 自動交換)で全員の窓に 5 枚 ----
for (const [t, p] of [['B', B], ['C', C], ['A', A]])
	await p.waitForFunction(() => document.querySelectorAll('.ir-thumb img[src]').length >= 5, null, { timeout: 60000 }).catch(e => console.log('thumb wait timeout', t));
await A.waitForTimeout(1200);
await shot('exchange', [A, B, C], ['A(3枚を他から取得)', 'B(3枚を他から取得)', 'C(4枚を他から取得)'], 'img_demo_3_exchange.png');

// ---- 4. 手元で表示: 各々が未所持の 1 枚をクリック→本文 Q/H/A/G fetch→ビューア ----
const pick = async (p, idx) => p.evaluate(i => {
	const c = window.__IRAPP.activeCtx(),
		own = c.collection.mset || new Set(),
		els = [...document.querySelectorAll('.ir-thumb')].filter(e => e.dataset.h10 && !own.has(e.dataset.h10));
	return els[i] ? els[i].dataset.h10 : null;
}, idx);
const instrument = p => p.evaluate(() => {
		const c = window.__IRAPP.activeCtx(),
			t = c.transfer;
		window.__dbg = [];
		if (t._dbgOn) return;
		t._dbgOn = 1;
		const f = t.fetch.bind(t);
		t.fetch = o => {
			window.__dbg.push('fetch ' + String(o.h10).slice(0, 6) + ' h:' + JSON.stringify(o.holders));
			const pr = f(o);
			pr.then(ab => window.__dbg.push('RES ' + (ab && ab.byteLength))).catch(e => window.__dbg.push('REJ ' + String(e).slice(0, 120)));
			return pr;
		};
		const oq = t._onQ.bind(t);
		t._onQ = (o, from) => {
			window.__dbg.push('onQ ' + String(o.h).slice(0, 6) + ' from ' + from);
			return oq(o, from);
		};
		const pv = t.provide.bind(t);
		t.provide = async (hh, from) => {
			const r = await pv(hh, from);
			window.__dbg.push('provide ' + String(hh).slice(0, 6) + '->' + (r ? (r.byteLength || 'obj') : 'null'));
			return r;
		};
		const ss = t.startSend.bind(t);
		t.startSend = o => {
			window.__dbg.push('startSend ' + String(o.h10).slice(0, 6) + ' c' + (o.chunks ? o.chunks.length : '?'));
			return ss(o);
		};
		const dr = t._drive.bind(t);
		t._drive = tp => {
			window.__dbg.push('drive ' + String(tp.h10).slice(0, 6) + ' chunks' + tp.chunks.length);
			return dr(tp);
		};
	});
const open = async (p, i) => {
	const h = await pick(p, i);
	if (!h) return null;
	await p.click(`.ir-thumb[data-h10="${h}"]`);
	try {
		await p.waitForSelector('img.ir-img', { timeout: 30000 });
	} catch (e) {
		console.log('viewer FAIL', h, JSON.stringify(await p.evaluate(() => window.__dbg)));
		for (const q of [A, B, C]) console.log('dbg@' + (q===A?'A':q===B?'B':'C'), JSON.stringify(await q.evaluate(() => window.__dbg)));
		return null;
	}
	return p.evaluate(() => {
		const im = document.querySelector('img.ir-img');
		return im && im.naturalWidth > 0 ? `${im.naturalWidth}x${im.naturalHeight}` : 'LOAD-FAIL';
	});
};
await instrument(A);
await instrument(B);
await instrument(C);
const vA = await open(A, 0), // A: C の mori(最新)
	vB = await open(B, 1), // B: A の画像
	vC = await open(C, 0); // C: B の画像
await A.waitForTimeout(1500);
await shot('view', [A, B, C], [`A のビューア(取得: C の画像) ${vA}`, `B のビューア(取得: A の画像) ${vB}`, `C のビューア(取得: B の画像) ${vC}`], 'img_demo_4_view.png');

console.log(JSON.stringify({ engine: name, room: ROOM, vA, vB, vC, errors }, null, 1));
const thumbs = {
	A: await A.evaluate(() => document.querySelectorAll('.ir-thumb img[src]').length),
	B: await B.evaluate(() => document.querySelectorAll('.ir-thumb img[src]').length),
	C: await C.evaluate(() => document.querySelectorAll('.ir-thumb img[src]').length),
};
console.log('thumbs:', JSON.stringify(thumbs));
await browser.close();
const bad = errors.length || thumbs.A < 5 || thumbs.B < 5 || thumbs.C < 5 || !vA || !vB || !vC;
console.log(bad ? 'DEMO INCOMPLETE' : 'DEMO OK');
process.exit(bad ? 1 : 0);
