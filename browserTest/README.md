# browserTest — WebブラウザJS動作確認ハーネス

Playwright（ヘッドレスブラウザ）で `../wwwroot` のクライアントJSを**実ブラウザ**で動かし、
コンソールログ・WebSocketフレーム・DOM表示・スクリーンショットで検証するテスト環境です。
サーバー実装（`TMiniWebServerES/`）は変更せず、Node dev版サンプルサーバーに対して実行します。

## 動作確認済み環境（2026-11-08 現在）

### OS / ハードウェア

| 項目 | 値 |
|---|---|
| OS | Ubuntu 24.04.5 LTS (x86_64) |
| カーネル | 6.8.0-147-generic |
| ディスプレイ | 不要（完全ヘッドレス。X/Wayland 不要） |
| メモリ | 推奨 2GB 以上（multi プロファイルテストは 3 コンテキスト同時起動） |

### ミドルウェア / 各バージョン

| 項目 | バージョン | 備考 |
|---|---|---|
| Node.js | v26.13.0（確認値。最小 20 LTS 推奨） | ESM・クラス static フィールド等を使用 |
| npm | 11.20.0 | |
| Playwright | 1.65.0 | `./node_modules` に devDependency（約19MB） |
| Chromium (Playwright同梱) | **158.0.8127.18**（ビルド r1254） | `chrome` と `headless_shell` の2種 |
| Firefox (Playwright同梱) | **159.0**（ビルド r1572） | `/usr/bin/firefox` ではない |
| ffmpeg (Playwright同梱) | r1013 | 自動導入・未使用 |
| fonts-noto-cjk | 1:20230817+repack1-3 | `label` テストの日本語描画に必須（`sudo apt install fonts-noto-cjk`） |

### ストレージ（実測）

| パス | サイズ | 内容 | gitignore |
|---|---|---|---|
| `../.playwright-browsers/` | **約1.0GB**（1,017MB） | Chromium + headless shell + Firefox + ffmpeg | ✓ |
| `./node_modules/` | 約19MB | playwright 本体 | ✓ |
| `./out/` | 実行毎に数MB | スクリーンショット・生成PNG | ✓ |
| `./.ff-home/` `.ff-tmp/` `.ff-run/` | 数十MB | Firefox のプロファイル/キャッシュ退避先（自動作成） | ✓ |

合計で **約1.1GB の空き容量**が必要。

## セットアップ手順

```bash
# 0. (クリーンなUbuntuの場合) 日本語フォントとブラウザシステム依存
$ sudo apt install fonts-noto-cjk
$ npx playwright install-deps chromium firefox   # 依存ライブラリが欠けている場合のみ

# 1. テストハーネスの依存導入（このフォルダで）
$ cd browserTest
$ npm install

# 2. ブラウザのダウンロード（repo直下の .playwright-browsers/ に共有配置）
$ npm run install-browser
```

### テスト実行の手前に: サーバー起動（重要: cwd は内側の `TMiniWebServerES/`）

`SampleServer.js` は wwwroot を **cwd 相対の `../wwwroot`** で解決するため、
必ず内側の `TMiniWebServerES/` ディレクトリで起動します（ルートスクリプト `npm run server` と同じ）。

```bash
cd ../TMiniWebServerES
node ./SampleServer.js start        # ポート 8080 で起動
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/ws_chat2.html   # 200 が確認できれば OK
```

> 誤ってリポジトリルートから起動すると `../wwwroot` が見つからず全ページ 404 になります。

## テスト一覧と実行方法

`npm run <script>`（`PLAYWRIGHT_BROWSERS_PATH` はスクリプト内に設定済み）。
`:ff` 接尾は Firefox 実行。合格時は最終行に `OK (<engine>)`、失敗時は exit 1。

| script | テストファイル | 内容 / 検証点 |
|---|---|---|
| `smoke` | `tests/smoke.mjs` | `ws_test.html` の WS エコー（`/ws/test`）。DOM に `Hello,world!! …` 表示＋フレーム送受信 |
| `multi` | `tests/multi-profile-chat.mjs` | `ws_chat.html` を**3つの独立ブラウザプロファイル**で入室/投稿/退室。プロファイル間の相互中継と入室通知の到達範囲を検証 |
| `fileshare` | `tests/ws-chat2-fileshare.mjs` | `ws_chat2.html` の**ファイル共有端到端**。A→B にチャンク配送→gunzip→**OPFS保存→読み戻しサムネイル**表示、ログ汚染なし |
| `label` | `tests/ws-chat2-label-test.mjs` | 「テスト yyyy-MM-dd-hh-mm-ss」PNG（`tools/make-label-png.mjs` で生成）を**双方でログイン＋相互送信＆受信**。全受信画像の**SHA-256が原本と一致**（無損失証明） |

```bash
npm run smoke        # / smoke:ff
npm run multi        # / multi:ff
npm run fileshare    # / fileshare:ff
npm run label        # / label:ff
```

手動実行する場合:

```bash
PLAYWRIGHT_BROWSERS_PATH=../.playwright-browsers BROWSER=firefox node tests/label.mjs ...
```

### 環境変数

