# TMiniWebServerES

Raspberry Pi Pico W 用に作成したコンパクトな WebServer です。
MicroPython の環境で動作して、asyncio (uasyncio)を利用して実装しています。

## 特徴

-   Raspberry Pi Pico W で WebServer 機能を提供
-   Flask に似た記述でルーティングを設定
-   WebSocket 通信に対応
-   非同期 IO を使用しており、並列でリクエストを処理可能

サーバーの定常状態では、およそ 122KB のメモリを使用します。
スレッドは使用しておらず、本ソフトウェアを利用する側へスレッドを使用するかどうかの裁量を残しています。

## 参考

TMiniWebServerES は以下のソフトウェアを参考に実装しました。

-   [MicroWebSrv](https://github.com/jczic/MicroWebSrv)
-   [microdot](https://github.com/miguelgrinberg/microdot)

# マニュアル

TMiniWebServerES のマニュアルです。
Raspberry Pi Pico W でネットワーク機能を有効にした後の状態を前提としています。

## WebServer 起動

サーバーは以下の記述で起動します。

```js
import { TMiniWebServerES } from './TMiniWebServerES/tminiwebserver.js';

// Server Start
TMiniWebServerES().start();
```

## スタティックファイルのサービング

TMiniWebServerES のコンストラクターで`wwwroot`の指定が可能です。
ここで指定されたディレクトリからファイルをサービングします。

静的な Web ページを作成した場合には、このディレクトリにファイルを配置してください。

## ルーティングハンドラーの使用

リクエストを処理するハンドラー関数を以下のように実装します。
これは`http://(your-address)/simple`にアクセスにきたときに呼び出されます。

```js
TMiniWebServerES.route('/simple', 'GET', async client => {
	const data = 'Hello,world';

	// ステータスコードは明示的に設定が可能で、省略時にはOK(200)が設定されている.
	//レスポンスヘッダに追加の情報を与えることが可能.
	await client.writeResponse(data, HttpStatusCode.OK, { myheader: 'sample_value' });
});
```

## ルーティングハンドラーとパラメーター受け取り

リクエストを処理するハンドラー関数を以下のように実装します。
このとき、デコレーターによるパス指定で所定の記述をすると、パスの一部をパラメーターとして取得できます。

```js
TMiniWebServerES.route('/sample/<id>/<kind>', async (client, args) => {
	// URL のパスに指定されたパラメータをキーワードで取得.
	const html = `<html lang='ja'>
   <body><p>パラメータ情報: <br/>
   id: ${args['id']}<br/>
   kind: ${args['kind']}</p></body>
   </html>`;
	await client.write_response(html);
});
```

## WebSocket の使用

WebSocket を受け付けるルーティングの設定はデコレーターで行います。
このハンドラー関数は、WebSocket のハンドシェイクが完了後に呼び出されます。
この関数から抜けると、WebSocket 通信はクローズとなります。

```js
TMiniWebServerES.withWS('/ws/', async (websocket, u8a) => {
	try {
		const [data, mimeType] = await websocket.receive(u8a);
		console.log(`received: ${data}/${mimeType}`);
		if (data === 'cmd_close') await websocket.close();
		else await websocket.send('Hello,world!!', TMiniWebSocket.MessageType.TEXT);
	} catch (e) {
		console.error(e);
	}
});
```

この WebSocket 用のハンドラーにおいてもパスのパラメーターを受け取ることが可能です。

```js
TMiniWebServerES.withWS('/ws/<id>', async (websocket, u8a, args) => {
	console.log(args);
	// ...
});
```

## 免責事項・その他

自由に利用してもらってかまいませんが、使用において発生した如何なる損害について作者は一切の責任を負いません。
各自の責任や判断において使用してください。

ライセンスは MIT としています。
不具合の報告は歓迎ですが、修正の保障はございません。
申し訳ないですが各自での修正作業を行っていただくか、Pull Request を頂ければ嬉しく思います。
