import net from 'net';
import { TMiniWebServerUtil, HttpStatusCode, Y } from './TMiniWebServerUtil.js';
import { L, D } from './Utils.js';
import { SHA1 } from './sha1.min.js';
const U = TMiniWebServerUtil;
const EMPTY = '';
const GET = 'GET';
const WS = 'websocket';
const INDEX_FILES = ['index.html', 'index.htm'];
const ACCEPTABLE_TYPE = ['string', 'number'];
const MAX_CONN = 10;
const EXPIRE_DURATION = 24 * 60 * 60 * 1000;
const TMP_ARR = [];

// class L {
// 	static isDebug = 1;
// 	static log = (msg, objects = EMPTY) => console.log(`[log] ${msg}`, objects);
// 	static dlog = (msg, objects = EMPTY) => (L.isDebug ? console.log(`[debug] ${msg}`, objects) : null);
// }
const ROUT_HEADERS = [];
const SERVERS = {};
export const TMWS = {
	route: (urlPath, method, routFunc) =>
		ROUT_HEADERS.push({
			urlPath,
			method: routFunc ? method : GET,
			routFunc: routFunc ? routFunc : method,
		}),
	withWS: (urlPath, routFunc) => ROUT_HEADERS.push({ urlPath, method: WS, routFunc }),
	addRouteItem: (sourceDecorators, currentRouteHeaders) => {
		for (const { urlPath, method, routFunc } of sourceDecorators) {
			const routeParts = urlPath.split('/');
			const routeArgNames = [];
			const routeRegexes = TMP_ARR;
			for (const s of routeParts) {
				const j = s.split(EMPTY);
				if (j.shift() === '<' && j.pop() === '>') {
					routeArgNames.push(j.join(EMPTY));
					routeRegexes.push('/([-\\._0-9a-zA-Z%]*)');
				} else if (s) {
					routeRegexes.push('/');
					routeRegexes.push(s);
				}
			}
			routeRegexes.push('$');
			const routeRegex = new RegExp(routeRegexes.join(EMPTY));
			currentRouteHeaders.push({
				route: urlPath,
				method: method.toUpperCase(),
				routFunc,
				routeArgNames,
				routeRegex,
			});
			D(`at addRouteItem: route add: urlPath:${urlPath} -> regex: ${routeRegexes.join(EMPTY)}, ${routeArgNames}`);
			routeRegexes.splice(0, routeRegexes.length);
		}
	},
	deleteExpireConns: a => {
		const keys = Object.keys(a);
		keys.sort();
		const l = keys.length;
		if (l > MAX_CONN)
			for (let i = MAX_CONN; i < l; i++) {
				const key = keys[i];
				const client = a[key];
				client.destroy();
				delete a[key];
			}
		const limit = Date.now() - EXPIRE_DURATION;
		Object.keys(a).forEach(key => {
			const client = a[key];
			if (client && client.spawnTime < limit) {
				client.destroy();
				delete a[key];
			}
		});
	},
};

