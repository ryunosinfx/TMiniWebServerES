#!/usr/bin/env node
// @see docs/img_room_spec.md §55 — imgroomCompanion ネイティブメッセージホスト
// 責務: ZIP 一括ダウンロードの ①解凍 ②ハッシュ(SHA-256)重複排除 ③最大7世代への世代バックアップ
// 　　　（各世代は指定ディレクトリ。追加/更新コピーのみで削除は同期しない）
// 起動: ブラウザの native messaging（stdio: 4バイト長さ前置り JSON）または CLI（テスト用）。
// プロトコル:
//   in : { job, config, zips:[絶対パス…], now? }
//   out: { ok, report:{ zips, written, skippedDup, sameName, copies:[..], errors:[..] } }
// config: { extractDir, genDirs:[…7], zipGlob?, keepGen?:7 }
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, read as fsRead } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';

// ---------------- ZIP 読み出し（Central Directory ベース。ImageRoom zip.js と同一形式） ----------------
function u16(buf, o) { return buf[o] | (buf[o + 1] << 8); }
function u32(buf, o) { return (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0; }

export function readZip(buf) { // -> [{name, data:Buffer}]
	// EOCD (0x06054b50) を末尾検索
	let eocd = -1;
	for (let i = buf.length - 22; i >= 0 && i >= buf.length - 66000; i--) {
		if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) { eocd = i; break; }
	}
	if (eocd < 0) throw new Error('zip: EOCD が見つからない');
	const count = u16(buf, eocd + 10);
	let p = u32(buf, eocd + 16); // セントラルディレクトリ開始
	const out = [];
	for (let n = 0; n < count; n++) {
		if (u32(buf, p) !== 0x02014b50) throw new Error('zip: 中央目录ヘッダ不正 @' + p);
		const flag = u16(buf, p + 8), method = u16(buf, p + 10);
		const csize = u32(buf, p + 20), usize = u32(buf, p + 24);
		const nameLen = u16(buf, p + 28), extraLen = u16(buf, p + 30), cmtLen = u16(buf, p + 32);
	 const lho = u32(buf, p + 42);
		const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8'); // flag bit11 前提（ImageRoom は UTF-8 固定）
		// ローカルヘッダの name/extra 長は中央と異なるため実測
		if (u32(buf, lho) !== 0x04034b50) throw new Error('zip: ローカルヘッダ不正 ' + name);
		const lNameLen = u16(buf, lho + 26), lExtraLen = u16(buf, lho + 28);
		const dataOff = lho + 30 + lNameLen + lExtraLen;
		const comp = buf.subarray(dataOff, dataOff + csize);
		let data;
		if (method === 0) data = Buffer.from(comp);
		else if (method === 8) data = inflateRawSync(comp, { maxOutputLength: usize || 0xffffffff });
		else throw new Error('zip: 未対応圧縮方式 ' + method + ' (' + name + ')');
		out.push({ name, data });
		p += 46 + nameLen + extraLen + cmtLen;
	}
	return out;
}

// ---------------- パス安全 ----------------
function safeName(name) { // traversal/絶対パス拒否。戻り: 相対パス or null
	const s = String(name).replace(/\\/g, '/');
	if (s.startsWith('/') || /^[a-zA-Z]:/.test(s)) return null;
	const parts = s.split('/').filter(x => x !== '' && x !== '.');
	if (parts.some(x => x === '..')) return null;
	return parts.length ? parts.join('/') : null;
}

// ---------------- ハッシュ ----------------
const sha256 = b => createHash('sha256').update(b).digest('hex');

// ---------------- ハッシュキャッシュ（世代ごとに .imgroom-hashcache.json） ----------------
function loadCache(dir) {
	const f = join(dir, '.imgroom-hashcache.json');
	try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return { sha: {}, name: {} }; } // sha: hex->relName, name: relName->{sha,mtime,size}
}
function saveCache(dir, c) {
	try { writeFileSync(join(dir, '.imgroom-hashcache.json'), JSON.stringify(c)); } catch { /* 読み取り専用等は無視 */ }
}

// ---------------- 展開（重複排除込み） ----------------
export function extractZips(zips, extractDir, report) { // zips: 絶対パス配列（同一実行の分割 part 込み）
	mkdirSync(extractDir, { recursive: true });
	const cache = loadCache(extractDir);
	for (const zp of zips) {
		let entries;
		try { entries = readZip(readFileSync(zp)); } catch (e) { report.errors.push(basename(zp) + ': ' + e.message); continue; }
		report.zips++;
		for (const en of entries) {
			const rel = safeName(en.name);
			if (!rel) { report.errors.push('不正パス無視: ' + en.name); continue; }
			const h = sha256(en.data);
			if (cache.sha[h]) { // 内容ハッシュ一致 = 重複排除
				report.skippedDup++;
				continue;
			}
			const prev = cache.name[rel];
			if (prev && prev.sha === h) { report.skippedDup++; continue; } // 同一ファイルの再取得
			const target = join(extractDir, rel);
			mkdirSync(join(target, '..'), { recursive: true });
			writeFileSync(target, en.data);
			if (prev) report.sameName++; // 同名別内容 = 上書き（旧内容は世代コピー側で保持）
			cache.sha[h] = rel;
			cache.name[rel] = { sha: h, mtime: statSync(target).mtimeMs, size: en.data.length };
			report.written++;
		}
	}
	// 実在しないキャッシュ名は掃除（手で消した等。sha の方は重複排除履歴として保持し続ける）
	for (const rel of Object.keys(cache.name)) {
		if (!existsSync(join(extractDir, rel))) delete cache.name[rel];
	}
	saveCache(extractDir, cache);
	return cache;
}

