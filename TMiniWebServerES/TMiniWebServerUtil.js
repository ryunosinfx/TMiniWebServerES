import fs from 'fs';
import path from 'path';
import { L, D } from './Utils.js';

const te = new TextEncoder(),
	td = new TextDecoder(),
	E = '',
	P = '/',
	gBl = b => b.byteLength;
export const B = {
		u8: a => new Uint8Array(a),
	},
	Y = {
		isSameAb: (abA, abB) => Y.a2B(abA) === Y.a2B(abB), //バイナリ処理モジュール
		isB64: (s = E) => s % 4 === 0 && /[+/=0-9a-zA-Z]+/.test(s),
		s2u: s => te.encode(s),
		u2s: u => td.decode(u),
		a2B: i => btoa(Y.u2b(B.u8(i.buffer ? i.buffer : i))),
		u2B: u => btoa(Y.u2b(u)),
		a2U: a => Y.B2U(Y.a2B(a)),
		u2U: u => Y.B2U(Y.u2B(u)),
		B2a: B => Y.b2u(window.atob(B)).buffer,
		U2a: U => Y.B2a(Y.U2B(U)),
		U2u: U => B.u8(Y.U2a(U)),
		B2U: B => (B ? B.split('+').join('-').split(P).join('_').split('=').join(E) : B),
		U2B: U => {
			const l = U.length,
				c = l % 4 > 0 ? 4 - (l % 4) : 0;
			let B = U.split('-').join('+').split('_').join(P);
			for (let i = 0; i < c; i++) B += '=';
			return B;
		},
		as: (ab, s, e) => B.u8(ab).subarray(s, e),
		az: (ab, o, m = { s: 0 }) => {
			const u = B.u8(o),
				s = B.u8(ab).subarray(m.s, (m.s += o || m.s));
			for (let i = 0; i < o; i++) u[i] = s[i];
			return u;
		},
		af: [],
		bP: () => {
			for (let i = 0; i < 7; i++) Y.af[i] = Math.pow(256, i);
		},
		i2u: (i, l) => {
			const u = B.u8(l).fill(0),
				p = 256;
			let j = i;
			for (let k = 0; k < l; k++) {
				const m = j / p;
				u[k] = j % p;
				if (m < 1) break;
				j = Math.floor(m);
			}
			return u;
		},
		u2i: u => {
			const l = u.length > 7 ? 7 : u.length;
			let j = 0;
			for (let i = 0; i < l; i++) j += u[i] * Y.af[i];
			return j;
		},
		jud: (s, t) => {
			const c = s.byteLength,
				l = c + t.byteLength,
				a = B.u8(l);
			a.set(s, 0);
			a.set(t, c);
			return a;
		},
		jus: s => {
			let l = 0,
				o = 0;
			for (const i of s) l += i.byteLength ? Y.b(i) : gBl(i);
			const a = B.u8(l);
			for (const i of s) {
				a.set(i.byteLength ? B.u8(i) : i, o);
				o += i.byteLength ? Y.b(i) : gBl(i);
			}
			return a;
		},
		u2b: u => {
			const r = [];
			for (const e of u) r.push(String.fromCharCode(e));
			return r.join(E);
		},
		b2u: bs => {
			const l = bs.length,
				a = B.u8(new ArrayBuffer(l));
			for (let i = 0; i < l; i++) a[i] = bs.charCodeAt(i);
			return a;
		},
		a: m => new Response(m).arrayBuffer(),
		b: ab => ab.byteLength,
		c: ab => Y.a(new Response(ab).body.pipeThrough(new CompressionStream('gzip'))),
		d: ab => Y.a(new Blob([ab]).stream().pipeThrough(new DecompressionStream('gzip'))),
		u: async () => {
			const str = JSON.stringify({ a: 1 }),
				compressed = await Y.d(str),
				restored = await Y.c(compressed);
			console.assert(str === restored);
		},
		h2i: h => parseInt(h, 16),
		h2u: h => {
			const l = Math.ceil(h.length / 2),
				u8a = B.u8(l);
			for (let i = 0; i < l; i++) {
				const j = i * 2,
					k = j + 2;
				u8a[i] = parseInt(h.slice(j, k), 16);
			}
			return u8a;
		},
		h2B: h => Y.u2B(Y.h2u(h)),
	};
