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
const ck = (k, v) => {
	checks[k] = !!v;
	if (!checks[k]) console.log('CHECKFAIL ' + k);
	return checks[k];
};
process.on('exit', () => console.log('PARTIAL-FAILS:', Object.keys(checks).filter(k => !checks[k]).join(',') || 'none')); // クラッシュ時も判明分を必ず出す

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
await A.waitForSelector('button[aria-label="部屋設定"]', { timeout: 10000 }); // 再描画直後の見えかけタイムアウト対策（ Flake 経験値）
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
// v2.5 §30: 全画面中の ←/→ は戻る/次へ。解除確認ボタンは同サイズ・10px 間隔
const h0k = await A.evaluate(() => window.__IRAPP._vBox._h10); // ファイル名重複に依存しない
await A.keyboard.press('ArrowRight');
let movedK = true;
try {
	await A.waitForFunction(h => {
		const b = window.__IRAPP._vBox;
		return b && b._h10 !== h;
	}, h0k, { timeout: 8000 });
	await A.waitForFunction(() => { // v2.11: viewer() 末尾(async)の fs クラス付与/配線完了まで待つ（_h10 は冒頭で変わる）
		const b = window.__IRAPP._vBox;
		return b && b._fsWire === true && b.classList.contains('ir-fs');
	}, null, { timeout: 8000 });
} catch (e) {
	movedK = false;
	console.log('fsKeyDiag', JSON.stringify(await A.evaluate(h => {
		const c = window.__IRAPP,
			b = c._vBox;
		return { h0: h, h10: b && b._vBox ? b._vBox._h10 : b && b._h10, seq: (c._slSeq || []).slice(0, 8), idx: b ? (c._slSeq || []).indexOf(b._h10) : null, fs: b && b.classList.contains('ir-fs'), fsc: !!(b && b._fsc), slOn: c._slOn, metas: c.activeCtx().collection.metas.size, pend: [c._fsPend, c._slPend] };
	}, h0k)));
}
ck('fsKeyNext', movedK && (await A.locator('.ir-mbx.ir-fs').count()) === 1);
await A.waitForFunction(() => {
	const b = window.__IRAPP._vBox;
	return b && b._fsWire === true && window.__IRAPP._fsPend === false;
}, null, { timeout: 8000 }); // 再配線完了まで待ってから左キー（取りこぼし防止）
await A.keyboard.press('ArrowLeft');
await A.waitForFunction(h => {
	const b = window.__IRAPP._vBox;
	return b && b._h10 === h;
}, h0k, { timeout: 8000 });
await A.waitForFunction(() => {
	const b = window.__IRAPP._vBox;
	return b && b._fsWire === true && b.classList.contains('ir-fs');
}, null, { timeout: 8000 }); // 同上（戻る送りでも配線待ち）
ck('fsKeyPrev', await A.locator('.ir-mbx.ir-fs').count() === 1);
await A.click('.ir-imgwrap');
await A.waitForSelector('.ir-fsc', { timeout: 5000 });
ck('confirmBtnSize', await A.evaluate(() => {
	const bs = [...document.querySelectorAll('.ir-fsp button')];
	if (bs.length !== 2) return false;
	const a = bs[0].getBoundingClientRect(),
		b = bs[1].getBoundingClientRect(),
		gap = Math.min(Math.abs(b.left - a.right), Math.abs(a.left - b.right));
	return Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1 && gap >= 8 && gap <= 12;
}));
await A.click('.ir-fsp button:has-text("続ける")');
await A.waitForTimeout(250);
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
await A.waitForFunction(() => {
	const b = window.__IRAPP._vBox;
	return b && b._fsWire === true && window.__IRAPP._fsPend === false;
}, null, { timeout: 8000 }); // 送り後の再配線待ち
await A.keyboard.press('ArrowLeft'); // v2.5 §30: スライドショー中の ← は戻る
await A.waitForFunction(n => {
	const x = document.querySelector('.ir-mbx h3');
	return x && x.textContent.trim() === n;
}, t0s, { timeout: 9000 });
ck('slideKeyPrev', (await A.textContent('.ir-mbx h3')).trim() === t0s);
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
await A.waitForSelector('.ir-toast', { state: 'detached', timeout: 8000 }).catch(() => {}); // 先行トースト消灯待ち（消灯済み即時可）
await A.click('.ir-mbx button:has-text("PNG 保存")');
await A.waitForSelector('.ir-toast:has-text("ダウンロードしました")', { timeout: 8000 });
ck('dlToast', true);
await A.waitForTimeout(9200); // 10s 表示のうち ~9.2s 時点: まだ表示
ck('dlToastPersist', (await A.locator('.ir-toast').count()) === 1);
await A.waitForTimeout(2000);
ck('dlToastEnd', (await A.locator('.ir-toast').count()) === 0);
await A.click('.ir-mclose');
ck('hdrModeSelect', await B.evaluate(() => document.querySelectorAll('.ir-hd select.ir-hmode').length === 1)); // v2.14 §41: ヘッダーは 3 値 select
ck('syncZoneOn', await B.evaluate(() => {
	const z = document.querySelector('.ir-seczone');
	if (!z || !z.classList.contains('ir-srvon')) return false;
	const g = getComputedStyle(z);
	return g.borderTopWidth === '2px' && g.borderTopStyle === 'solid' && !!z.querySelector('.ir-file') && !!z.querySelector('.ir-roomcal');
}));
ck('fileBrighter', await B.evaluate(() => {
	// v2.3 §27: 明色は画像登録エリア(.ir-uparea)のみ。ファイル input 自体は透明
	const up = document.querySelector('.ir-uparea');
	if (!up) return false;
	const bg = getComputedStyle(up).backgroundColor;
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
// ---- v2.3 §27: 登録エリアのみ明色 / pw ラベル / names 既定 / LS(deflate→b64url) ----
ck('upLightOnly', await B.evaluate(() => {
	const up = document.querySelector('.ir-uparea'),
		fi = document.querySelector('.ir-file');
	if (!up || !fi) return false;
	return getComputedStyle(up).backgroundColor !== 'rgba(0, 0, 0, 0)' && getComputedStyle(fi).backgroundColor === 'rgba(0, 0, 0, 0)' && up.contains(fi);
}));
ck('lsFormat', await A.evaluate(() => /^[DR][A-Za-z0-9_-]+$/.test(localStorage.getItem('ir_lastdef') || '')));
ck('lsDecode', await A.evaluate(async nm => {
	const d = await window.__IRAPP.lastDef();
	return !!d && d.nm === nm && d.uid === 'PONTA';
}, ROOM));
const P2 = await A.context().newPage();
await P2.goto(BASE + '/img_room.html');
await P2.waitForSelector('button:has-text("部屋作成")', { timeout: 15000 });
await P2.click('button:has-text("部屋作成")');
await P2.waitForSelector('input[name="ir-cn"]', { timeout: 10000 });
await P2.waitForTimeout(500);
const nmv = await P2.inputValue('input[name="ir-cn"]');
ck('prefillTs', nmv.startsWith(ROOM + '-') && /-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(nmv), nmv);
ck('prefillUid', (await P2.inputValue('input[name="ir-cuid"]')) === 'PONTA');
ck('tsReplace', await P2.evaluate(() => {
	const r = window.__IRAPP.withTs('abc-2020-01-01-00-00-00');
	return r.startsWith('abc-') && !r.includes('2020-') && /-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(r);
}));
await P2.close();
const D2 = await mk('D2');
await D2.goto(BASE + '/img_room.html');
await D2.waitForSelector('button:has-text("部屋作成")', { timeout: 15000 });
await D2.click('button:has-text("部屋作成")');
await D2.waitForSelector('input[name="ir-cpw"]', { timeout: 10000 });
ck('wsBtnCreate', (await D2.locator('.ir-frm button:has-text("⚙️ 接続設定")').count()) === 1); // v2.5 §30: 作成画面にも接続設定
await D2.click('.ir-frm button:has-text("⚙️ 接続設定")');
await D2.waitForSelector('.ir-wsqr canvas.ir-qrimg', { timeout: 20000 }); // QR はデフォルト表示
ck('wsQrAuto', true);
await D2.click('.ir-mbx .ir-mclose');
await D2.waitForTimeout(400);
ck('pwLabel', (await D2.locator('.ir-frm label:has-text("パスワード")').count()) === 1);
const un = await D2.inputValue('input[name="ir-cuid"]');
ck('nameRandom', un.length > 0 && (await D2.evaluate(x => (window.__IRAPP.cfg.names || []).includes(x), un)), un);
await D2.close();
// ---- v2.4 §28: WebSocket URL 設定（既定=サイト・QR 表示/変更/読取）----
const P3 = await A.context().newPage();
await P3.goto(BASE + '/img_room.html');
await P3.waitForSelector('button:has-text("⚙️ 接続設定")', { timeout: 15000 });
ck('wsBtn', true);
await P3.click('button:has-text("⚙️ 接続設定")');
await P3.waitForSelector('input[name="ir-wsb"]', { timeout: 10000 });
ck('wsDefaultEmpty', (await P3.inputValue('input[name="ir-wsb"]')) === '');
ck('wsBaseDefault', await P3.evaluate(() => import('/modules/imgroom/ir_const.js').then(m => m.getWsBase() === location.origin)));
await P3.click('.ir-mbx button:has-text("QR 表示")');
await P3.waitForSelector('.ir-wsqr canvas.ir-qrimg', { timeout: 20000 });
ck('wsQrQuiet', await P3.evaluate(() => {
	const cv = document.querySelector('.ir-wsqr canvas.ir-qrimg');
	if (!cv || !(cv.title || '').startsWith('TMIWS1:')) return false;
	const S = cv.width,
		g = cv.getContext('2d'),
		d = g.getImageData(0, 0, S, S).data,
		white = (x, y) => d[(y * S + x) * 4] >= 128;
	for (let i = 0; i < S; i++) for (let o = 0; o < 4; o++) if (!(white(i, o) && white(i, S - 1 - o) && white(o, i) && white(S - 1 - o, i))) return false;
	return true;
}));
await P3.fill('input[name="ir-wsb"]', 'http://example.local:9999');
await P3.click('.ir-mbx button:has-text("適用")');
await P3.waitForTimeout(400);
ck('wsApplied', await P3.evaluate(() => import('/modules/imgroom/ir_const.js').then(m => m.getWsBase() === 'ws://example.local:9999')));
await P3.waitForTimeout(900); // AppSettings 500ms debounce flush 待ち
await P3.reload();
await P3.waitForSelector('button:has-text("⚙️ 接続設定")', { timeout: 15000 });
await P3.click('button:has-text("⚙️ 接続設定")');
await P3.waitForSelector('input[name="ir-wsb"]', { timeout: 10000 });
ck('wsPersist', (await P3.inputValue('input[name="ir-wsb"]')) === 'ws://example.local:9999');
// v2.6 §31: OPFS 全体設定（user_settings.json）へ単一値。複数指定は拒否
ck('wsBootRestore', await P3.evaluate(async () => {
	const m = await import('/modules/imgroom/ir_const.js');
	return m.getWsBase() === 'ws://example.local:9999';
}));
ck('wsOpfsStored', await P3.evaluate(async () => {
	const { OPFS } = await import('/OPFS.js');
	const ab = await OPFS.r('user_settings.json');
	if (!ab) return false;
	const o = JSON.parse(new TextDecoder().decode(ab));
	return o.WSBASE === 'ws://example.local:9999';
}));
await P3.fill('input[name="ir-wsb"]', 'ws://a.example ws://b.example');
await P3.click('.ir-mbx button:has-text("適用")');
await P3.waitForTimeout(500);
ck('wsMultiReject', await P3.evaluate(async () => {
	const m = await import('/modules/imgroom/ir_const.js');
	const toast = [...document.querySelectorAll('.ir-toast')].some(e => (e.textContent || '').includes('1 つだけ'));
	return m.getWsBase() === 'ws://example.local:9999' && toast && (document.querySelector('input[name="ir-wsb"]').value || '').includes('a.example');
}));
const png = await P3.evaluate(async () => {
	const m = await import('/modules/qr_tool.js');
	const r = await m.QRTool.make('TMIWS1:https://qrhost.example', { size: 320 });
	return r.canvas.toDataURL('image/png').split(',')[1];
});
await P3.click('.ir-mbx button:has-text("QR 読取")');
await P3.waitForSelector('.ir-mbx input[type="file"]', { timeout: 10000 });
await P3.setInputFiles('.ir-mbx input[type="file"]', { name: 'ws.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
await P3.waitForTimeout(1500);
const wsv = await P3.inputValue('input[name="ir-wsb"]');
ck('wsScanPng', wsv === 'wss://qrhost.example', wsv);
await P3.click('.ir-mbx button:has-text("サイト既定")');
await P3.waitForTimeout(400);
ck('wsResetDefault', await P3.evaluate(() => import('/modules/imgroom/ir_const.js').then(m => m.getWsBase() === location.origin)));
await P3.close();
// v2.6 §32: 検証オリジンは Web ホスト基準。WebSocket 接続先オリジンは認証/検証に不関与
ck('wsNotInAuth', await A.evaluate(async () => {
	const m = await import('/modules/imgroom/ir_const.js'),
		ac = await import('/modules/auth_challenge.js');
	m.setWsBase('ws://elsewhere.example:9999'); // 接続先だけ別オリジン（接続は行わない）
	try {
		const c = window.__IRAPP.activeCtx(),
			AC = ac.AuthChallenge,
			pw = c.plainPw,
			salt = c.room.pwSalt,
			r = c.session._rounds();
		if (!pw || !salt) return false;
		// v2.11 §38: seed 式自体が origin を含まない。auth の origin 照合は常に Web origin 基準で、WS 接続先は無関係
		const sWeb = await AC.seed(pw, c.room.nm, salt, r),
			sSess = await c.session._seedOf(pw, salt), // 実セッションの seed 経路
			sSame = await AC.seed(pw, c.room.nm, salt, r);
		const oh = await AC.originHashes(location.origin, r),
			ohWs = await AC.originHashes('ws://elsewhere.example:9999', r);
		return sWeb === sSess && sSess === sSame && !!oh.ho && !!oh.hor && oh.ho !== ohWs.ho; // 検証値は常に Web origin 基準で安定
	} finally {
		m.setWsBase('');
	}
}));
// ---- v2.7 §33: QR 認証 QR のコピー→貼付け耐性（TMIWR1: はパスワードの一部ではない）----
const ppw = await A.evaluate(() => window.__IRAPP.activeCtx().plainPw);
const pack = await A.evaluate(async () => {
	const m = await import('/modules/imgroom/ir_const.js'),
		c = window.__IRAPP.activeCtx();
	return m.qrPack(c.room.nm, c.plainPw);
});
ck('pwFromPack', await A.evaluate(([pk, pp]) => {
	const R = window.__IRAPP.constructor;
	return R.pwFromField(pk) === pp && R.pwFromField('TMIWR1:' + pp) === pp && R.pwFromField(pp) === pp;
}, [pack, ppw]));
await A.context().grantPermissions(['clipboard-read', 'clipboard-write']);
await A.click('button[aria-label="部屋設定"]');
await A.waitForSelector('.ir-mbx h3', { timeout: 10000 });
await A.click('.ir-mbx button:has-text("パスワードのみコピー")');
await A.waitForTimeout(300);
const clip = await A.evaluate(async () => await navigator.clipboard.readText());
ck('copyPwOnly', clip === ppw && !clip.includes('TMIWR1'), (clip || '').slice(0, 12));
await A.click('.ir-mclose');
await A.waitForTimeout(300);
const E = await mk('E');
await E.goto(BASE + '/img_room.html');
await E.click('button:has-text("参加")');
await E.fill('input[name="ir-nm"]', ROOM);
await E.fill('input[name="ir-uid"]', 'ECHO');
await E.fill('input[name="ir-pw"]', pack); // TMIWR1:<部屋名>:<パスワード> 一式をそのまま貼付け
await E.click('.ir-frm button:has-text("ログイン")');
await E.waitForSelector('input[type=file]', { timeout: 30000 });
ck('joinWithPack', true);
await E.close();
// ---- v2.8 §34: 参加フォーム/リトライボックスの診断表示（誤パスワード採決不 OK 経路）----
const aLogs = [];
A.on('console', mm => aLogs.push(mm.text() || '')); // v2.9 §35: 投票側監査ログ（console.info）収集
const F2 = await mk('F');
await F2.goto(BASE + '/img_room.html');
await F2.click('button:has-text("参加")');
ck('joinFormOriginLine', await F2.evaluate(() => [...document.querySelectorAll('.ir-frm .ir-mut')].some(e => (e.textContent || '').includes('このページのオリジン: http://'))));
await F2.fill('input[name="ir-nm"]', ROOM);
await F2.fill('input[name="ir-uid"]', 'FAKE');
await F2.fill('input[name="ir-pw"]', 'WRONGPW');
await F2.click('.ir-frm button:has-text("ログイン")');
await F2.waitForFunction(() => document.body.textContent.includes('診断情報:'), null, { timeout: 30000 });
ck('retryDiag', await F2.evaluate(() => {
	const t = document.body.textContent || '';
	return t.includes('このページのオリジン: http://') && t.includes('モード: normal') && t.includes('クロスオリジン');
}));
await F2.close();
// ---- v2.9 §35: 投票側ゲート監査（誤 pw=gate=pw / 別オリジン参加=gate=origin）----
ck('voteDenyPw', aLogs.some(x => x.includes('gate=pw')));
const LOCBASE = BASE.replace('//127.0.0.1', '//localhost');
const G = await mk('G');
await G.goto(LOCBASE + '/img_room.html');
await G.click('button:has-text("参加")');
await G.fill('input[name="ir-nm"]', ROOM);
await G.fill('input[name="ir-uid"]', 'GLAB');
await G.fill('input[name="ir-pw"]', ppw); // パスワードは正しい。オリジン（localhost）だけが違う
await G.click('.ir-frm button:has-text("ログイン")');
await G.waitForFunction(() => document.body.textContent.includes('診断情報:'), null, { timeout: 30000 });
ck('voteDenyOrigin', aLogs.some(x => x.includes('gate=origin') && x.includes('GLAB')));
ck('voteLogArr', await A.evaluate(() => {
	const vl = window.__IRAPP.activeCtx().session._voteLog || [];
	return vl.some(e => e.gate === 'origin' && e.uid === 'GLAB');
}));
await G.close();
// ---- v2.10 §37: 全クリック要素 pointer カーソル / クリック波紋フィードバック ----
ck('cursorPointer', await A.evaluate(() => {
	const els = [...document.querySelectorAll('button:not(:disabled), select:not(:disabled), input[type="radio"]:not(:disabled)')];
	return els.length > 5 && els.every(e => getComputedStyle(e).cursor === 'pointer');
}));
ck('thumbPointer', await A.evaluate(() => {
	const t = document.querySelector('.ir-thumb');
	return !!t && getComputedStyle(t).cursor === 'pointer';
}));
await A.click('button[aria-label="部屋設定"]');
ck('clickFlash', await A.evaluate(() => {
	const b = document.querySelector('button[aria-label="部屋設定"]');
	return !!b && getComputedStyle(b).animationName === 'ir-clickflash';
}));
await A.click('.ir-mclose');
await A.waitForTimeout(250);
// ---- v2.11 §38: xorig 部屋のクロスオリジン参加（seed から origin 除去の実効性）----
const XR = 'xroom' + (Date.now() % 100000);
const X1 = await mk('X');
await X1.goto(BASE + '/img_room.html');
await X1.click('button:has-text("部屋作成")');
await X1.fill('input[name="ir-cn"]', XR);
await X1.fill('input[name="ir-cuid"]', 'XO1');
const XPW = await X1.inputValue('input[name="ir-cpw"]');
await X1.check('.ir-frm .ir-toggle input[type="checkbox"]'); // クロスオリジン許可 ON（作成時固定）
await X1.click('.ir-frm button:has-text("部屋作成")');
await X1.waitForSelector('input[type=file]', { timeout: 20000 });
const xLogs = [];
X1.on('console', mm => xLogs.push(mm.text() || ''));
await X1.click('button[aria-label="部屋設定"]');
await X1.waitForSelector('.ir-mbx h3', { timeout: 10000 });
await X1.fill('.ir-mbx input[placeholder*="許可オリジン"]', 'http://localhost:8080');
await X1.click('.ir-mbx .ir-row button:has-text("+")');
await X1.waitForTimeout(700); // C 配信
await X1.click('.ir-mclose');
await X1.waitForTimeout(300);
const X2 = await mk('X2');
await X2.goto(LOCBASE + '/img_room.html'); // 別オリジン（localhost）。パスワード・部屋名は正しい
await X2.click('button:has-text("参加")');
await X2.fill('input[name="ir-nm"]', XR);
await X2.fill('input[name="ir-uid"]', 'XO2');
await X2.fill('input[name="ir-pw"]', XPW);
await X2.click('.ir-frm button:has-text("ログイン")');
await X2.waitForSelector('input[type=file]', { timeout: 30000 });
ck('xorigJoin', true);
const X3 = await mk('X3');
await X3.goto(BASE + '/img_room.html'); // 未登録オリジン（127.0.0.1）。pw は正しい → ゲート 2 で棄却
await X3.click('button:has-text("参加")');
await X3.fill('input[name="ir-nm"]', XR);
await X3.fill('input[name="ir-uid"]', 'XO3');
await X3.fill('input[name="ir-pw"]', XPW);
await X3.click('.ir-frm button:has-text("ログイン")');
await X3.waitForFunction(() => document.body.textContent.includes('診断情報:'), null, { timeout: 30000 });
ck('xorigDenyUnlisted', xLogs.some(x => x.includes('gate=origin') && x.includes('XO3')));
await X3.close();
await X2.close();
await X1.close();
// ---- v2.12 §39: メニューの「パスワードのみコピー」は QR 直下/未発行時無効、説明文、file 選択 button pointer ----
await A.click('button[aria-label="部屋設定"]');
await A.waitForSelector('.ir-mbx .ir-qrpic', { timeout: 10000 });
ck('pwCopyPos', await A.evaluate(() => {
	const mb = document.querySelector('.ir-mbx'),
		qr = mb.querySelector('.ir-qrrow'),
		cp = [...mb.querySelectorAll('button')].find(b => (b.textContent || '').includes('パスワードのみコピー'));
	return !!qr && !!cp && !cp.disabled && (qr.compareDocumentPosition(cp) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}));
ck('scanNote', await A.evaluate(() => [...document.querySelectorAll('.ir-mbx .ir-qrnote, .ir-mbx .ir-mut')].some(e => (e.textContent || '').includes('部屋名とパスワード'))));
await A.click('.ir-mclose');
await A.waitForTimeout(300);
const D9 = await mk('D9');
await D9.goto(BASE + '/img_room.html');
await D9.click('button:has-text("部屋作成")');
const DR = 'dkw' + (Date.now() % 100000);
await D9.fill('input[name="ir-cn"]', DR);
await D9.fill('input[name="ir-cuid"]', 'DEE');
const DPW = await D9.inputValue('input[name="ir-cpw"]');
await D9.click('.ir-frm button:has-text("部屋作成")');
await D9.waitForSelector('input[type=file]', { timeout: 20000 });
ck('fileCursor', await D9.evaluate(() => {
	const f = document.querySelector('input[type=file]');
	return !!f && getComputedStyle(f).cursor === 'pointer';
}));
await D9.click('button[aria-label="部屋設定"]');
await D9.waitForSelector('.ir-mbx h3', { timeout: 10000 });
await D9.click('.ir-mbx button:has-text("退室")'); // 退室後、再度ログイン（平文 pw 非保持）→ 発行前はボタン無効
try {
	await D9.waitForFunction(() => [...document.querySelectorAll('button')].some(b => (b.textContent || '').trim() === '部屋作成'), null, { timeout: 40000 }); // ホーム再描画待ち（退室後のカードは「ログイン」または rl クリアで「参加」）
await D9.locator('.ir-btn:has-text("ログイン"), .ir-btn:has-text("参加")').first().click();
} catch (err918) {
	console.log('leaveDiag', JSON.stringify(await D9.evaluate(() => ({
		hash: location.hash,
		mbx: !!document.querySelector('.ir-mbx'),
		toast: [...document.querySelectorAll('.ir-toast')].map(x => (x.textContent || '').slice(0, 60)),
		btns: [...document.querySelectorAll('button')].map(b => (b.textContent || '').trim()).slice(0, 30),
	}))));
	throw err918;
}
await D9.locator('.ir-btn:has-text("ログイン")').first().click();
await D9.waitForSelector('.ir-frm input[name="ir-pw"]', { timeout: 10000 });
await D9.fill('input[name="ir-nm"]', DR);
await D9.fill('input[name="ir-uid"]', 'DEE');
await D9.fill('input[name="ir-pw"]', DPW);
await D9.click('.ir-frm button:has-text("ログイン")');
await D9.waitForSelector('input[type=file]', { timeout: 30000 });
await D9.click('button[aria-label="部屋設定"]');
await D9.waitForSelector('.ir-mbx h3', { timeout: 10000 });
ck('pwCopyDisabled', await D9.evaluate(() => {
	const mb = document.querySelector('.ir-mbx'),
		cp = [...mb.querySelectorAll('button')].find(b => (b.textContent || '').includes('パスワードのみコピー'));
	return !!cp && cp.disabled === true;
}));
await D9.close();
// ---- v2.13 §40: モード keep（通常・取得保持）: 取得後 OPFS 永続化+manifest 採用で保持者化 ----
const Aroom = await A.evaluate(() => {
	const c = window.__IRAPP.activeCtx(),
		e = c.collection.manifest.find(x => x && x.h) || {};
	return { nm: c.room.nm, h: e.h || '' }; // nm は b64url 形式の可能性あり→参加にはテスト変数 ROOM を使う
});
ck('keepH10Ready', !!Aroom.h);
const CURPW = await A.evaluate(() => window.__IRAPP.activeCtx().plainPw || ''); // §26 で再発行済み: 現行平文 pw を作成者セッションから取る
ck('keepPwKnown', !!CURPW);
const K1 = await mk('K1');
await K1.goto(BASE + '/img_room.html');
await K1.click('button:has-text("参加")');
ck('keepRadio', await K1.evaluate(() => !!document.querySelector('input[name="ir-mode"][value="keep"]')));
await K1.check('input[name="ir-mode"][value="keep"]');
await K1.fill('input[name="ir-nm"]', ROOM);
await K1.fill('input[name="ir-uid"]', 'KEE');
await K1.fill('input[name="ir-pw"]', CURPW);
await K1.click('.ir-frm button:has-text("ログイン")');
try {
	await K1.waitForSelector('input[type=file]', { timeout: 30000 });
} catch (eK1j) {
	console.log('kJoinDiag', await K1.evaluate(() => (document.querySelector('.ir-retry, .ir-mbx')?.textContent || document.body.textContent || '').slice(0, 300)));
	throw eK1j;
}
console.log('kRidDbg', JSON.stringify({ Aroom: Aroom.nm, krid: await K1.evaluate(() => window.__IRAPP.activeCtx().rid), arid: await A.evaluate(() => window.__IRAPP.activeCtx().rid), khash: await K1.evaluate(() => location.hash) }));
const kState = () => {
	const c = window.__IRAPP.activeCtx(),
		own = new Set(c.collection.manifest.map(e => e.h));
	return {
		ps: c.session.state.participants.map(x => x.uid),
		th: document.querySelectorAll('.ir-thumb').length,
		srcs: document.querySelectorAll('.ir-thumb img[src]').length,
		nonOwnSrc: [...document.querySelectorAll('.ir-thumb img[src]')].filter(el => { const t = el.closest('.ir-thumb'); return t && t.dataset.h10 && !own.has(t.dataset.h10); }).length,
		metas: c.collection.metas.size,
		mset: c.collection.mset.size,
	};
};
try {
	await K1.waitForFunction(() => {
		const c = window.__IRAPP.activeCtx(),
			own = new Set(c.collection.manifest.map(e => e.h));
		return [...document.querySelectorAll('.ir-thumb img[src]')].some(el => {
			const t = el.closest('.ir-thumb');
			return !!t && !!t.dataset.h10 && !own.has(t.dataset.h10);
		});
	}, null, { timeout: 45000 });
} catch (e961) {
	console.log('kDiag', JSON.stringify(await K1.evaluate(kState)));
	console.log('aDiag', JSON.stringify(await A.evaluate(() => {
		const c = window.__IRAPP.activeCtx();
		return { ps: c.session.state.participants.map(x => x.uid), mode: c.mode, th: document.querySelectorAll('.ir-thumb').length, mset: c.collection.mset.size };
	})));
	throw e961;
}
const kh = await K1.evaluate(() => {
	const c = window.__IRAPP.activeCtx(),
		own = new Set(c.collection.manifest.map(e => e.h)),
		el = [...document.querySelectorAll('.ir-thumb')].find(e => e.dataset.h10 && !own.has(e.dataset.h10));
	return el ? el.dataset.h10 : '';
});
ck('keepSeeThumb', !!kh);
await K1.click(`.ir-thumb[data-h10="${kh}"]`);
await K1.waitForSelector('.ir-mbx img[src]', { timeout: 20000 });
await K1.click('.ir-mclose');
await K1.waitForTimeout(1200);
ck('keepAdopt', await K1.evaluate(async h => {
	const app = window.__IRAPP,
		c = app.activeCtx();
	return c.collection.mset.has(h) && !!(await app.store.get(h));
}, kh));
await A.waitForTimeout(2500); // シート配信（スロットル）で A 側 holders に収束
ck('keepHolders', await A.evaluate(o => {
	const c = window.__IRAPP.activeCtx(),
		ho = c.collection.holdersOf(o.h);
	return !!ho && ho.uids.includes(o.uidK);
}, { uidK: 'KEE', h: kh })); // K1 が開いたのと同じ h10 で保持者判定する
const N9 = await mk('N9');
await N9.goto(BASE + '/img_room.html');
await N9.click('button:has-text("参加")'); // 通常（都度取得）対照: manifest 採用しない
await N9.fill('input[name="ir-nm"]', ROOM);
await N9.fill('input[name="ir-uid"]', 'NRM9');
await N9.fill('input[name="ir-pw"]', CURPW);
await N9.click('.ir-frm button:has-text("ログイン")');
await N9.waitForSelector('input[type=file]', { timeout: 30000 });
await N9.waitForFunction(() => {
	const c = window.__IRAPP.activeCtx(),
		own = new Set(c.collection.manifest.map(e => e.h));
	return [...document.querySelectorAll('.ir-thumb img[src]')].some(el => {
		const t = el.closest('.ir-thumb');
		return !!t && !!t.dataset.h10 && !own.has(t.dataset.h10);
	});
}, null, { timeout: 45000 });
const nh = await N9.evaluate(() => {
	const c = window.__IRAPP.activeCtx(),
		own = new Set(c.collection.manifest.map(e => e.h)),
		el = [...document.querySelectorAll('.ir-thumb')].find(e => e.dataset.h10 && !own.has(e.dataset.h10));
	return el ? el.dataset.h10 : '';
});
await N9.click(`.ir-thumb[data-h10="${nh}"]`);
await N9.waitForSelector('.ir-mbx img[src]', { timeout: 20000 });
await N9.click('.ir-mclose');
await N9.waitForTimeout(1200);
ck('normalNoAdopt', await N9.evaluate(h => window.__IRAPP.activeCtx().collection.mset.has(h) === false, nh));
// ---- v2.14 §41: ログイン済み画面からのモード切替（B: normal→keep で取得保持化） ----
ck('hdrSwitchSelect', await B.evaluate(() => {
	const sel = document.querySelector('.ir-hd select.ir-hmode');
	return !!sel && [...sel.options].map(o => o.value).join(',') === 'normal,keep,sync';
}));
await B.selectOption('.ir-hd select.ir-hmode', 'keep');
ck('hdrSwitchState', await B.evaluate(() => {
	const c = window.__IRAPP.activeCtx();
	return c.mode === 'keep' && !!c.cal && c.cal.keep === true;
}));
{
	const bh = await B.evaluate(() => {
		const c = window.__IRAPP.activeCtx(),
			own = new Set(c.collection.mset),
			el = [...document.querySelectorAll('.ir-thumb')].find(e => e.dataset.h10 && !own.has(e.dataset.h10));
		return el ? el.dataset.h10 : '';
	});
	ck('hdrSwitchTarget', !!bh);
	if (bh) {
		await B.click(`.ir-thumb[data-h10="${bh}"]`);
		await B.waitForSelector('.ir-mbx img[src]', { timeout: 20000 });
		await B.click('.ir-mclose');
		await B.waitForTimeout(1500);
		ck('hdrSwitchAdopt', await B.evaluate(async h => {
			const app = window.__IRAPP,
				c = app.activeCtx();
			return c.collection.mset.has(h) && !!(await app.store.get(h));
		}, bh));
	}
	ck('hdrSwitchPersist', await B.evaluate(async () => {
		const m = await import('/modules/app_settings.js'),
			c = window.__IRAPP.activeCtx();
		return ((m.AppSettings.state.roomLogin || {})[c.rid] || {}).mode === 'keep';
	}));
}
// ---- v2.15 §42: URL アンカーの WebSocket 設定 / URL QR の ws 同梱 / サーバー pw QR オプション / パスワードマネージャ form ----
ck('urlQrWs', await A.evaluate(async () => { // URL QR 実文に #nb:b64url(実効 WS base) が付く
	const v = (document.querySelector('.ir-sec .ir-qrside input') || {}).value || '',
		m = /#([A-Za-z0-9_%-]+):([A-Za-z0-9_-]+)$/.exec(v);
	if (!m) return false;
	const Y = (await import('/Y.js')).Y;
	return Y.u2s(Y.U2u(m[2])) === location.origin.replace(/^http/, 'ws');
}));
// A: 切断・再接続で plainPw を失った状態をテストフックで補い再描画（実運用ではメニュー QR 流程で復活可、§39）
await A.evaluate(pw => {
	const c = window.__IRAPP.activeCtx();
	if (!c.plainPw) c.plainPw = pw;
	window.__IRAPP.redraw();
}, CURPW);
await A.waitForTimeout(300);
ck('pwqrChkEnabled', await A.locator('.ir-sec input.ir-chk').isEnabled());
await A.check('.ir-sec input.ir-chk'); // サーバーモード: パスワード QR 同時表示オプション ON
await A.waitForTimeout(500);
ck('pwqrShown', await A.locator('.ir-sec .ir-secret').count() >= 1);
await A.uncheck('.ir-sec input.ir-chk');
await A.waitForTimeout(500);
ck('pwqrOff', await A.locator('.ir-sec .ir-secret').count() === 0);
{
	const ws1 = Buffer.from('ws://127.0.0.1:8080').toString('base64url'),
		ws2 = Buffer.from('ws://elsewhere.invalid:9999').toString('base64url'),
		readWs = pg => pg.evaluate(async () => {
			const m = await import('/modules/imgroom/ir_const.js');
			return m.getWsBase();
		});
	const WB = await mk('WA');
	await WB.goto(BASE + '/img_room.html#anchorx1:' + ws1); // 既存設定なし → 確認なく適用・永続化
	await WB.waitForSelector('.ir-frm input[name="ir-nm"]', { timeout: 10000 }); // boot 完了（アンカー適用後）を待つ
	ck('anchorWsApply', (await readWs(WB)) === 'ws://127.0.0.1:8080');
	await WB.waitForTimeout(900); // AppSettings の 500ms デバウンス保存を待つ（user_settings 側 = cfg に載る）
	ck('anchorWsSaved', await WB.evaluate(async () => {
		const a = await import('/modules/app_settings.js');
		return (a.AppSettings.cfg || {}).WSBASE === 'ws://127.0.0.1:8080';
	}));
	let asked = false;
	WB.on('dialog', d => {
		asked = true;
		d.dismiss(); // 別ドメイン設定 → 確認。拒否なら保持
	});
	await WB.goto(BASE + '/img_room.html#anchorx2:' + ws2); // fragment 変化だけなので reload で boot を再実行させる
	await WB.reload();
	await WB.waitForSelector('.ir-frm input[name="ir-nm"]', { timeout: 10000 });
	await WB.waitForTimeout(800);
	ck('anchorWsConfirm', asked);
	ck('anchorWsKeep', (await readWs(WB)) === 'ws://127.0.0.1:8080');
	const WB2 = await WB.context().newPage(); // 同一 OPFS の別タブ
	WB2.on('dialog', d => d.accept());
	await WB2.goto(BASE + '/img_room.html#anchorx3:' + ws2); // 確認 OK → 上書き
	await WB2.waitForSelector('.ir-frm input[name="ir-nm"]', { timeout: 10000 });
	ck('anchorWsOver', (await readWs(WB2)) === 'ws://elsewhere.invalid:9999');
	await WB2.evaluate(async () => { // 後始末（この文脈の既定に戻す）
		const m = await import('/modules/imgroom/ir_const.js'),
			a = await import('/modules/app_settings.js');
		m.setWsBase('');
		await a.AppSettings.set('WSBASE', '');
	});
	await WB2.close();
	await WB.close();
}
{
	const FM = await mk('FM');
	await FM.goto(BASE + '/img_room.html');
	await FM.click('button:has-text("参加")');
	await FM.waitForSelector('form.ir-frm input[name="ir-uid"][autocomplete="username"]', { timeout: 6000 });
	ck('formMgrJoin', await FM.evaluate(() => {
		const f = document.querySelector('form.ir-frm');
		return !!f && !!f.querySelector('input[name="ir-uid"][autocomplete="username"]') && !!f.querySelector('input[name="ir-pw"][autocomplete="current-password"]');
	}));
	await FM.goto(BASE + '/img_room.html');
	await FM.click('button:has-text("部屋作成")');
	await FM.waitForSelector('form.ir-frm input[name="ir-cpw"][autocomplete="new-password"]', { timeout: 6000 });
	ck('formMgrCreate', await FM.evaluate(() => {
		const f = document.querySelector('form.ir-frm');
		return !!f && !!f.querySelector('input[name="ir-cuid"][autocomplete="username"]') && !!f.querySelector('input[name="ir-cpw"][autocomplete="new-password"]');
	}));
	await FM.close();
}
// ---- v2.16 §43: ビューア両端クリックで前後切替 / 左右キー / ダブルで全画面 ----
{
	await K1.click(`.ir-thumb[data-h10="${kh}"]`);
	await K1.waitForSelector('.ir-mbx .ir-img[src]', { timeout: 20000 });
	await K1.waitForTimeout(700);
	const cur0 = await K1.evaluate(() => window.__IRAPP._vBox && window.__IRAPP._vBox._h10);
	const meta0 = await K1.evaluate(() => (document.querySelector('.ir-meta3') || {}).textContent || '');
	ck('navStart', !!cur0 && cur0 === kh);
	ck('navZones', await K1.locator('.ir-mbx .ir-navz').count() === 2);
	await K1.click('.ir-navz.r'); // 右 1/3: 次へ（単クリックは 300ms 遅延で確定・未保有は P2P 取得を待つ）
	const cur1 = await K1.waitForFunction(h => {
		const bo = window.__IRAPP._vBox;
		return !!(bo && bo._h10 && bo._h10 !== h);
	}, cur0, { timeout: 15000 }).then(() => K1.evaluate(() => window.__IRAPP._vBox && window.__IRAPP._vBox._h10)).catch(() => cur0);
	ck('navNext', !!cur1 && cur1 !== cur0);
	await K1.waitForTimeout(500); // 開き直後の添付データ描画を待つ
	const meta1 = await K1.evaluate(() => (document.querySelector('.ir-meta3') || {}).textContent || '');
	ck('navMeta', !!meta1 && meta1 !== meta0); // 添付データ（投稿者/日付/SHA）も追従
	await K1.click('.ir-navz.l'); // 左 1/3: 前へ（cur0 復帰は取得済みで速いが同じ待ち方）
	const back = await K1.waitForFunction(h => {
		const bo = window.__IRAPP._vBox;
		return !!(bo && bo._h10 === h);
	}, cur0, { timeout: 15000 }).then(() => K1.evaluate(() => window.__IRAPP._vBox && window.__IRAPP._vBox._h10)).catch(() => '');
	ck('navPrev', back === cur0);
	await K1.keyboard.press('ArrowRight'); // キーでも同様に
	const fwd = await K1.waitForFunction(h => {
		const bo = window.__IRAPP._vBox;
		return !!(bo && bo._h10 === h);
	}, cur1, { timeout: 15000 }).then(() => K1.evaluate(() => window.__IRAPP._vBox && window.__IRAPP._vBox._h10)).catch(() => '');
	ck('navKeyR', fwd === cur1);
	await K1.dblclick('.ir-mbx .ir-img'); // ダブルクリックで全画面
	await K1.waitForTimeout(500);
	ck('fsDbl', await K1.evaluate(() => !!window.__IRAPP._vBox && window.__IRAPP._vBox.classList.contains('ir-fs')));
	await K1.click('.ir-mbx .ir-img'); // 全画面中の中央タップ → 解除確認 → 終了
	await K1.waitForTimeout(400);
	ck('fsExitPanel', await K1.locator('.ir-mbx .ir-fsc').count() === 1);
	await K1.click('.ir-fsc .ir-btn.warn');
	await K1.waitForTimeout(500);
	ck('fsExited', await K1.evaluate(() => !window.__IRAPP._vBox || !window.__IRAPP._vBox.classList.contains('ir-fs')));
	await K1.click('.ir-mclose');
	await K1.waitForTimeout(400);
}
// ---- v2.17 §44: 2MB 級本文取得はサイズ比例上限で完遂（旧固定 18s では途中でタイムアウトした） ----
{
	const z = await import('node:zlib'),
		crc32 = buf => {
			const table = [];
			for (let n = 0; n < 256; n++) {
				let c = n;
				for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
				table[n] = c >>> 0;
			}
			let crc = 0xffffffff;
			for (const by of buf) crc = table[(crc ^ by) & 255] ^ (crc >>> 8);
			return (crc ^ 0xffffffff) >>> 0;
		},
		pngChunk = (type, data) => {
			const td = Buffer.concat([Buffer.from(type, 'ascii'), data]),
				len = Buffer.alloc(4),
				crc = Buffer.alloc(4);
			len.writeUInt32BE(data.length);
			crc.writeUInt32BE(crc32(td));
			return Buffer.concat([len, td, crc]);
		};
	// 決定的 xorshift 乱数 RGBA（gzip 不能）→ 約 2.36MB PNG。圧縮後 chunk 数 ≒ 290 × CHUNK_GAP_MS 100ms ≒ 29s で旧固定上限 18s を必ず超える
	const PW_ = 768, PH = 768,
		raw = Buffer.alloc(PH * (PW_ * 4 + 1));
	for (let i = 0, x = 123456789; i < raw.length; i++) // xorshift32（gzip 耐性の高品質擬似乱数。LCG 上位ビットは圧縮され chunk 数が稼げない）
		if (i % (PW_ * 4 + 1)) {
			x ^= x << 13;
			x = (x ^ (x >>> 17)) >>> 0;
			x = (x ^ (x << 5)) >>> 0;
			raw[i] = x & 255;
		}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(PW_, 0);
	ihdr.writeUInt32BE(PH, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	const bigPng = Buffer.concat([
		Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'),
		pngChunk('IHDR', ihdr),
		pngChunk('IDAT', z.deflateSync(raw, { level: 0 })),
		pngChunk('IEND', Buffer.alloc(0)),
	]);
	ck('bigPngSize', bigPng.length > 2 * 1024 * 1024 && bigPng.length < 4 * 1024 * 1024, Math.round(bigPng.length / 1024) + 'KB');
	const BIGROOM = 'BIG' + Date.now().toString(36).slice(-4),
		T1 = await mk('T1'),
		T2 = await mk('T2');
	await T1.goto(BASE + '/img_room.html');
	await T1.click('button:has-text("部屋作成")');
	await T1.fill('input[name="ir-cn"]', BIGROOM);
	await T1.fill('input[name="ir-cuid"]', 'BIGA');
	await T1.fill('input[name="ir-cpw"]', 'big-pw');
	await T1.fill('input[name="ir-cmx"]', '5');
	await T1.click('.ir-frm button:has-text("部屋作成")');
	await T1.waitForSelector('input[type=file]', { timeout: 20000 });
	await T1.setInputFiles('input[type=file]', { name: 'big.png', mimeType: 'image/png', buffer: bigPng });
	await T1.waitForSelector('.ir-thumb', { timeout: 30000 });
	await T2.goto(BASE + '/img_room.html');
	await T2.click('button:has-text("参加")');
	await T2.fill('input[name="ir-nm"]', BIGROOM);
	await T2.fill('input[name="ir-uid"]', 'BIGB');
	await T2.fill('input[name="ir-pw"]', 'big-pw');
	await T2.click('.ir-frm button:has-text("ログイン")');
	await T2.waitForSelector('input[type=file]', { timeout: 20000 });
	await T2.waitForSelector('.ir-thumb', { timeout: 20000 });
	const t0 = Date.now();
	await T2.click('.ir-thumb'); // 未保有 2.3MB を P2P 取得
	await T2.waitForSelector('.ir-mbx .ir-img[src]', { timeout: 60000 });
	const bigMs = Date.now() - t0;
	console.log('bigFetchMs:', bigMs);
	ck('bigFetchOk', true);
	ck('bigFetchProportional', bigMs > 18000); // 旧固定上限（18s）超えの実転送で成功 = 比例化が効いている
	await T2.click('.ir-mclose');
	await T1.close();
	await T2.close();
}
// ---- v2.18 §45: カレンダーピックアップ（画像のある日へ移動・見出し行最上段） ----
{
	ck('pickBtn', await B.locator('.ir-calbar .ir-cpick').count() === 1);
	// メモリ上の擬似过去日（10 日前）を作り候補を 2 日以上にする（永続化しない・このページは間もなくクローズ）
	ck('pickSetupPast', await B.evaluate(() => {
		const c = window.__IRAPP.activeCtx(),
			hs = [...c.collection.metas.keys()];
		if (!hs.length) return false;
		c.collection.metas.get(hs[0]).ts = Date.now() - 10 * 86400000;
		c.cal.setItems(c.collection.roomItems());
		return true;
	}));
	// 日モードに切替（セクション=日。10 日前と今日が別セクションになりジャンプ距離が出る）
	await B.click('.ir-calbar .ir-calmode:has-text("日")');
	await B.waitForTimeout(400);
	await B.click('.ir-calbar .ir-cpick');
	await B.waitForSelector('.ir-pick .ir-pickday', { timeout: 5000 });
	ck('pickDays2', await B.locator('.ir-pick .ir-pickday').count() >= 2);
	// 候補は現在→過去順。その中から「今スクロール位置に無い日」を選ぶ（日→新順セクションとの整合に依らず検証できる）
	const dk = await B.evaluate(() => {
		const c = window.__IRAPP.activeCtx(),
			cvv = c.cal.cal,
			btns = [...document.querySelectorAll('.ir-pick .ir-pickday')];
		for (const el of btns) {
			const i = cvv.secIdxOfDay(+el.dataset.k);
			if (i >= 0 && Math.abs(cvv.box.scrollTop - i * cvv.vl.pg) > 4) return el.dataset.k;
		}
		return '';
	});
	console.log('pj1Dbg', JSON.stringify(await B.evaluate(() => {
		const c = window.__IRAPP.activeCtx(),
			cvv = c.cal.cal;
		return { md: cvv.md, pad: cvv.padPages, st: cvv.box.scrollTop, ch: cvv.box.clientHeight, pc: cvv.pgCnt(), days: cvv.daysWith().map(x => ({ k: x.k, i: cvv.secIdxOfDay(x.k) })) };
	})));
	ck('pickTarget', !!dk);
	if (!dk) await B.click('.ir-calbar .ir-cpick'); // パネル閉じ（残さない）
	if (dk) {
		await B.click(`.ir-pick .ir-pickday[data-k="${dk}"]`);
		await B.waitForTimeout(600);
		console.log('pj2Dbg', JSON.stringify(await B.evaluate(k => {
			const c = window.__IRAPP.activeCtx(),
				cvv = c.cal.cal;
			return { k: +k, i: cvv.secIdxOfDay(+k), pg: cvv.vl.pg, pad: cvv.padPages, st: cvv.box.scrollTop, y: window.scrollY, bt: Math.round(cvv.box.getBoundingClientRect().top), dh: document.documentElement.scrollHeight, vh: document.documentElement.clientHeight, ch: cvv.box.clientHeight, sh: cvv.box.scrollHeight, pc: cvv.pgCnt(), md: cvv.md };
		}, dk)));
		ck('pickJumpTop', await B.evaluate(k => {
			const c = window.__IRAPP.activeCtx(),
				cvv = c.cal.cal,
				i = cvv.secIdxOfDay(+k),
				pg = cvv.vl.pg,
				st = cvv.box.scrollTop || Math.max(0, -cvv.box.getBoundingClientRect().top); // 両レイアウト共通の実効スクロール量
			return i >= 0 && Math.abs(st - i * pg) <= 2 && st > 0; // 該当セクションの top が最上段（実際に動かす）
		}, dk));
		ck('pickHeaderTop', await B.evaluate(k => {
			const c = window.__IRAPP.activeCtx(),
				cvv = c.cal.cal,
				i = cvv.secIdxOfDay(+k),
				el = cvv.vl.els.get(i);
			if (!el) return false;
			const r = el.getBoundingClientRect(),
				br = cvv.box.getBoundingClientRect();
			return Math.abs(r.top - Math.max(0, br.top)) <= 8; // DOM 実寸で表示領域一番上（box/ページ両スクロール様式）
		}, dk));
	}
	ck('pickClosed', await B.locator('.ir-pick').count() === 0); // 選択で閉じる
	ck('pickClosed', await B.locator('.ir-pick').count() === 0); // 選択で閉じる
}
await N9.close();
await K1.close();

console.log(JSON.stringify({ engine: name, room: ROOM, checks, errors }, null, 1));
const bad = errors.length || Object.values(checks).some(v => !v);
console.log(bad ? 'SPEC INCOMPLETE' : 'SPEC OK');
await browser.close();
process.exit(bad ? 1 : 0);
