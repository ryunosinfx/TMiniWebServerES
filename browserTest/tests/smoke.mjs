// 動作確認スモークテスト: ws_test.html を開き、
// WebSocket 接続 → メッセージ送信 → サーバのエコー（"Hello,world!! <msg>"）受信を検証する。
// 対象ブラウザ: BROWSER=chromium (既定) | firefox
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launchEngine, instrumentPage } from './lib.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8080';
const OUT = fileURLToPath(new URL('../out/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const { name, browser } = await launchEngine();
const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
const { frames, errors } = instrumentPage(page);

await page.goto(`${BASE}/ws_test.html`, { waitUntil: 'load' });

// WS_URL は /ws/chat/room1 が既定。エコーハンドラ /ws/test に明示的に差し替える。
await page.fill('input[name="inputUrl"]', `${BASE.replace('http://', 'ws://')}/ws/test`);
await page.click('button:has-text("testInitWS")');

// 接続確立（open時に "Hello Server!" が自動送信され、サーバが折り返す）
await page.waitForFunction(() => document.body.innerText.includes('Hello,world!! Hello Server!'), null, { timeout: 5000 });

// テキストエリア入力 → send → エコー
await page.fill('textarea', 'Playwright smoke');
await page.waitForFunction(() => document.body.innerText.includes('Hello,world!! Playwright smoke'), null, { timeout: 5000 });

await page.screenshot({ path: `${OUT}ws_test_${name}.png`, fullPage: true });

const checks = {
	openWS: frames.some(f => f.startsWith('OPEN ')),
	echoHello: frames.includes('RECV Hello,world!! Hello Server!'),
	echoSmoke: frames.includes('RECV Hello,world!! Playwright smoke'),
	noPageErrors: errors.length === 0,
};
console.log(JSON.stringify({ engine: name, url: BASE, checks, frames, errors }, null, 2));

await browser.close();
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
if (failed.length > 0) {
	console.error(`FAILED (${name}): ${failed.join(', ')}`);
	process.exit(1);
}
console.log(`SMOKE OK (${name})`);