// ---------------- 世代バックアップ（追加/更新のみ・削除同期なし） ----------------
export function genCopies(extractDir, genDirs, report) {
	const chain = [extractDir, ...genDirs].filter(d => d); // current → gen1 → … → gen7
	for (let i = 0; i + 1 < chain.length; i++) {
		const src = chain[i], dst = chain[i + 1];
		if (!existsSync(src)) continue;
		mkdirSync(dst, { recursive: true });
		const dCache = loadCache(dst);
		let copied = 0, skipped = 0;
		for (const rel of listFiles(src)) {
			const sPath = join(src, rel);
			const st = statSync(sPath);
			if (!st.isFile()) continue;
			const ent = dCache.name[rel];
			if (ent && ent.mtime === st.mtimeMs && ent.size === st.size) { skipped++; continue; } // 転送済み（mtime+size 一致）
			const sSha = sha256(readFileSync(sPath));
			if (ent && ent.sha === sSha) { // 内容同じ → メタだけ更新
				dCache.name[rel] = { sha: sSha, mtime: st.mtimeMs, size: st.size };
				skipped++;
				continue;
			}
			const dPath = join(dst, rel);
			mkdirSync(join(dPath, '..'), { recursive: true });
			writeFileSync(dPath, readFileSync(sPath));
			dCache.sha[sSha] = rel;
			dCache.name[rel] = { sha: sSha, mtime: st.mtimeMs, size: st.size };
			copied++;
		}
		saveCache(dst, dCache);
		report.copies.push({ dir: dst, copied, skipped });
	}
}
export function* listFiles(dir) { // 相対パス列挙（再帰・ドットファイル・キャッシュ除外）
	const stack = [[dir, '']];
	while (stack.length) {
		const [d, pre] = stack.pop();
		let names = [];
		try { names = readdirSync(d); } catch { continue; }
		for (const n of names) {
			const rel = pre ? pre + '/' + n : n;
			const p = join(d, n);
			let st;
			try { st = statSync(p); } catch { continue; }
			if (st.isDirectory()) stack.push([p, rel]);
			else if (st.isFile() && n !== '.imgroom-hashcache.json') yield rel;
		}
	}
}

// ---------------- メインジョブ ----------------
export function runJob(config, zips, nowIso) {
	const report = { zips: 0, written: 0, skippedDup: 0, sameName: 0, copies: [], errors: [], at: nowIso || new Date().toISOString() };
	const extractDir = resolve(config.extractDir);
	const genDirs = (config.genDirs || []).slice(0, 7).map(d => resolve(d)); // 最大 7 世代
	extractZips(zips, extractDir, report);
	genCopies(extractDir, genDirs, report);
	return report;
}

// ---------------- ネイティブメッセージ I/O ----------------
function readMsg(read) { // 4 バイト LE 長さ → JSON
	return new Promise((res, rej) => {
		const lenb = Buffer.alloc(4);
		read(0, lenb, 0, 4, err => {
			if (err) return rej(err);
			const len = lenb.readUInt32LE(0);
			if (len > 8 * 1024 * 1024) return rej(new Error('msg 過大'));
			const b = Buffer.alloc(len);
			let got = 0;
			const step = () => read(got, b, got, len - got, (e2, n) => {
				if (e2) return rej(e2);
				got += n;
				if (got < len) return step();
				try { res(JSON.parse(b.toString('utf8'))); } catch (e3) { rej(e3); }
			});
			step();
		});
	});
}
function writeMsg(obj) {
	const b = Buffer.from(JSON.stringify(obj));
	const len = Buffer.alloc(4);
	len.writeUInt32LE(b.length);
	process.stdout.write(len);
	process.stdout.write(b);
}

if (process.argv[2] === '--cli') { // CLI（テスト/手動）: node host.mjs --cli '<job JSON>'
	const job = JSON.parse(process.argv[3] || 'null') || (() => { const p = process.argv[4]; return JSON.parse(readFileSync(p, 'utf8')); })();
	const rep = runJob(job.config || {}, job.zips || [], job.now);
	writeFileSync((job.reportFile) || '/dev/stdout', JSON.stringify(rep, null, 1) + '\n');
} else if (!process.argv[2]) { // stdio native messaging（fd0/fd1。Chrome/Firefox 起動）
	readMsg((off, buf, o, len, cb) => { // off は未使用（fd は自動順次）
		let got = 0;
		const step = () => fsRead(0, buf, o + got, len - got, null, (e, n) => {
			if (e) return cb(e);
			got += n;
			if (got === 0) return cb(new Error('EOF'));
			if (got < len) return step();
			cb(null);
		});
		step();
	}).then(job => {
		let rep;
		try { rep = runJob(job.config || {}, job.zips || [], job.now); } catch (e) { rep = { ok: false, error: String(e && e.message || e) }; }
		writeMsg({ ok: !rep.error, report: rep });
	}).catch(() => { writeMsg({ ok: false, error: 'bad message' }); });
}
