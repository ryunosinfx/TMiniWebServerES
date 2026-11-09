// ImageRoom 結合シナリオ: 作成(A)→参加(B)→画像投稿→シート差分交換→B のサムネイル表示→
// サムネイルクリックで本体取得(viewer 表示)。対象: BROWSER=chromium|firefox
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launchEngine, instrumentPage } from './lib.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8080';
const OUT = fileURLToPath(new URL('../out/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const ROOM = 'IRTEST' + Date.now().toString(36).toUpperCase().slice(-5);
const PW = 'TEST-PW-123';
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);

const { name, browser } = await launchEngine();
const errors = [];
const mkPage = async () => {
	const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 900, height: 1200 } });
	const page = await ctx.newPage();
	const inst = instrumentPage(page);
	inst.errors = errors;
	page.on('pageerror', e => errors.push(`[${ctx === null ? '?' : 'p'}] ${e}`));
	return page;
};
const pa = await mkPage();
const pb = await mkPage();

// ---- A: 部屋作成 ----
await pa.goto(`${BASE}/img_room.html`, { waitUntil: 'load' });
await pa.waitForSelector('button:has-text("Create room")', { timeout: 10000 });
await pa.click('button:has-text("Create room")');
await pa.fill('input[name="ir-cn"]', ROOM);
await pa.fill('input[name="ir-cuid"]', 'PONTA');
await pa.fill('input[name="ir-cpw"]', PW);
await pa.click('.ir-frm button:has-text("Create room")');
await pa.waitForSelector('input[type=file]', { timeout: 20000 }); // 認証後：共有 input

// ---- B: 参加（採決: A が O ok を返す）----
await pb.goto(`${BASE}/img_room.html`, { waitUntil: 'load' });
await pb.waitForSelector('button:has-text("Join")', { timeout: 10000 });
await pb.click('button:has-text("Join")');
await pb.fill('input[name="ir-nm"]', ROOM);
await pb.fill('input[name="ir-uid"]', 'PONKO');
await pb.fill('input[name="ir-pw"]', PW);
await pb.click('.ir-frm button:has-text("Log in")');
await pb.waitForSelector('input[type=file]', { timeout: 20000 });

// ---- A: 画像投稿（§9.1）----
await pa.setInputFiles('input[type=file]', { name: 'photo.png', mimeType: 'image/png', buffer: PNG });

// ---- B: M→T→S/chunk→シート→スライス→サムネイル img（§9.2/§9.3）----
await pb.waitForSelector('.ir-thumb img[src]', { timeout: 45000 });

// ---- B: クリック→本体取得→ビューア（§9.3/§5.4）----
await pb.click('.ir-thumb img[src]');
await pb.waitForSelector('img.ir-img', { timeout: 30000 });

await pa.screenshot({ path: `${OUT}img_room_A_${name}.png`, fullPage: true });
await pb.screenshot({ path: `${OUT}img_room_B_${name}.png`, fullPage: true });

const checks = {
	creatorRoomView: !!(await pa.$('input[type=file]')),
	joinerRoomView: !!(await pb.$('input[type=file]')),
	joinerThumb: !!(await pb.$('.ir-thumb img[src]')),
	joinerViewer: !!(await pb.$('img.ir-img')),
	noPageErrors: errors.length === 0,
};
console.log(JSON.stringify({ engine: name, room: ROOM, checks, errors }, null, 2));
await browser.close();
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
if (failed.length) {
	console.error(`FAILED (${name}): ${failed.join(', ')}`);
	process.exit(1);
}
console.log(`IMG_ROOM OK (${name})`);
