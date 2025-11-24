import { TMiniWebServerES, MessageType } from './TMiniWebServerES.js';
import { HttpStatusCode, Y } from './TMiniWebServerUtil.js';
TMiniWebServerES.route('/simple', 'GET', async client => {
	const data = 'Hello,world';

	// ステータスコードは明示的に設定が可能で、省略時にはOK(200)が設定されている.
	//レスポンスヘッダに追加の情報を与えることが可能.
	await client.writeResponse(data, HttpStatusCode.OK, { myheader: 'sample_value' });
});
TMiniWebServerES.route('/sample/<id>/<kind>', async (client, args) => {
	// URL のパスに指定されたパラメータをキーワードで取得.
	const html = `<html lang='ja'>
   <body><p>パラメータ情報: <br/>
   id: ${args['id']}<br/>
   kind: ${args['kind']}</p></body>
   </html>`;
	await client.write_response(html);
});
TMiniWebServerES.withWS('/ws/test', async (websocket, u8a) => {
	try {
		const [data, mimeType] = await websocket.receive(u8a);
		console.log(Y.u2s(u8a));
		console.log(`[SAMPLE SERVER@/ws/test received: ${data}/${mimeType}`);
		if (data === 'cmd_close') await websocket.close();
		else await websocket.send('Hello,world!! ' + data, MessageType.TEXT);
	} catch (e) {
		console.error(e);
	}
});

class Chat {
	static cmds = { CHAT: 'C', ENTER: 'E', LEAVE: 'L' };
	static duration = 30 * 60 * 60 * 1000;
	static rooms = {};
	static bufferList = [];
	static bufferList2 = [];
	static bufferList3 = [];
	static deletedList = [];
	static closingSocketsList = [];
	static leaveRoom = async (roomId, userId, socket) => {
		const userList = Chat.getRoomUserList(roomId);
		await Chat.filterUserList(userList, userId, Chat.isNotSame);
		console.log(`leaveRoom roomId:${roomId} /userId:${userId}`);
		Chat.closingSocketsList.push(socket);
		setTimeout(Chat.close, 100);
	};
	static close = () => {
		for (const socket of Chat.closingSocketsList) socket.close();
	};
	static enterRoom = async (roomId, userId, socket) => {
		const userList = Chat.getRoomUserList(roomId);
		const now = await Chat.filterUserList(userList);
		userList.push({ userId, expire: now + Chat.duration, socket });
		Chat.sendForRoom(userList, userId + 'さんが入室しました。', userId);
		socket.onClose = () => {};
	};
	static chat(roomId, userId, msg) {
		const userList = Chat.getRoomUserList(roomId);
		console.log('chat userList:', userList, userId, msg);
		if (!Chat.isInTheRoom(roomId, userId)) return;
		Chat.filterUserList(userList);
		Chat.sendForRoom(userList, msg, userId);
	}
	static getRoomUserList = roomId => {
		const userList = Chat.rooms[roomId] || [];
		if (userList.length < 1) Chat.rooms[roomId] = userList;
		return userList;
	};
	static cb = () => true;
	static isSame = (a, b) => a === b;
	static isNotSame = (a, b) => a !== b;
	static filterUserList = async (userList, param, cb = Chat.cb) => {
		const bufferList = Chat.bufferList;
		bufferList.splice(0, bufferList.length);
		const bufferList2 = Chat.bufferList2;
		bufferList2.splice(0, bufferList2.length);
		const bufferList3 = Chat.bufferList3;
		bufferList3.splice(0, bufferList3.length);
		const now = Date.now();
		for (const user of userList)
			if (user.expire > now && (cb === Chat.cb || cb(user.userId, param))) bufferList.push(user);
			else bufferList2.push(user) && bufferList3.push(user);

		userList.splice(0, userList.length);
		for (const user of bufferList) {
			userList.push(user);
			bufferList3.push(user);
		}
		for (const user of bufferList2)
			await Chat.sendForRoom(bufferList3, `${user.userId}さんが退室しました。`, user.userId);
		return now;
	};
	static sendForRoom = async (usersList, msg, userId) => {
		const d = JSON.stringify({ userId, msg, t: Date.now() });
		const promises = [];
		for (const user of usersList) promises.push(user.socket.send(d));
		await Promise.all(promises);
	};
	static isInTheRoom(roomId, userId) {
		const userList = Chat.rooms[roomId] ? Chat.rooms[roomId] : [];
		for (const user of userList) if (user.userId === userId) return true;
		return false;
	}
	static onClose(websocket) {
		const props = websocket.props;
		Chat.leaveRoom(props.roomId, props.userId, websocket);
	}
}
/**
 * Chat
 *
 */
TMiniWebServerES.withWS('/ws/chat/<roomId>', async (websocket, u8a, routeArgs) => {
	try {
		let isFirst = false;
		if (websocket.onClose !== Chat.onClose) {
			websocket.onClose = Chat.onClose;
			isFirst = true;
		}
		const props = websocket.props;
		console.log('withWS routeArgs:', routeArgs);
		const LH = '[SAMPLE SERVER@/ws/chat] ';
		const roomId = routeArgs ? routeArgs.roomId : null;
		props.roomId = roomId;
		const [data, mimeType] = await websocket.receive(u8a);
		console.log(`${LH}received: ${data}/${mimeType}`);
		if (!roomId) return await websocket.send({ msg: LH + 'ROOM NOT FOUND!!!' });
		if (!data && !isFirst) return await websocket.send({ msg: LH + 'DATA NOT FOUND!!!' });
		try {
			const obj = JSON.parse(data);
			if (!obj.cmd || !obj.userId)
				return (await websocket.send({ msg: LH + 'CMD NOT FOUND!!!' })) && websocket.close();
			const userId = obj.userId;
			props.userId = userId;
			if (obj.cmd === Chat.cmds.CHAT) Chat.chat(roomId, userId, obj.msg);
			else if (obj.cmd === Chat.cmds.ENTER) await Chat.enterRoom(roomId, userId, websocket);
			else if (obj.cmd === Chat.cmds.LEAVE) await Chat.leaveRoom(roomId, userId, websocket);
		} catch (e) {
			console.log(e);
		}
	} catch (e) {
		console.error(e);
	}
});
export class SampleServer {
	static L = TMiniWebServerES.L;
	static start() {
		// Server Start
		new TMiniWebServerES(8080, '0.0.0.0', '../wwwroot').start(); //TMiniWebServerES().start();
	}
}

if (process && Array.isArray(process.argv) && process.argv.length > 2 && process.argv[2] === 'start')
	SampleServer.start();
