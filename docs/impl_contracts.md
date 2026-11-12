# ImageRoom 実装契約（モジュール間インターフェース固定）

対象仕様: [img_room_spec.md](img_room_spec.md)（v1.0）。この契約は**モジュール間の結合点のシグネチャのみ**を固定する。内部実装・フレーム詳細は仕様書本文に従う（仕様と矛盾した場合は仕様書が優先、その旨を報告すること）。

## 共通ルール

- 配置: `wwwroot/modules/`（共用）と `wwwroot/modules/imgroom/`（固有）。ファイル名 snake_case。
- ESM。import は相対パス + `.js` 拡張子必須（bundler / import map 不使用）。既存ユーティリティは `../Y.js` / `../Vw.js` / `../OPFS.js` / `../const.js` として import する。
- 依存方向: `modules/*` は `modules/imgroom/*` を import しない。imgroom 内は `./xxx.js`。
- 各ファイル冒頭コメント: `/** @module <path> @version 0.1.0 @see docs/img_room_spec.md */`
- コードスタイル: タブインデント、既存 wwwroot/*.js に合わせる（極力短い命名、コメント日本語可）。
- 対応ブラウザ: 2023 年以降の Firefox / Chrome / Safari。`structuredClone`・optional chaining・`??`・クラス静的メソッドは可。**top-level await は使わない**（`.then`/async 関数で）。Worker は使わない。
- 例外処理: `Y.js` の `err()`/`ef()` でログし、UI へはコールバックで伝搬。暗黙の握りつぶし禁止。
- テスト容易性: DOM/ネットワークを触るクラスは依存（transport, cfg）をコンストラクタ注入可能にする。

## 既存 API（復習・変更禁止）

- `Y.js`: `H.d(msgOrU8, sc=1, algo='SHA-256', isAB=false)` → **base64url 文字列**（isAB=true で ArrayBuffer）。`Y.s2u/u2s/B2U/U2B/u2U/U2u/a2U/a2B/u2B/U2a/B2a/as(ab,s,e)/jus/jud/c(gzip)/d(gunzip)` すべて async か即値かは既存実装どおり。`gBl(b)`, `now()`, `crv(u8)`, `io/w/err/ef`, `T/F/N/E`。
- `OPFS.js`: `OPFS.i(name)` 初期化（ハッシュルート）、`OPFS.rd` 初期化 Promise、`OPFS.w(path, ab)/r(path)`（root 相対）、`x(n,ab,i)/y(n,h)/rmh(n,h)/rmf(p)/mkFile(p)/isEf(p)/ls(p,i)`。
- `Vw.js`: `Vw.add/ce/gi/rm/rc/sS/sT/click/change/copy/fr` 等。`C` クラスはスタイル定数。
- `const.js`: `cmds={CHAT:'C',ENTER:'E',LEAVE:'L'}`, `names`。

---

## 共用モジュール（wwwroot/modules/）

### ws_client.js — `export class WSClient`
```
new WSClient({ url, userId, cmds=cmds(from ../const.js), reconnectMs=[1000,2000,4000,8000,16000] })
  .connect()            -> Promise<void>   // open 完了で resolve。open 時に ENTER 自動送信
  .chat(msgStr)         // envelope {cmd:CHAT, userId, msg}
  .leave()              // LEAVE 送信後 close（意図的切断: 再接続しない）
  .close()              // 意図的切断
  .isOpen               // getter boolean
  .onOpen=fn .onMessage=fn(dataStr) .onClose=fn({intentional}) .onRetry=fn(n, delayMs)
```
- 再接続は `reconnectMs` 指数バックオフ、`leave()/close()` 以降しない。open 時に `onRetry` リセット。

### store_tx.js — `export class StoreTX`
```
StoreTX.run(name, fn) -> Promise<any>  // name 単位のクロスタブ排他で fn() を実行（FIFO）
StoreTX.release(name)                  // 明示解放（セッション権放棄用）
```
- 主機構 `navigator.locks.request(name, fn)`。非対応時: BroadcastChannel `dsh.stx.<name>` ハートビート選出（2s 宣言 / 6s 失効、タブ固有 `tabId = Y.B2U(await H.d(String(now)+random,4))` の文字列比較で最小が優先宣言）。詳細は仕様 §11.1。
- Web Locks 対応判定は `!!navigator.locks`。

### app_settings.js — `export class AppSettings`
```
AppSettings.init(defaults) -> Promise<void>   // OPFS.i('imgroom') 呼び出し後。user_settings.json / app_state.json を読み既定値とマージ
AppSettings.cfg   // 同期取得: user_settings のマージ済みオブジェクト（変更しないこと。変更は set 経由）
AppSettings.state // 同期取得: app_state
AppSettings.set(key, value)        -> Promise<void>  // 500ms debounce、StoreTX.run('user_settings', ...) 内で read-modify-write
AppSettings.setNested(path, value) -> Promise<void>  // path 例 'MODE.roomA'（ドット区切り）
AppSettings.setState(key, value)   -> Promise<void>  // 同様に app_state 側（'roomLogin.<rid>', 'MODE.<rid>', 'lastSweep'）
AppSettings.flush()                -> Promise<void>
```
- JSON ファイルは OPFS ルート直下（ファイル名は `user_settings.json`, `app_state.json` 固定）。読込失敗/不存在は既定値。

### auth_challenge.js — `export class AuthChallenge`
```
AuthChallenge.saltNormal(dateMs = Date.now()) -> "YYYYMM"    // UTC
AuthChallenge.saltServer(dateMs = Date.now()) -> "YYYYMMDD"  // UTC（参加日）
AuthChallenge.originHashes(origin, rounds) -> Promise<{ho, hor}>   // hor は文字列反転のハッシュ
AuthChallenge.seed(password, ridB64U, salt, rounds) -> Promise<b64url> // 仕様 §4 の seedSaltedHash（v2.11 §38 で origin 除去）
AuthChallenge.at({ho, seed, hor, uid, salt, anonce}, rounds) -> Promise<b64url> // 仕様 §6.2
AuthChallenge.newAnonce() -> b64url        // 16B 乱数
AuthChallenge.newPw(bits = 512) -> Promise<b64url string>    // 仕様 §6.3
```
- 文字列結合の順序・区切りは仕様 §4/§6.2 と**一字一句一致**させる（相互運用上重要。実装後、仕様式をコメントに転記すること）。

### p2p_file.js — `export class FileTransfer`
仕様 §8.2〜8.6, §9.3〜9.4 準拠。フレーム（`Q,H,A,G,X?` と `~h.i.c.r`）の生成・解析はこのモジュール内部に閉じる（imgroom は生文字列を feed するだけ）。
```
new FileTransfer({
  send: fn(strFrame)->boolean,          // transport 注入（broadcast 前提。unicast 不可）
  cfg: {CHUNK_RAW, CHUNK_GAP_MS, IN_TRANSFERS, OUT_TRANSFERS, REQ_TIMEOUT, STALL_MS, MAX_RETRY, HASH_ROUNDS},
})
  .feed(frameStr, fromUid)              // 受信フレーム供給（Q/H/A/~chunk/G を判別して処理、他は無視して false）
  .provide(h10, fromUid, size, mime, comp) // 提供要求 Q 受信時にエンジン内部から呼ばれる差し出し: 保持本体を返す
  // 応答側フック:
  .onNeedBody = fn(h10, fromUid) -> Promise<ArrayBuffer|null>  // null=保持せず(nf)。throw=busy
  // 取得側 API:
  .fetch({h10, holders:[uid...]}) -> Promise<ArrayBuffer>      // 1 ファイルずつ直列（IN_TRANSFERS）。ラウンドロビン選択、ウォッチドッグ、G 再送、失敗時 Error
  .cancel(h10)                            // 消滅破棄（§9.9）
  .onProgress = fn(h10, receivedBytes, totalBytes)
  .onFetchDone = fn(h10, ab) / .onFetchFail = fn(h10, reason)
```
- gzip: `Y.c/Y.d`（comp フラグで gzip ⇄ raw、伸長後に h10 検証）。chunk: `CHUNK_RAW` スライス → `Y.u2U`。

### hash_store.js — `export class HashStore`
```
new HashStore()                 // OPFS ルート（'imgroom' ドメイン）下の bodies/ meta/ を使う
  .put(ab) -> Promise<h10>            // bodies/<h10> へ（既存があれば何もしない）。h10 = Y.B2U(H.d(ab, rounds))（rounds は cfg）
  .get(h10) -> Promise<ArrayBuffer|null>
  .has(h10) -> Promise<boolean>
  .rm(h10) -> Promise<void>           // bodies 削除（メタは消さない）
  .metaPut(metaObj) / .metaGet(h10) -> obj|null / .metaAll() -> [obj]   // meta/<h10>.json
  .listTrash(nowMs, keepDays) -> [meta with d]      // d = ゴミ箱入時刻 ms
  .sweep(nowMs, keepDays) -> {deleted:[h10]}        // 期限切れ meta + 参照ゼロ bodies 削除
  .sizesOf(h10s:[..]) -> Promise<{bytes, count}>    // bodies+meta 実測（estimate 併用可）
  .usage() -> Promise<{bodies:{bytes,count}, sheets:..., meta:...}>
```

### img_proc.js — `export class ImgProc`, `export class SliceCache`
```
ImgProc.load(blob) -> Promise<ImageBitmap|HTMLImageElement>   // createImageBitmap 優先
ImgProc.thumb(blob, px) -> Promise<Blob jpeg>                  // center-crop 正方形 → px
ImgProc.collage(cellBlobs[], cols, rows, px, q) -> Promise<Blob jpeg>  // 空スロットは白
ImgProc.slice(sheetBlob, cols, rows, px, q) -> Promise<Blob[]>
ImgProc.ab2blob(ab, mime) / ImgProc.blob2ab(blob)
SliceCache: set(key, blob)->objectURL, get(key)->url|null, release(key), releaseAll()
```

### qr_tool.js — `export class QRTool`（qrcode.es.min.js + jsQR のラッパー。外部 2 モジュールはここ以外 import 禁止）
```
QRTool.make(text, {size=256, level='H', retry=8}) -> Promise<{canvas, data(finalText), passes, failed:boolean}>
  // 生成 → canvas.getImageData() → jsQR 照合 → 不一致なら text+' ' 再エンコード（§6.4）
QRTool.verifyCanvas(canvas) -> Promise<{ok:boolean, data:string|null}>
QRTool.pngBlob(canvas) -> Promise<Blob>
```
- 生成 API は `modules/qrcode.es.min.js` の実際の export を読んで使用（README 同梱。`CanvasQRCode` 等）。復号は `./jsQR/jsQR.es.min.nosjis.js` の `jsQR(data,width,height)`。

### qr_scan.js — `export class QRScan`
```
QRScan.imageFile(file) -> Promise<{data:string}|{error:string}>      // png/jpg → canvas → jsQR
QRScan.canCamera() -> boolean            // secure context & getUserMedia
QRScan.camera(onFound:string->void) -> {stop:fn} | {error:string}    // 非 secure/権限拒否は error を返す（呼び出し側がフォールバック UI）
QRScan.text(s) -> string                 // ペースト文字列そのまま（TMIWR1: 検証は呼び出し側）
```

### zip.js — `export class ZipBuilder`, `export function crc32(u8)`
```
new ZipBuilder()
  .add(name, data:Blob|ArrayBuffer|string)   // UTF-8 名。bit11 + 0x7075 extra field（§9.10）
  .build() -> Promise<Blob>                  // deflate-raw 対応なら DEFLATE/STORE 小さい方、非対応は STORE
```

### app_settings 以外に状態ファイルを書くもの
- `rooms/<rid>/room.json`, `manifest.<uid>.json`, `history.json`, `autodl.json`, `sheet/<...>`, `bodies/<h10>`, `meta/<h10>.json` → 全て `OPFS.w/r` 直（store_tx 不要。単一セッション所有者タブのみが書く、§9.12）。

### virt_list.js — `export class VirtList`
```
new VirtList({ container, page(px), winPages=3, count()->n, render(i)->HTMLElement, onWindow? })
  .refresh()   // 再計算（count 変化時）
  .destroy()
```
- スクロールで窓 ±1 ページ進め、窓外 DOM は削除（§5.5, §9）。

### cal_view.js — `export class CalView`
```
new CalView({ parent, mode='month', items=[{ts,...}], renderItem(item)->HTMLElement, onPage? })
  .setMode('day'|'week'|'month') .setItems(items) .refresh() .destroy()
```
- 現在基準降順・日別バケット・セル内は呼び出し側が renderItem（VirtList 併用は呼び出し側、仕様 §5.5）。

### widgets.js — `export function Toggle({parent,label,onChange}) -> {el, set(b), get()}` ほか
```
Toggle, Progress({parent}) -> {el, set(0..1), text(s)}, Badge(parent, cls, textStr) -> el,
Toast(msg, ms=4000) -> void (body 固定オーバーレイ), useLabel(bytes) -> "1.2 MB" 形式文字列
```
- 文言は `I18N.t()` を使うものは key を受け取る（文言ハードコード禁止）。

### i18n.js — `export class I18N`
```
I18N.init(lang) -> Promise<void>     // lang: 'auto'|'ja'|'en'。packs: ./locales/ja.js,en.js（動的 import、既定読み込み済み可）
I18N.lang -> 'ja'|'en'               // 解決済み言語
I18N.setLang(lang) -> Promise<void>  // 'auto' は navigator.language で解決（ja→ja、それ他→en）
I18N.register(packObj)               // アプリ固有キーの追加（imgroom 用、ja/en 両方）
I18N.t(key, params?) -> string       // 欠落キーは '⚠key' + console.warn。params は {name} 置換
I18N.onChange = fn                   // 言語切替時の再描画回调
```
- `locales/ja.js`, `locales/en.js`: `export default { key: '...' }`。**キー一覧は契約附表 A に統一**（両言語で同一キー集合必須）。

---

## imgroom 固有（wwwroot/modules/imgroom/）

### ir_const.js
```
export const CFG = { GRID_COLS:4, GRID_ROWS:8, THUMB_PX:96, SHEET_FMT:'image/jpeg', SHEET_Q:0.72,
  CHUNK_RAW:8192, CHUNK_GAP_MS:100, IN_TRANSFERS:1, OUT_TRANSFERS:2, REQ_TIMEOUT:8000, STALL_MS:10000,
  MAX_RETRY:2, SHEET_BCAST_MIN_MS:30000, SHEET_JITTER_MS:10000, TRASH_KEEP_DAYS:30, ZIP_CHUNK_MB:10,
  CAL_WINDOW_PAGES:3, MAX_IMG_BYTES:2*1024*1024, HASH_ROUNDS:10, PW_BITS:512, CAL_VIEW:'month',
  QR_SIZE_PX:256, QR_CORRECT_LEVEL:'H', QR_VERIFY_RETRY:8 }
export const IR = { W:'W', O:'O', C:'C', J:'J', B:'B', M:'M', S:'S', T:'T', Q:'Q', H:'H', A:'A', G:'G', X:'X' }
export const STORAGE = { rooms:'rooms', bodies:'bodies', meta:'meta', userFile:'user_settings.json', stateFile:'app_state.json',
  roomFile:rid=>`rooms/${rid}/room.json`, manifest:(rid,uid)=>`rooms/${rid}/manifest.${uid}.json`,
  history:rid=>`rooms/${rid}/history.json`, autodl:rid=>`rooms/${rid}/autodl.json`,
  sheet:(rid)=>`rooms/${rid}/sheet` }
export const ridOf = nameB64U -> Promise<rid>       // 仕様 §7.3 の式（Y.u2B(H.d(name,4)) 先頭16 + '-' + B2U(name b64url 先頭16)）
export const wsUrl = rid => `${location.origin}/ws/chat/${rid}`
```

### ir_protocol.js — `export class Protocol`
```
Protocol.mk(ir, obj) -> string            // {ir, ...obj} JSON（キー順固定）
Protocol.parse(str) -> obj|null           // JSON object の ir 文字列チェックのみ（Q/H/A/G/~ は p2p_file 転送用に {raw, uid?} ではない: 生文字列のまま呼び出し側で feed）
Protocol.isData(ir) / Protocol.isAuth(ir) / Protocol.chunk(str) -> {h,i,c,r}|null
Protocol.mkChunk(h10, i, comp, b64u) -> string
Protocol.pages(mEntries, max=64) -> [[...]]  // M フレームページ分割（仕様 §7.4）
```
- 各フレームの payload キー（`J{uid,gen}`, `B{uid}`, `M{rid,uid,idx,total,sheets:[{i,h}],grid}`, `S/T`, `X{h,by}` 等）は**仕様 §8.2 表と §7.4 の JSON 例に完全一致**させる。W/O/C の payload は仕様 §6.2/§6.6/§6.8（`C` に `srvOn`, `W` に `mode`,`salt` 含む）。

### room_session.js — `export class RoomSession`
仕様 §6, §8.2, §9.1, §9.7, §9.12, §6.7〜6.9 準拠。セッション所有者/ミラーの選出は `StoreTX`（lock name: `room.<rid>`）+ BC `imgroom.session.<rid>`。
```
new RoomSession({ rid, room:{nm,pw?,pwSalt?,srvOn,cr,cg,xorig,oa}, uid, mode:'normal'|'keep'|'sync'|'server', // keep=通常（取得保持）v2.13 §40、salt 等は normal と同一
                  settings(AppSettings), transfer(FileTransfer) })
  .login({password?, seed?, salt, mode}) -> Promise<boolean>   // W 送信→全採決 OK で true。seed 既定は pwSalt が有効期間内なら room.json 保管値
  .rejoin() -> Promise<boolean>                                 // §9.12 自動再参加（pwSalt 期間内のみ）
  .leave()                                                      // LEAVE + state.roomLogin null 化 + transfer 停止
  .state -> {online:bool, authed:bool, participants:[{uid,t}], mode, mirror:bool}
  .on(evt, fn)/.off(evt, fn)   // evt: 'open','close','authOk','authFail(reason)','participants','conflict','srvOff','monthExpire','mirror','takeover'
  .sendFrame(objOrStr)          // 所有者のみ実送信。ミラーは BC 委譲
  .seenAnonce(s) -> boolean     // 処理済み anonce 判定（メンバー側）
```
- 月境界タイマ（通常/同期）: 検知→`leave()` + `on('monthExpire')`。`srvOn=false` の `C` 受信で mode=server なら強制ログアウト。`C` の cr/pw 不一致→`conflict`（§6.9）。room.json 読み書き・history.json 更新は所有者タブのみ。
- ミラータブ: 状態スナップショット（参加者・auth 状態）を BC で受信し `state`/イベントを再現、操作は `sendFrame` 委譲。

### sheet_room.js — `export class SheetRoom`
仕様 §9.2 準拠。
```
new SheetRoom({ rid, uid, store(HashStore), img(ImgProc), cfg, sendFrame })
  .rebuild(manifestEntries) -> Promise<void>  // 投稿時刻降順→32 コマ/シート→collage→bodies 相当 OPFS 保存（sheet/ 配下 <uid>_<idx>.<h10>）
  .diffMine(genPeers) -> pages[]              // M ページ（送信済み差分）
  .onM(mframe, fromUid) -> Promise<void>      // 受信→差分計算→p2p_file でシート本体交換→スライス保存→'sheets' イベント回调
  .on('sheets', fn(uid, idx, sliceBlobs[]))
```

### collection.js — `export class Collection`
仕様 §7, §9.5, §9.8, §5.5 グレースケール判定, §9.9 除外。
```
new Collection({ rid, uid, store(HashStore), session(RoomSession) })
  .share(file Blob) -> Promise<{h10}>        // §9.1: 上限/検証/metaPut(rid マージ)/put/manifest 更新/M broadcast（スロットル）
  .addRid(h10, ridB64U) / .manifest() -> entries[]（自端末）
  .roomItems() -> [{h10, meta, mine, trashed, holders:[uid], offlineHolders:boolean}]  // 表示用
  .trash(h10) / .restore(h10) / .purge(h10) / .trashList() / .emptyTrash() / .sweepIfNeeded()
  .onDeleteX(xframe)                          // meta r から当該 rid 除去、自房削除通知
  .isTrashed(h10)
  .adopt(metaObj) -> boolean            // v2.13 §40: 既存 meta を自房 manifest に採用（keep 取得後。重複時 false）
```

### room_calendar.js — `export class RoomCalendar`
仕様 §5.5: CalView + VirtList 窓 + スライス表示 + 取得インジケーター + グレースケール + クリック→本体取得。
```
new RoomCalendar({ parent, cfg, cal(CalView), slices(SliceCache), collection, transfer, session, keep, afterBody }) // keep/afterBody v2.13 §40: 本体取得のローカル優先+取得後永続化フック
  .setItems(items)  // collection.roomItems()
  .fetchBody(h10)   // 優先度付き（ユーザー操作）→ transfer.fetch → viewer 表示
  .refresh()
```

### sync_mode.js — `export class SyncMode`
仕様 §9.9（ゴミ箱除外）, §5.7（autodl）。
```
new SyncMode({ rid, uid, collection, transfer, session, settings, footerEls })
  .enable(bool) / .enabled
  .onManifestUpdate()          // 未所持キュー再構築（投稿時刻降順、ゴミ箱/所持除外、autodl 台帳照合）
  .pump()                      // 順次取得（IN=1）。ユーザー操作優先。フッター進捗（対象数/取得数）
  .autodlEnable(bool) / .autodlClear() / .autodlCount()   // autodl.json 台帳
```

### bulk_dl.js — `export class BulkDL`
仕様 §9.10: `new BulkDL({collection, cfg})` → `.run() -> Promise<{files:[{name,blob}]}>`（10MB 分割、命名 `<roomB64U><yyyyMMddhhmmss>-<連番>.zip`、UTF-8 名 ZIP）。

### room_app.js — `export class RoomApp`（entry point）
```
new RoomApp() .boot() // window.onload から呼ぶ
```
- 起動順: `OPFS.i('imgroom')` → `AppSettings.init(CFG)` → `I18N.init(state LANG)` → i18n pack 登録（`./locales.js` に ja/en 辞書同梱可）→ ヘッダー（使用量/モード/言語/ゴミ箱/一括DL）→ ルーム一覧（ホーム）または hash 部屋指定ならログイン画面 → 認証後タブ + RoomSession/各モジュール生成。
- URL クエリ上書き: `GRID_COLS/GRID_ROWS/CAL_VIEW` のみ（非永続）。
- `img_room.html` は最小構成: `<script type="module">import {RoomApp} from './modules/imgroom/room_app.js'; new RoomApp().boot()</script>` に相当する 1 行。

---

## 附表 A: i18n キー（最低限・両言語必須）

app.title / hdr.usage / hdr.mode.normal / hdr.mode.sync / hdr.mode.server / hdr.lang / btn.trash / btn.bulkdl / btn.logout / btn.login / btn.create / btn.qr / btn.pw.issue / btn.oa.manage / btn.srv.toggle / lbl.username / lbl.password / lbl.mode / msg.auth.waitMembers / msg.auth.fail / msg.auth.noMember / msg.auth.srvDisabled / msg.creator.otherAdmin / msg.room.recreated / msg.conflict.blocked / msg.month.expire / msg.offline / msg.fetch.progress({n},{m}) / msg.fetch.fail / msg.share.tooBig / msg.share.ok / lbl.trash.empty / btn.trash.purge / btn.trash.empty / msg.trash.sweep / lbl.sync.footer({total},{fetched}) / btn.autodl / btn.autodl.clear / msg.autodl.cleared / lbl.participants / lbl.pastParticipants / lbl.opfs.total / lbl.opfs.room / msg.offline.gray / msg.zip.part({n}) / msg.qr.verify.fail / msg.scan.cameraUnavail / msg.scan.paste / msg.settings.saved

実装で追加キーが必要な場合: **ja/en 両方に同時追加**し、追加キー一覧を実装報告に含めること。

## 実装報告ルール（各担当）

1. 担当ファイル一覧と行数
2. この契約からの逸脱（あれば理由と、仕様/契約のどちらを合わせたか）
3. 追加 i18n キー一覧
4. 未実装の TODO とその理由
