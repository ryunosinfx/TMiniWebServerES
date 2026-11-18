// @see docs/img_room_spec.md §55 — 設定 UI（storage.local 保存）+ QR/TMIWR1 取り込み + ホスト実行系
// QR 復号は内蔵 jsQR（wwwroot と同一ビルド・MIT）で Chrome/Firefox 共通（BarcodeDetector 非依存）。
import { jsQR } from './jsqr/jsQR.es.min.nosjis.js';
const B = (typeof browser !== 'undefined') ? browser : chrome;
const KEYS = ['roomUrl', 'userName', 'password', 'roomName', 'autoLogin', 'reloadMin', 'dailyTime', 'dailyEnabled', 'dailyTimeoutMin', 'zipPattern', 'hostId', 'extractDir', 'genDirs'];
const $ = id => document.getElementById(id);
const GENN = 7;
function genInputs() {
	const w = document.querySelector('.genwrap');
	w.textContent = '';
	for (let i = 1; i <= GENN; i++) {
		const lb = document.createElement('label');
		lb.className = 'row';
		const sp = document.createElement('span');
		sp.textContent = '世代 ' + i + ' ディレクトリ（空=使用しない）';
		const inp = document.createElement('input');
		inp.type = 'text';
		inp.className = 'gen';
		inp.id = 'gen' + i;
		lb.append(sp, inp);
		w.appendChild(lb);
	}
}
async function load() {
	const c = await B.storage.local.get(KEYS);
	for (const k of KEYS) {
		if (k === 'genDirs') continue;
		const el = $(k);
		if (!el) continue;
		if (el.type === 'checkbox') el.checked = c[k] !== false;
		else el.value = c[k] != null ? c[k] : '';
	}
	const gd = c.genDirs || [];
	for (let i = 1; i <= GENN; i++) $('gen' + i).value = gd[i - 1] || '';
	if (!c.reloadMin && c.reloadMin !== 0) $('reloadMin').value = 15;
	if (!c.dailyTimeoutMin) $('dailyTimeoutMin').value = 15;
	if (!c.zipPattern) $('zipPattern').value = '-\\d{14}-\\d{3}\\.zip$';
	if (!c.hostId) $('hostId').value = 'com.imgroom.companion';
	if (!c.dailyTime) $('dailyTime').value = '09:00';
	const st = await B.storage.local.get(['lastNote', 'lastReport']);
	$('status').textContent = (st.lastNote || '（実行記録なし）') + '\n' + (st.lastReport ? JSON.stringify(st.lastReport, null, 1) : '');
}
async function save() {
	const c = {};
	for (const k of KEYS) {
		if (k === 'genDirs') continue;
		const el = $(k);
		if (!el) continue;
		c[k] = el.type === 'checkbox' ? el.checked : (el.type === 'number' ? Number(el.value) : el.value);
	}
	c.genDirs = Array.from({ length: GENN }, (_, i) => $('gen' + (i + 1)).value);
	await B.storage.local.set(c);
	$('saved').textContent = '保存しました ' + new Date().toLocaleTimeString();
}
function b64uDec(s) {
	return decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice(0, (4 - s.length % 4) % 4))));
}
function parseTmiwr1(txt) { // TMIWR1:<部屋名b64url>:<パスワード>
	const i = txt.indexOf(':');
	if (!txt.startsWith('TMIWR1') || i < 0) return null;
	const rest = txt.slice(i + 1), j = rest.indexOf(':');
	if (j < 0) return null;
	let nm = rest.slice(0, j);
	try { nm = b64uDec(nm); } catch { /* そのまま */ }
	return { roomName: nm, password: rest.slice(j + 1) };
}
$('qrparse').addEventListener('click', async () => {
	const t = $('qrtext').value.trim();
	if (t) {
		const p = parseTmiwr1(t);
		if (p) { $('roomName').value = p.roomName; $('password').value = p.password; $('saved').textContent = 'TMIWR1 を解釈しました'; }
		else $('saved').textContent = 'TMIWR1 形式ではありません';
		return;
	}
	const f = $('qrfile').files[0];
	if (!f) { $('saved').textContent = 'QR 画像か TMIWR1 テキストを入力'; return; }
	try {
		const bmp = await createImageBitmap(f);
		const max = 1600, k = Math.min(1, max / Math.max(1, bmp.width, bmp.height)),
			c = document.createElement('canvas');
		c.width = Math.max(1, Math.round(bmp.width * k));
		c.height = Math.max(1, Math.round(bmp.height * k));
		const g = c.getContext('2d');
		g.drawImage(bmp, 0, 0, c.width, c.height);
		if (bmp.close) bmp.close();
		const img = g.getImageData(0, 0, c.width, c.height),
			res = await jsQR(img.data, c.width, c.height); // nosjis ビルドは async
		if (!res || !res.data) { $('saved').textContent = 'QR を検出/復号できませんでした'; return; }
		$('qrtext').value = res.data;
		$('qrparse').click();
	} catch (e) { $('saved').textContent = 'QR 解読失敗: ' + e.message; }
});
$('qrfile').addEventListener('change', () => {
	const f = $('qrfile').files[0];
	if (!f) return;
	$('qrimg').src = URL.createObjectURL(f);
	$('qrimg').style.display = 'inline';
});
$('save').addEventListener('click', save);
$('testhost').addEventListener('click', async () => {
	$('status').textContent = 'ホスト接続テスト中…';
	const rep = await B.runtime.sendMessage({ cmd: 'host-test' });
	$('status').textContent = JSON.stringify(rep, null, 1);
});
$('runnow').addEventListener('click', async () => {
	$('status').textContent = '実行を開始しました（完了まで数分）…';
	await B.runtime.sendMessage({ cmd: 'run-now' });
});
genInputs();
load();
