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
	// WebSocket の受信 1 メッセージ上限（細分化メッセージの断片合計・ペイロード byte 数）。
	// Kaluma 実機のメモリ事情を確認したら、この定数だけを調整すること。
	MAX_MSG_SIZE = 16 * 1024,
	EXPIRE_DURATION = 6 * 60 * 60 * 1000,
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
		const ks = Object.keys(a),
			// key 先頭がミリ秒タイムスタンプなので文字列 sort でも古い順に並ぶ
			l = ks.sort().length,
			closeConn = c => {
				// map から消すだけではソケットが残り続けるため、実際に閉じて接続上限を実効化させる
				if (c.socket && !c.socket.destroyed) c.socket.destroy();
				c.destroy();
			};
		// MAX_CONN 超過分は古い接続から閉じる
		if (l > MAX_CONN)
			for (let i = 0, over = l - MAX_CONN; i < over; i++) {
				const k = ks[i],
					c = a[k];
				if (c) {
					closeConn(c);
					delete a[k];
				}
			}
		const limit = Date.now() - EXPIRE_DURATION;
		Object.keys(a).forEach(key => {
			const c = a[key];
			if (c && c.spawnTime < limit) {
				closeConn(c);
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
		L('start 1');
		if (this.isStarted()) return;
		L('start 2');
		const z = this,
			a = {},
			svr = net.createServer(s => {
				try {
					console.log(s);
					D(`client connected at ${s.localAddress}`); // 'connection' listener.
					const c = new TMiniWebClient(s, z),
						k = `${Date.now()}/${Math.random()}`;
					a[k] = c;
					TMWS.deleteExpireConns(a); // 接続直後も上限を即座に効かせる（バースト時の無制限化防止）
					s.on('data', u8a => c._processRequest(u8a));
					// #4 修正: L() が常に undefined を返すため && 後が一度も実行されていなかった（close と同様に分離）
					s.on('end', evt => {
						L('end event:', evt);
						c.onEnd();
					});
					s.on('close', evt => {
						L('close event:', evt);
						c.onClose(evt);
						c.destroy();
						delete a[k];
						TMWS.deleteExpireConns(a);
					});
					// #4 修正: drain も同じ && 短絡で不動だった
					s.on('drain', evt => {
						L('drain event:', evt);
						c.onDrain();
					});
					L(`writableLength:${s.writableLength} writableNeedDrain:${s.writableNeedDrain}`);

					L(`at serverProc:connected by ${s.remoteAddress ? s.remoteAddress : EMPTY}`);
				} catch (ex) {
					L(`[ERROR]at serverProc:process request failed.`, ex);
				}
			});
		z._conns = a; // stop() から生存接続（と expireTimer）を解放するため
		L('start 3');
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
		// #N4 修正: stop() で生存接続を閉じないと expireTimer（6h）が残り、
		// Node ではプロセスが終了まで居座り、Kaluma ではタイマーリソースを消費し続ける。
		const conns = this._conns;
		if (conns)
			for (const k of Object.keys(conns)) {
				const c = conns[k];
				if (c) {
					if (c.socket && !c.socket.destroyed) c.socket.destroy();
					c.destroy(); // 内部で clearTimeout(z.expireTimer)
					delete conns[k];
				}
			}
		delete SERVERS[this.port]; // 同一ポートでの再起動を可能にする
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
			if (urlPath.endsWith('/')) urlPath = urlPath.slice(0, -1); // #5 修正: urlPath[-1] は undefined を返していた
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
		D(`getPhysPathInWwwroot 1 requestPath:${requestPath}`);
		if (requestPath !== '/') {
			D(`getPhysPathInWwwroot 2 requestPath:${requestPath}`);
			fp = `${this._wwwroot}/${requestPath}`;
			isE = await U.isExistFile(fp);
		} else {
			D(`getPhysPathInWwwroot 3 requestPath===/:${INDEX_FILES}`);
			for (const fn of INDEX_FILES) {
				fp = `${this._wwwroot}/${fn}`;
				L('getPhysPathInWwwroot 4 fp:' + fp);
				isE = await U.isExistFile(fp);
				L('getPhysPathInWwwroot 5 isE:' + isE);
				if (isE) break;
			}
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
		// #2 修正: params を常に初期化（未初期化だとクエリ付き URL で TypeError→500 になっていた）
		const p = { params: {} };
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
			await TWL.writeHeader(s, 'Content-Security-Policy', "img-src 'self' data:", headers4Send);
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
		z.expireTimer = setTimeout(() => {
			if (z.socket && !z.socket.destroyed) {
				L('Connection exceeded maximum lifetime; closing socket');
				z.socket.destroy();
			}
		}, EXPIRE_DURATION);
		z.headers = null;
		z.params = null;
	}
	/**
	 * ルートハンドラー公開 API。README 記載の client.writeResponse(content, status, headers) に対応させる。
	 * @param {string|number|Uint8Array} content
	 * @param {number} httpStatus
	 * @param {object} headers
	 */
	writeResponse(content, httpStatus = HttpStatusCode.OK, headers = {}) {
		return TWL.writeResponse(this.socket, content, headers, httpStatus);
	}
	destroy() {
		const z = this,
			r = z.routeArgs;
		clearTimeout(z.expireTimer);
		delete z.expireTimer;
		for (const k in z.routeArgs) delete r[k];
		delete z.routeArgs;
		delete z.socket;
		delete z.spawnTime;
		if (z.tMWS) {
			z.tMWS.destroy();
			delete z.tMWS;
		}
		delete z.lastCalledRouteFunc;
		delete z.headers;
		delete z.params;
	}
	async close() {
		const z = this,
			tMWS = z.tMWS,
			// socket は destroy() で削除されうるので 100ms 遅延後に再参照する
			// （stop()/退避とレスポンス完了が競合すると s.destroyed で TypeError → プロセスクラッシュ）
			f = r => {
				const s = z.socket;
				if (!s || s.destroyed) return r();
				D('at close: TRY close!', [s.destroyed, s]);
				tMWS && tMWS.setIsClosed();
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
		const z = this;
		// #9 修正: WS アップグレード済みのソケットへ届くデータは全てフレーム。
		// バイナリを HTTP リクエスト行として再パースすると、マスク済みバイト列に
		// 空白が含まれた場合などに誤解釈するため、フレーム経路へ直送する。
		if (z.lastCalledRouteFunc) {
			const t = z.tMWS;
			if (!t) return true;
			// #新: 蓄積バッファへ追加し、完全なフレームが揃うたびにハンドラーを 1 フレーム分呼ぶ
			// （分割到着の合算 / 同一パケット内の複数フレーム対応）
			let guard = -1;
			while (t._bufferMessage(u8a) && t._buf && t._buf.length !== guard) {
				guard = t._buf.length;
				await z.lastCalledRouteFunc(EMPTY_U8A); // receive() は蓄積分を消費する
				u8a = null;
				if (t.isClosed()) break;
			}
			return true;
		}
		const str = Y.u2s(u8a),
			rows = str.split(/\r\n|\r|\n/g),
			s = this.socket,
			{ method, url, reqPath, params } = await TWL.parseFirstRow(rows.shift(), u8a, this.lastCalledRouteFunc);
		if (method) {
			this.params = params || {}; // ハンドラー側で client.params からクエリ参数を参照可能に
			const hs = await TWL.parseHeader(rows),
				hl = Object.keys(hs).length;
			if (hl > 0) {
				const ug = TWL.checkUpgrade(hs);
				this.headers = hs;
				return !ug
					? await this.routingHttp(method, url, reqPath)
					: ug === WS // WebSocket
						? await this._routingWebsocket(reqPath, u8a, hs)
						: await TWL.writeBadRequest(s);
			} else await TWL.writeBadRequest(s);
		} else if (url === WS) return true;
		else await TWL.writeInternalServerError(s);
		return L('at _processRequest: false:' + false) || false;
	}
	async routingHttp(method, url, reqPath) {
		D(`at routingHttp: START reqPath:${reqPath} url:${url}`);
		const s = this.socket,
			{ routFunc, routeArgs } = this._server.getRouteHandler(reqPath, this._server.routeHeaders, method);
		if (!method) D(`at routingHttp:method not found reqPath: ${reqPath}, url: ${url}`); // console.debug(this._headers);
		if (routFunc) {
			D(`at routingHttp:found reqPath: ${reqPath}, args: `, routeArgs);
			try {
				await routFunc(this, routeArgs ? routeArgs : {});
			} catch (ex) {
				D(`at routingHttp:Throw Exception in exec routeFunc: ${ex}`);
			}
		} else {
			D('at routingHttp:routing !== found. METHOD:' + method);
			if (method === 'GET') {
				D('at routingHttp:routing !== found. reqPath:' + reqPath);
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
			// #9 修正: ハンドシェイクバッファ（フレームではない）でハンドラーを呼ばない。
			// ハンドシェイク同梱で後方にフレームバイトが続く場合のみ、後方部分で呼ぶ。
			const hdrEnd = TWS.findHdrEnd(u8a);
			if (hdrEnd >= 0 && u8a.length > hdrEnd + 4) {
				// #新: 同梱バイトも蓄積し、完全なフレームが揃った時点でハンドラーを呼ぶ（分割到着対応）
				let tail = u8a.subarray(hdrEnd + 4),
					guard = -1;
				while (tMWS._bufferMessage(tail) && tMWS._buf && tMWS._buf.length !== guard) {
					guard = tMWS._buf.length;
					await routFunc(tMWS, EMPTY_U8A, routeArgs); // receive() が蓄積分を消費する
					tail = null; // 追加は最初の 1 度だけ
					if (tMWS.isClosed()) break;
				}
			}
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
	EMPTY_U8A = new Uint8Array(0), // 蓄積済みバッファから解析する際の送り玉（u8a 位置引数の互換維持用）
	TWS = {
		// HTTP リクエスト末尾（CRLF CRLF）の位置。無ければ -1
		findHdrEnd: u => {
			for (let i = 0, l = u.length - 3; i < l; i++)
				if (u[i] === 13 && u[i + 1] === 10 && u[i + 2] === 13 && u[i + 3] === 10) return i;
			return -1;
		},
		// オフセット i のフレームヘッダを解釈。{ len: 宣言ペイロード長, size: フレーム総 byte 数 } を返す。
		// ヘッダ自体が未完なら null、ペイロード未完なら { len, size: null }。#新
		_frameSize: (u8a, i = 0) => {
			if (i + 2 > u8a.length) return null;
			const h1 = u8a[i + 1],
				l1 = h1 & 0x7f,
				hasMask = (h1 & 0x80) === 0x80;
			let hdr = 2,
				len = l1;
			if (l1 === 126) {
				if (i + 4 > u8a.length) return null;
				len = Y.be2i(u8a.subarray(i + 2, i + 4));
				hdr = 4;
			} else if (l1 === 127) {
				if (i + 10 > u8a.length) return null;
				len = Y.be2i(u8a.subarray(i + 2, i + 10));
				hdr = 10;
			}
			const o2 = i + hdr + (hasMask ? 4 : 0);
			return { len, size: u8a.length >= o2 + len ? o2 + len - i : null };
		},
		// #RFC6455: 細分化メッセージを考慮し、バッファ内で「完結した 1 メッセージ
		// （fin=true のデータフレームまで）」または単一の制御フレームに必要な総 byte 数を返す。
		// 未完了なら null（次の受信を待つ）。制御フレーム（PING/CLOSE）は断片間に混在可能（RFC 6455 §5.4/§5.5）。
		_messageSize: u8a => {
			let i = 0,
				frag = false, // 細分化メッセージの途中か
				msgBytes = 0; // 当該メッセージの断片合計ペイロード長
			for (;;) {
				const f = TWS._frameSize(u8a, i);
				if (f === null) return null;
				const op = u8a[i] & 0x0f,
					fin = (u8a[i] & 0x80) !== 0;
				// #16KB: 宣言長が単独でも断片合計でも上限超過 → 蓄積を待たず即拒否（DoS 対策）
				if (f.len > MAX_MSG_SIZE || (op < 8 && msgBytes + f.len > MAX_MSG_SIZE)) return -1;
				if (f.size === null) return null; // ペイロード未完: 次の受信を待つ（上限判定は済んでいる）
				if (op >= 8) {
					// 制御フレーム: 断片途中でなければ単独でディスパッチ可能（PING 応答/CLOSE 処理）
					if (!frag) return i + f.size;
					i += f.size;
					continue;
				}
				msgBytes += f.len;
				i += f.size;
				if (frag) {
					if (fin) return i; // 細分化メッセージ完結
				} else if (fin) return i; // 単一フレームメッセージ
				else frag = true; // fin=false: ここから細分化開始
			}
		},
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
				hasMask = p.hasMask;
			// #6 修正: 126/127 は拡張長のマーカーであり、後続バイトをビッグエンディアンで読む（RFC 6455）。
			// 旧コードの l1<0 分岐は 0-127 の値では到達せず、126 以上の長さで誤パースしていた。
			let o1 = 2,
				len = l1;
			if (l1 === 126) {
				len = Y.be2i(u8a.subarray(2, 4));
				o1 = 4;
			} else if (l1 === 127) {
				len = Y.be2i(u8a.subarray(2, 10));
				o1 = 10;
			}
			p.length = len;
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
			return { opcode, payload: o, size: o3 };
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
		this._buf = null; // #新: マルチパケットで分割到着するフレームの蓄積バッファ
	}
	// 受信データを蓄積し、完結した 1 メッセージ（または制御フレーム）が揃っていれば
	// その総 byte 数、未完なら 0 を返す。上限超過なら close(1009) を送り 0 を返す。#16KB
	_bufferMessage(u8a) {
		const z = this;
		if (u8a && u8a.length) z._buf = z._buf ? Y.jud(z._buf, u8a) : u8a;
		if (!z._buf) return 0;
		const ms = TWS._messageSize(z._buf);
		if (ms !== null && ms < 0) {
			L(`[WARN] WS message exceeds MAX_MSG_SIZE(${MAX_MSG_SIZE}): close(1009)`);
			z._buf = null; // 超過データの蓄積を破棄
			z.rejectOversize(); // fire-and-forget（sendCore は async）
			return 0;
		}
		return ms || 0;
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
		delete this._buf;
	}
	async close(code) {
		try {
			// code 指定時は close frame に 2 byte BE のステータスコードを載せる（RFC 6455 §5.5.1）
			await this.sendCore(Opcode.CLOSE, code ? Y.i2be(code, 2) : null);
		} catch (e) {
			D('at close: throw Exception e:', e);
		}
		this._closed = true;
	}
	// #16KB: メッセージが MAX_MSG_SIZE 超過 → RFC 6455 §7.4.1 に従い close(1009 Message Too Big)
	async rejectOversize() {
		try {
			await this.sendCore(Opcode.CLOSE, Y.i2be(1009, 2));
		} catch (e) {
			D('at rejectOversize:', e);
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
			const z = this;
			// #新: 引数があれば蓄積へ追加（旧呼び出し形との互換）。無ければ蓄積済みバッファから取り出す
			if (u8a && u8a.length) z._buf = z._buf ? Y.jud(z._buf, u8a) : u8a;
			if (!z._buf) return NULL_NULL_ARRAY;
			// #RFC6455: 細分化メッセージは fin=true まで 1 メッセージとして組み立てる。
			// ディスパッチ側は完結済みメッセージ/制御フレームが揃うまで呼ばないため、
			// ここで消費した領域は必ず完結している。
			const msgSize = TWS._messageSize(z._buf);
			if (msgSize === null) return NULL_NULL_ARRAY; // 未完了: 次の受信を待つ
			if (msgSize < 0) {
				// #16KB: 直接 receive() を呼ぶ旧来経路でも同じ上限保護を適用
				z._buf = null;
				await z.rejectOversize();
				return NULL_NULL_ARRAY;
			}
			const parts = [];
			let type = null,
				off = 0;
			while (off < msgSize) {
				const f = TWS._readFrame(z._buf.subarray(off, msgSize)),
					{ isSendRes, data, isClosed } = TWS._processFrame(f.opcode, f.payload);
				off += f.size;
				z._closed = isClosed;
				if (isClosed) {
					z._buf = z._buf.length > off ? z._buf.subarray(off) : null;
					return NULL_NULL_ARRAY;
				}
				if (isSendRes) {
					await z.sendCore(isSendRes, data); // PING → PONG 応答後、同一領域内の次フレームへ
					continue;
				}
				if (f.opcode === Opcode.CONTINUE) {
					if (type !== null) parts.push(f.payload);
				} else if (f.opcode === Opcode.TEXT || f.opcode === Opcode.BINARY) {
					type = f.opcode;
					parts.length = 0;
					parts.push(f.payload);
				}
			}
			z._buf = z._buf.length > msgSize ? z._buf.subarray(msgSize) : null; // メッセージ領域を消費
			if (type === null) return NULL_NULL_ARRAY; // 制御フレームのみ（PING 応答済み等）
			const msg = parts.length === 1 ? parts[0] : Y.jus(parts);
			if (type === Opcode.BINARY) return [msg, MessageType.BINARY];
			return [Y.u2s(msg), MessageType.TEXT];
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
		// destroy() 後の遅延 close() でも安全に no-op とする（socket/_closed が delete 済みのケース）
		if (this.isClosed() || !this.socket) return;
		try {
			const fm = [],
				u = new Uint8Array([0x80 | parseInt(opcode)]),
				p2 = payload && opcode === Opcode.TEXT ? Y.s2u(payload) : payload,
				pl = p2 ? p2.length : 0;
			fm.push(u);
			if (pl < 126) fm.push(Y.i2u(pl, 1)); // 1 バイトはエンディアン差なし
			else if (pl < 1 << 16) {
				fm.push(BT.u126);
				fm.push(Y.i2be(pl, 2)); // #6 修正: 拡張長はビッグエンディアン（RFC 6455）
			} else {
				fm.push(BT.u127);
				fm.push(Y.i2be(pl, 8));
			}
			if (p2) fm.push(p2);
			await TWL.write(this.socket, Y.jus(fm));
		} catch (ex) {
			if (ex && ex.errno === 104)
				this._closed = true; // ECONNRESET
			else L(`[ERROR] at sendCore: opcode:${opcode}`, ex);
		}
	}
}
