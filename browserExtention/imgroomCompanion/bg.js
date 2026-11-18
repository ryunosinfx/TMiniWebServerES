// @see docs/img_room_spec.md §55 — ImageRoom Companion バックグラウンド
// Chrome(MV3 service worker) / Firefox(MV3 event page) 共通。API は browser||chrome を B として使用。
// 責務: ①毎朝定時 job（タブ確保→自動ログイン→一括 DL 実行→ダウンロード完了監視→ネイティブホストへ解凍/重複排除/世代バックアップ依頼）
// 　　　②定期リロード（セッション維持）③options からの手動実行/ホストテスト
const B = (typeof browser !== 'undefined') ? browser : chrome;
const HOST_ID = 'com.imgroom.companion'; // ネイティブホスト名（install.mjs と一致させる）
const DEF = {
	roomUrl: '',
	userName: '',
	password: '',
	roomName: '',
	autoLogin: true,
	reloadMin: 15,
	dailyTime: '09:00',
	dailyEnabled: true,
	dailyTimeoutMin: 15,
	zipPattern: '-\\d{14}-\\d{3}\\.zip$',
	hostId: HOST_ID,
	extractDir: '',
	genDirs: ['', '', '', '', '', '', ''],
};
const cfgGet = async () => ({ ...DEF, ...(await B.storage.local.get(Object.keys(DEF))) });
const say = async (m) => B.storage.local.set({ lastNote: m + ' @' + new Date().toISOString() }).catch(() => {});

// ---- 定期リロード（セッション維持: 再読込→content の自動ログインで復活） ----
function schedKeepalive(cfg) {
	if (cfg.reloadMin >= 1) B.alarms.create('keepalive', { periodInMinutes: cfg.reloadMin });
	else B.alarms.clear('keepalive');
}
async function keepaliveTick(cfg) {
	const base = (cfg.roomUrl || '').split('#')[0];
	if (!base) return;
	const tabs = await B.tabs.query({ url: urlMatch(base) });
	for (const t of tabs) B.tabs.reload(t.id).catch(() => {});
}
function urlMatch(u) {
	try {
		const x = new URL(u);
		return x.origin + '/*';
	} catch { return '<all_urls>'; }
}

// ---- 毎日の定時アラーム（next fire 計算 → 起動時に再スケジュール。dailyAt は Firefox 非対応のため when を使う） ----
function nextAt(hhmm) {
	const [h, m] = (hhmm || '09:00').split(':').map(Number);
	const d = new Date();
	d.setHours(h || 0, m || 0, 0, 0);
	if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
	return d.getTime();
}
function schedDaily(cfg) {
	if (cfg.dailyEnabled && /^\d{1,2}:\d{2}$/.test(cfg.dailyTime || '')) B.alarms.create('daily', { when: nextAt(cfg.dailyTime) });
	else B.alarms.clear('daily');
}

// ---- job: タブ確保 → ログイン → bulkDl → ダウンロード完了待ち → ホスト実行 ----
const job = { run: false, zips: new Set(), last: 0, started: 0 };