Y.bP();

const htmlEscapeChars = {
		'&': '&amp;',
		'"': '&quot;',
		"'": '&apos;',
		'>': '&gt;',
		'<': '&lt;',
	},
	READ_UNIT = 4 * 1024,
	MIME_TYPES = {
		txt: 'text/plain',
		htm: 'text/html',
		html: 'text/html',
		css: 'text/css',
		csv: 'text/csv',
		js: 'application/javascript',
		xml: 'application/xml',
		xhtml: 'application/xhtml+xml',
		json: 'application/json',
		zip: 'application/zip',
		gz: 'application/gzip',
		pdf: 'application/pdf',
		tar: 'application/x-tar',
		'7z': 'application/x-7z-compressed',
		ts: 'application/typescript',
		woff: 'font/woff',
		woff2: 'font/woff2',
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		png: 'image/png',
		gif: 'image/gif',
		svg: 'image/svg+xml',
		ico: 'image/x-icon',
		bin: 'application/octet-stream',
	};

const U = {
	isKaluma: false,
	escapeHtml: s => {
		const p = s.split('');
		for (let i = 0, l = P.length; i < l; i++) {
			const n = htmlEscapeChars[p[i]];
			if (n) p[i] = n;
		}
		return p.join('');
	},
	isExistFile: async (p, timeout = 3000) => {
		D('isExistFile 1 p:' + p);
		const fp = p.split('//').join('/'),
			f = U.isKaluma ? U.iefKaluma : U.iefNode;
		D('isExistFile 2 fp:' + fp);
		return await f(fp, timeout);
	},
	iefKaluma: fp => {
		try {
			const stat = fs.stat(fp);
			L((stat.isFile() ? 'ファイル' : stat.isDirectory() ? 'ディレクトリ' : '不明') + 'です', stat);
			return true;
		} catch (e) {
			L(`error at fs.stat fp:${fp}/e:`, e);
		}
		return false;
	},
	iefNode: (fp, timeout = 3000) => {
		return new Promise(r => {
			let compl = false;

			// タイムアウト処理：指定時間内にコールバックが呼ばれなければ false を返す
			const tid = setTimeout(() => {
				if (!compl) {
					L(`fs.stat timeout for: ${fp}`);
					compl = true;
					r(false);
				}
			}, timeout);
			try {
				fs.stat(fp, (er, stat) => {
					// 既にタイムアウトで完了している場合はスキップ
					if (compl) return;

					compl = true;
					clearTimeout(tid);

					L(`p:${fp}`);
					if (er) {
						L(er.code === 'ENOENT' ? 'ファイル・ディレクトリは存在しません。' : er.message);
						r(false);
					} else {
						L((stat.isFile() ? 'ファイル' : stat.isDirectory() ? 'ディレクトリ' : '不明') + 'です', stat);
						r(true);
					}
				});
			} catch (e) {
				L(`error at fs.stat fp:${fp}/e:`, e);
				r(false);
			}
		});
	},
	listFiles: async p => {
		const fp = p.split('//').join('/'),
			f = U.isKaluma ? U.lfKaluma : U.lfNode;
		D('listFiles 2 fp:' + fp);
		return await f(fp);
	},
	lfKaluma: fp => {
		D('listFilesKaluma 1 fp:' + fp);
		const items = fs.readdir(fp);
		D('listFilesKaluma 2 items:', items);
		return items.map(name => path.join(fp, name));
	},
	lfNode: fp =>
		new Promise(r => {
			D('listFilesNode 1 fp:' + fp);
			fs.readdir(fp, (err, items) => {
				D('listFilesNode 2 items:', items);
				if (err) return r(err);
				r(items.map(name => path.join(fp, name)));
			});
		}),
	readFile: async (p, len, writeCB) => {
		if (len <= 0) return null;
		const fp = p.split('//').join('/'),
			f = U.isKaluma ? U.rfKaluma : U.rfNode;
		D('readFile 2 fp:' + fp);
		return await f(fp, len, writeCB);
	},
	rfKaluma: async (fp, len, writeCallBack) => {
		const fd = fs.open(fp),
			c = Math.ceil(len / READ_UNIT);
		for (let i = 0; i < c; i++) {
			const s = READ_UNIT * i,
				t = s + READ_UNIT,
				e = t > len ? len : t,
				d = e - s,
				buf = new Uint8Array(d);
			fs.read(fd, buf, 0, d, s);
			await writeCallBack(buf);
		}
		fs.close(fd);
	},
	rfNode: (path, length, writeCallBack) =>
		length <= 0
			? null
			: new Promise(r => {
					fs.open(path, 'r', async (err, fd) => {
						if (err) return L('ファイルが開けない');
						// with open(file_phys_path, 'rb') as f:
						fs.read(fd, async (err, br, buf) => {
							L(`read ${err},${br}, ${buf}`);
							const ro = 0;
							if (err) console.error(err);
							if (br >= ro + READ_UNIT) await writeCallBack(buf);
							else if (br > ro) await writeCallBack(buf.subarray(0, br - ro));
							fs.close(fd);
							r();
						});
					});
				}),
	getMineTypeFromExt: fp => {
		const mt = MIME_TYPES[fp.toLowerCase().split('.').pop()];
		return mt ? mt : 'application/octet-stream';
	},
	getFileSize: p => {
		try {
			const s = fs.statSync ? fs.statSync(p) : fs.stat(p);
			return s.size;
		} catch (e) {
			L(e);
		}
		return 0;
	},
};