export class TMiniWebServerES {
	/**
	 * Add
	 * @param {string} urlPath
	 * @param {string} method
	 * @param {function} routFunc
	 * @returns
	 */
	constructor(port = 8080, bindIP = '0.0.0.0', wwwroot = '/wwwroot') {
		if (SERVERS[port]) return L(`[ERROR] 既にそのポート${port}で起動中です`);
		this.serverIp = bindIP;
		this.port = port;
		this._wwwroot = wwwroot;
		this.isRunning = false;
		this.routeHeaders = [];
		SERVERS[port] = true;
		TMWS.addRouteItem(ROUT_HEADERS, this.routeHeaders);
	}
	async start() {
		if (this.isStarted()) return;
		const a = {};
		const server = net.createServer(socket => {
			D(`client connected at ${socket.localAddress}`); // 'connection' listener.
			const client = new TMiniWebClient(socket, this);
			const key = `${Date.now()}/${Math.random()}`;
			a[key] = client;
			socket.on('data', u8a => client._processRequest(u8a));
			socket.on('end', evt => L('end event:', evt) && client.onEnd());
			socket.on('close', evt => L('close event:', evt) && TMWS.deleteExpireConns(a) && client.onClose(evt));
			socket.on('drain', evt => L('drain event:', evt) && client.onDrain());
			L(`writableLength:${socket.writableLength} writableNeedDrain:${socket.writableNeedDrain}`);
			try {
				L(`at serverProc:connected by ${socket.remoteAddress ? socket.remoteAddress : EMPTY}`);
			} catch (ex) {
				L(`[ERROR]at serverProc:process request failed.`, ex);
			}
		});
		server.on('error', err => {
			L('[ERROR] at server:', err);
			throw err;
		});
		server.on('end', evt => L('srv end event:', evt));
		server.on('close', evt => L('srv close event:', evt));
		server.listen(this.port, () => L('server START port:', this.port));
		this._server = server;
		this.isRunning = true;
		L(`start server on ${this.serverIp}:${this.port}`);
	}

	stop() {
		if (!this.isStarted()) return;
		if (this._server)
			try {
				this._server.close();
			} catch (e) {
				console.error(e);
			}
		this.isRunning = false;
	}
	isStarted() {
		return this.isRunning;
	}

	getRouteHandler(urlPath, routeHeaders = [], method = EMPTY) {
		D(`at getRouteHandler: search ${urlPath},${method}`);
		const result = { routFunc: null, routeArgs: null };
		try {
			if (!routeHeaders) return result;
			if (urlPath.endsWith('/')) urlPath = urlPath[-1];
			const methodUpperCase = method.toUpperCase();
			for (const handler of routeHeaders) {
				if (handler.method !== methodUpperCase) continue;
				const m = handler.routeRegex.exec(urlPath);
				if (!m || m.length < 1) continue;
				const routeArgNames = handler.routeArgNames;
				result.routFunc = handler.routFunc;
				if (routeArgNames && routeArgNames.length > 0) {
					const routeArgs = {};
					for (let i = 1, l = routeArgNames.length; i <= l; i++) {
						const value = m[i];
						routeArgs[routeArgNames[i - 1]] = isNaN(value) ? value : value * 1;
					}
					result.routeArgs = routeArgs;
				}
				return result;
			}
		} catch (ex) {
			L(`[ERROR]at getRouteHandler:  ${urlPath}, ${method}`, ex);
		}
		return result;
	}
	async getPhysPathInWwwroot(requestPath) {
		let filePath = EMPTY;
		let isExistFile = false;
		if (requestPath !== '/') {
			filePath = `${this._wwwroot}/${requestPath}`;
			isExistFile = await U.isExistFile(filePath);
		} else
			for (const fileName of INDEX_FILES) {
				filePath = `${this._wwwroot}/${fileName}`;
				isExistFile = await U.isExistFile(filePath);
				if (isExistFile) break;
			}
		if (!isExistFile) return { filePath: null, mimeType: null };
		return { filePath, mimeType: U.getMineTypeFromExt(filePath) };
	}
}

