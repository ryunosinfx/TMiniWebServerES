// @see docs/img_room_spec.md §55 — imgroomCompanion 検証
// 環境の chromium は headless shell のため実ブラウザ拡張ロード不可（full chrome はこの環境で SIGTRAP）。
// そのため 3 層の等価検証で行う:
//  A) アプリ実 zip → playwright download → ネイティブホスト実行（--cli 相当: import runJob）で展開/重複排除/7 世代
//  B) content.js を MAIN world addInitScript + chrome スタブで実アプリページに注入 → 自動ログイン到達
//  C) bg.js を node で API スタブ注入し orchestration（run-now job → hostAsk → lastReport）を検証
import { chromium } from 'playwright';
import { mkdirSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const BASE = 'http://127.0.0.1:8080';
const ROOT = join(import.meta.dirname, '..', '..');
const EXT = join(ROOT, 'browserExtention/imgroomCompanion');
const tmp = join(tmpdir(), 'irc' + Date.now().toString(36));
const dl = join(tmp, 'Downloads');
const cur = join(tmp, 'cur');
const gens = Array.from({ length: 7 }, (_, i) => join(tmp, 'g' + (i + 1)));
for (const d of [dl, cur, ...gens]) mkdirSync(d, { recursive: true });

let fails = 0;
const ck = (n, ok, x) => { console.log((ok ? 'ok   ' : 'FAIL ') + n + (x ? ' ' + x : '')); if (!ok) fails++; };
const { runJob } = await import(join(EXT, 'native-host/host.mjs'));

const br = await chromium.launch();
const ctx = await br.newContext({ locale: 'ja-JP', acceptDownloads: true, viewport: { width: 900, height: 1200 } });
const PAGE = join(EXT, 'content.js');

// ---------- A: 実 zip 取得とホスト展開（3 フェーズ） ----------
const ROOM = 'EX' + Date.now().toString(36).slice(-4);
const NB = Buffer.from(ROOM, 'utf8').toString('base64url');
const P1 = await ctx.newPage();
P1.on('pageerror', e => console.log('[perr]', String(e).slice(0, 140)));
const downloads = [];
P1.on('download', async d => {
	const p = join(dl, d.suggestedFilename());
	await d.saveAs(p);
	downloads.push(p);
});
await P1.goto(BASE + '/img_room.html');
await P1.click('button:has-text("部屋作成")');
await P1.fill('input[name="ir-cn"]', ROOM);
await P1.fill('input[name="ir-cuid"]', 'COMP');
await P1.fill('input[name="ir-cpw"]', 'ex-pw');
await P1.click('.ir-frm button:has-text("部屋作成")');
await P1.waitForSelector('input[type=file]', { timeout: 20000 });
const png = async (P) => {
	const b64 = await P.evaluate(() => {
		const cv = document.createElement('canvas');
		cv.width = 48;
		cv.height = 32;
		const g = cv.getContext('2d');
		g.fillStyle = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
		g.fillRect(0, 0, 48, 32);
		g.fillStyle = '#fff';
		g.fillRect(((window.__ex = (window.__ex || 0) + 1) * 5) % 48, 0, 3, 32);
		return cv.toDataURL('image/png').slice(22);
	});
	return Buffer.from(b64, 'base64');
};
for (const [i, nm] of ['e1.png', 'e2.png', 'e3.png'].entries()) {
	await P1.setInputFiles('input[type=file]', { name: nm, mimeType: 'image/png', buffer: await png(P1) });
	await P1.waitForFunction(k => window.__IRAPP.activeCtx().collection.roomItems().length >= k, i + 1, { timeout: 20000 });
}
await P1.click('button:has-text("一括 DL")');
for (let i = 0; i < 40 && downloads.length < 1; i++) await new Promise(r => setTimeout(r, 500));
ck('zipDownloaded', downloads.length >= 1, JSON.stringify(downloads.map(x => x.split('/').pop())));
const cfgH = { extractDir: cur, genDirs: gens };
let rep = runJob(cfgH, downloads);
console.log('host run1:', JSON.stringify(rep).slice(0, 260));
ck('wrote3', rep.written === 3 && rep.errors.length === 0);
ck('gens7', rep.copies.length === 7 && rep.copies.every(c => c.copied === 3));
ck('files7', gens.every(g => readdirSync(g).filter(n => !n.startsWith('.')).length === 3));
rep = runJob(cfgH, downloads); // 同一 zip 再実行 = 全件重複排除
console.log('host run2:', JSON.stringify({ w: rep.written, s: rep.skippedDup, c: rep.copies.map(x => x.copied) }));
ck('dedupeAll', rep.written === 0 && rep.skippedDup === 3 && rep.copies.every(c => c.copied === 0));
await P1.setInputFiles('input[type=file]', { name: 'e4.png', mimeType: 'image/png', buffer: await png(P1) });
await P1.waitForFunction(() => window.__IRAPP.activeCtx().collection.roomItems().length >= 4, null, { timeout: 20000 });
downloads.length = 0;
await P1.click('button:has-text("一括 DL")');
for (let i = 0; i < 40 && downloads.length < 1; i++) await new Promise(r => setTimeout(r, 500));
const rep3 = runJob(cfgH, downloads); // 増分: 4 件中 3 件 dup + 1 件新規
console.log('host run3:', JSON.stringify({ w: rep3.written, s: rep3.skippedDup, c: rep3.copies.map(x => x.copied) }));
ck('incWrite1', rep3.written === 1 && rep3.skippedDup === 3);
ck('incCopy1', rep3.copies.every(c => c.copied === 1 && c.skipped === 3));
await P1.evaluate(async () => { await window.__IRAPP.activeCtx().collection.setTags((window.__IRAPP.activeCtx().collection.roomItems()[0].h10), ['zz']); });
await P1.click('button:has-text("ログアウト")');
await P1.waitForTimeout(1200);
await P1.close();

// ---------- B: content.js 自動ログイン（MAIN world 注入 + chrome スタブ） ----------
const P2 = await ctx.newPage();
P2.on('pageerror', e => console.log('[perrB]', String(e).slice(0, 140)));
const contentSrc = readFileSync(PAGE, 'utf8');
const bridgeSrc = readFileSync(join(EXT, 'bridge.js'), 'utf8');
// addInitScript の文字列版は CSP 非適用（img_room の no-unsafe-eval を回避）— chrome スタブ + bridge.js + content.js をそのまま MAIN world へ
await P2.addInitScript('window.chrome={storage:{local:{get:()=>Promise.resolve(' + JSON.stringify({ autoLogin: true, userName: 'COMP', password: 'ex-pw', roomName: '' }) + ')}},runtime:{onMessage:{addListener:()=>{}}}};\n' + bridgeSrc + '\n' + contentSrc);
await P2.goto(BASE + '/img_room.html#' + NB);
await P2.waitForFunction(() => { const c = window.__IRAPP && window.__IRAPP.activeCtx(); return !!(c && c.session && c.session.state && c.session.state.authed); }, null, { timeout: 45000 })
	.then(() => ck('autoLogin', true))
	.catch(async () => { ck('autoLogin', false, await P2.evaluate(() => 'body=' + document.body.innerText.slice(0, 90).replace(/\s+/g, ' '))); });
ck('loginItems', await P2.evaluate(() => { const c = window.__IRAPP.activeCtx(); return !!(c && c.collection.roomItems().length >= 4); }));

// ---------- C: bg.js orchestration（API スタブ） ----------
{
	const listeners = { alarm: [], msg: [], dl: [] };
	const captured = {};
	global.chrome = {
		storage: {
			local: {
				get: (k) => Promise.resolve({
					roomUrl: BASE + '/img_room.html', userName: 'COMP', password: 'ex-pw', autoLogin: true,
					reloadMin: 0, dailyEnabled: true, dailyTime: '09:00', dailyTimeoutMin: 2,
					zipPattern: '-\\d{14}-\\d{3}\\.zip$', hostId: 'com.imgroom.companion',
					extractDir: cur, genDirs: gens, ...captured,
				}),
				set: (o) => { Object.assign(captured, o); return Promise.resolve(); },
			},
			onChanged: { addListener: () => {} },
		},
		alarms: { create: () => {}, clear: () => {}, onAlarm: { addListener: f => listeners.alarm.push(f) } },
		downloads: { search: () => Promise.resolve([{ filename: downloads[0] || 'x-20261116090000-001.zip', state: 'complete' }]), onChanged: { addListener: f => listeners.dl.push(f) } },
		tabs: {
			query: () => Promise.resolve([]),
			create: () => Promise.resolve({ id: 1, status: 'complete' }),
			get: () => Promise.resolve({ id: 1, status: 'complete' }),
			reload: () => Promise.resolve(),
			sendMessage: (id, m) => Promise.resolve(m.cmd === 'ensure-login' ? { authed: true } : { res: 'bulkdl', ok: true }),
		},
		runtime: {
			onInstalled: { addListener: () => {} }, onStartup: { addListener: () => {} },
			onMessage: { addListener: f => listeners.msg.push(f) },
			lastError: null,
			sendNativeMessage: (host, msg, cb) => {
				let r;
				try { r = { ok: true, report: runJob(msg.config, msg.zips) }; } catch (e) { r = { ok: false, error: String(e) }; }
				cb(r);
			},
		},
	};
	await import(join(EXT, 'bg.js')); // top-level boot()
	await new Promise(r => setTimeout(r, 300));
	const send = m => new Promise(res => listeners.msg[0](m, {}, res));
	const t0 = Date.now();
	await send({ cmd: 'run-now' }); // fire and forget（job 完了は lastReport 出現待ち）
	let lr = null;
	for (let i = 0; i < 60 && !lr; i++) {
		await new Promise(r => setTimeout(r, 500));
		lr = captured.lastReport || null;
	}
	console.log('bg job report:', JSON.stringify(lr && lr.rep && lr.rep.report).slice(0, 240), '(' + (Date.now() - t0) + 'ms)');
	ck('bgJob', !!(lr && lr.rep && lr.rep.ok && lr.rep.report.zips === 1));
	ck('bgNote', typeof captured.lastNote === 'string' && captured.lastNote.includes('完了'), String(captured.lastNote).slice(0, 60));
	const alarms = listeners.alarm.length;
	ck('bgWired', alarms === 1 && listeners.dl.length === 1);
}
// ---------- D: options の QR PNG 復号（内蔵 jsQR → Firefox でも動く経路） ----------
{
	const P3 = await ctx.newPage();
	await P3.goto(BASE + '/img_room.html');
	const qrData = await P3.evaluate(async (nb) => {
		const { QRTool } = await import('/modules/qr_tool.js');
		const r = await QRTool.make('TMIWR1:' + nb + ':qr-pw-99', { size: 256, level: 'M', retry: 3 });
		return r.failed ? null : r.canvas.toDataURL('image/png');
	}, NB);
	await P3.close();
	ck('qrPngMade', !!qrData);
	if (qrData) {
		// options.js の復号部と同一ロジック（jsQR は wwwroot と同一ビルド。FF 互換 API のみ）
		const PQ = await ctx.newPage();
		await PQ.goto(BASE + '/img_room.html');
		const got = await PQ.evaluate(async ([b64, path]) => {
			const { jsQR } = await import(path);
			const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
			const bmp = await createImageBitmap(new Blob([buf], { type: 'image/png' }));
			const max = 1600, k = Math.min(1, max / Math.max(1, bmp.width, bmp.height)),
				c = document.createElement('canvas');
			c.width = Math.max(1, Math.round(bmp.width * k));
			c.height = Math.max(1, Math.round(bmp.height * k));
			const g = c.getContext('2d');
			g.drawImage(bmp, 0, 0, c.width, c.height);
			if (bmp.close) bmp.close();
			const img = g.getImageData(0, 0, c.width, c.height),
				res = await jsQR(img.data, c.width, c.height);
			return res && res.data ? res.data : null;
		}, [qrData.slice(22), '/modules/jsQR/jsQR.es.min.nosjis.js']);
		ck('qrDecode', got === 'TMIWR1:' + NB + ':qr-pw-99', String(got).slice(0, 70));
	}
}
await br.close();
rmSync(tmp, { recursive: true, force: true });
console.log(fails ? 'EXT-COMPANION FAILS=' + fails : 'EXT-COMPANION OK');
process.exit(fails ? 1 : 0);
