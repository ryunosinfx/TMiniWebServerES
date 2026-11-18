#!/usr/bin/env node
// @see docs/img_room_spec.md §55 — ネイティブホスト登録マニフェストの生成/配置
// 使い方: node install.mjs --browser chrome|firefox --ext <拡張ID> [--name com.imgroom.companion] [--dest <dir>] [--print]
// Chrome 拡張 ID: chrome://extensions の「詳細」で表示される ID。
// Firefox 拡張 ID: about:addons の技術情報（manifest の gecko.id と同一）。
import { writeFileSync, chmodSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir, platform } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = {};
for (let i = 0; i < argv.length; i++) {
	if (argv[i].startsWith('--')) { opt[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
}
const browser = opt.browser || 'chrome';
const ext = opt.ext;
const name = opt.name || 'com.imgroom.companion';
if (!ext || ext === true) {
	console.log('用法: node install.mjs --browser chrome|firefox --ext <拡張ID> [--dest <dir>] [--print]');
	process.exit(1);
}
// host 起動コマンド（Linux/macOS: shebang。Windows: .bat ラッパ）
let hostPath = join(HERE, 'host.mjs');
if (platform() === 'win32') {
	const bat = join(HERE, 'host.bat');
	writeFileSync(bat, '@echo off\r\nnode "%~dp0host.mjs" %*\r\n');
	hostPath = bat;
} else {
	try { chmodSync(hostPath, 0o755); } catch { /* 実行権限なし環境はログで案内 */ }
}
const allowed = browser === 'chrome' ? [`chrome-extension://${ext}/`] : [ext];
const man = {
	name,
	description: 'ImageRoom Companion backup host (extract/dedupe/generation copies)',
	path: resolve(hostPath),
	type: 'stdio',
	allowed_extensions: allowed,
};
const home = homedir();
const defDirs = {
	chrome: { linux: join(home, '.config/google-chrome/NativeMessagingHosts'), darwin: join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts'), win32: null },
	firefox: { linux: join(home, '.mozilla/native-messaging-hosts'), darwin: join(home, 'Library/Application Support/Mozilla/NativeMessagingHosts'), win32: null },
};
const dest = opt.dest && opt.dest !== true ? opt.dest : defDirs[browser]?.[platform()] || null;
const file = name + '.json';
const content = JSON.stringify(man, null, '\t');
if (dest) {
	mkdirSync(dest, { recursive: true });
	writeFileSync(join(dest, file), content);
	console.log('登録マニフェストを配置しました:', join(dest, file));
}
console.log('--- マニフェスト内容 ---\n' + content);
if (!dest || opt.print) {
	console.log(`\n配置先例:
  chrome linux : ~/.config/google-chrome/NativeMessagingHosts/${file}
  chrome macos : ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/${file}
  firefox linux: ~/.mozilla/native-messaging-hosts/${file}
  firefox macos: ~/Library/Application Support/Mozilla/NativeMessagingHosts/${file}
  windows      : レジストリ HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${name} に本 JSON のパスを登録（reg add）`);
}
if (!existsSync(man.path)) console.log('警告: host パスが存在しません →', man.path);