const httpStatusMessage = {};
const init = () => {
	const z = httpStatusMessage,
		h = HttpStatusCode;
	z[h.SWITCH_PROTOCOLS] = 'Switching Protocols';
	z[h.OK] = 'OK';
	z[h.CREATED] = 'Created';
	z[h.ACCEPTED] = 'Accepted';
	z[h.NON_AUTHORITATIVE_INFORMATION] = 'Non-Authoritative Information';
	z[h.NO_CONTENT] = 'No Content';
	z[h.RESET_CONTENT] = 'Reset Content';
	z[h.PARTIAL_CONTENT] = 'Partial Content';
	z[h.MULTIPLE_CHOICES] = 'Multiple Choices';
	z[h.MOVED_PERMANENTLY] = 'Moved Permanently';
	z[h.FOUND] = 'Found';
	z[h.SEE_OTHER] = 'See Other';
	z[h.NOT_MODIFIED] = 'Not Modified';
	z[h.USE_PROXY] = 'Use Proxy';
	z[h.TEMPORARY_REDIRECT] = 'Temporary Redirect';
	z[h.BAD_REQUEST] = 'Bad Request';
	z[h.UNAUTHORIZED] = 'Unauthorized';
	z[h.PAYMENT_REQUIRED] = 'Payment Required';
	z[h.FORBIDDEN] = 'Forbidden';
	z[h.NOT_FOUND] = 'Not Found';
	z[h.METHOD_NOT_ALLOWED] = 'Method Not Allowed';
	z[h.NOT_ACCEPTABLE] = 'Not Acceptable';
	z[h.PROXY_AUTHENTICATION_REQUIRED] = 'Proxy Authentication Required';
	z[h.REQUEST_TIMEOUT] = 'Request Timeout';
	z[h.CONFLICT] = 'Conflict';
	z[h.GONE] = 'Gone';
	z[h.LENGTH_REQUIRED] = 'Length Required';
	z[h.PRECONDITION_FAILED] = 'Precondition Failed';
	z[h.REQUEST_ENTITY_TOO_LARGE] = 'Request Entity Too Large';
	z[h.REQUEST_URI_TOO_LONG] = 'Request-URI Too Long';
	z[h.UNSUPPORTED_MEDIA_TYPE] = 'Unsupported Media Type';
	z[h.REQUESTED_RANGE_NOT_SATISFIABLE] = 'Requested Range Not Satisfiable';
	z[h.EXPECTATION_FAILED] = 'Expectation Failed';
	z[h.INTERNAL_SERVER_ERROR] = 'Internal Server Error';
	z[h.NOT_IMPLEMENTED] = 'Not Implemented';
	z[h.BAD_GATEWAY] = 'Bad Gateway';
	z[h.SERVICE_UNAVAILABLE] = 'Service Unavailable';
	z[h.GATEWAY_TIMEOUT] = 'Gateway Timeout';
	z[h.HTTP_VERSION_NOT_SUPPORTED] = 'HTTP Version Not Supported';
};
init();
//TMiniWebLogic
const TWL = {
	parseFirstRow: async (line, u8a, lastCalledRouteFunc) => {
		const parsed = {};
		try {
			L(`at parseFirstRow: line:${line}`, lastCalledRouteFunc);
			const elements = line.split(' ');
			L(`at parseFirstRow: A elements:${elements}`);
			if (elements.length === 3) {
				L(`at parseFirstRow: 3 elements:${elements}`);
				parsed.method = elements[0].toUpperCase();
				parsed.url = elements[1];
				parsed._http_ver = elements[2].toUpperCase();
				const urlParts = parsed.url.split('?');
				parsed.reqPath = decodeURIComponent(urlParts.shift());
				const querystring = urlParts.length > 0 ? urlParts.join('?') : EMPTY;
				L(`at parseFirstRow: querystring:${querystring}`);
				if (querystring) {
					parsed.querystring = querystring;
					const kvs = querystring.split('&');
					for (const kv of kvs) {
						const pair = kv.split('=');
						const value = pair.length > 1 ? decodeURIComponent(pair[1]) : EMPTY;
						parsed.params[decodeURIComponent(pair[0])] = value;
					}
					D(`at parseFirstRow: querystring:${parsed.querystring} params:${parsed.params}`, parsed);
				}
				return parsed;
			} else if (elements.length <= 2 && lastCalledRouteFunc) {
				await lastCalledRouteFunc(u8a);
				parsed.url = WS;
				return parsed;
			} else return D('at parseFirstRow:failed read first line (http request)') || parsed;
		} catch (ex) {
			return L('[ERROR] at parseFirstRow:', ex) || false;
		}
	},
	parseHeader: async lines => {
		L(`at parseHeader: lines:${lines.length}`);
		const headers = {};
		for (const line of lines) {
			const elements = line.trim().split(':');
			const key = elements.shift().trim();
			const value = elements.join(':').trim();
			D(`at parseHeader: line:${line}  k/v ${key}/${value} elements:`, elements);
			if (value) headers[key.toLowerCase()] = value;
			else if (!value && !key) D(`at parseHeader: headers=${Object.keys(headers).length}`, headers);
			else L(`at parseHeader:  warning: ${line}`);
		}
		return headers;
	},

	writeResponseFromFile: async (
		s,
		filePhysPath,
		headers = {},
		httpStatus = HttpStatusCode.OK,
		contentType = null,
		charset = 'UTF-8'
	) => {
		D('[in] at writeResponseFromFile');
		try {
			if (!(await U.isExistFile(filePhysPath))) return await TWL.writeErrorResponse(s, HttpStatusCode.NOT_FOUND);
			if (contentType === null) contentType = U.getMineTypeFromExt(filePhysPath);
			let length = U.getFileSize(filePhysPath);
			const headers4Send = [];
			await TWL.writeStatusCode(s, httpStatus, headers4Send);
			await TWL.writeHeaders(s, headers, contentType, charset, length, headers4Send);
			await U.readFile(filePhysPath, length, buffer => TWL.write(s, buffer));
		} catch (ex) {
			L(`[ERROR]at writeResponseFromFile filePhysPath:${filePhysPath} httpStatus:${httpStatus}`, ex);
		}
		D('[out] at writeResponseFromFile');
	},
	writeErrorResponse: async (s, code, content = null) => {
		if (!content) content = httpStatusMessage[code];
		D(`at writeErrorResponse: content`, content);
		await TWL.writeResponse(s, content, undefined, code);
	},
	write: (s, data) =>
		new Promise((resolve, reject) =>
			!s.destroyed
				? s.write(
						data,
						evt => (evt ? reject(evt) : resolve()) || D(`send!${typeof evt}/${s.bytesWritten}`, evt)
				  )
				: resolve(s.destroyed)
		),
	writeStatusCode: (s, statusCode) => {
		const msg = httpStatusMessage[statusCode] || EMPTY;
		return TWL.write(s, `HTTP/1.1 ${statusCode} ${msg}\r\n`);
	},
	writeHeader: (s, name, value) => TWL.write(s, `${name}: ${value}\r\n`),
	writeContentTypeHeader: (s, contentType, charset = null, headers) => {
		return TWL.writeHeader(
			s,
			'content-type',
			!contentType ? 'application/octet-stream' : contentType + (charset ? `; charset=${charset}` : EMPTY),
			headers
		);
	},
	writeHeaders: async (s, headers, contentType, charset, length, headers4Send = []) => {
		if (headers && typeof headers === 'object' && !Array.isArray(headers))
			for (const header in headers) await TWL.writeHeader(s, header, headers[header], headers4Send);
		await TWL.writeHeader(s, 'server', 'TMiniWebServer', headers4Send);
		await TWL.writeHeader(s, 'connection', 'close', headers4Send);
		if (length > 0) {
			await TWL.writeContentTypeHeader(s, contentType, charset, headers4Send);
			await TWL.writeHeader(s, 'content-length', length, headers4Send);
		}
		await TWL.write(s, '\r\n');
	},
	writeResponse: async (
		s,
		content,
		headers = {},
		httpStatus = HttpStatusCode.OK,
		contentType = 'text/html',
		charset = 'UTF-8'
	) => {
		D('[in] writeResponse');
		try {
			let length = 0;
			if (content) {
				const type = typeof content;
				if (ACCEPTABLE_TYPE.includes(type)) content = Y.s2u(`${content}`, charset);
				length = content.length;
			}
			const headers4Send = [];
			await TWL.writeStatusCode(s, httpStatus, headers4Send);
			await TWL.writeHeaders(s, headers, contentType, charset, length, headers4Send);
			await TWL.write(s, content);
		} catch (ex) {
			L('[ERROR] at writeResponse ', ex);
		}
		D('[out] writeResponse');
	},
	checkUpgrade: headers => {
		const connType = headers['connection'];
		const upgrade = headers['upgrade'];
		return connType && connType.toLowerCase().indexOf('upgrade') > -1 && upgrade ? upgrade.toLowerCase() : null;
	},
	writeBadRequest: async s => await TWL.writeErrorResponse(s, HttpStatusCode.BAD_REQUEST),
	writeInternalServerError: async s => await TWL.writeErrorResponse(s, HttpStatusCode.INTERNAL_SERVER_ERROR),
};
class TMiniWebClient {
	constructor(socket, server) {
		this.spawnTime = Date.now();
		this.socket = socket;
		this.lastCalledRouteFunc = null;
		this.tMWS = null;
		this._server = server;
		this.url = null;
	}
	destroy() {
		const routeArgs = this.routeArgs;
		for (const key in this.routeArgs) delete routeArgs[key];
		delete this.routeArgs;
		delete this.socket;
		delete this.spawnTime;
		if (this.tMWS) {
			this.tMWS.destroy();
			delete this.tMWS;
		}
		delete this.lastCalledRouteFunc;
	}
	async close() {
		const socket = this.socket;
		const tMWS = this.tMWS;
		const f = resolve => {
			D('at close: TRY close!', [socket.destroyed, socket]);
			tMWS && tMWS.setIsClosed();
			if (socket.destroyed) return resolve();
			try {
				socket.end(EMPTY, () => D('close!') || resolve());
			} catch (e) {
				L('[WARN]at close: ', e) || resolve();
			}
		};
		return new Promise(resolve => setTimeout(() => f(resolve), 100));
	}
	onClose(evt) {
		if (this.tMWS && this.tMWS.onClose) this.tMWS.setIsClosed() || this.tMWS.onClose(this.tMWS, evt);
	}
	onEnd(evt) {
		if (this.tMWS && this.tMWS.onEnd) this.tMWS.onEnd(this.tMWS, evt);
	}
	onDrain(evt) {
		if (this.tMWS && this.tMWS.onDrain) this.tMWS.onDrain(this.tMWS, evt);
	}

