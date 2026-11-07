# browserTest — WebブラウザJS動作確認ハーネス

Playwright(Chromium)で `../wwwroot` のクライアントJSを実際にブラウザで動かし、
コンソールログ・WebSocketフレーム・エラー・スクリーンショットで検証します。

## 必要メモリ/容量

- Chromium等: `../.playwright-browsers`（約700MB・gitignore済み）
- Playwright: `./node_modules`（約19MB）

## 使い方

### 1. サーバー起動（重要: cwd は `TMiniWebServerES/` の中）

`SampleServer.js` は wwwroot を `../wwwroot` 相対で解決するため、
必ず内側の `TMiniWebServerES/` ディレクトリで起動します（ルートスクリプト `npm run server` と同じ）。

```bash
cd ../TMiniWebServerES && node ./SampleServer.js start   # ポート 8080
```

### 2. テスト実行（Chromium / Firefox 切替）

```bash
npm run smoke          # Chromium で ws_test エコー確認
npm run smoke:ff       # Firefox で同テスト
npm run multi          # Chromium で3プロファイル掲示板検証
npm run multi:ff       # Firefox で同テスト
# 別サーバーに対して: BASE_URL=http://192.168.x.x:80 npm run smoke
```

- 合格時: `SMOKE OK (engine)` / `MULTI-PROFILE CHAT OK (engine)` / 失敗時は exit 1
- スクリーンショット: `out/<テスト>_<engine>.png`
- Firefox のブラウザ種別は Playwright 同梱ビルド（`/usr/bin/firefox` ではない）

## Firefox のこの環境での注意点（Landlock制約下）

- Firefox は `~/.cache/mozilla`・`XDG_RUNTIME_DIR` 等へ書き込むため、Landlock制約下では
  `HOME`/`TMPDIR`/`XDG_CACHE_HOME`/`XDG_RUNTIME_DIR` をワークスペース配下へリダイレクトする必要がある
  （`tests/lib.mjs` が `.ff-*` ディレクトリを自動作成して対応済み）
- Firefox自身のサンドボックスはカーネル設定(AppArmorのuserns制限)で無効化される
  （`unshare(CLONE_NEWPID): EPERM` は警告であり起動は継続する）
- **既知の計測上の癖**: 非既定コンテキスト(`newContext()`)ではFirefoxの
  `page.on('websocket')` のフレーム本文が取得できない場合がある。
  ため `tests/lib.mjs` はページ側で `WebSocket` をラップした注入ログ(`window.__wsLog`)を
  フレーム本文の正文として使用する（Chromium/Firefox共通）

## テストの追加

`tests/*.mjs` を追加し、`smoke.mjs` を雛形にしてください（共通部品は `tests/lib.mjs`）。
共通で取得できる計測点:

- `page.on('console'|'pageerror'|'requestfailed'|'response')` — ログ・エラー・通信
- `page.on('websocket', ws => ...)` — `framesent`/`framereceived` でWSフレーム逐次記録
- `page.screenshot()` — 目視確認用画像

## 既知の動作仕様（テスト執筆時の注意）

- `ws_test.html` の既定接続先は `const.js` の `WS_URL = ${location.origin}/ws/chat/room1`。
  素朴なエコーハンドラは `/ws/test` なので、テストではURL入力欄を差し替えている。
- 静的ファイルの配信ルートはサーバー起動cwdに依存する（上記1）。
