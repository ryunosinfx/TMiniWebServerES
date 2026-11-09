/** @module wwwroot/modules/i18n.js @version 0.1.0 @see docs/img_room_spec.md */
// 言語パック管理。附表 A 準拠。locales/ja,en は静的 import（既定読み込み済み。top-level await 禁止）。
import { E, N, w } from '../Y.js';
import ja from './locales/ja.js';
import en from './locales/en.js';

export class I18N {
	static packs = { ja, en };
	static langs = ['ja', 'en'];
	static lang = 'ja'; // 解決済み言語
	static onChange = N; // 言語切替時の再描画回调 fn(lang)
	// 'auto' 解決: navigator.language が ja 始まりなら ja、他は en
	static auto() {
		const n = (globalThis.navigator?.language || E).toLowerCase();
		return n.startsWith('ja') ? 'ja' : 'en';
	}
	static resolve(lang = 'auto') {
		return lang === 'auto' ? I18N.auto() : I18N.packs[lang] ? lang : 'en';
	}
	static async init(lang = 'auto') {
		I18N.lang = I18N.resolve(lang);
	}
	static async setLang(lang = 'auto') {
		const l = I18N.resolve(lang);
		if (l === I18N.lang) return;
		I18N.lang = l;
		if (typeof I18N.onChange === 'function') I18N.onChange(l);
	}
	// アプリ固有キー追加: register({ja:{...},en:{...}) または register('ja', pack)
	static register(a, b) {
		const mg = (l, pack) => Object.assign(I18N.packs[l] || (I18N.packs[l] = {}), pack || {});
		if (typeof a === 'string') mg(a, b);
		else for (const l of Object.keys(a || {})) mg(l, a[l]);
	}
	static has(key) {
		const p = I18N.packs[I18N.lang];
		return !!(p && key in p);
	}
	// 欠落キーは '⚠'+key + console.warn。params は {name} 置換
	static t(key, params) {
		const p = I18N.packs[I18N.lang];
		const s = p && key in p ? p[key] : N;
		if (s === N) return w(`i18n: missing key ${key}`), `⚠${key}`;
		if (!params) return s;
		return s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? `${params[k]}` : m));
	}
}
