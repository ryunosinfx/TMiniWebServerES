export const te = new TextEncoder('utf-8'),
	td = new TextDecoder('utf-8'),
	cy = crypto.subtle,
	T = true,
	F = false,
	N = null,
	E = '',
	P = '/',
	SALT =
		'メロスは激怒した。必ず、かの邪智暴虐じゃちぼうぎゃくの王を除かなければならぬと決意した。メロスには政治がわからぬ。メロスは、村の牧人である。笛を吹き、羊と遊んで暮して来た。けれども邪悪に対しては、人一倍に敏感であった。',
	gBl = b => b.byteLength,
	n16 = Math.pow(2, 16),
	now = () => Date.now(),
	crv = t => crypto.getRandomValues(t),
	pr = f => new Promise(f),
	isFn = s => typeof s === 'function',
	isStr = s => typeof s === 'string',
	isArr = a => Array.isArray(a),
	cb = a => a,
	io = (...a) => console.info(a),
	w = (...a) => console.warn(a),
	err = (...a) => console.error(a),
	ef = (e, id = E, l = N) => {
		cb(w(`${id} ${e.message}`), w(e.stack));
		if (l && isFn(l)) cb(l(`${id} ${e.message}`), l(e.stack));
		return N;
	};
export class H {
	static async d(m, sc = 1, algo = 'SHA-256', isAB = F) {
		let r = m.buffer ? (m instanceof Uint8Array ? Y.dpU(m) : B.u8(m.buffer)) : te.encode(m); //ハッシュ処理
		for (let i = 0; i < sc; i++) r = await cy.digest(algo, r);
		return isAB ? r : Y.a2U(r);
	}
}
export class B {
	static u8 = a => new Uint8Array(a);
	static u32 = a => new Uint32Array(a);
	static i32 = a => new Int32Array(a);
}
export class Y {
	static isSameAb = (abA, abB) => Y.a2B(abA) === Y.a2B(abB); //バイナリ処理モジュール
	static isB64 = (s = E) => s % 4 === 0 && /[+/=0-9a-zA-Z]+/.test(s);
	static s2u = s => te.encode(s);
	static u2s = u => td.decode(u);
	static a2B = i => window.btoa(Y.u2b(B.u8(i.buffer ? i.buffer : i)));
	static u2B = u => window.btoa(Y.u2b(u));
	static u2I(u) {
		const f = B.u8(4),
			l = u.length,
			n = Math.ceil(l / 4),
			i32a = B.i32(n);
		for (let i = 0; i < n; i++) {
			f[0] = u[i + 0];
			f[1] = l < i + 1 ? 0 : u[i + 1];
			f[2] = l < i + 2 ? 0 : u[i + 2];
			f[3] = l < i + 3 ? 0 : u[i + 3];
			i32a[i] = B.i32(f.buffer)[0];
		}
		return i32a;
	}
	static u8a2u32a(u) {
		const f = B.u8(4),
			l = u.length,
			n = Math.ceil(l / 4),
			u32a = B.u32(n);
		for (let i = 0; i < n; i++) {
			f[0] = u[i + 0];
			f[1] = l < i + 1 ? 0 : u[i + 1];
			f[2] = l < i + 2 ? 0 : u[i + 2];
			f[3] = l < i + 3 ? 0 : u[i + 3];
			u32a[i] = B.u32(f.buffer)[0];
		}
		return u32a;
	}
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
	static L2a = b =>
		pr(r => {
			const fr = new FileReader();
			fr.onload = () => r(fr.result);
			fr.onerror = () => cb(r(fr.error), err(fr.error));
			fr.readAsArrayBuffer(b);
		});
	static dpU(u) {
		const l = u.length,
			n = B.u8(l);
		for (let i = 0; i < l; i++) n[i] = u[i];
		return n;
	}
	static N2u(n) {
		let a = n;
		const p = [];
		while (Math.abs(a) > 0) {
			p.unshift(a % 256);
			a = a >> 8;
		}
		const l = p.length,
			u = B.u8(l);
		for (let i = 0; i < l; i++) u[i] = p[i];
		return u;
	}
	static a = m => new Response(m).arrayBuffer();
	static b = gBl;
	static c = ab => Y.a(new Response(ab).body.pipeThrough(new CompressionStream('gzip')));
	static d = ab => Y.a(new Blob([ab]).stream().pipeThrough(new DecompressionStream('gzip')));
	static u = async () => {
		// usage
		const json = { a: 1 },
			str = JSON.stringify(json),
			compressed = await Y.d(str),
			restored = await Y.c(compressed);
		console.assert(str === restored);
	};
}
Y.bP();
const ed = ['encrypt', 'decrypt'],
	eO = ['encrypt'],
	dO = ['decrypt'],
	sv = ['sign', 'verify'],
	sO = ['sign'],
	vO = ['verify'],
	dV = ['deriveKey'];
