/** @module wwwroot/modules/widgets.js @version 0.1.0 @see docs/img_room_spec.md */
// 共用 UI ウィジェット（契約 widgets.js 準拠）。文言は key 受け取り（I18N.t 解決、ハードコード禁止）。
import { Vw, C } from '../Vw.js';
import { I18N } from './i18n.js';

// key がパックにあれば翻訳、無ければ渡された文言のまま（t() の warn を出さない）
const tx = k => (I18N.has(k) ? I18N.t(k) : k);

export function Toggle({ parent, label, onChange } = {}) {
	const el = Vw.div(parent, {}, { display: 'inline-flex', alignItems: 'center', gap: '6px' });
	const ipt = Vw.ipt(el, { type: 'checkbox' });
	const lb = Vw.add(el, 'span');
	lb.textContent = tx(label);
	const get = () => !!ipt.checked;
	const set = b => (ipt.checked = !!b);
	Vw.change(ipt, () => typeof onChange === 'function' && onChange(get()));
	return { el, set, get };
}

export function Progress({ parent } = {}) {
	const el = Vw.div(parent);
	const wrap = Vw.div(el, {}, { height: '10px', background: '#ddd', 'border-radius': '5px', overflow: 'hidden' });
	const bar = Vw.div(wrap, {}, { height: '100%', width: '0%', background: 'blue' }); // C.bi 相当の縞は使わず単色
	const cap = Vw.div(el, {}, { 'font-size': '12px' });
	Vw.sS(cap, C.vH);
	const set = r => {
		const x = Math.max(0, Math.min(1, Number(r) || 0));
		Vw.sA(bar, 'width', `${Math.round(x * 100)}%`);
	};
	const text = s => {
		const v = s == null ? '' : tx(s);
		Vw.sS(cap, v ? C.vV : C.vH);
		cap.textContent = v;
	};
	return { el, set, text };
}

export function Badge(parent, cls, textStr) {
	const el = Vw.add(parent, 'span', {}, {
		display: 'inline-block', padding: '1px 6px', 'border-radius': '8px',
		background: '#888', color: '#fff', 'font-size': '12px',
	});
	if (cls) Vw.aC(el, cls);
	el.textContent = tx(textStr);
	return el;
}

let tEl = null; // body 固定オーバーレイ（同時 1 個、再呼び出しで差し替え）
export function Toast(msg, ms = 4000) {
	if (tEl) Vw.rm(tEl);
	const el = (tEl = Vw.div(Vw.gB(), {}, {
		position: 'fixed', left: '50%', bottom: '16px', transform: 'translateX(-50%)',
		background: '#222', color: '#fff', padding: '8px 14px', 'border-radius': '6px',
		'max-width': '90vw', 'z-index': '9999',
	}));
	el.textContent = tx(msg);
	setTimeout(() => {
		if (tEl === el) Vw.rm(tEl), (tEl = null);
	}, ms);
}

// byte 数 → "1.2 MB" 形式（1024 単位。B/KB/MB/GB。GB 超は GB のまま）
export function useLabel(bytes) {
	let n = Number(bytes);
	if (!isFinite(n) || n < 0) n = 0;
	if (n < 1024) return `${n} B`;
	const u = ['KB', 'MB', 'GB'];
	let i = -1;
	do {
		n /= 1024;
		i++;
	} while (n >= 1024 && i < u.length - 1);
	return `${Math.round(n * 10) / 10} ${u[i]}`;
}
