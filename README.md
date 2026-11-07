# TMiniWebServerES

Raspberry Pi Pico W 用に作成したコンパクトな WebServer です。
js 基盤（Kaluma 1.2.1）作動します。

## 特徴

- Raspberry Pi Pico W で WebServer 機能を提供
- Flask に似た記述でルーティングを設定
- WebSocket 通信に対応
- ノンブロッキングで並列でリクエストを処理可能

サーバーの定常状態では、およそ 122KB のメモリを使用します。
スレッドは使用しておらず、本ソフトウェアを利用する側へスレッドを使用するかどうかの裁量を残しています。

## 参考

TMiniWebServerES は以下のソフトウェアを参考に実装しました。

- [MicroWebSrv](https://github.com/jczic/MicroWebSrv)
- [microdot](https://github.com/miguelgrinberg/microdot)
- [TMiniWebServer](https://github.com/techmadot/TMiniWebServerv)

# マニュアル

TMiniWebServerES のマニュアルです。
Raspberry Pi Pico2 W でKaluma1.2.1をフラッシュした状態を想定しています。

### ファイル構成

#### Project: TMiniWebServerES

以下はリポジトリのファイル構成ツリーと各ファイル/フォルダの用途概要です。

```
TMiniWebServerES/                      # プロジェクトルート
├─ index.js                             # Kaluma 向け実験/デモスクリプト（npm run flashTest で利用）
├─ wifiTest.js                          # Wi‑Fi 接続のテストスクリプト（Kaluma 向け）
├─ package.json                         # Node 開発用依存定義（ビルド/ツール設定）
├─ package-lock.json                    # 依存の固定ロックファイル
├─ browserTest/                         # Playwright 自動ブラウザテスト（→ browserTest/README.md）
├─ rollup.config.js                     # フロントエンドバンドル設定（Rollup）
├─ eslint.config.js                     # ESLint 設定ファイル
├─ .prettierrc.yaml                      # Prettier 設定
├─ .gitignore                           # Git 無視設定
├─ LICENSE                              # ライセンス情報
├─ README.md                            # JS 実装の説明（このフォルダ向け）
├─ python/                             # 元のpython実装※参考用に保存
│  ├─ boot.py                              # (MicroPython) 起動時スクリプト／初期化処理
│  ├─ main.py                              # メイン実行スクリプト（Python版の例）
│  ├─ sample_basic.py                      # サンプル：基本的なサーバーの例（Python）
│  ├─ sample_restapi.py                    # サンプル：REST API の実装例（Python）
│  ├─ sample_websocket.py                  # サンプル：WebSocket サーバー例（Python）
│  ├─ Readme.md                            # ルートの README（プロジェクト概要）
│  └─ TMiniWebServer/                      # Python サーバー実装（ライブラリ）
│     ├─ __init__.py                       # パッケージ初期化
│     ├─ tminiwebserver.py                 # サーバー本体の実装（Python）
│     └─ tminiwebserver_util.py            # サーバーのユーティリティ関数（Python）
├─ wwwroot/                             # 静的ウェブコンテンツ
│  ├─ index.html                        # デフォルトの Web UI
│  ├─ Vw.js                             # フロントエンド View ユーティリティ
│  ├─ Y.js                              # フロントエンド共通ユーティリティ
│  ├─ const.js                          # フロントエンド定数（WS_URL 等）
│  ├─ file_util.js                      # ファイル選択等のユーティリティ
│  ├─ OPFS.js                           # OPFS(Origin Private File System) ヘルパ
│  ├─ ws_test.html                      # WebSocket テストページ
│  ├─ ws_test.js                        # WebSocket テスト用クライアントスクリプト
│  ├─ ws_chat.html                      # WebSocket チャットデモ
│  ├─ ws_chat.js                        # チャット用クライアントスクリプト
│  ├─ ws_chat2.html                     # チャットデモ（画像添付あり）
│  └─ ws_chat2.js                       # 画像添付付きチャットクライアント
└─ TMiniWebServerES/                    # JavaScript/ES 実装フォルダ
   ├─ main.js                           # Kaluma 用エントリ（WiFi 接続後にサンプルサーバーを起動）
   ├─ SampleServer.js                   # サンプルサーバー（Node/Kaluma 共通）
   ├─ TMiniWebServerES.js               # ライブラリ本体（ES モジュール）
   ├─ TMiniWebServerUtil.js             # サーバー系ユーティリティ（ES）
   ├─ Utils.js                          # 補助ユーティリティ（ログ/待機等）
   └─ sha1.min.js                       # WebSocket ハンドシェイク用 SHA-1
```

注意・補足:

- `wifiTest.js` の最後は `connectWifiStatic;` となっており、関数呼び出しになっていません。実行するには `connectWifiStatic();` に修正してください。
- Kaluma などの組込み JS 環境では Node の `fs` API と同一ではないことが多く、ファイルアクセスは `storage` や各環境固有 API を使う必要があります。

## 環境セットアップ

```bash
# ubuntuを想定
$ sudo apt install build-essential node
# パッケージに必要なモジュールを取得（Kaluma環境ではプログラムを１ファイルにする必要が有るため、rollupをバンドラーとして使用しています。)
$ npm install
```

## Kaluma セットアップ

公式サイト
[Kaluma](https://kalumajs.org/)

### Kalumaのインストール

- 公式サイトからPico2 WならPico2 W用のファームウェアの.UF2 fileをダウンロードしてください。
- BOOTSELボタンを押したまま、USBケーブルでPCにつなぎます。
- その後、ボタンから手を放します。そしたら RPI-RP2という名前でUSBストレージとして認識されるはずです。
- そのRPI-RP2ドライブにドラッグアンドドロップでダウンロードしてきたファームウェアの.UF2 fileを置くと自動でインストールされ、再起動します。
    - Ubuntuの場合は管理者権限が要求されます。
- 以上で完了です。違うバージョンに書き換えたい場合も手順は同じで当然、中身は初期化されて消えます。

### 本プロジェクトのセットアップ

一応、以下の手順で動くようになるはずです。kaluma-cliのコマンドは面倒くさいのでnpm scriptでラップしています。

```bash
# ubuntuにnodejsをインストール済みの想定、他の環境は適宜読み替えてください。
# kaluma-cliがいろいろ要求するのでbuild-essentialを入れます。
$ sudo apt install build-essential
$ npm install --save-dev @kaluma/cli

#ディレクトリ作成のためkaluma-cliでkalumaOS上につなぎます。
sudo npx kaluma shell

> .help
> .ls
> .pwd
> .mkdir wwwroot
> .ls

# 続けてWifi設定
> storage.setItem('WIFI_SSID', 'MyHome');
> storage.setItem('WIFI_PASSWORD', '12345678');
> storage.setItem('WIFI_SECURITY', 'WPA2_WPA_PSK');
Ctrl + z でkaluma-cliから抜けます。
```

## サンプルサーバーのビルドと反映

```bash
# ubuntuを想定
$ npm run build
# パッケージに必要なモジュールを取得
$ sudo npm run wwwload # wwwroot配下を反映
$ sudo npm run flash # ビルドしたファイルを反映
$ sudo npm run build_flash # ビルド&ファイルを反映
```

### wifiでのIPアドレスの確認（DHCPのクライアントとしてのみ作動）

　IPを指定して起動する方法がわからないので現状はDHCPで自動でIPを振られる前提です。

内部で１０回pingをデフォルトゲートウェイに投げてIPアドレスを確認しています。

```bash
#kaluma-cliでkalumaOS上につなぎます。
sudo npx kaluma shell

> .load
# 以下の行が出てきたらIPが取得できています。
#[log] ####1#getConnection ip:192.168.x.y###### undefined

#Kaluma-cliにアクセスが出来ない場合は事前にネットワーク上でPingに応答するIPをすべて洗い出し
$ for a in `seq 1 254`; do ping -c 1 -w 1 192.168.x.$a > /dev/null && arp -a 192.168.x.$a | grep ether; done
# 電源投入後、再度チェックして増えた物が該当のIPの可能性が高いです。
$ for a in `seq 1 254`; do ping -c 1 -w 1 192.168.1.$a > /dev/null && arp -a 192.168.1.$a | grep ether; done
```

参考：LAN内で使用中のIPアドレス(pingで応答があるノード)を簡易に調査するワンライナー(Linux編) https://www.na3.jp/entry/20101231/p1

### サンプルページへのアクセス

プログラムを書き込んだ後、電源投入後にURLにアクセスするとサンプルページが開きます。
（IPアドレスは自分のものを入れてください。）

http://192.168.x.y:8080/index.html

httpsには対応していません。

## 組み込み先のプログラム内でのWebServer 起動

サーバーはロードするプログラム上で以下の記述で起動します。

詳細は`./TMiniWebServerES/SampleServer.js`を参照してください。

```js
// TMiniWebServerES.js と同じフォルダに配置するプログラムからの import
import { TMiniWebServerES, MessageType, TMWS } from './TMiniWebServerES.js';
import { HttpStatusCode } from './TMiniWebServerUtil.js';

// ルーティング登録（後述の TMWS.route / TMWS.withWS）を行ってから起動する。
// 引数省略時は port=8080 / bindIP='0.0.0.0' / wwwroot='/wwwroot'（Kaluma 向けの既定）。
// Node で試す場合は wwwroot を相対パス（例 '../wwwroot'）で指定する。
new TMiniWebServerES(8080, '0.0.0.0', './wwwroot').start();
```

## スタティックファイルのサービング

TMiniWebServerES のコンストラクターで`wwwroot`の指定が可能です。
ここで指定されたディレクトリからファイルをサービングします。

静的な Web ページを作成した場合には、このディレクトリにファイルを配置してください。

## ルーティングハンドラーの使用

リクエストを処理するハンドラー関数を以下のように実装します。
これは`http://(your-address)/simple`にアクセスにきたときに呼び出されます。

```js
TMWS.route('/simple', 'GET', async client => {
	const data = 'Hello,world';

	// ステータスコードは明示的に設定が可能で、省略時にはOK(200)が設定されている.
	//レスポンスヘッダに追加の情報を与えることが可能.
	await client.writeResponse(data, HttpStatusCode.OK, { myheader: 'sample_value' });
});
```

## ルーティングハンドラーとパラメーター受け取り

リクエストを処理するハンドラー関数を以下のように実装します。
このとき、`TMWS.route` のパス文字列内に `<id>` のように記述すると、パスの一部をパラメーターとして取得できます。

```js
TMWS.route('/sample/<id>/<kind>', async (client, args) => {
	// URL のパスに指定されたパラメータをキーワードで取得.
	const html = `<html lang='ja'>
   <body><p>パラメータ情報: <br/>
   id: ${args['id']}<br/>
   kind: ${args['kind']}</p></body>
   </html>`;
	await client.writeResponse(html);
});
```

## WebSocket の使用

WebSocket を受け付けるルーティングの設定は `TMWS.withWS()` で行います。
このハンドラー関数は、クライアントからメッセージ（または制御フレーム）を受信するたびに呼び出されます。
受信データが TCP パケットに分割されて届いた場合や、細分化（continuation フレーム）されたメッセージも、内部で蓄積・再接続され 1 メッセージとして受け取れます。
1 メッセージの上限は `TMiniWebServerES.js` の `MAX_MSG_SIZE` 定数（既定 16KB）で、超過した接続は close(1009) でクローズされます。
通信を閉じるには `websocket.close()` を呼ぶか、クライアント側から切断します。

```js
TMWS.withWS('/ws/', async (websocket, u8a) => {
	try {
		const [data, mimeType] = await websocket.receive(u8a);
		console.log(`received: ${data}/${mimeType}`);
		if (data === 'cmd_close') await websocket.close();
		else await websocket.send('Hello,world!! ' + data, MessageType.TEXT);
	} catch (e) {
		console.error(e);
	}
});
```

この WebSocket 用のハンドラーにおいてもパスのパラメーターを受け取ることが可能です。

```js
TMWS.withWS('/ws/<id>', async (websocket, u8a, args) => {
	console.log(args);
	// ...
});
```

## Kaluma のNodejsとの互換性

プロダクト自体はテスト容易性のためKalumaとNodeに対応しています。

```mermaid
 flowchart LR;
     		A[main.js]
			B[SampleServer.js]
			C[TMiniWebServerES.js]
			D[TMiniWebServerUtil.js]
			E[Utils.js]
			F[sha1.min.js]
			Y[bundle.js]
			Ba[SampleServer.js]
			Ca[TMiniWebServerES.js]
			Da[TMiniWebServerUtil.js]
			Ea[Utils.js]
			Fa[sha1.min.js]
	subgraph Kaluma
		subgraph X[Rollupによるバンドル]
			A-->|呼出|B-->|呼出|C-->|呼出|D
			B-->|呼出|D
			B-->|呼出|E
			C-->|呼出|E
			D-->|呼出|E
			C-->|呼出|F
	  	end
		X-->|バンドルしPicoWに書き込み|Y
	end
	subgraph Node
		subgraph Z[そのまま起動]
			Ba-->|呼出|Ca-->|呼出|Da
			Ba-->|呼出|Da
			Ba-->|呼出|Ea
			Ca-->|呼出|Ea
			Da-->|呼出|Ea
			Ca-->|呼出|Fa
	  	end
	end
```

### Kaluma のNodejsとの非互換性

別js実装なのでNodejsとは非互換性が有ります。以下分かってる範囲です。ドキュメントが不完全なので他にも有る可能性が高いです。

- console.debug は実装がない
- fsモジュールがNodeと違いコールバックを取らない同期実装になっている

### Node.jsでの実行

```bash
npm run server
```

以下でアクセスできます。

http://localhost:8080/index.html

## Webブラウザでの動作確認（自動ブラウザテスト）

クライアント側JS（ws_test / ws_chat / ws_chat2 のファイル共有など）の実ブラウザ動作を、
Playwright によるヘッドレスブラウザ自動テストで検証できます。
Chromium 158 / Firefox 159 で全テスト動作確認済みです。

- **セットアップ手順・テスト実行方法・必要環境(バージョン/ストレージ)**: [browserTest/README.md](./browserTest/README.md)

## Pico が応答不能になった場合

storageが4kbの16スロットしかなく、使い切ると書き込みで応答不能になるため

- https://kalumajs.org/docs/boards/pico2-w

https://www.raspberrypi.com/documentation/microcontrollers/pico-series.html#software-utilities
の
Resetting Flash memory
の項目から flash_nuke.uf2 をダウンロードして
ファイルマネージャからドラッグアンドドロップで反映し

そして最初からやり直すと治ります。

## 免責事項・その他

自由に利用してもらってかまいませんが、使用において発生した如何なる損害について作者は一切の責任を負いません。
各自の責任や判断において使用してください。

ライセンスは MIT としています。
不具合の報告は歓迎ですが、修正の保障はございません。
申し訳ないですが各自での修正作業を行っていただくか、Pull Request を頂ければ嬉しく思います。

WebSocketに必要なSHA-1の実装はCrypto.jsから持ってきています。
