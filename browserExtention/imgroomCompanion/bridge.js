// @see docs/img_room_spec.md §55 — MAIN world ブリッジ（window.__IRAPP へアクセスできるのは main world のため）
// isolated の content.js と window.postMessage で通信する（CSP 安全・eval 不使用）。
(() => {
	const post = (m) => window.postMessage({ irC: 1, ...m }, window.location.origin);
	window.addEventListener('message', (ev) => {
		if (ev.source !== window || !ev.data || ev.data.irC !== 1 || !ev.data.req) return;
		const req = ev.data.req;
		try {
			if (req === 'state') {
				const app = window.__IRAPP,
					ctx = app && app.activeCtx && app.activeCtx();
				post({ res: 'state', hasApp: !!app, authed: !!(ctx && ctx.session && ctx.session.state && ctx.session.state.authed), title: (ctx && ctx.title) || '' });
			} else if (req === 'bulkdl') {
				const app = window.__IRAPP;
				if (!app || typeof app.bulkDl !== 'function') { post({ res: 'bulkdl', ok: false, error: 'no __IRAPP.bulkDl' }); return; }
				app.bulkDl(); // 分割 ZIP が <a download> で降りる（完了判定は bg の downloads 監視）
				post({ res: 'bulkdl', ok: true });
			}
		} catch (e) {
			post({ res: req, ok: false, error: String(e && e.message || e) });
		}
	});
	post({ res: 'hello' });
})();
