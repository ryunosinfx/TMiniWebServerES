// @see docs/img_room_spec.md §55 — isolated world: 自動ログイン（参加フォーム入力）と bg からの命令中継
const B = (typeof browser !== 'undefined') ? browser : chrome;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const bridge = (req) => new Promise((res) => {
	const h = (ev) => {
		if (ev.source !== window || !ev.data || ev.data.irC !== 1 || ev.data.res !== req) return;
		window.removeEventListener('message', h);
		res(ev.data);
	};
	window.addEventListener('message', h);
	window.postMessage({ irC: 1, req }, window.location.origin);
	setTimeout(() => { window.removeEventListener('message', h); res(null); }, 4000);
});
async function waitApp(ms = 30000) {
	const t0 = Date.now();
	while (Date.now() - t0 < ms) {
		const s = await bridge('state');
		if (s && s.hasApp) return s;
		await sleep(700);
	}
	return null;
}
const q = sel => document.querySelector(sel);
function setInput(el, v) { // フレームワーク非依存の値設定（React 対策の setter は不要: 素の value 読み取り）
	if (!el) return;
	el.value = v;
	el.dispatchEvent(new Event('input', { bubbles: true }));
	el.dispatchEvent(new Event('change', { bubbles: true }));
}
function btnByText(txt) {
	return [...document.querySelectorAll('button')].find(b => (b.textContent || '').includes(txt) && b.offsetParent !== null);
}
function roomNameFromCfgOrHash(cfg) {
	const h = decodeURIComponent((location.hash || '').replace(/^#/, '')).split(':')[0];
	if (h) { try { return atob(h.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice(0, (4 - h.length % 4) % 4)); } catch { return h; } }
	return cfg.roomName || '';
}
async function authed() {
	const s = await bridge('state');
	return !!(s && s.authed);
}
// 自動ログイン: home→参加→記入→ログイン。失敗シェル（再試行ボックス）残留時はログアウトで home 復帰から再試行（spec §54 既知 UX）
async function ensureLogin(cfg) {
	if (await authed()) return true;
	for (let t = 0; t < 3; t++) {
		if (!q('input[name="ir-pw"]')) {
			const jb = btnByText('参加');
			if (!jb) {
				const lo = btnByText('ログアウト'); // 失敗直後の部屋シェルなら home へ
				if (lo) { lo.click(); await sleep(1500); }
				continue;
			}
			jb.click();
			for (let i = 0; i < 20 && !q('input[name="ir-nm"]'); i++) await sleep(300);
		}
		setInput(q('input[name="ir-nm"]'), roomNameFromCfgOrHash(cfg));
		setInput(q('input[name="ir-uid"]'), cfg.userName || '');
		setInput(q('input[name="ir-pw"]'), cfg.password || '');
		const lb = [...document.querySelectorAll('.ir-frm button')].find(b => (b.textContent || '').trim() === 'ログイン');
		if (lb) lb.click();
		const t0 = Date.now();
		while (Date.now() - t0 < 30000) {
			if (await authed()) return true;
			await sleep(800);
		}
		await sleep(1500);
	}
	return await authed();
}
async function main() {
	const cfgAll = await B.storage.local.get(['autoLogin', 'userName', 'password', 'roomName']);
	const cfg = { autoLogin: true, ...cfgAll };
	const s = await waitApp();
	if (!s) return; // アプリ不在ページ（読み取り専用等）
	if (cfg.autoLogin && !s.authed && cfg.userName) await ensureLogin(cfg);
}
B.runtime.onMessage.addListener((m, _s, res) => {
	(async () => {
		if (m && m.cmd === 'ensure-login') res({ authed: await ensureLogin({ ...(await B.storage.local.get(['autoLogin', 'userName', 'password', 'roomName'])) }) });
		else if (m && m.cmd === 'bulkdl') res(await bridge('bulkdl'));
		else res(null);
	})();
	return true;
});
main().catch(() => {});
