/** @module modules/imgroom/ir_protocol.js @version 0.1.0 @see docs/img_room_spec.md */
// ir フレーム生成・受信判別・ページ分割（仕様 §8.2, §7.4, §8.5）
// Q/H/A/G と ~chunk の生成・解析自体は modules/p2p_file.js 側が担う（ここは判別と転送委譲のみ）。
import { IR, IR_AUTH } from './ir_const.js';

export class Protocol {
	// JSON オブジェクト生成（ir を常に先頭キーに）
	static mk(ir, obj = {}) {
		const o = { ir };
		for (const k in obj) o[k] = obj[k];
		return JSON.stringify(o);
	}
	// 受信文字列の JSON 判別。object でなく ir 文字列でなければ null（§8.5 手順 c）
	static parse(str) {
		if (!str || typeof str !== 'string' || str.startsWith('~')) return null;
		let o = null;
		try {
			o = JSON.parse(str);
		} catch {
			return null;
		}
		if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
		if (typeof o.ir !== 'string' || o.ir.length !== 1) return null;
		return o;
	}
	// チャンクフレーム ~<h10>.<i>.<c>.<r>（§8.2 (b)）
	static chunk(str) {
		if (!str || str[0] !== '~') return null;
		const s = str.slice(1).split('.');
		if (s.length !== 4) return null;
		const i = s[1] * 1,
			c = s[2] * 1;
		if (!s[0] || !Number.isFinite(i) || !Number.isFinite(c)) return null;
		return { h: s[0], i, c, r: s[3] };
	}
	static mkChunk(h10, i, c, b64u) {
		return `~${h10}.${i}.${c}.${b64u}`;
	}
	// 認証系（§8.2: 認証前受理可は W/O/C）
	static isAuth(ir) {
		return IR_AUTH.includes(ir);
	}
	// データ系 ir（認証後に有効化）
	static isData(ir) {
		return !IR_AUTH.includes(ir) && Object.values(IR).includes(ir);
	}
	// p2p_file エンジンへ委譲する ir（Q/H/A/G）
	static isP2P(ir) {
		return ir === IR.Q || ir === IR.H || ir === IR.A || ir === IR.G;
	}
	// M フレームのページ分割（§7.4: 1 フレーム最大 64 エントリ）
	static pages(list, max = 64) {
		const out = [];
		for (let i = 0; i < list.length; i += max) out.push(list.slice(i, i + max));
		return out.length ? out : [[]];
	}
	// to フィルタ（broadcast 中継でのアプリ層宛先選択、§8.2）
	static forMe(o, uid) {
		return !o || !o.to || o.to === uid;
	}
}
