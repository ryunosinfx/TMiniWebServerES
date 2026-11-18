# ImageRoom Companion（ブラウザ拡張 + ネイティブホスト）

ImageRoom（`wwwroot/img_room.html`）の部屋へブラウザ拡張が**定時に自動ログイン**し、**一括 ZIP ダウンロード**を毎日実行、ダウンロードされた ZIP を**ネイティブホスト（Node）**が**指定ディレクトリへ展開**し、**SHA-256 による重複ファイル排除**と**最大 7 世代の世代バックアップ**（各世代は指定ディレクトリへ追加/更新コピーのみ実施。**削除は同期しない**）を行うセット。

仕様根拠: `docs/img_room_spec.md` §55（追加仕様 v2.28）。

## 構成

```
imgroomCompanion/
  manifest.json      … MV3。Chrome/Firefox 両対応（background に service_worker と scripts を二重宣言）
  bg.js              … 定期リロード・毎日の定時 job・DL 完了監視・ネイティブホスト起動
  content.js         … 参加フォームへの自動記入（isolated world）
  bridge.js          … window.__IRAPP 呼び出し用 MAIN world ブリッジ（CSP 安全・eval 不使用）
  options.html/js    … 設定 UI（モジュール）。QR PNG 復号=内蔵 jsQR・TMIWR1 取り込み・手動実行・ホストテスト
  jsqr/              … jsQR.es.min.nosjis.js + LICENSE（アプリ wwwroot/modules/jsQR と同一ビルド）
  native-host/
    host.mjs         … ZIP 解凍 + 重複排除 + 世代コピー（Node ≥ 18・依存パッケージ無し）
    install.mjs      … native messaging 登録マニフェストの生成/配置
```

## 仕様 ↔ 実装

| 要求 | 実装 |
| --- | --- |
| Chromium/Firefox 互換 | manifest V3 で共通。`background: {service_worker, scripts}` 二重宣言（Chrome は service_worker、Firefox は scripts イベントページを使用）。アラームは `dailyAt`（Chrome 専用）を使わず `when` + 毎再スケジュール。**MAIN world content_scripts は Chrome 111+ / Firefox 128+**。Firefox ≥115（gecko.id 付きで一時ロード可） |
| ブラウザの定期リロード | `reloadMin` 分ごと該当タブを `tabs.reload`（セッション維持）。リロード後は自動ログインが再開 |
| パスワード QR と特定のユーザー名で自動ログイン | 設定の「QR 画像」で PNG/JPG から**内蔵 jsQR**（`jsqr/jsQR.es.min.nosjis.js`、アプリと同一ビルド・MIT）で復号 — **Chrome/Firefox 共通**（BarcodeDetector 非依存）。または `TMIWR1:<部屋名b64url>:<パスワード>` テキスト貼り付けで部屋名+パスワードを取得。`userName` と共に参加フォーム（ir-nm/ir-uid/ir-pw）へ自動記入してログイン。URL hash（`#部屋名b64url`）があれば部屋名はそこから復元 |
| 毎日定時に一括 ZIP DL | `dailyTime`（HH:MM）のアラームで部屋タブを開き（必要なら）→ bulkDl()（アプリの「一括 DL」と同一、分割 ZIP `<部屋名>-YYYYMMDDHHMMSS-NNN.zip`）→ downloads API で完了収集 |
| 内容確認して指定ディレクトリへ展開・ハッシュ重複排除 | ネイティブホストが ZIP（method 0/8・UTF-8 名）を中央目录から解析、エントリを SHA-256 で照合し**内容重複は書き込まない**。不正パス（`..`・絶対パス）は拒否。`.imgroom-hashcache.json` にハッシュ台帳 |
| 最大 7 世代バックアップ・各世代指定ディレクトリ・削除同期なし | `extractDir → gen1 → … → gen7` の連鎖で**存在しない/内容が違うファイルだけをコピー**（削除・リネームの伝搬なし）。同一世代ディレクトリ内は上書きで現行状態、世代が浅い順に履歴が残る |

## インストール

### 1. ブラウザ拡張

- **Chromium**: `chrome://extensions` → 開発者モード →「パッケージ化されていない拡張機能を読み込む」→ このフォルダ（`imgroomCompanion/`）を選択。
- **Firefox**: `about:debugging#/runtime/this-firefox` →「一時追加機能を読み込む」→ `manifest.json` を選択（恒久化は署名が必要）。

### 2. ネイティブホストの登録

拡張を読み込んだ後、拡張 ID を控えて実行:

```bash
node native-host/install.mjs --browser chrome  --ext <chrome拡張ID>
node native-host/install.mjs --browser firefox --ext <firefox拡張ID>
```

配置先（install.mjs が自動選択、Windows はレジストリ登録）:

- Chrome(Linux): `~/.config/google-chrome/NativeMessagingHosts/com.imgroom.companion.json`
- Firefox(Linux): `~/.mozilla/native-messaging-hosts/com.imgroom.companion.json`

ホスト ID を変更する場合は設定 UI と `install.mjs --name` を一致させる。

### 3. 設定（拡張の「詳細」→「拡張の設定を開く」）

- 部屋の URL: ImageRoom の URL。**hash 付き（`#部屋名b64url` などアプリの URL QR そのもの）を推奨**
- ユーザー名 / パスワード: 自動ログインするアカウント（パスワードは QR 画像〔内蔵 jsQR で復号〕または TMIWR1: 貼り付けで入力可）
- 定期リロード 分 / 毎日定時 HH:MM
- 展開先ディレクトリ / 世代 1..7 ディレクトリ（空の世代はスキップ）

### 4. 動作確認

設定 UI の「ホスト接続テスト」→ `{ok:true, report:{written:0,…}}` が返ればホスト OK。
「今すぐ実行」で一括 DL → 展開 → 世代コピーが走ります。実行結果は「状態」に表示（`lastReport`）。

## 注意点

- ダウンロードファイル名パターン既定値: `-\d{14}-\d{3}\.zip$`（ImageRoom BulkDL 形式）。ブラウザの保存名に接頭辞が付く環境は設定で調整。
- ログイン失敗直後の「再試行ボックス」状態はログアウト→ホーム復帰から再試行します（spec §54 の既知 UX）。
- セットアップガイド表示（セットアップガイド）等の**ブラウザ UI を経由する手順は拡張からは操作できません**。QR 自動ログインを使うため設定は設定 UI で一度だけ行ってください。
- パスワードは拡張の `storage.local` に平文で保存されます（ローカル運用前提）。共用 PC では使用しないこと。
- 展開・コピーはネイティブホスト（Node）がブラウザと同じ権限で実行します。書き込み先権限に注意。

## テスト

- ホスト単体: `node native-host/host.mjs --cli '{"config":{"extractDir":"/tmp/cur","genDirs":["/tmp/g1"]},"zips":["/path/PICS-…-001.zip"]}'`
- E2E（Chromium・一時プロファイルでホスト登録まで自動）: `browserTest/tests/ext-companion.mjs`（開発リポジトリ内）。
