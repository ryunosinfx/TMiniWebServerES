import net from 'net';
import { TMiniWebServerUtil, HttpStatusCode, Y } from './TMiniWebServerUtil.js';
import { L, D } from './Utils.js';
import { SHA1 } from './sha1.min.js';
const U = TMiniWebServerUtil,
	EMPTY = '',
	GET = 'GET',
	WS = 'websocket',
	INDEX_FILES = ['index.html', 'index.htm'],
	AT = ['string', 'number'],
	MAX_CONN = 10,
	EXPIRE_DURATION = 24 * 60 * 60 * 1000,
	TMP_ARR = [],
	ROUT_HEADERS = [],
	SERVERS = {};
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
			const rPs = urlPath.split('/'),
				rAN = [],
				rRs = TMP_ARR;
			for (const s of rPs) {
				const j = s.split(EMPTY);
				if (j.shift() === '<' && j.pop() === '>') {
					rAN.push(j.join(EMPTY));
					rRs.push('/([-\\._0-9a-zA-Z%]*)');
				} else if (s) {
					rRs.push('/');
					rRs.push(s);
				}
			}
			rRs.push('$');
			const routeRegex = new RegExp(rRs.join(EMPTY));
			currentRouteHeaders.push({
				route: urlPath,
				method: method.toUpperCase(),
				routFunc,
				routeArgNames: rAN,
				routeRegex,
			});
			D(`at addRouteItem: route add: urlPath:${urlPath} -> regex: ${rRs.join(EMPTY)}, ${rAN}`);
			rRs.splice(0, rRs.length);
		}
	},
	deleteExpireConns: a => {
		const ks = Object.keys(a);
		ks.sort();
		const l = ks.length;
		if (l > MAX_CONN)
			for (let i = MAX_CONN; i < l; i++) {
				const k = ks[i],
					c = a[k];
				c.destroy();
				delete a[k];
			}
		const limit = Date.now() - EXPIRE_DURATION;
		Object.keys(a).forEach(key => {
			const c = a[key];
			if (c && c.spawnTime < limit) {
				c.destroy();
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
		const z = this;
		z.serverIp = bindIP;
		z.port = port;
		z._wwwroot = wwwroot;
		z.isRunning = false;
		z.routeHeaders = [];
		SERVERS[port] = true;
		TMWS.addRouteItem(ROUT_HEADERS, z.routeHeaders);
	}
	async start() {
		if (this.isStarted()) return;
		const z = this,
			a = {},
			svr = net.createServer(s => {
				D(`client connected at ${s.localAddress}`); // 'connection' listener.
				const c = new TMiniWebClient(s, z),
					k = `${Date.now()}/${Math.random()}`;
				a[k] = c;
				s.on('data', u8a => c._processRequest(u8a));
				s.on('end', evt => L('end event:', evt) && c.onEnd());
				s.on('close', evt => L('close event:', evt) && TMWS.deleteExpireConns(a) && c.onClose(evt));
				s.on('drain', evt => L('drain event:', evt) && c.onDrain());
				L(`writableLength:${s.writableLength} writableNeedDrain:${s.writableNeedDrain}`);
				try {
					L(`at serverProc:connected by ${s.remoteAddress ? s.remoteAddress : EMPTY}`);
				} catch (ex) {
					L(`[ERROR]at serverProc:process request failed.`, ex);
				}
			});
		svr.on('error', err => {
			L('[ERROR] at server:', err);
			throw err;
		});
		svr.on('end', evt => L('srv end event:', evt));
		svr.on('close', evt => L('srv close event:', evt));
		svr.listen(z.port, () => L('server START port:', z.port));
		z._server = svr;
		z.isRunning = true;
		L(`start server on ${z.serverIp}:${z.port}`);
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
		const r = { routFunc: null, routeArgs: null };
		try {
			if (!routeHeaders) return r;
			if (urlPath.endsWith('/')) urlPath = urlPath[-1];
			const mUC = method.toUpperCase();
			for (const h of routeHeaders) {
				if (h.method !== mUC) continue;
				const m = h.routeRegex.exec(urlPath);
				if (!m || m.length < 1) continue;
				const rANs = h.routeArgNames;
				r.routFunc = h.routFunc;
				if (rANs && rANs.length > 0) {
					const rAs = {};
					for (let i = 1, l = rANs.length; i <= l; i++) {
						const v = m[i];
						rAs[rANs[i - 1]] = isNaN(v) ? v : v * 1;
					}
					r.routeArgs = rAs;
				}
				return r;
			}
		} catch (ex) {
			L(`[ERROR]at getRouteHandler:  ${urlPath}, ${method}`, ex);
		}
		return r;
	}
	async getPhysPathInWwwroot(requestPath) {
		let fp = EMPTY,
			isE = false;
		if (requestPath !== '/') {
			fp = `${this._wwwroot}/${requestPath}`;
			isE = await U.isExistFile(fp);
		} else
			for (const fn of INDEX_FILES) {
				fp = `${this._wwwroot}/${fn}`;
				isE = await U.isExistFile(fp);
				if (isE) break;
			}
		if (!isE) return { filePath: null, mimeType: null };
		return { filePath: fp, mimeType: U.getMineTypeFromExt(fp) };
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
		const p = {};
		try {
			L(`at parseFirstRow: line:${line}`, lastCalledRouteFunc);
			const elms = line.split(' ');
			L(`at parseFirstRow: A elements:${elms}`);
			if (elms.length === 3) {
				L(`at parseFirstRow: 3 elements:${elms}`);
				p.method = elms[0].toUpperCase();
				p.url = elms[1];
				p._http_ver = elms[2].toUpperCase();
				const up = p.url.split('?');
				p.reqPath = decodeURIComponent(up.shift());
				const qs = up.length > 0 ? up.join('?') : EMPTY;
				L(`at parseFirstRow: querystring:${qs}`);
				if (qs) {
					p.querystring = qs;
					const kvs = qs.split('&');
					for (const kv of kvs) {
						const pair = kv.split('='),
							v = pair.length > 1 ? decodeURIComponent(pair[1]) : EMPTY;
						p.params[decodeURIComponent(pair[0])] = v;
					}
					D(`at parseFirstRow: querystring:${p.querystring} params:${p.params}`, p);
				}
				return p;
			} else if (elms.length <= 2 && lastCalledRouteFunc) {
				await lastCalledRouteFunc(u8a);
				p.url = WS;
				return p;
			} else return D('at parseFirstRow:failed read first line (http request)') || p;
		} catch (ex) {
			return L('[ERROR] at parseFirstRow:', ex) || false;
		}
	},
	parseHeader: async lines => {
		L(`at parseHeader: lines:${lines.length}`);
		const h = {};
		for (const l of lines) {
			const elms = l.trim().split(':'),
				k = elms.shift().trim(),
				v = elms.join(':').trim();
			D(`at parseHeader: line:${l}  k/v ${k}/${v} elements:`, elms);
			if (v) h[k.toLowerCase()] = v;
			else if (!v && !k) D(`at parseHeader: headers=${Object.keys(h).length}`, h);
			else L(`at parseHeader:  warning: ${l}`);
		}
		return h;
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
			L(`at writeResponseFromFile filePhysPath:${filePhysPath}`);
			if (!(await U.isExistFile(filePhysPath))) return await TWL.writeErrorResponse(s, HttpStatusCode.NOT_FOUND);
			if (contentType === null) contentType = U.getMineTypeFromExt(filePhysPath);
			let len = U.getFileSize(filePhysPath);
			const h4s = [];
			await TWL.writeStatusCode(s, httpStatus, h4s);
			await TWL.writeHeaders(s, headers, contentType, charset, len, h4s);
			await U.readFile(filePhysPath, len, buffer => TWL.write(s, buffer));
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
	writeHeader: (s, n, v) => TWL.write(s, `${n}: ${v}\r\n`),
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
			for (const h in headers) await TWL.writeHeader(s, h, headers[h], headers4Send);
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
			let len = 0;
			if (content) {
				const t = typeof content;
				if (AT.includes(t)) content = Y.s2u(`${content}`, charset);
				len = content.length;
			}
			const h4s = [];
			await TWL.writeStatusCode(s, httpStatus, h4s);
			await TWL.writeHeaders(s, headers, contentType, charset, len, h4s);
			await TWL.write(s, content);
		} catch (ex) {
			L('[ERROR] at writeResponse ', ex);
		}
		D('[out] writeResponse');
	},
	checkUpgrade: headers => {
		const ct = headers['connection'],
			ug = headers['upgrade'];
		return ct && ct.toLowerCase().indexOf('upgrade') > -1 && ug ? ug.toLowerCase() : null;
	},
	writeBadRequest: async s => await TWL.writeErrorResponse(s, HttpStatusCode.BAD_REQUEST),
	writeInternalServerError: async s => await TWL.writeErrorResponse(s, HttpStatusCode.INTERNAL_SERVER_ERROR),
};
class TMiniWebClient {
	constructor(socket, server) {
		const z = this;
		z.spawnTime = Date.now();
		z.socket = socket;
		z.lastCalledRouteFunc = null;
		z.tMWS = null;
		z._server = server;
		z.url = null;
	}
	destroy() {
		const z = this,
			r = z.routeArgs;
		for (const k in z.routeArgs) delete r[k];
		delete z.routeArgs;
		delete z.socket;
		delete z.spawnTime;
		if (z.tMWS) {
			z.tMWS.destroy();
			delete z.tMWS;
		}
		delete z.lastCalledRouteFunc;
	}
	async close() {
		const s = this.socket,
			tMWS = this.tMWS,
			f = r => {
				D('at close: TRY close!', [s.destroyed, s]);
				tMWS && tMWS.setIsClosed();
				if (s.destroyed) return r();
				try {
					s.end(EMPTY, () => D('close!') || r());
				} catch (e) {
					L('[WARN]at close: ', e) || r();
				}
			};
		return new Promise(r => setTimeout(() => f(r), 100));
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
		const str = Y.u2s(u8a),
			rows = str.split(/\r\n|\r|\n/g),
			s = this.socket,
			{ method, url, reqPath } = await TWL.parseFirstRow(rows.shift(), u8a, this.lastCalledRouteFunc);
		if (method) {
			const hs = await TWL.parseHeader(rows),
				hl = Object.keys(hs).length;
			if (hl > 0) {
				const ug = TWL.checkUpgrade(hs);
				return !ug
					? await this.routingHttp(method, url, reqPath, rows)
					: ug === WS // WebSocket
					? await this._routingWebsocket(reqPath, u8a, hs)
					: await TWL.writeBadRequest(s);
			} else await TWL.writeBadRequest(s);
		} else if (url === WS) return true;
		else await TWL.writeInternalServerError(s);
		return L('at _processRequest: false:' + false) || false;
	}
	async routingHttp(method, url, reqPath, rows) {
		D(`at routingHttp: START reqPath:${reqPath} url:${url}`);
		const s = this.socket,
			{ routFunc, routeArgs } = this._server.getRouteHandler(reqPath, this._server.routeHeaders, method);
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
		const z = this,
			{ routFunc, routeArgs } = z._server.getRouteHandler(reqPath, z._server.routeHeaders, WS);
		if (!routFunc) {
			D(`not found websocket routFunc. [${reqPath}]`);
			return (await TWL.writeBadRequest(z.socket)) || true;
		}
		const tMWS = new TMiniWebSocket(z.socket);
		try {
			if (!(await tMWS.handshake(headers))) return D('handshake failed.') || true;
		} catch (e) {
			return D('at _routingWebsocket handshake failed.', e) && false;
		}
		try {
			z.routeArgs = routeArgs;
			z.tMWS = tMWS;
			z.lastCalledRouteFunc = async buff => await routFunc(tMWS, buff, routeArgs);
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
	},
	NULL_NULL_ARRAY = [null, null],
	TWS = {
		_readFrame: (buff = new Uint8Array(1)) => {
			if (buff.length < 2) {
				L('at _readFrame:Invalid WebSocket frame header');
				throw new Error(32, 'WebSocket connection closed');
			}
			const p = { fin: null, compressed: null, opcode: null, hasMask: null, payloadLength: null, length: null },
				u8a = new Uint8Array(buff),
				h0 = u8a[0],
				h1 = u8a[1];
			// ヘッダのパース.
			p.fin = (h0 & 0x80) === 0x80;
			p.compressed = (h0 & 0x40) === 0x40;
			p.opcode = h0 & 0x0f;
			p.hasMask = (h1 & 0x80) === 0x80;
			p.payloadLength = h1 & 0x7f; //0000.0111.1111.1111 payloadLength
			const opcode = p.opcode,
				l1 = p.payloadLength,
				hasMask = p.hasMask,
				o1 = (l1 < 0 ? -1 * l1 : 0) + 2;
			p.length = l1 < 0 ? Y.u2i(u8a.subarray(2, o1)) : l1;
			const len = p.length;
			D('at _readFrame:  compressed:', p);
			const o2 = hasMask ? o1 + 4 : o1,
				o3 = o2 + len,
				pl = u8a.subarray(o2, o3),
				l = pl.length,
				o = new Uint8Array(l),
				mask = hasMask ? u8a.subarray(o1, o2) : BT.nullMask;
			if (hasMask && (mask[0] | mask[1] | mask[2] | mask[3]) !== 0)
				for (let i = 0; i < l; i++) o[i] = pl[i] ^ mask[i % 4];
			else for (let i = 0; i < l; i++) o[i] = pl[i];
			return { opcode, payload: o };
		},
		_processFrame: (opcode, payload) => {
			const data = opcode === Opcode.TEXT ? Y.u2s(payload) : opcode === Opcode.PONG ? null : payload,
				isSendRes = opcode === Opcode.PING ? Opcode.PONG : null,
				isClosed = opcode === Opcode.CLOSE;
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
		const wk = headers['sec-websocket-key'];
		if (!wk) return (await TWL.writeBadRequest(this.socket)) || false;
		else {
			const sha1 = new SHA1();
			sha1.update(wk);
			sha1.update('258EAFA5-E914-47DA-95CA-C5AB0DC85B11');
			const resKey = Y.h2B(sha1.finalize().toString());
			return (await this.sendUpgradeResponse(resKey)) || true;
		}
	}
	async receive(u8a) {
		try {
			const { opcode, payload } = TWS._readFrame(u8a),
				{ isSendRes, data, isClosed } = TWS._processFrame(opcode, payload);
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
			const fm = [],
				u = new Uint8Array([0x80 | parseInt(opcode)]),
				p2 = payload && opcode === Opcode.TEXT ? Y.s2u(payload) : payload,
				pl = p2 ? p2.length : 0;
			fm.push(u);
			if (pl < 126) fm.push(Y.i2u(pl, 1));
			else if (pl < 1 << 16) {
				fm.push(BT.u126);
				fm.push(Y.i2u(pl, 2));
			} else {
				fm.push(BT.u127);
				fm.push(Y.i2u(pl, 8));
			}
			if (p2) fm.push(p2);
			await TWL.write(this.socket, Y.jus(fm));
		} catch (ex) {
			if (ex && ex.errno === 104) this._closed = true; // ECONNRESET
			else L(`[ERROR] at sendCore: opcode:${opcode}`, ex);
		}
	}
}