//AES-GCM暗号化
export class Cy {
	static async gK(p, s) {
		const k = await cy.deriveKey(
			{
				name: 'PBKDF2',
				salt: s,
				iterations: 100000,
				hash: 'SHA-256',
			},
			await cy.importKey(
				'raw',
				await H.d(p.byteLength ? p : Y.s2u(p).buffer, 100, 'SHA-256', T),
				{ name: 'PBKDF2' },
				F,
				dV
			),
			{ name: 'AES-GCM', length: 256 },
			F,
			ed
		);
		return [k, s];
	}
	static gS = (saltI, isAB) => (saltI ? (isAB ? B.u8(saltI) : Y.s2u(saltI)) : crv(B.u8(16))); //soaltを生成
	static importKeyAESGCM = async (kAb, usages = ed) => await cy.importKey('raw', kAb, { name: 'AES-GCM' }, T, usages);
	static gFF = () => crv(B.u8(12)); //Random Vec
	static gIF = () => crv(B.u32(1)); //Random Vec
	static srand = () => crv(B.u32(1))[0] / 4294967295;
	static rd = n =>
		n / n16 > 1
			? new Array(Math.ceil(n / n16))
					.fill(0)
					.reduce(a => Y.jud(a, crv(B.u8(n - a.byteLength > n16 ? n16 : n - a.byteLength))), B.u8(0))
			: crv(B.u8(n));
	static enc = async (s, pk) => await Cy.encAES256GCM(Y.s2u(s), pk);
	static async eA256Gbare(ab, pk, saltI = N, isAB = F) {
		const s = Cy.gS(saltI, isAB),
			iv = Uint8Array.from([...Cy.gFF(), ...B.u8(Cy.gIF().buffer)]),
			edAb = await cy.encrypt({ name: 'AES-GCM', iv }, await Cy.lk(pk, s), ab);
		return [edAb, iv.buffer, s.buffer]; // 形式は固定[EncryptData(base64url),iv(base64url),salt(base64url)]
	}
	static async encAES256GCM(u, pk, saltI = N, isAB = F, isS = T) {
		const a = await Cy.eA256Gbare(u.buffer, pk, saltI, isAB);
		return isS ? [Y.a2U(a[0]), Y.a2U(a[1]), Y.a2U(a[2])].join(',') : a; // 形式は固定[EncryptData(base64url),iv(base64url),salt(base64url)]
	}
	static dec = async (ers, pk) => Y.u2s(await Cy.decAES256GCM(ers, pk));
	static lk = async (pk, s) => (await Cy.gK(pk, isStr(s) ? B.u8(Y.U2a(s)) : s))[0]; //loadKey
	static async decAES256GCM(ers, p) {
		const [U, ip, s] = ers.split(',');
		return B.u8(await Cy.dA256Gbare(Y.U2a(U), Y.U2a(ip), s, p));
	}
	static async dA256Gbare(ab, iv, s, p) {
		try {
			return await cy.decrypt({ name: 'AES-GCM', iv: B.u8(iv) }, await Cy.lk(p, s), ab);
		} catch (e) {
			return ef(e);
		}
	}
	static ps = {
		name: 'RSA-OAEP',
		modulusLength: 4096,
		publicExponent: B.u8([1, 0, 1]),
		hash: 'SHA-512',
	};
	static es = {
		name: 'ECDSA',
		namedCurve: 'P-384',
		hash: { name: 'SHA-384' },
	};
	static gKPrE = () => cy.generateKey(Cy.ps, T, ed); // rsa-oerp:公開鍵での暗号化用キー作成
	static gKPr = async () => {
		const a = await Cy.gKPrE(); // rsa-oerp:公開鍵での暗号化用キー作成
		return { pu: await Cy.eKRu(a.publicKey), pr: await Cy.eKRr(a.privateKey) };
	};
	static gKPe = async () => {
		const a = await Cy.gKPeE(); // ECDSA署名用キー作成
		console.log('!!!!gKPe', a, await Cy.eKEu(a.publicKey));
		return { pu: await Cy.eKEu(a.publicKey), pr: await Cy.eKEr(a.privateKey) };
	};
	static gKPeE = () => cy.generateKey(Cy.es, T, sv); // ECDSA署名用キー作成
	static eK = async (k, t) => Y.a2U(await cy.exportKey(t, k)); //Base64Urlで出力
	static iK = (u, t, s, o) => cy.importKey(t, Y.U2a(u), s, F, o); // return Promise
	static eKRu = k => Cy.eK(k, 'spki'); //Base64Urlで出力 return promise for sign
	static eKRr = k => Cy.eK(k, 'pkcs8'); //Base64Urlで出力 return promise for verify
	static eKEu = k => Cy.eK(k, 'spki'); //Base64Urlで出力 return promise for sign
	static eKEr = k => Cy.eK(k, 'pkcs8'); //Base64Urlで出力 return promise for verify
	static iKRu = k => Cy.iK(k, 'spki', Cy.ps, eO); //Base64Urlで入力 return promise for encrypt
	static iKRr = k => Cy.iK(k, 'pkcs8', Cy.ps, dO); //Base64Urlで入力 return promise for decrypt
	static iKEu = k => Cy.iK(k, 'spki', Cy.es, vO); //Base64Urlで入力 return promise for verify
	static iKEr = k => Cy.iK(k, 'pkcs8', Cy.es, sO); //Base64Urlで入力 return promise for sign
	static s = async (pr, ab) => await cy.sign(Cy.es, pr, ab); // sign
	static v = async (pu, abS, abD) => await cy.verify(Cy.es, pu, abS, abD); //verify
	static pE = async (pu, ab) => await cy.encrypt(Cy.ps, pu, ab); //公開鍵で暗号化,keyはab、入力はab
	static pD = async (pr, ab) => await cy.decrypt(Cy.ps, pr, ab); //秘密鍵で復号化,keyはab、入力出力ともにab
	static uuid = () => self.crypto.randomUUID();
	static ePP = async (ab, puKr, prKe) => {
		const a = await H.d(Cy.uuid() + SALT + now(), 100, 'SHA-512', T), //main key
			s = await Cy.s(await Cy.iKEr(prKe), a), //signature
			e = await Cy.pE(await Cy.iKRu(puKr), a), //encrypted
			ed = await Cy.eA256Gbare(ab, a), //[encryptData,iv,salt]
			da = ed[0], //data
			dl = Y.b(da), //byteLength
			iv = ed[1], //init vector
			sa = ed[2], //salt
			hd = Y.i2u(dl, 8), //64bitだが実質57bit
			d = Y.jus([hd, s, e, iv, sa, da]),
			zip = await Y.c(d); //圧縮
		return zip; //ab
	};
	static dPP = async (ab, puKe, prKr) => {
		try {
			const p = await Y.d(ab), //圧縮データを展開
				m = { s: 0 },
				l = { s: 0 },
				hd = B.u8(Y.az(p, 8, m)), //ヘッダ8byte
				dlua = Y.az(hd, 8, l),
				dlu = Y.u2i(dlua), //57bit
				s = Y.az(p, 96, m), //96
				e = Y.az(p, 512, m), //512
				iv = Y.az(p, 16, m), //init vector 16
				sa = Y.az(p, 16, m), //salt 16
				ed = Y.az(p, dlu, m), //data
				k = await Cy.pD(await Cy.iKRr(prKr), e.buffer), //秘密鍵で復号化,
				iV = await Cy.v(await Cy.iKEu(puKe), s.buffer, k), //公開鍵で署名検証
				d = iV ? await Cy.dA256Gbare(ed.buffer, iv.buffer, sa, k) : N; //OKな場合のみ復号
			return d;
		} catch (e) {
			io(e);
			return N;
		}
	};
}
