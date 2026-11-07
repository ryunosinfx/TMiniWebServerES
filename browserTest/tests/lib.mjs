// 共通ヘルパ: エンジン（chromium|firefox）選択と計測の共通化。
// Firefox は Landlock 制約下で HOME/TMPDIR/XDG_* をワークスペース内の
// 書き込み可能なディレクトリへ向けないと起動できない（~/.cache/mozilla 等への
// 書き込みが拒否される為）。
import { chromium, firefox } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('./', import.meta.url));

/** 書き込みが必要なディレクトリを workspace 配下に用意して launch する。 */
export async function launchEngine() {
	const name = process.env.BROWSER ?? 'chromium';
	if (name === 'firefox') {
		for (const d of ['.ff-home', '.ff-tmp', '.ff-run', '.ff-home/.cache']) mkdirSync(HERE + d, { recursive: true });
		return { name, browser: await firefox.launch({ env: {
			...process.env,
			HOME: HERE + '.ff-home',
			TMPDIR: HERE + '.ff-tmp',
			XDG_CACHE_HOME: HERE + '.ff-home/.cache',
			XDG_RUNTIME_DIR: HERE + '.ff-run',
			GSETTINGS_BACKEND: 'memory', // dconf の /run/user 書き込み回避
		} }) };
	}
	if (name === 'chromium') return { name, browser: await chromium.launch() };
	throw new Error(`unknown BROWSER=${name} (chromium|firefox)`);
}

/**
 * ページに注入し、WebSocketをラップしてフレームを window.__wsLog に記録させる。
 * Playwright の websocket イベントは Firefox でも動作するが、エンジン非依存の
 * 二重計測としてページ側ログも残す（ラップはページ側の可視性だけを見る検証に有用）。
 */
export const WS_WRAP_INIT = () => {
	window.__wsLog = [];
	const Orig = window.WebSocket;
	window.WebSocket = function (url, protos) {
		const s = protos === undefined ? new Orig(url) : new Orig(url, protos);
		window.__wsLog.push(`OPEN ${url}`);
		s.addEventListener('message', e => window.__wsLog.push(`RECV ${e.data}`));
		const origSend = s.send.bind(s);
		s.send = m => {
			window.__wsLog.push(`SENT ${m}`);
			return origSend(m);
		};
		s.addEventListener('close', () => window.__wsLog.push('CLOSE'));
		return s;
	};
};

/** ページに websocket 計測（Playwright イベント＋注入ラップ）を仕込む。 */
export function instrumentPage(page) {
	const frames = [];
	const errors = [];
	page.on('console', m => {
		if (m.type() === 'error') errors.push(`CONSOLE_ERR ${m.text()}`);
	});
	page.on('pageerror', e => errors.push(String(e)));
	page.addInitScript(WS_WRAP_INIT);
	page.on('websocket', ws => {
		frames.push(`OPEN ${ws.url()}`);
		ws.on('framesent', f => frames.push(`SENT ${f.payload}`));
		ws.on('framereceived', f => frames.push(`RECV ${f.payload}`));
		ws.on('close', () => frames.push('CLOSE'));
	});
	return { frames, errors };
}
