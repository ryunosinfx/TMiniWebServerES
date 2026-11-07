// 「テスト yyyy-MM-dd-hh-mm-ss」を描画したPNGをヘッドレスChromiumのcanvasで生成するユーティリティ
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const stamp = (d = new Date()) => {
	const p = n => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
};

export async function makeLabelPng(ts = stamp(), outDir = new URL('../out/', import.meta.url)) {
	mkdirSync(outDir, { recursive: true });
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 960, height: 200 } });
	const dataUrl = await page.evaluate(text => {
		const c = document.createElement('canvas');
		[c.width, c.height] = [920, 160];
		const x = c.getContext('2d');
		x.fillStyle = '#ffffff';
		x.fillRect(0, 0, c.width, c.height);
		x.strokeStyle = '#000000';
		x.lineWidth = 4;
		x.strokeRect(6, 6, c.width - 12, c.height - 12);
		x.fillStyle = '#111111';
		x.font = "500 54px 'Noto Sans CJK JP', sans-serif";
		x.textBaseline = 'middle';
		x.fillText(text, 44, 80);
		return c.toDataURL('image/png');
	}, `テスト ${ts}`);
	await browser.close();
	const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
	const file = new URL(`label-${ts}.png`, outDir);
	writeFileSync(file, buf);
	return { file: fileURLToPath(file), ts, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
}

// CLI 直接実行対応
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const r = await makeLabelPng();
	console.log(JSON.stringify(r));
}
