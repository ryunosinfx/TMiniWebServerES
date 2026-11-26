// tools/imgroom_one.mjs — ImageRoom を 1 個の JS に統合し、それを呼ぶ HTML も生成（v2.36 §63）
// 正は分割ファイル（wwwroot/modules/…）。派生物は wwwroot/one/ に書き出すだけ（再生成前提）。
//   使い方: npm run imgone（または node tools/imgroom_one.mjs）
//   生成物: wwwroot/one/imgroom.one.js（rollup で ESM 1 個 + terser で minify）
//           wwwroot/one/img_room_one.html（img_room.html と同構成で ./imgroom.one.js を読む）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, buildBundle } from './imgroom_bundle_lib.mjs';

const bundle = await buildBundle();
const oneDir = join(ROOT, 'wwwroot', 'one');
mkdirSync(oneDir, { recursive: true });
writeFileSync(join(oneDir, 'imgroom.one.js'), bundle);

const html = readFileSync(join(ROOT, 'wwwroot', 'img_room.html'), 'utf8');
const out = html.replace('<script type="module" src="./img_room.js"></script>', '<script type="module" src="./imgroom.one.js"></script>');
if (out === html) throw new Error('img_room.html のスクリプト差し替えに失敗（構成変化？ tools/imgroom_one.mjs 更新）');
writeFileSync(join(oneDir, 'img_room_one.html'), out);

console.log(`imgroom.one.js: ${(bundle.length / 1024).toFixed(1)} KB (terser minify) → wwwroot/one/`);
console.log('img_room_one.html → wwwroot/one/');
