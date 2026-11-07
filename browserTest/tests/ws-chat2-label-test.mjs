// 「テスト yyyy-MM-dd-hh-mm-ss」PNG を双方プロファイルでログイン→相互送信&受信する端到端テスト。
// 受信側は OPFS 保存→読み戻し画像が表示されるため、表示画像の SHA-256 が
// 元ファイルのハッシュと一致すればバイト一致の受信証明となる。
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { launchEngine, instrumentPage } from './lib.mjs';
import { makeLabelPng } from '../tools/make-label-png.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8080';
const ROOM = `label-${Date.now()}`;
const OUT = fileURLToPath(new URL('../out/', import.meta.url));

const label = await makeLabelPng();
console.log('label:', JSON.stringify(label));
const NAME = label.file.split('/').pop();

const { name: engine, browser } = await launchEngine();

const mk = async id => {
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	const { errors } = instrumentPage(page);
	await page.goto(`${BASE}/ws_chat2.html`, { waitUntil: 'load' });
	await page.fill('input[name="inputUrl"]', `${BASE.replace('http://', 'ws://')}/ws/chat/${ROOM}`);
	await page.fill('input[name="userId"]', id);
	await page.click('button:has-text("入室")');
	return { id, ctx, page, errors };
};

const [a, b] = [await mk('LAB_A'), await mk('LAB_B')];
for (const cl of [a, b])
	await cl.page.waitForFunction(id => document.body.innerText.includes(`${id}さんが入室しました`), cl.id, { timeout: 8000 });

// 相互送信: A→B
await a.page.setInputFiles('input[type="file"]', label.file);
await a.page.click('button:has-text("画像共有")');
await b.page.waitForFunction(n => document.body.innerText.split(n).length - 1 >= 1, NAME, { timeout: 30000 });
// B→A (B も同じPNGを共有)
await b.page.setInputFiles('input[type="file"]', label.file);
await b.page.click('button:has-text("画像共有")');

// 双方に「自分のエコー + 相手の送信」の2行がそろうまで待機
const rows = async (p, n, k) => p.waitForFunction(([n, k]) => document.body.innerText.split(n).length - 1 >= k, [n, k], { timeout: 30000 });
await rows(a.page, NAME, 2);
await rows(b.page, NAME, 2);

// 画像のSHA-256検証: 結果欄のimg(src=data:)をデコードして元ファイルとハッシュ比較
const shaOf = b64 => createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex');
const inspect = async p => {
	const srcs = await p.evaluate(() => [...document.images].filter(i => i.src.startsWith('data:image/png')).map(i => i.src.split(',')[1]));
	const shas = srcs.map(shaOf);
	return {
		nameRows: await p.evaluate(n => document.body.innerText.split(n).length - 1, NAME),
		imgCount: srcs.length,
		shaMatch: shas.length > 0 && shas.every(s => s === label.sha256),
		shas: [...new Set(shas)],
	};
};
const [ia, ib] = [await inspect(a.page), await inspect(b.page)];

await a.page.screenshot({ path: `${OUT}label_A_${engine}.png`, fullPage: true });
await b.page.screenshot({ path: `${OUT}label_B_${engine}.png`, fullPage: true });

const checks = {
	aTwoRows: ia.nameRows >= 2,
	bTwoRows: ib.nameRows >= 2,
	aImgs: ia.imgCount >= 3, // プレビュー + 結果欄2(OPFS読み戻し)
	bImgs: ib.imgCount >= 3,
	aContentIdentical: ia.shaMatch,
	bContentIdentical: ib.shaMatch,
	noPageErrors: a.errors.length === 0 && b.errors.length === 0,
};
console.log(JSON.stringify({ engine, room: ROOM, label, a: ia, b: ib, checks, errors: { a: a.errors, b: b.errors } }, null, 1));
// グレースフル終了: ブラウザ強制終了前に明示的に退室する。
// (サーバは切断済みソケットへの送信で ECONNRESET 未処理により停止しうるため、
//  サーバ実装を変えずクライアント側で回避する)
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
	console.error(`FAILED (${engine}): ${failed.join(', ')}`);
	process.exit(1);
}
console.log(`LABEL-PNG OK (${engine})`);
