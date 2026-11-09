/** @module modules/imgroom/ir_const.js @version 0.1.0 @see docs/img_room_spec.md */
// ImageRoom 定数（仕様 §11 設定既定値、§8.2 ir 種別、§10 ストレージ相対パス、§7.3 rid）
import { Y, H } from '../../Y.js';

// 仕様 §11 の既定値。user_settings.json とマージされ、AppSettings.cfg が正（本オブジェクトは既定値のみ）
export const CFG = {
	GRID_COLS: 4,
	GRID_ROWS: 8,
	THUMB_PX: 96,
	SHEET_FMT: 'image/jpeg',
	SHEET_Q: 0.72,
	CHUNK_RAW: 8192,
	CHUNK_GAP_MS: 100,
	IN_TRANSFERS: 1,
	OUT_TRANSFERS: 2,
	REQ_TIMEOUT: 8000,
	STALL_MS: 10000,
	MAX_RETRY: 2,
	SHEET_BCAST_MIN_MS: 30000,
	SHEET_JITTER_MS: 10000,
	TRASH_KEEP_DAYS: 30,
	ZIP_CHUNK_MB: 10,
	CAL_WINDOW_PAGES: 3,
	MAX_IMG_BYTES: 2 * 1024 * 1024,
	HASH_ROUNDS: 10,
	PW_BITS: 512,
	CAL_VIEW: 'month',
	QR_SIZE_PX: 256,
	QR_CORRECT_LEVEL: 'H',
	QR_VERIFY_RETRY: 8,
};

// フレーム種別（仕様 §8.2 表と一致）
export const IR = {
	W: 'W', // 参加要求（認証前可）
	O: 'O', // 認証採決
	C: 'C', // 部屋設定通知
	J: 'J', // 参加告知
	B: 'B', // 退出告知
	M: 'M', // インベントリ manifest（シート索引を含む、§7.4）
	S: 'S', // シート転送開始ヘッダ
	T: 'T', // シート取得要求
	Q: 'Q', // 本体取得要求
	H: 'H', // 本体転送開始ヘッダ
	A: 'A', // 応答ステータス ok|nf|busy
	G: 'G', // chunk 再送要求
	X: 'X', // 画像削除通知
};

// 認証系 ir（認証前に受理/送出可、§8.2）
export const IR_AUTH = ['W', 'O', 'C'];

// OPFS 相対パス（'imgroom' ハッシュルート直下、仕様 §10）
export const STORAGE = {
	rooms: 'rooms',
	bodies: 'bodies',
	meta: 'meta',
	userFile: 'user_settings.json',
	stateFile: 'app_state.json',
	roomFile: rid => `rooms/${rid}/room.json`,
	manifest: (rid, uid) => `rooms/${rid}/manifest.${uid}.json`,
	history: rid => `rooms/${rid}/history.json`,
	autodl: rid => `rooms/${rid}/autodl.json`,
	sheet: (rid, uid, idx, h) => `rooms/${rid}/sheet/${uid}_${idx}.${h}`,
	sheetDir: rid => `rooms/${rid}/sheet`,
};

// 仕様 §7.3:
// rid = Y.B2U(H.d(部屋名, 4) 先頭16文字 + '-' + Y.B2U(部屋名b64url 先頭16文字))
export const ridOf = async nameB64U => {
	const h4 = await H.d(Y.U2u(nameB64U), 4); // 部屋名バイト列を 4 回スクラム（b64url 文字列返却）
	return h4.slice(0, 16) + '-' + Y.B2U(nameB64U.slice(0, 16));
};

// 仕様 §9.6/§5.1: QR 経由での部屋指定は #<部屋名b64url>。rid はここで再計算
export const wsUrl = rid => `${location.origin}/ws/chat/${rid}`;

// 仕様 §6.4 QR ペイロード: TMIWR1:<ridB64U の代わりに部屋名b64url>:<password>（ASCII のみ）
export const QR_PREFIX = 'TMIWR1:';
export const qrPack = (nameB64U, pw) => `${QR_PREFIX}${nameB64U}:${pw}`;
export const qrUnpack = s => {
	if (!s || !s.startsWith(QR_PREFIX)) return null;
	const rest = s.slice(QR_PREFIX.length);
	const i = rest.indexOf(':');
	if (i < 1) return null;
	return { nameB64U: rest.slice(0, i), pw: rest.slice(i + 1).replace(/ +$/, '') }; // 末尾スペースは検証ループ由来なので除去（§6.4）
};