| 変数 | 既定値 | 意味 |
|---|---|---|
| `BROWSER` | `chromium` | エンジン選択（`chromium` / `firefox`） |
| `BASE_URL` | `http://127.0.0.1:8080` | 対象サーバー。**Pico W 実機に向けると実機検証に流用可**（`http://192.168.x.x:8080`）。ただし OPFS は secure context 必須のため、http 実機 IP では `fileshare`/`label` の保存部はスキップ不可（動作不可） |
| `PLAYWRIGHT_BROWSERS_PATH` | （設定必須） | 共有ブラウザ配置先 `../.playwright-browsers` |

成果物: `out/<テスト>_<engine>.png`（スクリーンショット）、`out/label-<時刻>.png`（生成PNG）、
テスト詳細 JSON は stdout に出力（`sha256` 一致判定を含む）。

実行時間の目安: smoke 5〜10秒 / multi 15秒 / fileshare 20〜30秒 / label 25〜40秒（Firefox はやや遅い）。

## 実装上の注意・既知の挙動

### サーバー側（実装を変えずに運用する前提）

- **cwd 依存**: 静的配信ルートは起動 cwd に依存（上記）。
- **1メッセージ上限 16KB**（`TMiniWebServerES.js` の `MAX_MSG_SIZE`）: クライアントのチャンクは
  base64url 展開込みで収まるよう **8KiB** に設定してある（ws_chat2.js の `US`）。
- **他クライアントへの中継は chat（cmd `C`）の msg 文字列のみ**: ファイル共有のヘッダ/チャンクは
  すべて `{cmd:'C', msg:...}` にラップして送信する設計（ws_chat2.js 冒頭コメント参照）。
- **Node dev版の終了時クラッシュ**: ブラウザを「退室」せずに強制終了すると、切断済みソケットへ
  送信して `ECONNRESET` 未処理でプロセスが停止することがある。テストは終了前に必ず
  **「退室」クリック**して回避している（Kaluma 実機では問題にならない経路）。

### Firefox 実行時の注意

- 書き込み先（`~/.cache/mozilla` 等）制約がある環境では、`tests/lib.mjs` が
  `HOME`/`TMPDIR`/`XDG_CACHE_HOME`/`XDG_RUNTIME_DIR` を当フォルダの `.ff-*` へ自動リダイレクトする。
  `GSETTINGS_BACKEND=memory` で dconf 書き込みも回避。
  `Sandbox: CanCreateUserNamespace() ... EPERM` は**警告であり起動は継続**する（AppArmor の
  userns 制限があるホストで発生）。
- **ヘッドレス Firefox では `navigator.storage.persist()` が解決しないことがある**
  （ハング）。`wwwroot/OPFS.js` 側でタイムアウト付き race により既に吸収済み。
- **既知の計測上の癖**: 非既定コンテキスト（`newContext()`）では Firefox の
  `page.on('websocket')` フレーム本文が取得できないことがある。
  `tests/lib.mjs` はページへ注入した `WebSocket` ラッパーログ（`window.__wsLog`）を
  フレーム本文の正文として使用する（Chromium/Firefox 共通）。

### OPFS / secure context

- `ws_chat2.html` のファイル保存（OPFS）は **secure context（localhost / 127.0.0.1 / HTTPS）必須**。
  LAN 上の `http://192.168.x.x` 直呼びではチャットのみ動作し、保存・読み戻し部は作動しない。

## テストの追加方法

`tests/*.mjs` を追加し、`smoke.mjs` を雛形にしてください（共通部品は `tests/lib.mjs`）。

- `launchEngine()` … `BROWSER` に応じてエンジンを起動（Firefox の環境変数回避込み）
- `instrumentPage(page)` … `{ frames, errors }` を返す計測配線。`WS_WRAP_INIT` で
  `window.__wsLog`（`OPEN/SENT/RECV/CLOSE`）をページ側に注入
- 共通計測点: `page.on('console'|'pageerror'|'requestfailed'|'response')`、
  `page.on('websocket')`、`page.screenshot()`

### 折り込み済みのページ仕様（テスト執筆時の注意）

- `ws_test.html` の既定接続先は `const.js` の `WS_URL = ${location.origin}/ws/chat/room1`。
  素朴なエコーハンドラは `/ws/test` なので、テストでは URL 入力欄を差し替えている。
- サーバーは送信者自身にも chat を中継（エコー）するため、ファイル送信時は**送信者側にも
  受信行が現れる**（fileshare/label テストはこれを検証に利用している）。
- 入室通知（ENTER）は「その時点でroomにいる成員」にのみ届く（遅参者への再生なし）。

## フォルダ構成

```
browserTest/
├─ package.json        # npm scripts（engine×test の実行口）
├─ README.md           # このファイル
├─ tools/
│  └─ make-label-png.mjs   # 「テスト <時刻>」PNG生成（Chromium canvas + Noto CJK）
├─ tests/
│  ├─ lib.mjs              # エンジン起動・WS/DOM計測の共通部品
│  ├─ smoke.mjs            # ws_test エコー
│  ├─ multi-profile-chat.mjs  # 3プロファイル掲示板
│  ├─ ws-chat2-probe.mjs   # ws_chat2 調査用プローブ（pass/fail なし・事実収集）
│  ├─ ws-chat2-fileshare.mjs  # ファイル共有端到端
│  └─ ws-chat2-label-test.mjs # 文字入りPNG 双方向送受信＋SHA-256一致
└─ out/                # 成果物（gitignore）
```
