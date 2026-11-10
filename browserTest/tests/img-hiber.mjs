// browserTest/tests/img-hiber.mjs — 一時退避（12h リロード）仕様テスト（追加仕様 v1.3 §15.8）
// 手順: A 作成 / B 参加 → B を即時退避(now())→リロード→自動再参加・localStorage 消去・鍵消去・二重退避なし
// → A も同様に退避（平文 pw 含む）→ pw QR が復活 → 期限切れ(>5分)条目は無視・削除。
import { launchEngine } from './lib.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = 'http://127.0.0.1:8080';
const OUT = fileURLToPath(new URL('../out/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const ROOM = 'IRHIB' + Math.random().toString(36).slice(2, 5);
const PW = 'PW';
const checks = {},
	errors = [];
const ck = (k, v) => {
	checks[k] = !!v;
};
const { browser } = await launchEngine();
const mk = async (label) => {
	const c = await browser.newContext({ locale: 'ja-JP' });
	const p = await c.newPage();
	p.on('pageerror', e => errors.push(`[${label}] ${e}`));
	p.on('console', m => {
		if (m.type() === 'error') errors.push(`[${label}] console ${m.text().slice(0, 160)}`);
	});
	return p;
};
const authed = p =>
	p.waitForFunction(() => {
		const x = window.__IRAPP && window.__IRAPP.activeCtx();
		return !!x && x.session.state.authed && x.session.state.online;
	}, null, { timeout: 45000 });

const A = await mk('A'),
	B = await mk('B');
// A 作成 / B 参加
await A.goto(BASE + '/img_room.html');
await A.click('button:has-text("部屋作成")');
await A.fill('input[name="ir-cn"]', ROOM);
await A.fill('input[name="ir-cuid"]', 'PONTA');
await A.fill('input[name="ir-cpw"]', PW);
await A.click('.ir-frm button:has-text("部屋作成")');
await authed(A);
await B.goto(BASE + '/img_room.html');
await B.click('button:has-text("参加")');
await B.fill('input[name="ir-nm"]', ROOM);
await B.fill('input[name="ir-uid"]', 'PONKO');
await B.fill('input[name="ir-pw"]', PW);
await B.click('.ir-frm button:has-text("ログイン")');
await authed(B);
await A.waitForFunction(() => {
	const x = window.__IRAPP.activeCtx();
	return !!(x && x.session && x.session.state.participants.length === 2);
}, null, { timeout: 20000 });
ck('twoPeers', true);

// ---- B を即時退避 → リロード → 自動再参加 ----
const bTs = await B.evaluate(() => {
	window.__IRAPP.hib.now();
	return Date.now();
}).catch(() => Date.now()); // リロードで evaluate 自体は中断され得る
// 新しいページ（bootAt > 退避時刻）になるまで待つ（旧コンテキストの authed で誤通過しないため）
ck('B.reloaded', !!(await B.waitForFunction(t => window.__IRAPP && window.__IRAPP.hib && window.__IRAPP.hib.bootAt > t, bTs, { timeout: 30000 }).then(() => true, () => false)));
ck('B.resumed', await (async () => {
	await authed(B);
	await B.waitForFunction(() => {
		const x = window.__IRAPP.activeCtx();
		return !!(x && x.rid && x.session && x.session.state.participants.some(pp => pp.uid === 'PONTA'));
	}, null, { timeout: 25000 });
	return true;
})().catch(() => false));
console.log('B post-resume dump:', await B.evaluate(() => {
	const x = window.__IRAPP.activeCtx();
	return JSON.stringify({ rid: x && x.rid, authed: !!(x && x.session && x.session.state.authed), online: !!(x && x.session && x.session.state.online), parts: x && x.session ? x.session.state.participants.map(pp => pp.uid) : null, view: window.__IRAPP.view, toasts: [...document.querySelectorAll('.ir-toast')].map(tt => tt.textContent) });
}));
console.log('errors so far:', JSON.stringify(errors.slice(0, 6)));
ck('B.storeClean', await B.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('ir.hiber')).length === 0));
ck('B.keyClean', await B.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('ir.hiberkey')).length === 0));
console.log('hibdbg:', await B.evaluate(() => JSON.stringify({ fired: window.__IRAPP.hib._fired, t: typeof window.__IRAPP.hib._t, after: window.__IRAPP.cfg.HIBER_AFTER_MS, ttl: window.__IRAPP.cfg.HIBER_TTL_MS })));
ck('B.noDoubleHiber', await B.evaluate(() => window.__IRAPP.hib._fired === false && window.__IRAPP.hib._t !== null && window.__IRAPP.cfg.HIBER_AFTER_MS === 43200000 && window.__IRAPP.cfg.HIBER_TTL_MS === 300000));
ck('B.tabStable', await B.evaluate(() => !!sessionStorage.getItem('ir.tabid.v1')));
await B.waitForFunction(() => {
	const x = window.__IRAPP.activeCtx();
	return !!(x && x.session && x.session.state.participants.length === 2);
}, null, { timeout: 20000 });
ck('B.parts2', true);

// ---- A（作成者・平文 pw 保持）を退避 → pw 含む復帰 → pw QR 復活 ----
const aTs = await A.evaluate(() => {
	window.__IRAPP.hib.now();
	return Date.now();
}).catch(() => Date.now());
ck('A.reloaded', !!(await A.waitForFunction(t => window.__IRAPP && window.__IRAPP.hib && window.__IRAPP.hib.bootAt > t, aTs, { timeout: 30000 }).then(() => true, () => false)));
ck('A.resumed', await (async () => {
	await authed(A);
	await A.waitForFunction(pw => {
		const x = window.__IRAPP.activeCtx();
		return !!(x && x.plainPw === pw && x.session && x.session.state.participants.some(pp => pp.uid === 'PONKO'));
	}, PW, { timeout: 25000 });
	return true;
})().catch(() => false));
await A.click('.ir-subtab:has-text("パスワード QR")');
await A.waitForSelector('.ir-sec canvas', { timeout: 10000 });
ck('A.pwQrAfterResume', true);
await A.screenshot({ path: OUT + 'img_hiber_resume.png' });

// ---- 期限切れ条目（>5 分）は無視・削除 ----
const C = await mk('C');
await C.goto(BASE + '/img_room.html');
await C.waitForSelector('button:has-text("参加")', { timeout: 20000 });
await C.evaluate(() => {
	const t = sessionStorage.getItem('ir.tabid.v1');
	localStorage.setItem('ir.hiber.v1.' + t, JSON.stringify({ a: 'aesgcm', iv: '00', ct: '00', at: Date.now() - 600000 }));
});
await C.reload();
await C.waitForSelector('button:has-text("参加")', { timeout: 20000 });
ck('C.staleIgnored', await C.evaluate(() => !window.__IRAPP.activeCtx() && Object.keys(localStorage).filter(k => k.startsWith('ir.hiber')).length === 0));

console.log(JSON.stringify({ engine: 'chromium', room: ROOM, checks, errors }, null, 1));
const bad = errors.length || Object.values(checks).some(v => !v);
console.log(bad ? 'HIBER INCOMPLETE' : 'HIBER OK');
await browser.close();
process.exit(bad ? 1 : 0);
