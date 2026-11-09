/** @module modules/app_settings.js @version 0.1.0 @see docs/img_room_spec.md */
import { Y, ef, T, F, N } from '../Y.js';
import { OPFS } from '../OPFS.js';
import { StoreTX } from './store_tx.js';

const U = 'user_settings', S = 'app_state', UF = 'user_settings.json', SF = 'app_state.json', DBNS = 500;

export class AppSettings { // 契約: init/cfg/state/set/setNested/setState/flush。读写は StoreTX 経由のみ（§11, §11.1）
	static defaults = {}; // user_settings 既定値（init で注入: ir_const CFG）
	static sDflt = {MODE: {}, roomLogin: {}, lastSweep: 0}; // app_state 既定値（§11 表）
	static _cfg = {};
	static _state = structuredClone(AppSettings.sDflt);
	static ops = new Map(); // name -> [[path, value]] 未 flush 操作
	static timer = new Map(); // name -> debounce タイマー
	static waiters = new Map(); // name -> [{res,rej}] flush で解決
	static chain = new Map(); // name -> 書込直列チェーン
	static nb = new Map(); // name -> 通知 BC（他タブのキャッシュ無効化）
	static inited = F;
	static onChange = N; // 追加フック: 自/他タブのキャッシュ更新時に name を渡して呼ぶ
	static get cfg() {
		return this._cfg; // マージ済みキャッシュ（変更禁止。変更は set 経由）
	}
	static get state() {
		return this._state;
	}
	static fileOf(name) {
		return name === U ? UF : SF;
	}
	static async init(defaults) { // OPFS.i('imgroom') 呼び出し後に呼ぶ（契約）
		this.defaults = structuredClone(defaults || {});
		await OPFS.rd;
		this._cfg = await this.load(U);
		this._state = await this.load(S);
		this.listen(U);
		this.listen(S);
		this.inited = T;
	}
	static async load(name) { // 読み込みも tx 経由（直接 OPFS.r 禁止）
		let o = N;
		try {
			o = await StoreTX.run(name, () => this.read(this.fileOf(name)));
		} catch (e) {
			ef(e, 'app_settings.load');
		}
		return this.merge(name, o); // 読込失敗/不存在は既定値
	}
	static merge(name, parsed) {
		const d = structuredClone(name === U ? this.defaults : this.sDflt);
		return typeof parsed === 'object' && parsed ? {...d, ...parsed} : d;
	}
	static async read(f) { // OPFS.r: ArrayBuffer → Y.u2s（不存在時は空ファイル → null）
		try {
			const ab = await OPFS.r(f);
			return ab && ab.byteLength ? JSON.parse(Y.u2s(ab)) : N;
		} catch (e) {
			return ef(e, 'app_settings.read');
		}
	}
	static async write(f, o) { // Y.s2u → ArrayBuffer で OPFS.w
		await OPFS.w(f, Y.s2u(JSON.stringify(o)).buffer);
	}
	static set(key, value) {
		return this.queue(U, key, value);
	}
	static setNested(path, value) { // 'MODE.roomA' 等のドット区切り
		return this.queue(U, path, value);
	}
	static setState(key, value) { // app_state 側（'roomLogin.<rid>'/'MODE.<rid>'/'lastSweep'）
		return this.queue(S, key, value);
	}
	static queue(name, path, v) { // 500ms debounce → flushFile で read-modify-write
		if (!this.ops.has(name)) this.ops.set(name, []);
		if (!this.waiters.has(name)) this.waiters.set(name, []);
		this.ops.get(name).push([path, v]);
		const p = new Promise((res, rej) => this.waiters.get(name).push({res, rej}));
		if (this.timer.has(name)) clearTimeout(this.timer.get(name));
		this.timer.set(name, setTimeout(() => {
			this.timer.delete(name);
			this.flushFile(name);
		}, DBNS));
		return p;
	}
	static async flush() { // 保留中の全 debounce を即実行
		this.timer.forEach(t => clearTimeout(t));
		this.timer.clear();
		for (const name of [U, S]) await this.flushFile(name);
	}
	static flushFile(name) { // 同タブ内の書込はチェーンで直列（tx は別タブ間直列）
		const prev = this.chain.get(name) || Promise.resolve();
		const next = prev.then(() => this.doFlush(name));
		this.chain.set(name, next.then(() => {}, () => {}));
		return next;
	}
	static async doFlush(name) {
		const opList = this.ops.get(name) || [], wl = this.waiters.get(name) || [];
		this.ops.set(name, []);
		this.waiters.set(name, []);
		if (!opList.length) return wl.forEach(x => x.res());
		try {
			await StoreTX.run(name, async () => { // ロック内でのみ read-modify-write
				const f = this.fileOf(name), base = this.merge(name, await this.read(f));
				opList.forEach(([p, v]) => this.setPath(base, p, v));
				await this.write(f, base);
				if (name === U) this._cfg = base;
				else this._state = base;
				this.notify(name); // 他タブへ変更通知（キャッシュ無効化）
				this.onChange && this.onChange(name);
			});
			wl.forEach(x => x.res());
		} catch (e) {
			ef(e, 'app_settings.flush');
			wl.forEach(x => x.rej(e));
		}
	}
	static setPath(o, p, v) { // ドット区切り。prototype 汚染キーは無視
		const ks = String(p).split('.');
		let c = o;
		for (let i = 0; i < ks.length - 1; i++) {
			const k = ks[i];
			if (k === '__proto__' || k === 'constructor' || k === 'prototype') return;
			if (typeof c[k] !== 'object' || c[k] === N) c[k] = {};
			c = c[k];
		}
		const l = ks[ks.length - 1];
		if (l !== '__proto__' && l !== 'constructor' && l !== 'prototype') c[l] = v;
	}
	static notify(name) {
		const b = this.nb.get(name);
		if (b) b.postMessage({name});
	}
	static listen(name) { // 変更通知受信で tx 経由再読込（BC は実行時にのみ触る）
		if (this.nb.has(name) || typeof BroadcastChannel === 'undefined') return;
		const b = new BroadcastChannel(`dsh.stx.notify.${name}`);
		b.onmessage = () => this.reload(name);
		this.nb.set(name, b);
	}
	static async reload(name) {
		try {
			if ((this.ops.get(name) || []).length || this.timer.has(name)) return; // 自タブの未 flush 変更を上書きしない
			const o = await this.load(name);
			if (name === U) this._cfg = o;
			else this._state = o;
			this.onChange && this.onChange(name);
		} catch (e) {
			ef(e, 'app_settings.reload');
		}
	}
}
