// 追加仕様(v1.1)検証: QR タブ(作成者)/サーバーモード URL QR 常時/参加者バッジ(S マーク・時刻)/
// アップロード上限(作成時 1MB)/ビューア(タイトル=ファイル名・サイズ切替・☓右上・ゴミ箱右端・保存廃止・自動保存)
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launchEngine } from './lib.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8080';
const OUT = fileURLToPath(new URL('../out/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const ROOM = 'SPEC' + Date.now().toString(36).slice(-4);
const PW = 'spec-pw';

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
const A = await mk('A'), B = await mk('B');
const checks = {};
const ck = (k, v) => (checks[k] = !!v);

const shot = async (pages, tags, file) => {
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
// 画像生成（page 側 canvas）
const genImg = async (p, label, w, h, noise, bg = '#ffd7e0', fg = '#e0538f') => p.evaluate(async ([label, w, h, noise, bg, fg]) => {
	const cv = document.createElement('canvas');
	cv.width = w;
	cv.height = h;
	const x = cv.getContext('2d');
	if (noise) {
		const im = x.createImageData(w, h);
		for (let i = 0; i < im.data.length; i += 4) {
			const r = (Math.random() * 255) | 0;
			im.data[i] = r;
			im.data[i + 1] = (Math.random() * 255) | 0;
			im.data[i + 2] = (Math.random() * 255) | 0;
			im.data[i + 3] = 255;
		}
		x.putImageData(im, 0, 0);
	} else {
		x.fillStyle = bg;
		x.fillRect(0, 0, w, h);
		x.fillStyle = fg;
		for (let i = 0; i < 6; i++) x.beginPath(), x.arc(80 + i * 100, h / 2, 40, 0, 7), x.fill();
	}
	x.fillStyle = '#fff';
	x.font = 'bold 48px sans-serif';
	x.fillText(label, 20, 60);
	return cv.toDataURL('image/jpeg', noise ? 0.85 : 0.9).split(',')[1];
}, [label, w, h, noise, bg, fg]);
const maker = await browser.newPage();
await maker.goto(BASE + '/index.html');
const small = Buffer.from(await genImg(maker, 'SAKURA', 640, 480, false), 'base64');
const small2 = Buffer.from(await genImg(maker, 'UMI', 560, 420, false, '#d7e8ff', '#2f6fbf'), 'base64');
const big = Buffer.from(await genImg(maker, 'BIG', 1900, 1900, true), 'base64');
await maker.close();
console.log('big size:', big.length);

// ---- A: 作成（上限 1MB）----
await A.goto(BASE + '/img_room.html');
await A.click('button:has-text("部屋作成")');
await A.fill('input[name="ir-cn"]', ROOM);
await A.fill('input[name="ir-cuid"]', 'PONTA');
await A.fill('input[name="ir-cpw"]', PW);
await A.fill('input[name="ir-cmx"]', '1');
await A.click('.ir-frm button:has-text("部屋作成")');
await A.waitForSelector('input[type=file]', { timeout: 20000 });
ck('creatorView', true);

// サブタブ: URL QR / パスワード QR（作成者のみ）
ck('creatorSubtabs', await A.locator('.ir-subtabs .ir-subtab').count() === 3);
await A.click('.ir-subtab:has-text("URL QR")');
await A.waitForSelector('.ir-sec canvas', { timeout: 10000 });
ck('urlQrTab', await A.evaluate(() => !!document.querySelector('.ir-sec canvas') && (document.querySelector('.ir-qrside input')?.value || '').includes('/img_room.html#')));
ck('qrScanNote', await A.evaluate(() => (document.querySelector('.ir-qrnote')?.textContent || '').includes('スキャン')));
console.log('qrDbg:', await A.evaluate(() => {
	const pic = document.querySelector('.ir-qrpic'), side = document.querySelector('.ir-qrside');
	return JSON.stringify(pic && side && { pic: pic.getBoundingClientRect(), side: side.getBoundingClientRect() });
}));
ck('qrSideBySide', await A.evaluate(() => {
	const pic = document.querySelector('.ir-qrpic'), side = document.querySelector('.ir-qrside');
	if (!pic || !side) return false;
	const a = pic.getBoundingClientRect(), b = side.getBoundingClientRect();
	return b.top < a.bottom && b.bottom > a.top && b.left >= a.right - 4; // 横並び（縦中心が重なり側は右）
}));
await shot([A], ['作成者: URL QR タブ'], 'img_spec_1_qrurl.png');
await A.click('.ir-subtab:has-text("パスワード QR")');
await A.waitForSelector('.ir-sec canvas', { timeout: 10000 });
ck('pwQrTab', await A.evaluate(() => !!document.querySelector('.ir-sec canvas')));
ck('pwSecretStyle', await A.evaluate(() => {
	const sec = document.querySelector('.ir-secret');
	if (!sec || !sec.querySelector('canvas')) return false;
	return getComputedStyle(sec).borderColor !== getComputedStyle(document.body).color; // 秘密鍵色系の枠（既定文字色と異なる）
}));
ck('pwNoPlainUrl', await A.evaluate(() => {
	const sec = document.querySelector('.ir-secret');
	return !!sec && !(sec.querySelector('.ir-qrside input')?.value || '').includes('img_room.html'); // パスワード QR は URL QR と別（内容も URL ではない）
}));
await shot([A], ['作成者: パスワード QR タブ'], 'img_spec_2_qrpw.png');
await A.click('.ir-subtab:has-text("画像")');

// サーバーモード許可 → ログアウト → サーバーモードで再ログイン
await A.click('button[aria-label="部屋設定"]'); // v2.0 §24: 歯車絵文字化
await A.waitForSelector('.ir-mbx', { timeout: 5000 });
await A.click('.ir-mbx .ir-rw:has-text("同期") input[type=radio]'); // v2.2 §26: トグル→同期/通常ラジオ
await A.waitForSelector('.ir-toast', { timeout: 5000 });
await A.click('.ir-mclose');
await A.click('button:has-text("ログアウト")');
await A.waitForSelector('button:has-text("ログイン")', { timeout: 10000 });
await A.click('button:has-text("ログイン")');
await A.waitForSelector('.ir-rd', { timeout: 5000 });
const srvRadio = A.locator('.ir-rd:has-text("サーバー") input');
ck('srvRadioEnabled', await srvRadio.isEnabled());
await srvRadio.check();
await A.fill('input[name="ir-uid"]', 'PONTA');
await A.fill('input[name="ir-pw"]', PW);
await A.click('.ir-frm button:has-text("ログイン")');
await A.waitForSelector('input[type=file]', { timeout: 20000 });
ck('serverReLogin', await A.evaluate(() => window.__IRAPP.activeCtx().mode === 'server'));
await A.waitForSelector('.ir-sec canvas', { timeout: 10000 });
ck('urlQrAlways', await A.evaluate(() => {
	const i = document.querySelector('.ir-sec .ir-qrside input');
	return !!i && (i.value || '').includes('/img_room.html#') && !document.querySelector('.ir-secret'); // サーバーモードは常時表示（パスワード QR 露出なし）
}));

// ---- B: 通常参加 ----
await B.goto(BASE + '/img_room.html');
await B.click('button:has-text("参加")');
await B.fill('input[name="ir-nm"]', ROOM);
await B.fill('input[name="ir-uid"]', 'PONKO');
await B.fill('input[name="ir-pw"]', PW);
await B.click('.ir-frm button:has-text("ログイン")');
await B.waitForSelector('input[type=file]', { timeout: 20000 });
ck('noSubtabsForJoiner', await B.locator('.ir-subtabs').count() === 0);
// 参加者バッジ: 2人・A に S マーク・参加時刻(Unix)
await B.waitForFunction(() => document.querySelectorAll('.ir-pbadge').length >= 2, null, { timeout: 15000 });
ck('badges2', true);
ck('sMark', await B.evaluate(() => {
	const bs = [...document.querySelectorAll('.ir-pbadge')];
	const a = bs.find(x => x.textContent.includes('PONTA'));
	return !!(a && a.querySelector('.ir-ps') && a.textContent.includes('S'));
}));
ck('joinTimes', await B.evaluate(() => {
	const ps = window.__IRAPP.activeCtx().session.state.participants;
	const bs = [...document.querySelectorAll('.ir-pbadge')].map(x => x.textContent.replace('S', ''));
	const a = ps.find(p => p.uid === 'PONTA'), b2 = ps.find(p => p.uid === 'PONKO');
	return ps.length >= 2 && ps.every(p => Number.isFinite(p.t)) && !!a && !!b2 && a.t <= b2.t && bs[0] === 'PONTA';
}));
// mx 配信（C）: B 側 room.mx = 1MB
await B.waitForFunction(() => window.__IRAPP.activeCtx().room.mx === 1048576, null, { timeout: 15000 }).catch(() => {});
ck('mxDelivered', await B.evaluate(() => window.__IRAPP.activeCtx().room.mx === 1048576));
await shot([A, B], ['A: サーバーモード(URL QR 常時・S)', 'B: 参加者バッジ(PONTA に S)'], 'img_spec_3_badges.png');

// A: 小画像共有 → B: 1.5MB 超過 → 変換確認ダイアログ（§16 v1.4）→ 辞退でスキップ
await A.setInputFiles('input[type=file]', { name: 'sakura.jpg', mimeType: 'image/jpeg', buffer: small });
let overMsg = '';
B.on('dialog', d => { overMsg = d.message(); d.dismiss(); });
await B.waitForTimeout(2500); // A の sakura の M 配信を安定させてから計測
const bMetas0 = await B.evaluate(() => window.__IRAPP.activeCtx().collection.metas.size);
await B.setInputFiles('input[type=file]', { name: 'big.jpg', mimeType: 'image/jpeg', buffer: big });
await B.waitForTimeout(2500);
ck('over10Prompt', overMsg.includes('big.jpg') && overMsg.includes('4096'), JSON.stringify(overMsg.slice(0, 60)));
const bAfter = await B.evaluate(() => {
	const c = window.__IRAPP.activeCtx();
	return { n: c.collection.metas.size, has: [...c.collection.metas.values()].some(x => window.__IRAPP.constructor.unB64(x.n) === 'big.jpg') };
});
ck('over10Declined', bAfter.n === bMetas0 && !bAfter.has, JSON.stringify(bAfter));
await shot([B], ['B: 上限超確認ダイアログ（1MB 制限・辞退）'], 'img_spec_4_toolimit.png');

// ---- §17 大きな画像・形式ポリシー（A 部屋 mx=10MB）----
const metasA0 = await A.evaluate(() => window.__IRAPP.activeCtx().collection.metas.size);
// A の dialog は永続ハンドラ（既定辞退）で数える。act='accept' で noisy だけ承諾。
const aDlg = [];
let aAct = 'dismiss';
A.on('dialog', d => { aDlg.push(d.message()); if (aAct === 'accept') d.accept(); else d.dismiss(); });
// (1) ブラウザ非対応形式（TIFF）→ ダイヤログ無しで即お断り
let dBase = aDlg.length;
const tiffBuf = Buffer.concat([Buffer.from('II*\u0000', 'latin1'), Buffer.alloc(1024 * 1024, 0x41)]);
await A.setInputFiles('input[type=file]', { name: 'scan.tiff', mimeType: 'image/tiff', buffer: tiffBuf });
await A.waitForTimeout(2000);
const tU = await A.evaluate(() => [...document.querySelectorAll('.ir-toast')].map(x => x.textContent));
ck('gateUnsupported', aDlg.length === dBase && (await A.evaluate(() => window.__IRAPP.activeCtx().collection.metas.size)) === metasA0
	&& tU.some(x => x.includes('サポート') || x.includes('supported')));
// (2) PNG ヘッダ 9000×9000（デコード 324MB→256MB 超確実）→ 確認無しでお断り
dBase = aDlg.length;
const ihdr = Buffer.alloc(25);
ihdr.writeUInt32BE(13, 0); ihdr.write('IHDR', 4);
ihdr.writeUInt32BE(9000, 8); ihdr.writeUInt32BE(9000, 12);
ihdr[16] = 8; ihdr[17] = 6;
const hugeBuf = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, Buffer.alloc(11 * 1048576, 0x5a)]);
await A.setInputFiles('input[type=file]', { name: 'huge.png', mimeType: 'image/png', buffer: hugeBuf });
await A.waitForTimeout(2500);
const tT = await A.evaluate(() => [...document.querySelectorAll('.ir-toast')].map(x => x.textContent));
ck('gateTooBigDims', aDlg.length === dBase && (await A.evaluate(() => window.__IRAPP.activeCtx().collection.metas.size)) === metasA0
	&& tT.some(x => x.includes('256MB') || x.includes('大きすぎる')));
// (3) ノイズ PNG ~12MB（判定可）→ 確認 → JPEG 変換共有 → 復号可
const noiseB64 = await A.evaluate(async () => {
	const c = document.createElement('canvas');
	c.width = 900; c.height = 900; // 部屋 mx=1MB に対し ~1.7MB → 変換後 ~0.4MB
	const g = c.getContext('2d');
	const im = g.createImageData(900, 900);
	for (let i = 0; i < im.data.length; i += 4) {
		im.data[i] = Math.random() * 255 | 0; im.data[i + 1] = Math.random() * 255 | 0; im.data[i + 2] = Math.random() * 255 | 0; im.data[i + 3] = 255;
	}
	g.putImageData(im, 0, 0);
	const blob = await new Promise(r => c.toBlob(r, 'image/png'));
	const u8 = new Uint8Array(await blob.arrayBuffer());
	let s2 = '';
	for (let k = 0; k < u8.length; k += 0x8000) s2 += String.fromCharCode.apply(null, u8.subarray(k, k + 0x8000));
	return btoa(s2);
});
const noisyBuf = Buffer.from(noiseB64, 'base64');
ck('noisyOverMx', noisyBuf.length > 1048576 && noisyBuf.length < 10 * 1048576, 'bytes=' + noisyBuf.length);
aAct = 'accept';
await A.setInputFiles('input[type=file]', { name: 'noisy.png', mimeType: 'image/png', buffer: noisyBuf });
await A.waitForFunction(m0 => window.__IRAPP.activeCtx().collection.metas.size > m0, metasA0, { timeout: 90000 });
const conv = await A.evaluate(() => {
	const c = window.__IRAPP.activeCtx();
	for (const mm of c.collection.metas.values()) {
		if (window.__IRAPP.constructor.unB64(mm.n) === 'noisy.jpg') return { h: mm.h, t: mm.t, l: mm.l };
	}
	return null;
});
ck('gateConverted', !!conv && conv.t === 'image/jpeg' && conv.l <= 1048576, JSON.stringify(conv && { t: conv.t, kb: +(conv.l / 1024).toFixed(0) }));
const decOk = await A.evaluate(async h => {
	const c = window.__IRAPP.activeCtx();
	const ab = await c.collection.store.get(h);
	if (!ab) return 'no body';
	const { ImgProc } = await import('/modules/img_proc.js');
	const bmp = await createImageBitmap(ImgProc.ab2blob(ab instanceof ArrayBuffer ? ab : ab));
	return bmp.width > 0 && bmp.height > 0 ? 'ok' : 'zero';
}, conv && conv.h);
ck('gateConvertedDecodes', decOk === 'ok', decOk);
aAct = 'dismiss';
await shot([A], ['A: §16 変換共有（noisy.jpg）'], 'img_spec_4b_gate16.png');
await B.setInputFiles('input[type=file]', { name: 'umi.jpg', mimeType: 'image/jpeg', buffer: small2 });
await B.waitForFunction(() => document.querySelectorAll('.ir-thumb img[src]').length >= 2, null, { timeout: 45000 });

// B: A の画像でビューア（タイトル=ファイル名・☓右上・保存なし・ゴミ箱右端・サイズ切替・自動保存）
const h = await B.evaluate(() => {
	const c = window.__IRAPP.activeCtx(), own = c.collection.mset;
	const el = [...document.querySelectorAll('.ir-thumb')].find(e => e.dataset.h10 && !own.has(e.dataset.h10));
	return el ? el.dataset.h10 : null;
});
await B.click(`.ir-thumb[data-h10="${h}"]`);
await B.waitForSelector('img.ir-img', { timeout: 30000 });
await B.waitForTimeout(1200);
console.log('mdlDump:', await B.evaluate(() => JSON.stringify({
	n: document.querySelectorAll('.ir-mdl').length,
	hs: [...document.querySelectorAll('.ir-mbx h3')].map(x => x.textContent),
})));
ck('viewerTitleIsName', (await B.textContent('.ir-mbx h3')).trim() === 'sakura.jpg');
ck('noHashRow', !(await B.textContent('.ir-mbx')).includes(String(h).slice(0, 8)));
ck('noSaveBtn', await B.locator('.ir-mbx button:has-text("保存")').count() === 0);
ck('closeX', await B.locator('.ir-mclose').isVisible());
ck('trashRight', await B.locator('.ir-mbx .ir-trright').count() === 1);
ck('sizeRow', /(\d+)x(\d+) \/ (\d+)x(\d+)/.test(await B.evaluate(() => {
	const r = [...document.querySelectorAll('.ir-mbx .ir-row')].find(r => r.textContent.includes('サイズ'));
	return r ? r.textContent : '';
})));
ck('zoomDefault', await B.evaluate(() => {
	const bs = [...document.querySelectorAll('.ir-mbx button')];
	const fit = bs.find(b => b.textContent === '表示幅'), nat = bs.find(b => b.textContent === 'ネイティブ');
	return !!fit && !!nat && fit.classList.contains('on') && !nat.classList.contains('on'); // 既定=表示幅が選択状態
}));
ck('autoSaved', await B.evaluate(hh => window.__IRAPP.store.has(hh), h));
await shot([B], ['B: ビューア（タイトル=ファイル名/☓右上/ゴミ箱右端/サイズ切替）'], 'img_spec_5_viewer.png');
// ネイティブ切替
await B.click('.ir-mbx button:has-text("ネイティブ")');
console.log('nativeDbg:', await B.evaluate(() => {
	const w = document.querySelector('.ir-imgwrap'), im = w && w.querySelector('img');
	return w && JSON.stringify({ cls: w.className, cw: im.clientWidth, nw: im.naturalWidth, btns: [...document.querySelectorAll('.ir-mbx button')].map(b => b.textContent) });
}));
ck('nativeToggle', await B.evaluate(() => {
	const w = document.querySelector('.ir-imgwrap'), im = w.querySelector('img');
	const nb = [...document.querySelectorAll('.ir-mbx button')].find(b => b.textContent === 'ネイティブ');
	nb.click();
	return w.classList.contains('native') && im.clientWidth === im.naturalWidth;
}));
// v1.2: メタ 3 行 + SHA256 + ズーム 6 段/選択状態
ck('meta3Lines', await B.evaluate(() => document.querySelectorAll('.ir-meta3 .ir-row').length === 3));
ck('sha256', await B.evaluate(async () => {
	const sel = [...document.querySelectorAll('.ir-meta3 .ir-row')].find(r => r.textContent.includes('SHA256'));
	if (!sel) return false;
	for (let i = 0; i < 40; i++) {
		const v = sel.querySelector('.ir-sha')?.textContent || '';
		if (/^[0-9a-f]{64}$/.test(v)) return true;
		await new Promise(r => setTimeout(r, 100));
	}
	return false;
}));
ck('zoomSix', await B.evaluate(() => ['1/4', '1/2', 'ネイティブ', '2倍', '4倍', '表示幅'].every(x => [...document.querySelectorAll('.ir-mbx button')].some(b => b.textContent === x))));
ck('zoomActive', await B.evaluate(() => {
	const bs = [...document.querySelectorAll('.ir-mbx button')];
	const fit = bs.find(b => b.textContent === '表示幅'), nat = bs.find(b => b.textContent === 'ネイティブ');
	return !!fit && !!nat && nat.classList.contains('on') && !fit.classList.contains('on'); // ネイティブ選択中（選択状態が移動）
}));
console.log('zoomDbg:', await B.evaluate(() => {
	const w = document.querySelector('.ir-imgwrap'), im = w.querySelector('img');
	const b2 = [...document.querySelectorAll('.ir-mbx button')].find(b => b.textContent === '2倍');
	b2.click();
	return JSON.stringify({ wc: w.className, styleW: im.style.width, cw: im.clientWidth, nw: im.naturalWidth, b2c: b2.className, maxw: getComputedStyle(im).maxWidth });
}));
ck('zoom2x', await B.evaluate(() => {
	const im = document.querySelector('.ir-imgwrap img');
	return !!im && Math.abs(im.clientWidth - im.naturalWidth * 2) <= 2;
}));
await shot([B], ['ビューア: 2倍/SHA256'], 'img_spec_6_zoom.png');
await B.click('.ir-mclose'); // ☓ で閉じる
await B.waitForTimeout(300);
ck('closedByX', await B.locator('.ir-mdl').count() === 0);

// ---- §20(v1.6): サムネイル表示サイズ ピッカー（上下 2 箇所）と contain/基準128 ----
ck('szPickers', await B.evaluate(() => {
	const bs = [...document.querySelectorAll('.ir-tsz')].map(b => b.textContent.trim());
	return bs.length === 4 && [32, 64, 96, 128].every(v => bs.includes(String(v))); // v2.0 §24: 下部 1 箇所×4 選択肢
}));
await B.click('.ir-tsz:text-is("128")');
await B.waitForTimeout(800);
ck('sz128', await B.evaluate(() => {
	const css = getComputedStyle(document.documentElement).getPropertyValue('--ir-thumb').trim();
	const el = document.querySelector('.cal-cell .ir-thumb');
	const on = [...document.querySelectorAll('.ir-tsz.on')].map(b => b.textContent.trim());
	return css === '128px' && !!el && getComputedStyle(el).width === '128px' && on.filter(x => x === '128').length === 1;
}), await B.evaluate(() => JSON.stringify({ css: getComputedStyle(document.documentElement).getPropertyValue('--ir-thumb').trim() })));
await B.click('.ir-tsz:text-is("32")');
await B.waitForTimeout(600);
ck('sz32', await B.evaluate(() => {
	const el = document.querySelector('.cal-cell .ir-thumb');
	return getComputedStyle(document.documentElement).getPropertyValue('--ir-thumb').trim() === '32px' && (!el || getComputedStyle(el).width === '32px');
}));
ck('thumbContain', await B.evaluate(async () => {
	const { ImgProc } = await import('/modules/img_proc.js');
	const cc = document.createElement('canvas');
	cc.width = 10;
	cc.height = 40;
	const g = cc.getContext('2d');
	g.fillStyle = '#f00';
	g.fillRect(0, 0, 10, 40);
	const b0 = await new Promise(r => cc.toBlob(r, 'image/png'));
	const tb = await ImgProc.thumb(b0, 128); // 小画像→長辺 128 へ拡大・contain
	const bm = await createImageBitmap(tb);
	const c2 = document.createElement('canvas');
	c2.width = 128;
	c2.height = 128;
	const g2 = c2.getContext('2d');
	g2.drawImage(bm, 0, 0);
	const band = g2.getImageData(4, 64, 1, 1).data; // 短辺側レターボックスは白
	const mid = g2.getImageData(64, 64, 1, 1).data; // 中央は赤本体
	return bm.width === 128 && bm.height === 128 && band[0] > 240 && band[1] > 240 && band[2] > 240 && mid[0] > 200 && mid[1] < 90;
}));
ck('sheetPx128', await B.evaluate(async () => {
	const x = window.__IRAPP.activeCtx();
	const rec = [...x.sheet.index.values()][0];
	if (!rec) return false;
	const { OPFS } = await import('/OPFS.js');
	const { STORAGE } = await import('/modules/imgroom/ir_const.js');
	const ab = await OPFS.r(STORAGE.sheet(x.rid, rec.uid, rec.idx, rec.h));
	if (!ab) return false;
	const bm = await createImageBitmap(new Blob([ab], { type: 'image/jpeg' }));
	return bm.width === 4 * 128 && bm.height === 8 * 128; // GRID 4×8・コマ 128
}));
await B.click('.ir-tsz:text-is("64")'); // 既定へ復元（後続想定）
await B.waitForTimeout(400);

// ---- v1.8 §22: 枠線廃止・ヘッダのみ/左寄せ/コントラスト/ゴミ箱絵文字/全画面&スライドショー ----
ck('noFrame', await A.evaluate(() => {
	const c = document.querySelector('.cal-cell'),
		t0 = document.querySelector('.ir-thumb');
	return !!c && !!t0 && getComputedStyle(c).borderTopWidth === '0px' && getComputedStyle(t0).borderTopWidth === '0px';
}));
ck('headContrast', await A.evaluate(() => {
	const h = document.querySelector('.cal-ch'),
		g = getComputedStyle(h),
		lum = s => {
			const m = (s.match(/\d+/g) || []).slice(0, 3).map(Number);
			return m.length < 3 ? -1 : (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255;
		};
	return Math.abs(lum(g.color) - lum(g.backgroundColor)) >= 0.4;
}));
ck('thumbLeftAligned', await A.evaluate(() => {
	const th = [...document.querySelectorAll('.cal-day .ir-thumb, .cal-cell .ir-thumb')].filter(e => e.getBoundingClientRect().width > 0);
	if (!th.length) return false;
	const e = th[0],
		host = e.closest('.cal-cell');
	return Math.abs(e.getBoundingClientRect().left - host.getBoundingClientRect().left) <= 6;
}));
ck('trashEmoji', await A.evaluate(() => [...document.querySelectorAll('.ir-hd button')].some(b => (b.textContent || '').includes('🗑'))));
await A.click('.ir-hd button[aria-label="ゴミ箱"]');
await A.waitForSelector('.ir-mbx h3', { timeout: 10000 });
ck('trashTitleWord', (await A.textContent('.ir-mbx h3')).trim() === 'ゴミ箱');
await A.click('.ir-mclose');
await A.waitForTimeout(300);
const ownH = await A.evaluate(() => {
	const c = window.__IRAPP.activeCtx();
	const el = [...document.querySelectorAll('.ir-thumb')].find(e => e.dataset.h10 && c.collection.mset.has(e.dataset.h10));
	return el ? el.dataset.h10 : null;
});
await A.click(`.ir-thumb[data-h10="${ownH}"]`);
await A.waitForSelector('img.ir-img', { timeout: 30000 });
await A.waitForTimeout(800);
ck('fsButtons', (await A.locator('.ir-fsrow button:has-text("全画面表示")').count()) === 1 && (await A.locator('.ir-fsrow button:has-text("スライドショー")').count()) === 1);
await A.click('.ir-fsrow button:has-text("全画面表示")');
await A.waitForTimeout(500);
ck('fsOn', (await A.locator('.ir-mbx.ir-fs').count()) === 1);
// v1.9 §23: 全画面は画像のみ（タイトル・サイズ行・ボタン行・メタ非表示、imgwrap のみ可視）
ck('fsOnlyImage', await A.evaluate(() => {
	const bx = document.querySelector('.ir-mbx.ir-fs');
	if (!bx) return false;
	const hid = [...bx.children].filter(c => !c.classList.contains('ir-imgwrap') && !c.classList.contains('ir-fsc'));
	const vis = hid.filter(c => getComputedStyle(c).display !== 'none');
	const im = bx.querySelector('img.ir-img');
	return vis.length === 0 && !!im && im.clientWidth > 100;
}));
await A.screenshot({ path: OUT + 'img_spec_7_fs.png' });
await A.click('.ir-imgwrap');
await A.waitForSelector('.ir-fsc', { timeout: 5000 });
ck('fsConfirmText', (await A.textContent('.ir-fsp')).includes('終了'));
await A.click('.ir-fsp button:has-text("続ける")');
await A.waitForTimeout(300);
ck('fsKeepOn', (await A.locator('.ir-mbx.ir-fs').count()) === 1 && (await A.locator('.ir-fsc').count()) === 0);
// 全画面解除もタップ→コンファーム（終了）
await A.click('.ir-imgwrap');
await A.waitForSelector('.ir-fsc', { timeout: 5000 });
await A.click('.ir-fsp button:has-text("終了")');
await A.waitForTimeout(300);
ck('fsExitByConfirm', (await A.locator('.ir-mbx.ir-fs').count()) === 0);
await A.click('.ir-fsrow button:has-text("スライドショー")');
await A.waitForTimeout(400);
ck('slideFsOn', (await A.locator('.ir-mbx.ir-fs').count()) === 1);
const t0s = (await A.textContent('.ir-mbx h3')).trim();
await A.waitForFunction(cur => {
	const x = document.querySelector('.ir-mbx h3');
	return x && x.textContent.trim() !== cur;
}, t0s, { timeout: 9000 });
const t1s = (await A.textContent('.ir-mbx h3')).trim();
ck('slideAdvance', t1s !== t0s);
ck('slideHeldOnly', await A.evaluate(nm => {
	const c = window.__IRAPP.activeCtx();
	const un = b => {
		try {
			return decodeURIComponent(escape(atob(b.replace(/-/g, '+').replace(/_/g, '/'))));
		} catch (e) {
			return b;
		}
	};
	return [...c.collection.metas.values()].some(m => un(m.n || '') === nm);
}, t1s));
await A.click('.ir-imgwrap');
await A.waitForSelector('.ir-fsc', { timeout: 5000 });
ck('slideConfirmText', (await A.textContent('.ir-fsp')).includes('スライドショー'));
await A.click('.ir-fsp button:has-text("終了")');
await A.waitForTimeout(300);
ck('slideStoppedFsOff', (await A.locator('.ir-mbx.ir-fs').count()) === 0 && (await A.locator('.ir-fsc').count()) === 0);
const t2s = (await A.textContent('.ir-mbx h3')).trim();
await A.waitForTimeout(3800);
ck('slideHalted', (await A.textContent('.ir-mbx h3')).trim() === t2s);
await A.click('.ir-mclose');
await A.waitForTimeout(400);
// v1.9 §23: 部屋メニューの QR 欄は末尾（QR+情報の下に表示要素なし）
await A.click('.ir-hd button[aria-label="部屋設定"]');
await A.waitForSelector('.ir-mbx h3', { timeout: 15000 });
await A.waitForTimeout(600); // QR 生成（失敗時 needpw 文案）待ち
ck('menuQrLast', await A.evaluate(() => {
	const bx = [...document.querySelectorAll('.ir-mbx')].pop();
	const last = bx.lastElementChild;
	if (!last) return false;
	const hasQr = !!last.querySelector('.ir-qrrow') || (last.textContent || '').includes('パスワード');
	const h4s = [...bx.querySelectorAll('h4')];
	const lastH4 = h4s[h4s.length - 1];
	const lv = [...bx.querySelectorAll('button')].find(b => (b.textContent || '').includes('退室'));
	const lvAbove = !!lv && !!(last.querySelector('.ir-qrrow') || last.querySelector('.ir-mut')) && (lv.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_CONTAINED_BY) === 0 && lv.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING;
	return hasQr && !!lastH4 && (lastH4.textContent || '').includes('QR') && !!lvAbove;
}));
await A.click('.ir-mclose');
// ---- v2.0 §24: 歯車絵文字 / 日週月の下部タブ統合 / 下部行のコンパクト化 ----
ck('gearEmoji', await A.evaluate(() => [...document.querySelectorAll('.ir-hd button')].some(b => (b.textContent || '').includes('⚙'))));
ck('modeTabsBottom', await B.evaluate(() => {
	const bar = document.querySelector('.ir-calbar'),
		box = document.querySelector('.ir-calbox'),
		modes = document.querySelectorAll('.ir-calmode').length;
	return !!bar && !!box && modes === 3 && (bar.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_PRECEDING) !== 0; // バーはカレンダー（サムネ）の後
}));
ck('rowCompact', await B.evaluate(() => {
	const bar = document.querySelector('.ir-calbar'),
		btm = document.querySelector('.ir-botrow');
	if (!bar || !btm) return false;
	const bh = Math.max(...[...bar.querySelectorAll('.ir-calmode')].map(b => b.getBoundingClientRect().height));
	const gap = btm.getBoundingClientRect().top - bar.getBoundingClientRect().bottom;
	const szh = Math.max(...[...btm.querySelectorAll('.ir-tsz')].map(b => b.getBoundingClientRect().height));
	return bh <= 26 && szh <= 26 && gap <= 4; // 行高は文字サイズギリギリ・行間 1px（余裕 4px 以内）
}));
// ---- v2.1 §25: 日週月&サムネサイズは左下固定（スマホでも表示）----
ck('ctrlFixedBottomLeft', await B.evaluate(() => {
	const c = document.querySelector('.ir-ctrlbar');
	if (!c || getComputedStyle(c).position !== 'fixed') return false;
	const r = c.getBoundingClientRect();
	return r.left <= 12 && innerHeight - r.bottom <= 12 && r.top > 0 && c.contains(document.querySelector('.ir-calbar')) && c.contains(document.querySelector('.ir-botrow'));
}));
ck('ctrlNoOverlap', await B.evaluate(() => {
	const c = document.querySelector('.ir-ctrlbar'),
		box = document.querySelector('.ir-calbox');
	if (!c || !box) return false;
	return box.getBoundingClientRect().bottom <= c.getBoundingClientRect().top + 2;
}));
// ---- v2.2 §26 ----
await A.click('button[aria-label="部屋設定"]');
await A.waitForSelector('.ir-mbx h3', { timeout: 10000 });
await A.click('.ir-mbx button:has-text("パスワード発行")'); // 平文 pw は再発行後に.menu 内 QR 生成可能（§6.4）
await A.waitForSelector('.ir-mbx .ir-qrrow canvas', { timeout: 15000 });
ck('qrQuiet2', await A.evaluate(() => {
	const cv = document.querySelector('.ir-mbx canvas.ir-qrimg');
	if (!cv) return false;
	const S = cv.width,
		g = cv.getContext('2d'),
		d = g.getImageData(0, 0, S, S).data,
		white = (x, y) => d[(y * S + x) * 4] >= 128;
	for (let i = 0; i < S; i++) for (let o = 0; o < 4; o++) if (!(white(i, o) && white(i, S - 1 - o) && white(o, i) && white(S - 1 - o, i))) return false; // 四周 4px 以上が白
	let first = -1;
	for (let y = 4; y < S && first < 0; y++) {
		for (let x = 4; x < S; x++) if (!white(x, y)) {
			first = y;
			break;
		}
	}
	return first >= 4 && (first + 1) / 2 >= 2 && first <= S * 0.08; // 白縁 = 2 モジュール（cell ≧ 2・縁は 8% 以内）
}));
ck('modeRadio', await A.evaluate(() => {
	const bx = [...document.querySelectorAll('.ir-mbx')].pop();
	const rs = [...bx.querySelectorAll('input[type="radio"][name="ir-mode"]')];
	return rs.length === 2 && rs.filter(i => i.checked).length === 1;
}));
await A.waitForTimeout(4500); // パスワード発行トースト（4s）の消灯待ち
await A.click('.ir-mbx button:has-text("PNG 保存")');
await A.waitForSelector('.ir-toast:has-text("ダウンロードしました")', { timeout: 5000 });
ck('dlToast', true);
await A.waitForTimeout(9200);
ck('dlToastPersist', (await A.locator('.ir-toast').count()) === 1);
await A.waitForTimeout(2000);
ck('dlToastEnd', (await A.locator('.ir-toast').count()) === 0);
await A.click('.ir-mclose');
ck('hdrModeRadio', await B.evaluate(() => document.querySelectorAll('.ir-hd input[type="radio"][name="ir-hdrmode"]').length === 2));
ck('syncZoneOn', await B.evaluate(() => {
	const z = document.querySelector('.ir-seczone');
	if (!z || !z.classList.contains('ir-srvon')) return false;
	const g = getComputedStyle(z);
	return g.borderTopWidth === '2px' && g.borderTopStyle === 'solid' && !!z.querySelector('.ir-file') && !!z.querySelector('.ir-roomcal');
}));
ck('fileBrighter', await B.evaluate(() => {
	const fi = document.querySelector('.ir-file');
	if (!fi) return false;
	const bg = getComputedStyle(fi).backgroundColor;
	return bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
}));
const D = await mk('D');
await D.goto(BASE + '/img_room.html');
await D.waitForSelector('button:has-text("部屋作成")', { timeout: 15000 });
await D.click('button:has-text("部屋作成")');
await D.waitForSelector('input[name="ir-cpw"]', { timeout: 10000 });
await D.waitForTimeout(900);
ck('pwDefault', (await D.inputValue('input[name="ir-cpw"]')).length >= 8);
ck('pwRegenLabel', (await D.locator('button:has-text("パスワード再作成")').count()) === 1);
await D.close();

console.log(JSON.stringify({ engine: name, room: ROOM, checks, errors }, null, 1));
const bad = errors.length || Object.values(checks).some(v => !v);
console.log(bad ? 'SPEC INCOMPLETE' : 'SPEC OK');
await browser.close();
process.exit(bad ? 1 : 0);
