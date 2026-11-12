/** @module modules/auth_challenge.js @version 0.1.0 @see docs/img_room_spec.md */
// 部屋パスワード認証ユーティリティ（仕様 §4 用語 / §6.2 / §6.3 / §6.7、契約 impl_contracts.md auth_challenge 節）。
// 文字列結合の順序・区切りは仕様 §4・§6.2 と一字一句一致させる（相互運用上重要）。
// 仕様式は下記コメントへ一字一句転記。実行式は H.d が async なため Y.B2U( … ) の内側に await を補ったのみ
// （H.d の返却は base64url 文字列で、Y.B2U は base64→base64url 正規化＝b64url 入力では恒等）。
import { Y, H, crv } from '../Y.js';

// rounds 既定値 = ir_const CFG.HASH_ROUNDS（modules/* は imgroom/* を import できない共通ルールにより局所定義）
const DEF_ROUNDS = 10;

export class AuthChallenge {
	// §6.7: 通常/同期の期間ソルト = 現在 UTC 月 "YYYYMM"（UTC 月境界で全員強制ログアウト）
	static saltNormal(dateMs = Date.now()) {
		const d = new Date(dateMs);
		return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
	}
	// §6.7: サーバーモード参加日の "YYYYMMDD"（UTC。参加時に確定し room.json pwSalt へ保存）
	static saltServer(dateMs = Date.now()) {
		const d = new Date(dateMs);
		return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
	}
	// §6.2 転記:
	//   ho = Y.B2U(H.d(location.origin, HASH_ROUNDS)）（前: オリジンのハッシュ値）
	//   hor = Y.B2U(H.d([...location.origin].reverse().join(''), HASH_ROUNDS))（後ろ: 並び順を入れ替えたオリジンのハッシュ値）
	// origin は呼び出し側が location.origin を渡す（§6.2 検証 2 の oa マッチ判定は imgroom 側の責務）
	static async originHashes(origin, rounds = DEF_ROUNDS) {
		return {
			ho: Y.B2U(await H.d(origin, rounds)),
			hor: Y.B2U(await H.d([...origin].reverse().join(''), rounds)),
		};
	}
	// seedSaltedHash。§4 転記:
	//   Y.B2U(H.d(password + '|' + ridB64U + '|' + origin + '|' + salt, HASH_ROUNDS))
	// 再参加時は password の代わりに room.json 保管値（pw）を第一引数へ渡す（§6.2）
	// v2.11 §38: **origin を seed から除去**（旧式 §4: password|ridB64U|origin|salt）。旧式では参加側 location.origin が
	// seed に残るため、xorig=true の部屋でも別オリジン参加が §6.2 検証 3 で数学的に成立しなかった（§6.6 の意味を失う）。
	// オリジン統制は検証 2（ho/hor と oa/自オリジン照合）が担う。§4 新式: Y.B2U(H.d(password + '|' + ridB64U + '|' + salt, HASH_ROUNDS))
	// 再参加時は password の代わりに room.json 保管値（pw）を第一引数へ渡す（§6.2）
	static async seed(password, ridB64U, salt, rounds = DEF_ROUNDS) {
		return Y.B2U(await H.d(password + '|' + ridB64U + '|' + salt, rounds));
	}
	// 認証アテスト。§6.2 転記:
	//   at = Y.B2U(H.d(ho + '|' + seed + '|' + hor + '|' + uid + '|' + salt + '|' + anonce, HASH_ROUNDS))
	// seed は平文パスワードから計算した seedSaltedHash（§4 の式）そのもの。salt 不一致（期間ズレ）は一致し得ない（§6.2 検証 1）
	static async at({ ho, seed, hor, uid, salt, anonce }, rounds = DEF_ROUNDS) {
		return Y.B2U(await H.d(ho + '|' + seed + '|' + hor + '|' + uid + '|' + salt + '|' + anonce, rounds));
	}
	// §6.2: anonce は参加希望者が生成する 16B b64url の試行 ID（採決側は処理済み anonce をセッション中保持し重複 W を不 OK とする）
	static newAnonce() {
		return Y.u2U(crv(new Uint8Array(16)));
	}
	// §6.3 転記: crypto.getRandomValues(new Uint8Array(64)) → Y.u2B → Y.B2U → 86 文字の BASE64URL 文字列
	static async newPw(bits = 512) {
		return Y.B2U(Y.u2B(crv(new Uint8Array(bits >> 3))));
	}
}
