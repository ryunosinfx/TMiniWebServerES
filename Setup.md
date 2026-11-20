# ImageRoom セットアップガイド

**前提（コンセプト）**: アプリ本体（HTML/JS）は **GitHub Pages の静的配信**で公開します。
あなたが自宅に用意するのは **WebSocket 中継サーバー 1 台だけ** —
Raspberry Pi **Pico W** でも、普通の **Node.js**（PC / NAS / Raspberry Pi 等）でも動きます。
写真はすべて参加者の端末内ストレージとブラウザ間同期に留まり、中継サーバーは「橋渡し」だけです。

```
ブラウザ（GitHub Pages のアプリ）
   │  ①https: 静的ファイルだけ Pages から読む
   │  ②ws(s)://あなたのLANサーバー:8080/ws/chat/<部屋ID>  ← 中継のみ
   ▼
自宅 LAN サーバー（Node.js 版 または Pico W 版）
```

> 仕様の全体像: [docs/img_room_spec.md](docs/img_room_spec.md)（v2.30）
> 新規利用者の紹介ページ: [landing.html](landing.html)

---

## 0. アプリ本体を GitHub Pages に公開（共通・1 回だけ）

1. このリポジトリを自分の GitHub に push する。
2. リポジトリの **Settings → Pages** で **Deploy from a branch** を選び、
   ブランチ `main` / フォルダ **`/ (root)`** を指定して保存。
3. 保険としてリポジトリ直下に空ファイル `.nojekyll` を置く（Jekyll 処理による
   `modules/` 等のファイル除外を防ぐ）。
4. アプリ URL は次の形になります:

   ```
   https://<あなたのユーザー名>.github.io/TMiniWebServerES/wwwroot/img_room.html
   ```

Pages 側は静的ファイルしか配信しません。**接続先の LAN サーバーアドレスは
アプリ内の「⚙️ 接続設定」で指定**します（§A5 / QR でも反映可）。

---

## A. Node.js 版（推奨 — PC・NAS・Raspberry Pi 等）

### A1. 起動

前提: **Node.js 18 以上**（ESM / クラス静的フィールド使用）。ランタイム依存パッケージなし。

```bash
git clone https://github.com/<あなたのユーザー名>/TMiniWebServerES.git
cd TMiniWebServerES
npm run server        # = TMiniWebServerES/SampleServer.js start
```

これだけで `0.0.0.0:8080` に **静的配信 + WebSocket 中継**（`/ws/chat/<roomId>`）が立ちます。
LAN 上の IP は `hostname -I` 等で確認。ファイアウォールで **8080/tcp**（下記 wss を使うなら 8443/tcp も）を LAN 向けに開放。

### A2. つなぎ方は 2 とおり

| 形態 | アプリ URL | 接続先 | 備考 |
|---|---|---|---|
| **ワンボックス（最速）** | `http://<LAN-IP>:8080/img_room.html` | 同一 origin なので**接続設定は不要** | Pages を使わない最小構成 |
| **GitHub Pages アプリ** | `https://<user>.github.io/.../img_room.html` | `wss://<LAN-IP>:8443` | https ページは `ws://`（非 TLS）をブラウザが遮断するため **A3 の wss 終端が必要** |

### A3. wss 終端を 1 行（Caddy の例）

```bash
sudo apt install caddy
caddy reverse-proxy --from :8443 --to 127.0.0.1:8080
```

Caddy が自己 CA の TLS 証明書を自動取得します（各端末で初回に Caddy ルート証明書を信頼）。

**中継フレーム自体はアプリ層では無暗号（LAN 前提の設計・spec §6.5）** です。wss 終端を通すとブラウザ↔サーバー間 TLS で転送秘匿も得られます。家庭 LAN を超えた見知らぬ端末が同一ネットワークに居る環境では wss 運用を推奨します。
nginx を使う場合は `Upgrade`/`Connection` ヘッダを透過する設定で同じ ports 構成にできます
（`location /ws/ { proxy_pass http://127.0.0.1:8080; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; }`）。

### A4. 常時起動（systemd の例）

```ini
# /etc/systemd/system/imgroom.service
[Unit]
Description=ImageRoom LAN WebSocket relay
After=network-online.target
[Service]
ExecStart=/usr/bin/node %h/TMiniWebServerES/TMiniWebServerES/SampleServer.js start
WorkingDirectory=%h/TMiniWebServerES/TMiniWebServerES
Restart=always
[Install]
WantedBy=multi-user.target
```

```bash
systemctl --user enable --now imgroom   # または /etc/systemd/system に置いて system で
```

### A5. アプリ内の接続設定

- トップページ（ログイン画面）または部屋ヘッダーの **⚙️ 接続設定** を開き、
  `ws://<LAN-IP>:8080`（Pages 経由なら `wss://<LAN-IP>:8443`）を入力して **適用**。
  設定は端末に保存され、以降の部屋作成/参加で使われます。