async function ensureTab(cfg) {
	const base = (cfg.roomUrl || '').split('#')[0];
	if (!base) throw new Error('roomUrl 未設定');
	let tabs = await B.tabs.query({ url: urlMatch(cfg.roomUrl) });
	if (!tabs.length) {
		const t = await B.tabs.create({ url: cfg.roomUrl, active: false });
		for (let i = 0; i < 60; i++) {
			const g = await B.tabs.get(t.id).catch(() => null);
			if (!g || g.status === 'complete') { tabs = [g || t]; break; }
			await new Promise(r => setTimeout(r, 500));
		}
		if (!tabs.length) tabs = [await B.tabs.get(t.id)];
	}
	const tab = tabs[0];
	for (let i = 0; i < 40 && tab.status !== 'complete'; i++) {
		await new Promise(r => setTimeout(r, 500));
		Object.assign(tab, await B.tabs.get(tab.id).catch(() => tab));
	}
	return tab;
}
async function tabSend(tabId, msg) {
	// content script 起動待ちで数回リトライ
	for (let i = 0; i < 12; i++) {
		try { return await B.tabs.sendMessage(tabId, msg); } catch (e) {
			await new Promise(r => setTimeout(r, 1500));
		}
	}
	return null;
}
function waitDownloads(cfg) { // job 中に始まった zip の完了判定（idle 12s or 全体 complete+zip≥1 or 上限 timeout）
	return new Promise(async (res) => {
		const pat = new RegExp(cfg.zipPattern || DEF.zipPattern);
		const until = Date.now() + Math.max(2, cfg.dailyTimeoutMin || 15) * 60000;
		for (;;) {
			const items = await B.downloads.search({ startedAfter: new Date(job.started).toISOString(), limit: 200 }).catch(() => []);
			const zips = items.filter(x => x.filename && pat.test(x.filename) && x.state !== 'interrupted');
			for (const x of zips) if (x.state === 'complete') job.zips.add(x.filename);
			const pending = zips.some(x => x.state === 'in_progress' || x.state === 'paused' || x.state === 'unconfirmed');
			if (job.zips.size >= 1 && !pending && Date.now() - job.last > 12000) break;
			if (Date.now() > until) break;
			await new Promise(r => setTimeout(r, 2000));
		}
		res([...job.zips]);
	});
}
async function hostAsk(cfg, zips) {
	return new Promise((res) => {
		try {
			B.runtime.sendNativeMessage(cfg.hostId || HOST_ID, {
				config: { extractDir: cfg.extractDir, genDirs: (cfg.genDirs || []).filter(x => x) },
				zips,
			}, rep => {
				if (B.runtime.lastError) { res({ ok: false, error: B.runtime.lastError.message }); return; }
				res(rep || { ok: false, error: 'no reply' });
			});
		} catch (e) { res({ ok: false, error: String(e) }); }
	});
}
async function runDailyJob() {
	if (job.run) return;
	job.run = true; job.zips = new Set(); job.last = 0; job.started = Date.now();
	try {
		const cfg = await cfgGet();
		if (!cfg.roomUrl) { say('job: roomUrl 未設定で中止'); return; }
		const tab = await ensureTab(cfg);
		const lg = await tabSend(tab.id, { cmd: 'ensure-login' });
		if (!lg || !lg.authed) { say('job: 自動ログイン失敗（ブラウザで一度ログインして設定確認を）'); }
		await tabSend(tab.id, { cmd: 'bulkdl' });
		const zips = await waitDownloads(cfg);
		if (!zips.length) { say('job: ZIP 検出なし（ダウンロード先/パターン設定を確認）'); return; }
		if (!cfg.extractDir) { say('job: ZIP ' + zips.length + ' 件取得（展開先未設定のためホスト実行せず）'); return; }
		const rep = await hostAsk(cfg, zips);
		await B.storage.local.set({ lastReport: { at: new Date().toISOString(), zips: zips.length, rep } });
		say('job: ' + (rep.ok ? '完了（展開 ' + (rep.report.written) + / 重複除外 / + rep.report.skippedDup + '）' : 'ホストエラー: ' + rep.error));
	} catch (e) {
		say('job 例外: ' + (e && e.message || e));
	} finally {
		job.run = false;
		schedDaily(await cfgGet()); // 翌日へ
	}
}

// ---- 起動/イベント ----
async function boot() {
	const cfg = await cfgGet();
	schedKeepalive(cfg);
	schedDaily(cfg);
}
B.runtime.onInstalled.addListener(boot);
B.runtime.onStartup.addListener(boot);
B.storage.onChanged.addListener((ch, area) => { if (area === 'local') boot(); });
B.alarms.onAlarm.addListener((a) => {
	if (a.name === 'daily') runDailyJob();
	else if (a.name === 'keepalive') cfgGet().then(c => keepaliveTick(c)).catch(() => {});
});
B.downloads.onChanged.addListener((d) => {
	if (job.run) job.last = Date.now();
	void d;
});
B.runtime.onMessage.addListener((m, _s, res) => {
	if (m && m.cmd === 'run-now') { runDailyJob().then(() => res({ started: true })); return true; }
	if (m && m.cmd === 'host-test') {
		cfgGet().then(cfg => hostAsk(cfg, []).then(r => res(r)));
		return true;
	}
	return false;
});
boot();
