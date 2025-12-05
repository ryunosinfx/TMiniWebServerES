import { TMiniWebServerES, MessageType, TMWS } from './TMiniWebServerES.js';
import { HttpStatusCode, Y } from './TMiniWebServerUtil.js';
import { D } from './Utils.js';
TMWS.route('/simple', 'GET', async client => {
	const data = 'Hello,world';

	// ステータスコードは明示的に設定が可能で、省略時にはOK(200)が設定されている.
	//レスポンスヘッダに追加の情報を与えることが可能.
	await client.writeResponse(data, HttpStatusCode.OK, { myheader: 'sample_value' });
});
TMWS.route('/sample/<id>/<kind>', async (client, args) => {
	// URL のパスに指定されたパラメータをキーワードで取得.
	const html = `<html lang='ja'>
   <body><p>パラメータ情報: <br/>
   id: ${args['id']}<br/>
   kind: ${args['kind']}</p></body>
   </html>`;
	await client.write_response(html);
});
TMWS.withWS('/ws/test', async (websocket, u8a) => {
	try {
		const [d, mt] = await websocket.receive(u8a);
		D(Y.u2s(u8a));
		D(`[SAMPLE SERVER@/ws/test received: ${d}/${mt}`);
		if (d === 'cmd_close') await websocket.close();
		else await websocket.send('Hello,world!! ' + d, MessageType.TEXT);
	} catch (e) {
		console.error(e);
	}
});

const Chat = {
	cmds: { CHAT: 'C', ENTER: 'E', LEAVE: 'L' },
	duration: 30 * 60 * 60 * 1000,
	rooms: {},
	bl1: [],
	bl2: [],
	bl3: [],
	dl: [],
	csl: [],
	leaveRoom: async (roomId, userId, socket) => {
		const uL = Chat.getRoomUserList(roomId);
		await Chat.filterUserList(uL, userId, Chat.isNotSame);
		D(`leaveRoom roomId:${roomId} /userId:${userId}`);
		Chat.closingSocketsList.push(socket);
		setTimeout(Chat.close, 100);
	},
	close: () => {
		for (const socket of Chat.closingSocketsList) socket.close();
	},
	enterRoom: async (roomId, userId, socket) => {
		const uL = Chat.getRoomUserList(roomId),
			now = await Chat.filterUserList(uL);
		uL.push({ userId, expire: now + Chat.duration, socket });
		Chat.sendForRoom(uL, userId + 'さんが入室しました。', userId);
		socket.onClose = () => {};
	},
	chat: (roomId, userId, msg) => {
		const uL = Chat.getRoomUserList(roomId);
		D('chat userList:', [uL, userId, msg]);
		if (!Chat.isInTheRoom(roomId, userId)) return;
		Chat.filterUserList(uL);
		Chat.sendForRoom(uL, msg, userId);
	},
	getRoomUserList: roomId => {
		const uL = Chat.rooms[roomId] || [];
		if (uL.length < 1) Chat.rooms[roomId] = uL;
		return uL;
	},
	cb: () => true,
	isSame: (a, b) => a === b,
	isNotSame: (a, b) => a !== b,
	filterUserList: async (userList, param, cb = Chat.cb) => {
		const bl = Chat.bl1;
		bl.splice(0, bl.length);
		const bl2 = Chat.bl2;
		bl2.splice(0, bl2.length);
		const bl3 = Chat.bl3;
		bl3.splice(0, bl3.length);
		const now = Date.now();
		for (const u of userList)
			if (u.expire > now && (cb === Chat.cb || cb(u.userId, param))) bl.push(u);
			else bl2.push(u) && bl3.push(u);
		userList.splice(0, userList.length);
		for (const u of bl) {
			userList.push(u);
			bl3.push(u);
		}
		for (const u of bl2) await Chat.sendForRoom(bl3, `${u.userId}さんが退室しました。`, u.userId);
		return now;
	},
	sendForRoom: async (usersList, msg, userId) => {
		const d = JSON.stringify({ userId, msg, t: Date.now() }),
			p = [];
		for (const u of usersList) p.push(u.socket.send(d));
		await Promise.all(p);
	},
	isInTheRoom: (roomId, userId) => {
		const ul = Chat.rooms[roomId] ? Chat.rooms[roomId] : [];
		for (const u of ul) if (u.userId === userId) return true;
		return false;
	},
	onClose: websocket => {
		const ps = websocket.props;
		Chat.leaveRoom(ps.roomId, ps.userId, websocket);
	},
};
/**
 * Chat
 *
 */
TMWS.withWS('/ws/chat/<roomId>', async (websocket, u8a, routeArgs) => {
	try {
		let isFirst = false;
		if (websocket.onClose !== Chat.onClose) {
			websocket.onClose = Chat.onClose;
			isFirst = true;
		}
		const ps = websocket.props;
		D('withWS routeArgs:', routeArgs);
		const LH = '[SAMPLE SERVER@/ws/chat] ',
			rId = routeArgs ? routeArgs.roomId : null,
			[d, mt] = await websocket.receive(u8a);
		ps.roomId = rId;
		D(`${LH}received: ${d}/${mt}`);
		if (!rId) return await websocket.send({ msg: LH + 'ROOM NOT FOUND!!!' });
		if (!d && !isFirst) return await websocket.send({ msg: LH + 'DATA NOT FOUND!!!' });
		try {
			const o = JSON.parse(d);
			if (!o.cmd || !o.userId)
				return (await websocket.send({ msg: LH + 'CMD NOT FOUND!!!' })) && websocket.close();
			const uId = o.userId;
			ps.userId = uId;
			if (o.cmd === Chat.cmds.CHAT) Chat.chat(rId, uId, o.msg);
			else if (o.cmd === Chat.cmds.ENTER) await Chat.enterRoom(rId, uId, websocket);
			else if (o.cmd === Chat.cmds.LEAVE) await Chat.leaveRoom(rId, uId, websocket);
		} catch (e) {
			D(e);
		}
	} catch (e) {
		console.error(e);
	}
});
export const startSampleServer = p => new TMiniWebServerES(8080, '0.0.0.0', p ? p : '../wwwroot').start();

if (process && Array.isArray(process.argv) && process.argv.length > 2 && process.argv[2] === 'start')
	startSampleServer();