- ダイアログに併記される **QR（内容 `TMIWS1:<アドレス>`）をスマホのログイン画面のスキャンカメラで読み込む**と同じ設定が即反映します。
- リンク配布でも伝わります: `#部屋名:b64url(wsアドレス)` 形式（§42）。
- **サイト既定**ボタンは「アプリと同じ origin（http://…:8080 配置時の同一 origin）」に戻ります。
- 部屋パスワードの認証ソルトは**月次で自動切替**（月末をまたいだセッションは再ログインになります）。
- データの保存エリア（OPFS / IndexedDB / localStorage / sessionStorage）と**確実な消し方**の一覧は [landing.html](landing.html) の「保存エリアと消し方」節にあります。

---

## B. Raspberry Pi Pico W 版（基板 1 枚で完結）

Pico W（Kaluma 1.2.1）でも同一の中継＋静的配信が動きます。
Pico 版は **http（LAN 内）のみ**の構成です — GitHub Pages（https）からの `ws://` 接続は
ブラウザの mixed-content 遮断で使えないため、**アプリ URL は Pico W 自身の静的配信**
（`http://<pico-ip>:8080/img_room.html`）を使います。接続設定は不要です。

### B1. Kaluma のフラッシュ

[Kaluma 公式サイト](https://kalumajs.org/) から Pico W（または Pico2 W）用の `.uf2` をダウンロードし、
BOOTSEL ボタン押しっ放しで USB 接続 → ストレージにコピーしてフラッシュ。

### B2. ビルド

```bash
git clone https://github.com/<あなたのユーザー名>/TMiniWebServerES.git
cd TMiniWebServerES
npm install          # rollup と @kaluma/cli を導入
npm run build        # TMiniWebServerES/main.js → bundle.js（1 ファイル化）
```

### B3. Wi-Fi 設定（初回のみ・kaluma shell）

```bash
sudo npx kaluma shell
```

REPL 内で:

```js
storage.setItem('WIFI_SSID', 'あなたのSSID');
storage.setItem('WIFI_PASSWORD', 'パスワード');
storage.setItem('WIFI_SECURITY', 'WPA2_WPA_PSK');
```

`Ctrl + z` で抜ける。

### B4. 書き込み

```bash
sudo npm run build_flash   # サーバープログラム（bundle.js）をフラッシュ
sudo npm run wwwload       # wwwroot 配下（約 680KB・46 ファイル）を転送
```

※ REPL 側のディレクトリが未作成なら `sudo npx kaluma shell` → `.mkdir wwwroot` を先に。
（README の手順どおり。`wwwload` は `kaluma put` のラップです。）

### B5. IP 確認とアクセス

```bash
sudo npx kaluma shell
> .load             # [log] ####1#getConnection ip:192.168.x.y と出れば OK
```

ブラウザで **`http://<pico-ip>:8080/img_room.html`** → 部屋を作る/参加する。

### B6. 注意（Pico 版）

- IP は DHCP 割当。**ルーターの MAC 固定**などでアドレスを固定して共有しやすくしてください。
- 中継は小フレーム分割で動作しますが RAM/スループットが小さいため、
  **数人・数百枚規模の軽量利用**向けです。大規模（〜10 万枚・複数部屋）は A の Node.js 版を推奨。
- カメラでの QR スキャンは https/localhost のみの制約（LAN http では PNG ファイル選択で代替）。

---

## C. 仲間への共有

1. Pages 版ならアプリ URL、Pico/ワンボックス版なら `http://<LAN-IP>:8080/img_room.html` を渡す。
2. 接続設定 QR（または `#部屋名:b64url(ws)` リンク）をスキャンしてもらう。
3. 同じ LAN の人はパスワードだけで部屋に参加できます。作成者端末（秘密鍵を保管中の端末）には
   「（本人・署名一致）」と部屋設定ボタンが出ます。秘密鍵の引っ越しはログイン画面右下の
   「秘密鍵の移動（ダウンロード）」→ 移行先で同じファイルを読み込ませます。

## トラブルシュート

| 症状 | 対処 |
|---|---|
| 「（Websocketサーバーに接続不能）」 | IP/ポート違い・ファイアウォール・サーバー停止を確認。接続設定でアドレス再指定 |
| https ページで接続できない | `ws://` は遮断されます。`wss://` 終端（A3）を使うか http 配置を使う |
| 部屋パスワードが通らない（月初） | 認証ソルトの月次ロールオーバー。一度再ログイン |
| IP が変わった | 接続設定を「サイト既定」→ 再指定、または新しい QR/リンクを共有 |

## 任意: 毎日の自動バックアップ

ブラウザ拡張 **imgroomCompanion**（Native Messaging + Node ホスト）で、ログイン不要・
停止しない bulkDl ランタイムが部屋全体を毎日定時に差分取得・7 世代バックアップします。
手順: [browserExtention/imgroomCompanion/README.md](browserExtention/imgroomCompanion/README.md)
