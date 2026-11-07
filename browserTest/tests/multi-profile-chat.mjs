// マルチプロファイル掲示板検証:
// 1つのブラウザ内に独立コンテキスト（≒別ブラウザプロファイル）を3つ作り、
// 同一の Node HTTP/WS サーバーの同じルームに接続させて、
// 入室・投稿・退室のブロードキャストが他プロファイルのページに届くことを検証する。
// 対象ブラウザ: BROWSER=chromium (既定) | firefox
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launchEngine, instrumentPage } from './lib.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8080';
const ROOM = `mp-${Date.now()}`; // 実行ごとにルームを分離して前実行の影響を防ぐ
const WS_CHAT = `${BASE.replace('http://', 'ws://')}/ws/chat/${ROOM}`;
const OUT = fileURLToPath(new URL('../out/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const { name, browser } = await launchEngine();

const mkClient = async id => {
	const ctx = await browser.newContext(); // 独立プロファイル: storage/cookie/接続が別
	const page = await ctx.newPage();
	const { frames, errors } = instrumentPage(page);
	await page.goto(`${BASE}/ws_chat.html`, { waitUntil: 'load' });
	await page.fill('input[name="inputUrl"]', WS_CHAT);
	await page.fill('input[name="userId"]', `TESTER_${id}`);
	return { id, ctx, page, frames, errors };
};

const [a, b, c] = [await mkClient('A'), await mkClient('B'), await mkClient('C')];
const clients = [a, b, c];

// --- 入室（順に: 全員に「◯◯さんが入室しました。」がブロードキャストされる） ---
for (const cl of clients) {
	await cl.page.click('button:has-text("入室")');
	await cl.page.waitForFunction(id => document.body.innerText.includes(`TESTER_${id}さんが入室しました`), cl.id, { timeout: 8000 });
}
// 同時接続後に届いた入室行の交差受信を検証する。
// （アプリ仕様: 入室より前のブロードキャストは新参加者に再送されない。
//   したがって A には B・C の行、B には C の行が届く。C は自分の行のみ正常。）
const crossPairs = [
	[a, 'B'],
	[a, 'C'],
	[b, 'C'],
];
for (const [cl, otherId] of crossPairs)
	await cl.page.waitForFunction(other => document.body.innerText.includes(`TESTER_${other}さんが入室しました`), otherId, { timeout: 8000 });

// --- Aが投稿 → B・C（送信者A自身も含む全員）の掲示板に反映 ---
const POST = `こんにちは from A (${ROOM})`;
await a.page.fill('textarea', POST);
await a.page.click('button:has-text("投稿")');
for (const cl of clients)
	await cl.page.waitForFunction(msg => document.body.innerText.includes(msg), POST, { timeout: 8000 });

// --- Bが退室 → A・Cの掲示板に「TESTER_Bさんが退室しました。」 ---
await b.page.click('button:has-text("退室")');
for (const cl of [a, c])
	await cl.page.waitForFunction(() => document.body.innerText.includes('TESTER_Bさんが退室しました'), null, { timeout: 8000 });

// --- 計測サマリ ---
await b.page.screenshot({ path: `${OUT}chat_B_after_leave_${name}.png`, fullPage: true });
await c.page.screenshot({ path: `${OUT}chat_C_full_${name}.png`, fullPage: true });

const summary = [];
for (const cl of clients) {
	// ページ注入ログ（エンジン非依存）を正文とする。
	// ChromiumはPWのframereceivedでも全文取れるが、Firefoxの非既定コンテキストでは
	// payloadが空になるため、注入WebSocketラップのログで検証する。
	const pageLog = await cl.page.evaluate(() => window.__wsLog);
	summary.push({
		id: cl.id,
		wsOpened: pageLog.filter(f => f.startsWith('OPEN ')).length,
		enterSent: pageLog.some(f => f.startsWith('SENT ') && f.includes('"cmd":"E"')),
		recvCount: pageLog.filter(f => f.startsWith('RECV ')).length,
		recvEnterIds: ['A', 'B', 'C'].filter(id => pageLog.some(f => f.includes(`TESTER_${id}さんが入室`))),
		recvHasPost: pageLog.some(f => f.includes(POST)),
		pwFramesRecorded: cl.frames.length,
		pageErrors: cl.errors,
	});
}
console.log(JSON.stringify({ engine: name, room: ROOM, summary }, null, 2));

// 期待値: 接続順 A→B→C なので A=[A,B,C], B=[B,C], C=[C]（履歴再送なしの仕様）
const expectedEnter = { A: ['A', 'B', 'C'], B: ['B', 'C'], C: ['C'] };
const noErr = clients.every(cl => cl.errors.length === 0);
const allOk = summary.every(
	s => s.wsOpened === 1 && s.enterSent && s.recvHasPost && JSON.stringify(s.recvEnterIds) === JSON.stringify(expectedEnter[s.id]),
);
if (!allOk || !noErr) {
	console.error('FAILED', { engine: name, allOk, noErr });
	process.exitCode = 1;
} else console.log(`MULTI-PROFILE CHAT OK (${name})`);

await browser.close();