export const TMiniWebServerUtil = U,
	HttpStatusCode = {
		SWITCH_PROTOCOLS: 101,
		OK: 200,
		CREATED: 201,
		ACCEPTED: 202,
		NON_AUTHORITATIVE_INFORMATION: 203,
		NO_CONTENT: 204,
		RESET_CONTENT: 205,
		PARTIAL_CONTENT: 206,

		MULTIPLE_CHOICES: 300,
		MOVED_PERMANENTLY: 301,
		FOUND: 302,
		SEE_OTHER: 303,
		NOT_MODIFIED: 304,
		USE_PROXY: 305,
		TEMPORARY_REDIRECT: 307,

		BAD_REQUEST: 400,
		UNAUTHORIZED: 401,
		PAYMENT_REQUIRED: 402,
		FORBIDDEN: 403,
		NOT_FOUND: 404,
		METHOD_NOT_ALLOWED: 405,
		NOT_ACCEPTABLE: 406,
		PROXY_AUTHENTICATION_REQUIRED: 407,
		REQUEST_TIMEOUT: 408,
		CONFLICT: 409,
		GONE: 410,
		LENGTH_REQUIRED: 411,
		PRECONDITION_FAILED: 412,
		REQUEST_ENTITY_TOO_LARGE: 413,
		REQUEST_URI_TOO_LONG: 414,
		UNSUPPORTED_MEDIA_TYPE: 415,
		REQUESTED_RANGE_NOT_SATISFIABLE: 416,
		EXPECTATION_FAILED: 417,

		INTERNAL_SERVER_ERROR: 500,
		NOT_IMPLEMENTED: 501,
		BAD_GATEWAY: 502,
		SERVICE_UNAVAILABLE: 503,
		GATEWAY_TIMEOUT: 504,
		HTTP_VERSION_NOT_SUPPORTED: 505,
	};
