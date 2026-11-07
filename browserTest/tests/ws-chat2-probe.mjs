// ws_chat2.html 実装調査プローブ:
// 1) ページ読込とチャット(入室/投稿/エコー)が ws_chat と同じく動くこと
// 2) ファイル選択 -> 画像プレビュー (data: URL) がでること
// 3) 「画像共有」クリック時のWSフレームの実挙動:
//    - 送信されるフレームがヘッダ配列JSONのみか（チャンク送出があるか）
//    - サーバの応答（CMD NOT FOUND?）とクローズの有無
// 検証結果をJSONサマリで出力する（判定は出さず事実を記録する調査スクリプト）。
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8080';
const IMG = process.env.SAMPLE_IMG ?? fileURLToPath(new URL('../out/ws_test.png', import.meta.url));
const ROOM = `probe2-${Date.now()}`;

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const frames = [];
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => {
	if (m.type() === 'error') errors.push(`CONSOLE_ERR ${m.text()}`);
});
await page.addInitScript(() => {
	window.__wsLog = [];
	const Orig = window.WebSocket;
	window.WebSocket = function (url, protos) {
		const s = protos === undefined ? new Orig(url) : new Orig(url, protos);
		window.__wsLog.push(`OPEN ${url}`);
		s.addEventListener('message', e => window.__wsLog.push(`RECV ${String(e.data).slice(0, 120)}`));
		const os = s.send.bind(s);
		s.send = m => {
			window.__wsLog.push(`SENT ${String(m).slice(0, 80)}`);
			return os(m);
		};
		s.addEventListener('close', () => window.__wsLog.push('CLOSE'));
		return s;
	};
});

await page.goto(`${BASE}/ws_chat2.html`, { waitUntil: 'load' });
await page.fill('input[name="inputUrl"]', `${BASE.replace('http://', 'ws://')}/ws/chat/${ROOM}`);
await page.fill('input[name="userId"]', 'PROBE1');
await page.click('button:has-text("入室")');
await page.waitForFunction(() => document.body.innerText.includes('PROBE1さんが入室しました'), null, { timeout: 8000 });

// テキスト投稿は ws_chat と同一経路で動作するはず
await page.fill('textarea', 'chat2-text');
await page.click('button:has-text("投稿")');
await page.waitForFunction(() => document.body.innerText.includes('chat2-text'), null, { timeout: 8000 });
const textOk = await page.evaluate(() => document.body.innerText.includes('chat2-text'));

// ファイル選択 → プレビュー
await page.setInputFiles('input[type="file"]', IMG);
await page.waitForTimeout(1200);
const preview = await page.evaluate(() => {
	const img = document.querySelector('img');
	return img ? { visible: getComputedStyle(img).display !== 'none', srcPrefix: img.src.slice(0, 24) } : null;
});

// 画像共有クリック（この後の挙動を記録）
await page.click('button:has-text("画像共有")');
await page.waitForTimeout(2000);
const log = await page.evaluate(() => window.__wsLog);
const disconnected = await page.evaluate(() => document.body.innerText.includes('切断されました'));

console.log(
	JSON.stringify(
		{
			room: ROOM,
			textChatOk: textOk,
			preview,
			wsLog: log,
			socketClosedAfterSend: log.some(l => l === 'CLOSE'),
			disconnectUI: disconnected,
			errors,
		},
		null,
		1,
	),
);
await browser.close();