	async _processRequest(u8a) {
		const str = Y.u2s(u8a);
		const rows = str.split(/\r\n|\r|\n/g);
		const s = this.socket;
		const { method, url, reqPath } = await TWL.parseFirstRow(rows.shift(), u8a, this.lastCalledRouteFunc);
		if (method) {
			const headers = await TWL.parseHeader(rows);
			const hl = Object.keys(headers).length;
			if (hl > 0) {
				const upgradeStr = TWL.checkUpgrade(headers);
				return !upgradeStr
					? await this.routingHttp(method, url, reqPath, rows)
					: upgradeStr === WS // WebSocket
					? await this._routingWebsocket(reqPath, u8a, headers)
					: await TWL.writeBadRequest(s);
			} else await TWL.writeBadRequest(s);
		} else if (url === WS) return true;
		else await TWL.writeInternalServerError(s);
		return L('at _processRequest: false:' + false) || false;
	}
	async routingHttp(method, url, reqPath, rows) {
		D('at routingHttp: START');
		const s = this.socket;
		const { routFunc, routeArgs } = this._server.getRouteHandler(reqPath, this._server.routeHeaders, method);
		if (!method) D(`at routingHttp:method not found reqPath: ${reqPath}, url: ${url}`); // console.debug(this._headers);
		if (routFunc) {
			D(`at routingHttp:found reqPath: ${reqPath}, args: `, routeArgs);
			try {
				await routFunc(rows, routeArgs ? routeArgs : this);
			} catch (ex) {
				D(`at routingHttp:Throw Exception in exec routeFunc: ${ex}`);
			}
		} else {
			D('at routingHttp:routing !== found.');
			if (method === 'GET') {
				const { filePath, mimeType } = await this._server.getPhysPathInWwwroot(reqPath);
				D(`at routingHttp:search static files [${this._server._wwwroot}] filePath:${filePath}`);
				if (!filePath) {
					L(`at routingHttp:field not found [${reqPath}]`);
					await TWL.writeErrorResponse(s, HttpStatusCode.NOT_FOUND);
				} else {
					L(`at routingHttp:file found [${mimeType}, ${filePath}]`);
					await TWL.writeResponseFromFile(s, filePath, mimeType);
				}
			} else await TWL.writeBadRequest(s);
		}
		try {
			await this.close();
		} catch (ex) {
			return L(`[ERROR] at routingHttp exec close`, ex);
		}
	}
	/**
	 *
	 * @param {*} reqPath
	 * @param {*} u8a
	 * @param {*} headers
	 * @returns
	 */
	async _routingWebsocket(reqPath, u8a, headers = {}) {
		D('in _routing_websocket');
		const { routFunc, routeArgs } = this._server.getRouteHandler(reqPath, this._server.routeHeaders, WS);
		if (!routFunc) {
			D(`not found websocket routFunc. [${reqPath}]`);
			return (await TWL.writeBadRequest(this.socket)) || true;
		}
		const tMWS = new TMiniWebSocket(this.socket);
		try {
			if (!(await tMWS.handshake(headers))) return D('handshake failed.') || true;
		} catch (e) {
			return D('at _routingWebsocket handshake failed.', e) && false;
		}
		try {
			this.routeArgs = routeArgs;
			this.tMWS = tMWS;
			this.lastCalledRouteFunc = async buff => await routFunc(tMWS, buff, routeArgs);
			D(`found routFunc: ${reqPath}, args: ${routeArgs}`);
			await routFunc(tMWS, u8a, routeArgs);
		} catch (ex) {
			return L(`[ERROR] at _routingWebsocket exec routFunc`, ex) && false;
		}
		return true;
	}
}
const Opcode = {
	CONTINUE: 0,
	TEXT: 1,
	BINARY: 2,
	CLOSE: 8,
	PING: 9,
	PONG: 10,
};
export const MessageType = {
	TEXT: 1,
	BINARY: 2,
};
const BT = {
	u126: new Uint8Array([126]),
	u127: new Uint8Array([127]),
	nullMask: new Uint8Array([0, 0, 0, 0]),
};
const NULL_NULL_ARRAY = [null, null];
const TWS = {
	_readFrame: (buff = new Uint8Array(1)) => {
		if (buff.length < 2) {
			L('at _readFrame:Invalid WebSocket frame header');
			throw new Error(32, 'WebSocket connection closed');
		}
		const p = { fin: null, compressed: null, opcode: null, hasMask: null, payloadLength: null, length: null };
		const u8a = new Uint8Array(buff);
		const header0 = u8a[0];
		const header1 = u8a[1];
		// ヘッダのパース.
		p.fin = (header0 & 0x80) === 0x80;
		p.compressed = (header0 & 0x40) === 0x40;
		p.opcode = header0 & 0x0f;
		p.hasMask = (header1 & 0x80) === 0x80;
		p.payloadLength = header1 & 0x7f; //0000.0111.1111.1111 payloadLength
		const opcode = p.opcode;
		const l1 = p.payloadLength;
		const hasMask = p.hasMask;
		const offset1 = (l1 < 0 ? -1 * l1 : 0) + 2;
		p.length = l1 < 0 ? Y.u2i(u8a.subarray(2, offset1)) : l1;
		const length = p.length;
		D('at _readFrame:  compressed:', p);
		const offset2 = hasMask ? offset1 + 4 : offset1;
		const offset3 = offset2 + length;
		const payload = u8a.subarray(offset2, offset3);
		const l = payload.length;
		const o = new Uint8Array(l);
		const mask = hasMask ? u8a.subarray(offset1, offset2) : BT.nullMask;
		if (hasMask && (mask[0] | mask[1] | mask[2] | mask[3]) !== 0)
			for (let i = 0; i < l; i++) o[i] = payload[i] ^ mask[i % 4];
		else for (let i = 0; i < l; i++) o[i] = payload[i];
		return { opcode, payload: o };
	},
	_processFrame: (opcode, payload) => {
		const data = opcode === Opcode.TEXT ? Y.u2s(payload) : opcode === Opcode.PONG ? null : payload;
		const isSendRes = opcode === Opcode.PING ? Opcode.PONG : null;
		const isClosed = opcode === Opcode.CLOSE;
		return { isSendRes, data, isClosed };
	},
};
export class TMiniWebSocket {
	constructor(socket) {
		this.socket = socket;
		this._closed = false;
		this.props = {};
	}
	isClosed() {
		return this._closed;
	}
	setIsClosed() {
		this._closed = true;
	}
	destroy() {
		delete this.socket;
		delete this._closed;
		delete this.props;
	}
	async close() {
		try {
			await this.sendCore(Opcode.CLOSE, null);
		} catch (e) {
			D('at close: throw Exception e:', e);
		}
		this._closed = true;
	}
	async handshake(headers) {
		const websocketKey = headers['sec-websocket-key'];
		if (!websocketKey) return (await TWL.writeBadRequest(this.socket)) || false;
		else {
			const sha1 = new SHA1();
			sha1.update(websocketKey);
			sha1.update('258EAFA5-E914-47DA-95CA-C5AB0DC85B11');
			const resKey = Y.h2B(sha1.finalize().toString());
			return (await this.sendUpgradeResponse(resKey)) || true;
		}
	}
	async receive(u8a) {
		try {
			const { opcode, payload } = TWS._readFrame(u8a);
			const { isSendRes, data, isClosed } = TWS._processFrame(opcode, payload);
			this._closed = isClosed;
			if (isClosed) return NULL_NULL_ARRAY;
			if (isSendRes) await this.sendCore(isSendRes, data);
			else if (data)
				if (opcode === Opcode.BINARY) return [data, MessageType.BINARY];
				else if (opcode === Opcode.TEXT) return [data, MessageType.TEXT];
		} catch (ex) {
			this._closed = true;
			return L(`[WARN] WebSocket closed. (exception : ${ex})`, ex) || NULL_NULL_ARRAY;
		}
		return NULL_NULL_ARRAY;
	}
	onClose() {}
	onEnd() {}
	onDrain() {}
	send(data, type = MessageType.TEXT) {
		if (type === MessageType.TEXT)
			return this.sendCore(Opcode.TEXT, typeof data == 'object' ? JSON.stringify(data) : `${data}`);
		else if (type === MessageType.BINARY) return this.sendCore(Opcode.BINARY, data);
	}
	async sendUpgradeResponse(responseKey) {
		const s = this.socket;
		await TWL.writeStatusCode(s, HttpStatusCode.SWITCH_PROTOCOLS);
		await TWL.writeHeader(s, 'upgrade', WS);
		await TWL.writeHeader(s, 'connection', 'upgrade');
		await TWL.writeHeader(s, 'sec-websocket-accept', responseKey);
		await TWL.write(s, '\r\n');
	}
	async sendCore(opcode, payload) {
		if (this.isClosed()) return;
		try {
			const frame = [];
			const u = new Uint8Array([0x80 | parseInt(opcode)]);
			frame.push(u);
			const p2 = payload && opcode === Opcode.TEXT ? Y.s2u(payload) : payload;
			const pl = p2 ? p2.length : 0;
			if (pl < 126) frame.push(Y.i2u(pl, 1));
			else if (pl < 1 << 16) {
				frame.push(BT.u126);
				frame.push(Y.i2u(pl, 2));
			} else {
				frame.push(BT.u127);
				frame.push(Y.i2u(pl, 8));
			}
			if (p2) frame.push(p2);
			const n = Y.jus(frame);
			await TWL.write(this.socket, n);
		} catch (ex) {
			if (ex && ex.errno === 104) this._closed = true; // ECONNRESET
			else L(`[ERROR] at sendCore: opcode:${opcode}`, ex);
		}
	}
}
