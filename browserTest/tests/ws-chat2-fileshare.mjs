// ws_chat2.html ファイル共有端到端検証:
// プロファイルAが画像を選択して「画像共有」→ サーバ(chat msg中継)経由で
// プロファイルBがチャンク受領・gunzip・OPFS保存・結果欄表示に至ることを検証する。
// 結果欄の画像は OPFS からの再読み込み(App.load)で描画されるため、
// 表示成功＝OPFS 書き込み+読み出しの検証も兼ねる。
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launchEngine, instrumentPage } from './lib.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8080';
const IMG = fileURLToPath(new URL('../out/ws_test.png', import.meta.url));
const ROOM = `fs-${Date.now()}`;
const OUT = fileURLToPath(new URL('../out/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const { name, browser } = await launchEngine();

const mk = async id => {
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	const { frames, errors } = instrumentPage(page);
	await page.goto(`${BASE}/ws_chat2.html`, { waitUntil: 'load' });
	await page.fill('input[name="inputUrl"]', `${BASE.replace('http://', 'ws://')}/ws/chat/${ROOM}`);
	await page.fill('input[name="userId"]', id);
	await page.click('button:has-text("入室")');
	return { id, ctx, page, frames, errors };
};

const [a, b] = [await mk('FS_A'), await mk('FS_B')];
for (const cl of [a, b])
	await cl.page.waitForFunction(id => document.body.innerText.includes(`${id}さんが入室しました`), cl.id, { timeout: 8000 });

// A: ファイル選択 → プレビュー確認
await a.page.setInputFiles('input[type="file"]', IMG);
await a.page.waitForFunction(() => [...document.images].some(i => i.src.startsWith('data:image/png')), null, { timeout: 8000 });

// A: 画像共有
await a.page.click('button:has-text("画像共有")');

// B: 結果欄にファイル名行 + OPFSから読み戻したdata:画像が現れる
const received = p => p.evaluate(() => {
	const imgs = [...document.images].filter(i => i.src.startsWith('data:image/png') && i.width === 100 && i.height === 100 && getComputedStyle(i).display !== 'none');
	return { hasName: document.body.innerText.includes('ws_test.png'), imgCount: imgs.length, srcLen: imgs.length ? imgs[0].src.length : 0 };
});
let bState = null;
try {
	await b.page.waitForFunction(
		() => {
			const imgs = [...document.images].filter(i => i.src.startsWith('data:image/png') && i.width === 100 && i.height === 100 && getComputedStyle(i).display !== 'none');
			return document.body.innerText.includes('ws_test.png') && imgs.length >= 1;
		},
		null,
		{ timeout: 30000 },
	);
	bState = await received(b.page);
} catch (e) {
	bState = { timeout: true, ...(await received(b.page)) };
}

// A: 自分自身のエコーでも同じ行が現れる（サーバは送信者にも中継）
let aState = null;
try {
	await a.page.waitForFunction(
		() => {
			const imgs = [...document.images].filter(i => i.src.startsWith('data:image/png') && i.width === 100 && i.height === 100 && getComputedStyle(i).display !== 'none');
			return imgs.length >= 2; // プレビュー + 結果欄(OPFS読み戻し)
		},
		null,
		{ timeout: 15000 },
	);
	aState = await received(a.page);
} catch (e) {
	aState = { timeout: true, ...(await received(a.page)) };
}

// チャットログにチャンク生のゴミが流れていないこと
const chunkJunkLeaked = await b.page.evaluate(() => /[\w-]{20,}\.\d+\.\d+\./.test(document.body.innerText));

await a.page.screenshot({ path: `${OUT}fileshare_sender_${name}.png`, fullPage: true });
await b.page.screenshot({ path: `${OUT}fileshare_viewer_${name}.png`, fullPage: true });

const wsSummary = {
	// wc.chat 経由のため msg 内の引用符は JSON エスケープ済み（\",\"image/png\"）
	aHeaderFrames: (await a.page.evaluate(() => window.__wsLog.filter(l => l.startsWith('SENT ') && l.includes('image\\/png')))).length,
	bRecvHeader: await b.page.evaluate(() => window.__wsLog.some(l => l.startsWith('RECV ') && l.includes('image/png'))),
	bRecvChunkCount: await b.page.evaluate(() => window.__wsLog.filter(l => l.startsWith('RECV ') && /\.\d+\.\d+\./.test(l)).length),
};

const checks = {
	viewerHasRow: !!bState.hasName,
	viewerHasOpfsImage: bState.imgCount >= 1 && bState.srcLen > 10000,
	senderEchoRow: aState.imgCount >= 2,
	noChunkJunkInLog: !chunkJunkLeaked,
	noPageErrors: a.errors.length === 0 && b.errors.length === 0,
};
console.log(JSON.stringify({ engine: name, room: ROOM, bState, aState, wsSummary, checks, errors: { a: a.errors, b: b.errors } }, null, 1));
// グレースフル終了: ブラウザ強制終了前に明示的に退室(サーバ切断処理の競合回避)
for (const cl of [a, b]) {
	try {
		await cl.page.click('button:has-text("退室")');
	} catch (e) {
		console.log('leave skipped:', cl.id);
	}
}
await new Promise(r => setTimeout(r, 800));
await browser.close();
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
if (failed.length) {
	console.error(`FAILED (${name}): ${failed.join(', ')}`);
	process.exit(1);
}
console.log(`FILESHARE OK (${name})`);
