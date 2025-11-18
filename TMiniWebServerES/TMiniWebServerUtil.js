import fs from 'fs';

const te = new TextEncoder();
const td = new TextDecoder(),
	E = '',
	P = '/',
	gBl = b => b.byteLength;
export class B {
	static u8 = a => new Uint8Array(a);
}
export class Y {
	static isSameAb = (abA, abB) => Y.a2B(abA) === Y.a2B(abB); //バイナリ処理モジュール
	static isB64 = (s = E) => s % 4 === 0 && /[+/=0-9a-zA-Z]+/.test(s);
	static s2u = s => te.encode(s);
	static u2s = u => td.decode(u);
	static a2B = i => btoa(Y.u2b(B.u8(i.buffer ? i.buffer : i)));
	static u2B = u => btoa(Y.u2b(u));
	static a2U = a => Y.B2U(Y.a2B(a));
	static u2U = u => Y.B2U(Y.u2B(u));
	static B2a = B => Y.b2u(window.atob(B)).buffer;
	static U2a = U => Y.B2a(Y.U2B(U));
	static U2u = U => B.u8(Y.U2a(U));
	static B2U = B => (B ? B.split('+').join('-').split(P).join('_').split('=').join(E) : B);
	static U2B(U) {
		const l = U.length,
			c = l % 4 > 0 ? 4 - (l % 4) : 0;
		let B = U.split('-').join('+').split('_').join(P);
		for (let i = 0; i < c; i++) B += '=';
		return B;
	}
	static as = (ab, s, e) => B.u8(ab).subarray(s, e);
	static az = (ab, o, m = { s: 0 }) => {
		const u = B.u8(o),
			s = B.u8(ab).subarray(m.s, (m.s += o || m.s));
		for (let i = 0; i < o; i++) u[i] = s[i];
		return u;
	};
	static af = [];
	static bP = () => {
		for (let i = 0; i < 7; i++) Y.af[i] = Math.pow(256, i);
	};
	static i2u = (i, l) => {
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
	};
	static u2i = u => {
		const l = u.length > 7 ? 7 : u.length;
		let j = 0;
		for (let i = 0; i < l; i++) j += u[i] * Y.af[i];
		return j;
	};
	static jud(s, t) {
		const c = s.byteLength,
			l = c + t.byteLength,
			a = B.u8(l);
		a.set(s, 0);
		a.set(t, c);
		return a;
	}
	static jus(s) {
		let l = 0,
			o = 0;
		for (const i of s) l += i.byteLength ? Y.b(i) : gBl(i);
		const a = B.u8(l);
		// console.log('jus s:', s);
		for (const i of s) {
			// console.log('jus', i, o, l, s);
			a.set(i.byteLength ? B.u8(i) : i, o);
			o += i.byteLength ? Y.b(i) : gBl(i);
		}
		return a;
	}
	static u2b(u) {
		const r = [];
		for (const e of u) r.push(String.fromCharCode(e));
		return r.join(E);
	}
	static b2u(bs) {
		const l = bs.length,
			a = B.u8(new ArrayBuffer(l));
		for (let i = 0; i < l; i++) a[i] = bs.charCodeAt(i);
		return a;
	}
	static a = m => new Response(m).arrayBuffer();
	static b = ab => ab.byteLength;
	static c = ab => Y.a(new Response(ab).body.pipeThrough(new CompressionStream('gzip')));
	static d = ab => Y.a(new Blob([ab]).stream().pipeThrough(new DecompressionStream('gzip')));
	static u = async () => {
		// usage
		const json = { a: 1 };
		const str = JSON.stringify(json);
		const compressed = await Y.d(str);
		const restored = await Y.c(compressed);
		console.assert(str === restored);
	};
	static h2i = h => parseInt(h, 16);
	static h2u = h => {
		const l = Math.ceil(h.length / 2);
		const u8a = B.u8(l);
		for (let i = 0; i < l; i++) {
			const j = i * 2;
			const k = j + 2;
			u8a[i] = parseInt(h.slice(j, k), 16);
		}
		return u8a;
	};
	static h2B = h => Y.u2B(Y.h2u(h));
}
Y.bP();

const _html_escape_chars = {
	'&': '&amp;',
	'"': '&quot;',
	"'": '&apos;',
	'>': '&gt;',
	'<': '&lt;',
};
const READ_UNIT = 4 * 1024;

const MIME_TYPES = {
	'.txt': 'text/plain',
	'.htm': 'text/html',
	'.html': 'text/html',
	'.css': 'text/css',
	'.csv': 'text/csv',
	'.js': 'application/javascript',
	'.xml': 'application/xml',
	'.xhtml': 'application/xhtml+xml',
	'.json': 'application/json',
	'.zip': 'application/zip',
	'.gz': 'application/gzip',
	'.pdf': 'application/pdf',
	'.tar': 'application/x-tar',
	'.7z': 'application/x-7z-compressed',
	'.ts': 'application/typescript',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.gif': 'image/gif',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
	'.bin': 'application/octet-stream',
};

export class TMiniWebServerUtil {
	static escape_html = s => {
		const p = s.split('');
		for (let i = 0; i < p.length; i++) {
			const v = p[i];
			const n = _html_escape_chars[v];
			if (n) p[i] = n;
		}
		return p.join('');
	};
	//  ''.join(TMiniWebServerUtil._html_escape_chars.get(c,c) for c in s)

	static isExistFile = path => {
		return new Promise(resolve =>
			fs.stat(path, (er, stat) => {
				resolve(!er);
				if (er) console.log(er.code === 'ENOENT' ? 'ファイル・ディレクトリは存在しません。' : er.message);
				else
					console.log(
						(stat.isFile() ? 'ファイル' : stat.isDirectory() ? 'ディレクトリ' : '不明') + 'です',
						stat
					);
			})
		);
	};
	static readFile(path, length, writeCallBack) {
		if (length <= 0) return null;
		return new Promise(resolve => {
			fs.open(path, 'r', async (err, fd) => {
				if (err) return console.log('ファイルが開けない');
				// with open(file_phys_path, 'rb') as f:
				fs.read(fd, async (err, byteRead, buf) => {
					console.log(`read ${err},${byteRead}, ${buf}`);
					const readOffset = 0;
					if (err) console.error(err);
					if (byteRead >= readOffset + READ_UNIT) await writeCallBack(buf);
					else if (byteRead > readOffset) await writeCallBack(buf.subarray(0, byteRead - readOffset));
					fs.close(fd);
					resolve();
				});
			});
		});
	}

	static getMineTypeFromExt = file_path => {
		const path = file_path.toLowerCase();
		for (const ext in MIME_TYPES) if (path.endsWith(ext)) return MIME_TYPES[ext];
		return 'application/octet-stream';
	};
	static getFileSize = path => {
		try {
			const stats = fs.statSync ? fs.statSync(path) : fs.stat(path);
			return stats.size;
		} catch (e) {
			console.log(e);
		}
		return 0;
	};
}

export const HttpStatusCode = {
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
