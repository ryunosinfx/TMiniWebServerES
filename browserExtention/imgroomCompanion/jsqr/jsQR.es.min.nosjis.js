/* 10 */
class W {
	static u8a = (s) => new Uint8Array(s);
	static dc4DURI(dURI) {
		return new Promise((r) => {
			const i = new Image();
			i.onload = () => {
				const c = document.createElement('canvas'),
					s = (c.width = c.height = i.width),
					l = s * s * 4;
				const x = c.getContext('2d');
				x.drawImage(i, 0, 0);
				const d = x.getImageData(0, 0, s, s),
					n = d.data,
					b = (n[l - 2] << 8) + n[l - 3],
					u = W.u8a(b);
				for (let j = 0, k = 0; k < b; j++) if (j % 4 !== 3) u[k++] = n[j];
				r(u);
			};
			i.src = dURI;
		});
	}
	static v =
		'{"a":"infoBits","b":"versionNumber","c":"alignmentPatternCenters","d":"errorCorrectionLevels","e":"ecCodewordsPerBlock","f":"ecBlocks","g":"numBlocks","h":"dataCodewordsPerBlock"}';
	static D =
		'<a@,b1/^7.1,h19%e10.1,h16%e13.1,h13%e17.1,h9#a@,b2/6,18^10.1,h34%e16.1,h28%e22.1,h22%e28.1,h16#a@,b3/6,22^15.1,h55%e26.1,h44%e18.2,h17%e22.2,h13#a@,b4/6,26^20.1,h80%e18.2,h32%e26.2,h24%e16.4,h9#a@,b5/6,30^26.1,h108%e24.2,h43%e18.2,h15=g2,h16%e22.2,h11=g2,h12#a@,b6/6,34^18.2,h68%e16.4,h27%e24.4,h19%e28.4,h15#a31892,b7/6,22,38^20.2,h78%e18.4,h31%e18.2,h14=g4,h15%e26.4,h13=g1,h14#a34236,b8/6,24,42^24.2,h97%e22.2,h38=g2,h39%e22.4,h18=g2,h19%e26.4,h14=g2,h15#a39577,b9/6,26,46^30.2,h116%e22.3,h36=g2,h37%e20.4,h16=g4,h17%e24.4,h12=g4,h13#a42195,b10/6,28,50^18.2,h68=g2,h69%e26.4,h43=g1,h44%e24.6,h19=g2,h20%e28.6,h15=g2,h16#a48118,b11/6,30,54^20.4,h81%e30.1,h50=g4,h51%e28.4,h22=g4,h23%e24.3,h12=g8,h13#a51042,b12/6,32,58^24.2,h92=g2,h93%e22.6,h36=g2,h37%e26.4,h20=g6,h21%e28.7,h14=g4,h15#a55367,b13/6,34,62^26.4,h107%e22.8,h37=g1,h38%e24.8,h20=g4,h21%e22.12,h11=g4,h12#a58893,b14/6,26,46,66^30.3,h115=g1,h116%e24.4,h40=g5,h41%e20.11,h16=g5,h17%e24.11,h12=g5,h13#a63784,b15/6,26,48,70^22.5,h87=g1,h88%e24.5,h41=g5,h42%e30.5,h24=g7,h25%e24.11,h12=g7,h13#a68472,b16/6,26,50,74^24.5,h98=g1,h99%e28.7,h45=g3,h46%e24.15,h19=g2,h20%e30.3,h15=g13,h16#a70749,b17/6,30,54,78^28.1,h107=g5,h108%e28.10,h46=g1,h47%e28.1,h22=g15,h23%e28.2,h14=g17,h15#a76311,b18/6,30,56,82^30.5,h120=g1,h121%e26.9,h43=g4,h44%e28.17,h22=g1,h23%e28.2,h14=g19,h15#a79154,b19/6,30,58,86^28.3,h113=g4,h114%e26.3,h44=g11,h45%e26.17,h21=g4,h22%e26.9,h13=g16,h14#a84390,b20/6,34,62,90^28.3,h107=g5,h108%e26.3,h41=g13,h42%e30.15,h24=g5,h25%e28.15,h15=g10,h16#a87683,b21/6,28,50,72,94^28.4,h116=g4,h117%e26.17,h42%e28.17,h22=g6,h23%e30.19,h16=g6,h17#a92361,b22/6,26,50,74,98^28.2,h111=g7,h112%e28.17,h46%e30.7,h24=g16,h25%e24.34,h13#a96236,b23/6,30,54,74,102^30.4,h121=g5,h122%e28.4,h47=g14,h48%e30.11,h24=g14,h25%e30.16,h15=g14,h16#a102084,b24/6,28,54,80,106^30.6,h117=g4,h118%e28.6,h45=g14,h46%e30.11,h24=g16,h25%e30.30,h16=g2,h17#a102881,b25/6,32,58,84,110^26.8,h106=g4,h107%e28.8,h47=g13,h48%e30.7,h24=g22,h25%e30.22,h15=g13,h16#a110507,b26/6,30,58,86,114^28.10,h114=g2,h115%e28.19,h46=g4,h47%e28.28,h22=g6,h23%e30.33,h16=g4,h17#a110734,b27/6,34,62,90,118^30.8,h122=g4,h123%e28.22,h45=g3,h46%e30.8,h23=g26,h24%e30.12,h15=g28,h16#a117786,b28/6,26,50,74,98,122^30.3,h117=g10,h118%e28.3,h45=g23,h46%e30.4,h24=g31,h25%e30.11,h15=g31,h16#a119615,b29/6,30,54,78,102,126^30.7,h116=g7,h117%e28.21,h45=g7,h46%e30.1,h23=g37,h24%e30.19,h15=g26,h16#a126325,b30/6,26,52,78,104,130^30.5,h115=g10,h116%e28.19,h47=g10,h48%e30.15,h24=g25,h25%e30.23,h15=g25,h16#a127568,b31/6,30,56,82,108,134^30.13,h115=g3,h116%e28.2,h46=g29,h47%e30.42,h24=g1,h25%e30.23,h15=g28,h16#a133589,b32/6,34,60,86,112,138^30.17,h115%e28.10,h46=g23,h47%e30.10,h24=g35,h25%e30.19,h15=g35,h16#a136944,b33/6,30,58,86,114,142^30.17,h115=g1,h116%e28.14,h46=g21,h47%e30.29,h24=g19,h25%e30.11,h15=g46,h16#a141498,b34/6,34,62,90,118,146^30.13,h115=g6,h116%e28.14,h46=g23,h47%e30.44,h24=g7,h25%e30.59,h16=g1,h17#a145311,b35/6,30,54,78,102,126,150^30.12,h121=g7,h122%e28.12,h47=g26,h48%e30.39,h24=g14,h25%e30.22,h15=g41,h16#a150283,b36/6,24,50,76,102,128,154^30.6,h121=g14,h122%e28.6,h47=g34,h48%e30.46,h24=g10,h25%e30.2,h15=g64,h16#a152622,b37/6,28,54,80,106,132,158^30.17,h122=g4,h123%e28.29,h46=g14,h47%e30.49,h24=g10,h25%e30.24,h15=g46,h16#a158308,b38/6,32,58,84,110,136,162^30.4,h122=g18,h123%e28.13,h46=g32,h47%e30.48,h24=g14,h25%e30.42,h15=g32,h16#a161089,b39/6,26,54,82,110,138,166^30.20,h117=g4,h118%e28.40,h47=g7,h48%e30.43,h24=g22,h25%e30.10,h15=g67,h16#a167017,b40/6,30,58,86,114,142,170^30.19,h118=g6,h119%e28.18,h47=g31,h48%e30.34,h24=g34,h25%e30.20,h15=g61,h16>>>';

	static gK = (k, m, s) => (m[k] ? m[k] : (m[k] = s[Object.keys(m).length]));
	static p = [
		['"', ''],
		[':', ''],
		['},{', '='],
		['[{', '<'],
		['}]', '>'],
		['>>=', '#'],
		['>=', '%'],
		['null', '@'],
		[',f<g', '.'],
		[',c[', '/'],
		['],d<e', '^'],
	];
	static ej(j, p = W.p) {
		let a = j;
		for (const q of p) a = q[0] ? a.split(q[0]).join(q[1]) : a;
		return a;
	}
	static dj(j, vm) {
		let p = JSON.parse(JSON.stringify(W.p));
		for (const r of p) r.reverse();
		p.reverse();
		let a = W.ej(j, p);
		for (const k in vm) a = a.split(k).join(`"${k}":`);
		return a;
	}
	static vd(o, m) {
		if (Array.isArray(o)) for (const r of o) W.vd(r, m);
		else if (typeof o === 'object') {
			for (const k in o) {
				const v = o[k];
				delete o[k];
				o[m[k]] = v;
				W.vd(v, m);
			}
		}
	}
	static async gV() {
		const v = JSON.parse(W.v),
			m = JSON.parse(W.dj(W.D, v));
		W.vd(m, v);
		return m;
	}
	static dp(a) {
		const m = {},
			l = a.length;
		for (let c = 0; c < l; c += 4) m[((a[c + 0] << 8) | a[c + 1]) + ''] = (a[c + 2] << 8) | a[c + 3];
		return m;
	}
	static V = null;
	static async init() {
		if (W.V) return;
		W.V = await W.gV();
	}
	static u8ca = (s) => new Uint8ClampedArray(s);
	static u8cf = (s) => Uint8ClampedArray.from(s);
	static e(m) {
		throw new Error(m);
	}
	static cat = (b, a) => Array.prototype.push.apply(b, a);
	static A = (s) => new Array(s);
	static n = (m, n, l) => (console.log(m, n, l) ? null : null);
	static T = true;
}
/*0 BitMatrix*/
class BM {
	constructor(d, w) {
		this.w = w;
		this.h = d.length / w;
		this.d = d;
	}
	static c = (w, h) => new BM(W.u8ca(w * h), w);
	g(x, y) {
		return x < 0 || x >= this.w || y < 0 || y >= this.h ? false : !!this.d[y * this.w + x];
	}
	s(x, y, v) {
		this.d[y * this.w + x] = v ? 1 : 0;
	}
	r(l, t, w, h, v) {
		for (let y = t; y < t + h; y++) for (let x = l; x < l + w; x++) this.s(x, y, !!v);
	}
}
/* 1 GenericGF*/
class GF {
	static a = (a, b) => a ^ b;
	constructor(p, s, g) {
		const z = this;
		z.p = p;
		z.s = s;
		z.g = g;
		z.E = W.A(z.s);
		z.L = W.A(z.s);
		let x = 1;
		for (let i = 0; i < z.s; i++) {
			z.E[i] = x;
			x = x * 2;
			if (x >= z.s) x = (x ^ z.p) & (z.s - 1);
		}
		for (let i = 0; i < z.s - 1; i++) z.L[z.E[i]] = i;
		z.zero = new GP(z, W.u8cf([0]));
		z.one = new GP(z, W.u8cf([1]));
	}
	m(a, b) {
		return a === 0 || b === 0 ? 0 : this.E[(this.L[a] + this.L[b]) % (this.s - 1)];
	}
	i(a) {
		if (a === 0) W.e("Can't invert 0");
		return this.E[this.s - this.L[a] - 1];
	}
	b(d, c) {
		if (d < 0) W.e('Invalid monomial degree less than 0');
		if (c === 0) return this.zero;
		const e = W.u8ca(d + 1);
		e[0] = c;
		return new GP(this, e);
	}
	l(a) {
		if (a === 0) W.e("Can't take log(0)");
		return this.L[a];
	}
	e(a) {
		return this.E[a];
	}
}
/* 2 GenericGFPoly*/
class GP {
	constructor(f, c) {
		if (c.length === 0) W.e('No coefficients.');
		const z = this,
			l = c.length;
		z.F = f;
		if (l > 1 && c[0] === 0) {
			let f = 1;
			while (f < l && c[f] === 0) f++;
			if (f === l) z.C = f.zero.C;
			else {
				z.C = W.u8ca(l - f);
				for (let i = 0; i < z.C.length; i++) z.C[i] = c[f + i];
			}
		} else z.C = c;
	}
	d() {
		return this.C.length - 1;
	}
	z() {
		return this.C[0] === 0;
	}
	c(d) {
		return this.C[this.C.length - 1 - d];
	}
	a(o) {
		const z = this;
		if (z.z()) return o;
		if (o.z()) return z;
		let a = z.C,
			b = o.C;
		const j = [b, a];
		if (a.length > b.length) (a = j[0]), (b = j[1]);
		const c = W.u8ca(b.length),
			d = b.length - a.length;
		for (let i = 0; i < d; i++) c[i] = b[i];
		for (let i = d; i < b.length; i++) c[i] = GF.a(a[i - d], b[i]);
		return new GP(z.F, c);
	}
	m(s) {
		const z = this;
		if (s === 0) return z.F.zero;
		if (s === 1) return z;
		const e = z.C.length,
			p = W.u8ca(e);
		for (let i = 0; i < e; i++) p[i] = z.F.m(z.C[i], s);
		return new GP(z.F, p);
	}
	p(o) {
		const z = this,
			b = z.C,
			c = b.length,
			d = o.C,
			e = d.length,
			p = W.u8ca(c + e - 1);
		if (z.z() || o.z()) return z.F.zero;
		for (let i = 0; i < c; i++) {
			const a = b[i];
			for (let j = 0; j < e; j++) p[i + j] = GF.a(p[i + j], z.F.m(a, d[j]));
		}
		return new GP(z.F, p);
	}
	b(d, c) {
		if (d < 0) W.e('Invalid degree less than 0');
		if (c === 0) return this.F.zero;
		const s = this.C.length,
			p = W.u8ca(s + d);
		for (let i = 0; i < s; i++) p[i] = this.F.m(this.C[i], c);
		return new GP(this.F, p);
	}
	e(a) {
		const z = this,
			s = z.C.length;
		if (a === 0) return z.c(0);
		let r = 0;
		if (a === 1) {
			z.C.forEach((c) => {
				r = GF.a(r, c);
			});
			return r;
		}
		r = z.C[0];
		for (let i = 1; i < s; i++) r = GF.a(z.F.m(a, r), z.C[i]);
		return r;
	}
}
/* 9 Reedsolomon*/
class RS {
	static E(f, a, b, R) {
		const i = [b, a];
		if (a.d() < b.d()) (a = i[0]), (b = i[1]);
		let e = a,
			r = b,
			g = f.zero,
			t = f.one;
		while (r.d() >= R / 2) {
			const h = e,
				j = g;
			e = r;
			g = t;
			if (e.z()) return W.n('RS fEA rL.z():' + e.z(), f, a);
			r = h;
			let q = f.zero;
			const k = e.c(e.d()),
				m = f.i(k);
			while (r.d() >= e.d() && !r.z()) {
				const n = r.d() - e.d(),
					s = f.m(r.c(r.d()), m);
				q = q.a(f.b(n, s));
				r = r.a(e.b(n, s));
			}
			t = q.p(g).a(j);
			if (r.d() >= e.d()) return W.n('RS fEA r.d():' + r.d() + '">=rL.d():' + e.d(), f, a);
		}
		const s = t.c(0);
		if (s === 0) return W.n('RS fEA s', s, R);
		const o = f.i(s);
		return [t.m(o), r.m(o)];
	}
	static L(f, l) {
		const n = l.d();
		if (n === 1) return [l.c(1)];
		const r = W.A(n);
		let c = 0;
		for (let i = 1; i < f.s && c < n; i++)
			if (l.e(i) === 0) {
				r[c] = f.i(i);
				c++;
			}
		return c !== n ? W.n('RS fEL eC', c, n) : r;
	}
	static M(f, e, l) {
		const s = l.length;
		const r = W.A(s);
		for (let i = 0; i < s; i++) {
			const xi = f.i(l[i]);
			let d = 1;
			for (let j = 0; j < s; j++) if (i !== j) d = f.m(d, GF.a(1, f.m(l[j], xi)));
			r[i] = f.m(e.e(xi), f.i(d));
			if (f.g !== 0) r[i] = f.m(r[i], xi);
		}
		return r;
	}
	static dec(b, s2) {
		const u = W.u8ca(b.length);
		u.set(b);
		const f = new GF(0x011d, 256, 0),
			p = new GP(f, u),
			q = W.u8ca(s2);
		let e = false;
		for (let s = 0; s < s2; s++) {
			const z = p.e(f.e(s + f.g));
			q[q.length - 1 - s] = z;
			if (z !== 0) e = W.T;
		}
		if (!e) return u;
		const y = new GP(f, q),
			o = RS.E(f, f.b(s2, 1), y, s2);
		if (o === null) return W.n('RS dec o', o, y);
		const l = RS.L(f, o[0]);
		if (l == null) return W.n('RS dec l', l, f);
		const t = RS.M(f, o[1], l);
		for (let i = 0; i < l.length; i++) {
			const r = u.length - 1 - f.l(l[i]);
			if (r < 0) return W.n('RS dec r', r, t);
			u[r] = GF.a(u[r], t[i]);
		}
		return u;
	}
}
/* 4 Matrix Like BitMatrix but accepts arbitry Uint8 values*/
class Mx {
	constructor(w, h) {
		this.w = w;
		this.d = W.u8ca(w * h);
	}
	g(x, y) {
		return this.d[y * this.w + x];
	}
	s(x, y, v) {
		this.d[y * this.w + x] = v;
	}
}
class BZ {
	static R = 8;
	static M = 24;
	static n = (v, i, x) => (v < i ? i : v > x ? x : v);
	static b(d, w, h, r) {
		if (d.length !== w * h * 4) W.e('Malformed data passed to binarizer.');
		const a = new Mx(w, h);
		for (let x = 0; x < w; x++)
			for (let y = 0; y < h; y++) {
				const p = (y * w + x) * 4;
				a.s(x, y, 0.2126 * d[p + 0] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]);
			}
		const R = BZ.R,
			M = Math,
			c = M.ceil(w / R),
			e = M.ceil(h / R),
			f = new Mx(c, e);
		for (let i = 0; i < e; i++) {
			for (let j = 0; j < c; j++) {
				let m = 0,
					k = Infinity,
					n = 0;
				for (let y = 0; y < R; y++)
					for (let x = 0; x < R; x++) {
						let l = a.g(j * R + x, i * R + y);
						m += l;
						k = M.min(k, l);
						n = M.max(n, l);
					}
				let v = m / M.pow(R, 2);
				if (n - k <= BZ.M) {
					v = k / 2;
					if (i > 0 && j > 0) {
						const o = (f.g(j, i - 1) + 2 * f.g(j - 1, i) + f.g(j - 1, i - 1)) / 4;
						if (k < o) v = o;
					}
				}
				f.s(j, i, v);
			}
		}
		const z = BM.c(w, h),
			v = r ? BM.c(w, h) : null;
		for (let i = 0; i < e; i++)
			for (let j = 0; j < c; j++) {
				const l = BZ.n(j, 2, c - 3),
					t = BZ.n(i, 2, e - 3);
				let m = 0;
				for (let k = -2; k <= 2; k++) for (let n = -2; n <= 2; n++) m += f.g(l + k, t + n);
				const s = m / 25;
				for (let k = 0; k < R; k++)
					for (let n = 0; n < R; n++) {
						const x = j * R + k,
							y = i * R + n,
							l = a.g(x, y);
						z.s(x, y, l <= s);
						if (r) v.s(x, y, !(l <= s));
					}
			}
		return r ? { z, v } : { z };
	}
}
/* 7 BitStream*/
class BS {
	constructor(b) {
		this.bO = 0;
		this.bio = 0;
		this.b = b;
	}
	r(a) {
		const z = this;
		if (a < 1 || a > 32 || a > z.a()) W.e(`Cannot read ${a.toString()} bits`);
		let r = 0;
		if (z.bio > 0) {
			const c = 8 - z.bio,
				d = a < c ? a : c,
				e = c - d,
				m = (0xff >> (8 - d)) << e;
			r = (z.b[z.bO] & m) >> e;
			a -= d;
			z.bio += d;
			if (z.bio === 8) {
				z.bio = 0;
				z.bO++;
			}
		}
		if (a > 0) {
			while (a >= 8) {
				r = (r << 8) | (z.b[z.bO] & 0xff);
				z.bO++;
				a -= 8;
			}
			if (a > 0) {
				const f = 8 - a,
					m = (0xff >> f) << f;
				r = (r << a) | ((z.b[z.bO] & m) >> f);
				z.bio += a;
			}
		}
		return r;
	}
	a() {
		return 8 * (this.b.length - this.bO) - this.bio;
	}
}
/* 6 DecodeData*/
class DD {
	static M = { Numeric: 'numeric', Alphanumeric: 'alphanumeric', Byte: 'byte', Kanji: 'kanji', ECI: 'eci' };
	static B = {
		Terminator: 0,
		0: 'Terminator',
		Numeric: 1,
		1: 'Numeric',
		Alphanumeric: 2,
		2: 'Alphanumeric',
		Byte: 4,
		4: 'Byte',
		Kanji: 8,
		8: 'Kanji',
		ECI: 7,
		7: 'ECI',
	};
	static dN(m, z) {
		const b = [],
			h = [10, 12, 14][z];
		let t = '',
			l = m.r(h);
		while (l >= 3) {
			const n = m.r(10),
				a = Math.floor(n / 100),
				d = Math.floor(n / 10) % 10,
				c = n % 10;
			if (n >= 1000) W.e('Invalid numeric value above 999');
			b.push(48 + a, 48 + d, 48 + c);
			t += a.toString() + d.toString() + c.toString();
			l -= 3;
		}
		if (l === 2) {
			const n = m.r(7),
				a = Math.floor(n / 10),
				d = n % 10;
			if (n >= 100) W.e('Invalid numeric value above 99');
			b.push(48 + a, 48 + d);
			t += a.toString() + d.toString();
		} else if (l === 1) {
			const n = m.r(4);
			if (n >= 10) W.e('Invalid numeric value above 9');
			b.push(48 + n);
			t += n.toString();
		}
		return { b, t };
	}
	static A = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:'.split('');
	static dA(m, z) {
		const b = [],
			h = [9, 11, 13][z],
			A = DD.A;
		let t = '',
			l = m.r(h);
		while (l >= 2) {
			const v = m.r(11),
				a = Math.floor(v / 45),
				b = v % 45;
			b.push(A[a].charCodeAt(0), A[b].charCodeAt(0));
			t += A[a] + A[b];
			l -= 2;
		}
		if (l === 1) {
			const a = m.r(6);
			b.push(A[a].charCodeAt(0));
			t += A[a];
		}
		return { b, t };
	}
	static dB(m, z) {
		const b = [],
			h = [8, 16, 16][z];
		let t = '',
			l = m.r(h);
		for (let i = 0; i < l; i++) b.push(m.r(8));
		const a = b.map((b) => '%' + ('0' + b.toString(16)).substr(-2)).join('');
		try {
			t += decodeURIComponent(a);
		} catch (e) {
			console.log('decodeByte e:', e, b, a, m, z);
		}
		return { b, t };
	}
	static dK(m, z) {
		const b = [],
			h = [8, 10, 12][z];
		let t = '',
			l = m.r(h);
		for (let i = 0; i < l; i++) {
			const k = m.r(13);
			let c = (Math.floor(k / 0xc0) << 8) | k % 0xc0;
			c += c < 0x1f00 ? 0x8140 : 0xc140;
			b.push(c >> 8, c & 0xff);
			t += '';
		}
		return { b, t };
	}
	static dec(d, v) {
		const s = new BS(d),
			z = v <= 9 ? 0 : v <= 26 ? 1 : 2,
			c = [],
			b = [],
			r = {
				t: '',
				b,
				c,
				v,
			},
			M = DD.M,
			B = DD.B;
		while (s.a() >= 4) {
			const m = s.r(4);
			if (m === B.Terminator) return r;
			else if (m === B.ECI) {
				if (s.r(1) === 0)
					c.push({
						type: M.ECI,
						assignmentNumber: s.r(7),
					});
				else if (s.r(1) === 0)
					c.push({
						type: M.ECI,
						assignmentNumber: s.r(14),
					});
				else if (s.r(1) === 0)
					c.push({
						type: M.ECI,
						assignmentNumber: s.r(21),
					});
				else
					c.push({
						type: M.ECI,
						assignmentNumber: -1,
					});
			} else if (m === B.Numeric) {
				const N = DD.dN(s, z);
				r.t += N.t;
				W.cat(b, N.b);
				c.push({
					type: M.Numeric,
					text: N.t,
				});
			} else if (m === B.Alphanumeric) {
				const A = DD.dA(s, z);
				r.t += A.t;
				W.cat(b, A.b);
				c.push({
					type: M.Alphanumeric,
					text: A.t,
				});
			} else if (m === B.Byte) {
				const B = DD.dB(s, z);
				r.t += B.t;
				W.cat(b, B.b);
				c.push({
					type: M.Byte,
					bytes: B.b,
					text: B.t,
				});
			} else if (m === B.Kanji) {
				const K = DD.dK(s, z);
				r.t += K.t;
				W.cat(b, K.b);
				c.push({
					type: M.Kanji,
					bytes: K.b,
					text: K.t,
				});
			}
		}
		if (s.a() === 0 || s.r(s.a()) === 0) return r;
	}
}
/* 5 Decoder*/
class DC {
	static n(x, y) {
		let z = x ^ y;
		let c = 0;
		while (z) {
			c++;
			z &= z - 1;
		}
		return c;
	}
	static p = (t, y) => (y << 1) | t;
	static F = [
		{ b: 0x5412, f: { e: 1, d: 0 } },
		{ b: 0x5125, f: { e: 1, d: 1 } },
		{ b: 0x5e7c, f: { e: 1, d: 2 } },
		{ b: 0x5b4b, f: { e: 1, d: 3 } },
		{ b: 0x45f9, f: { e: 1, d: 4 } },
		{ b: 0x40ce, f: { e: 1, d: 5 } },
		{ b: 0x4f97, f: { e: 1, d: 6 } },
		{ b: 0x4aa0, f: { e: 1, d: 7 } },
		{ b: 0x77c4, f: { e: 0, d: 0 } },
		{ b: 0x72f3, f: { e: 0, d: 1 } },
		{ b: 0x7daa, f: { e: 0, d: 2 } },
		{ b: 0x789d, f: { e: 0, d: 3 } },
		{ b: 0x662f, f: { e: 0, d: 4 } },
		{ b: 0x6318, f: { e: 0, d: 5 } },
		{ b: 0x6c41, f: { e: 0, d: 6 } },
		{ b: 0x6976, f: { e: 0, d: 7 } },
		{ b: 0x1689, f: { e: 3, d: 0 } },
		{ b: 0x13be, f: { e: 3, d: 1 } },
		{ b: 0x1ce7, f: { e: 3, d: 2 } },
		{ b: 0x19d0, f: { e: 3, d: 3 } },
		{ b: 0x0762, f: { e: 3, d: 4 } },
		{ b: 0x0255, f: { e: 3, d: 5 } },
		{ b: 0x0d0c, f: { e: 3, d: 6 } },
		{ b: 0x083b, f: { e: 3, d: 7 } },
		{ b: 0x355f, f: { e: 2, d: 0 } },
		{ b: 0x3068, f: { e: 2, d: 1 } },
		{ b: 0x3f31, f: { e: 2, d: 2 } },
		{ b: 0x3a06, f: { e: 2, d: 3 } },
		{ b: 0x24b4, f: { e: 2, d: 4 } },
		{ b: 0x2183, f: { e: 2, d: 5 } },
		{ b: 0x2eda, f: { e: 2, d: 6 } },
		{ b: 0x2bed, f: { e: 2, d: 7 } },
	];
	static M = [
		(p) => (p.y + p.x) % 2 === 0,
		(p) => p.y % 2 === 0,
		(p) => p.x % 3 === 0,
		(p) => (p.y + p.x) % 3 === 0,
		(p) => (Math.floor(p.y / 2) + Math.floor(p.x / 3)) % 2 === 0,
		(p) => ((p.x * p.y) % 2) + ((p.x * p.y) % 3) === 0,
		(p) => (((p.y * p.x) % 2) + ((p.y * p.x) % 3)) % 2 === 0,
		(p) => (((p.y + p.x) % 2) + ((p.y * p.x) % 3)) % 2 === 0,
	];
	static m(v) {
		const d = 17 + 4 * v.versionNumber,
			m = BM.c(d, d);
		m.r(0, 0, 9, 9, W.T);
		m.r(d - 8, 0, 8, 9, W.T);
		m.r(0, d - 8, 9, 8, W.T);
		for (const x of v.alignmentPatternCenters)
			for (const y of v.alignmentPatternCenters)
				if (!((x === 6 && y === 6) || (x === 6 && y === d - 7) || (x === d - 7 && y === 6)))
					m.r(x - 2, y - 2, 5, 5, W.T);
		m.r(6, 9, 1, d - 17, W.T);
		m.r(9, 6, d - 17, 1, W.T);
		if (v.versionNumber > 6) {
			m.r(d - 11, 0, 3, 6, W.T);
			m.r(0, d - 11, 6, 3, W.T);
		}
		return m;
	}
	static c(m, v, f) {
		const M = DC.M[f.d],
			d = m.h,
			g = DC.m(v),
			c = [];
		let n = 0,
			b = 0,
			h = W.T;
		for (let j = d - 1; j > 0; j -= 2) {
			if (j === 6) j--;
			for (let i = 0; i < d; i++) {
				const y = h ? d - 1 - i : i;
				for (let k = 0; k < 2; k++) {
					const x = j - k;
					if (!g.g(x, y)) {
						b++;
						let t = m.g(x, y);
						if (M({ y: y, x: x })) t = !t;
						n = DC.p(t, n);
						if (b === 8) {
							c.push(n);
							b = 0;
							n = 0;
						}
					}
				}
			}
			h = !h;
		}
		return c;
	}
	static v(m) {
		const d = m.h,
			a = Math.floor((d - 17) / 4);
		if (a <= 6) return W.V[a - 1];
		let b = 0,
			c = 0;
		for (let y = 5; y >= 0; y--) for (let x = d - 9; x >= d - 11; x--) b = DC.p(m.g(x, y), b);
		for (let x = 5; x >= 0; x--) for (let y = d - 9; y >= d - 11; y--) c = DC.p(m.g(x, y), c);
		let e = Infinity,
			f = null;
		for (const v of W.V) {
			if (v.infoBits === b || v.infoBits === c) return v;
			const g = DC.n(b, v.infoBits),
				h = DC.n(c, v.infoBits);
			if (g < e) {
				f = v;
				e = g;
			}
			if (h < e) {
				f = v;
				e = h;
			}
		}
		return e <= 3 ? f : W.n(`readVersion bD:${e}`);
	}
	static f(m) {
		let e = 0,
			f = 0;
		for (let x = 0; x <= 8; x++) if (x !== 6) e = DC.p(m.g(x, 8), e);
		for (let y = 7; y >= 0; y--) if (y !== 6) e = DC.p(m.g(8, y), e);
		const d = m.h;
		for (let y = d - 1; y >= d - 7; y--) f = DC.p(m.g(8, y), f);
		for (let x = d - 8; x < d; x++) f = DC.p(m.g(x, 8), f);
		let g = Infinity,
			h = null;
		for (const a of DC.F) {
			const b = a.b,
				i = a.f;
			if (b === e || b === f) return i;
			const j = DC.n(e, b);
			if (j < g) {
				h = i;
				g = j;
			}
			if (e !== f) {
				const k = DC.n(f, b);
				if (k < g) {
					h = i;
					g = k;
				}
			}
		}
		return g <= 3 ? h : W.n('readFormatInformation bD:' + g);
	}
	static b(c, v, e) {
		const z = v.errorCorrectionLevels[e],
			x = [],
			f = z.ecBlocks;
		let y = 0;
		for (const b of f)
			for (let i = 0; i < b.numBlocks; i++) {
				const nD = b.dataCodewordsPerBlock;
				x.push({ nD, cw: [] });
				y += nD + z.ecCodewordsPerBlock;
			}
		if (c.length < y) return W.n(`getDataBlocks codeWs.length < tc:${y}/codeWs:${c.length}`);
		c = c.slice(0, y);
		const s = f[0].dataCodewordsPerBlock;
		for (let i = 0; i < s; i++) for (const d of x) d.cw.push(c.shift());
		if (f.length > 1) {
			const w = f[0].numBlocks,
				u = f[1].numBlocks;
			for (let i = 0; i < u; i++) x[w + i].cw.push(c.shift());
		}
		while (c.length > 0) for (const d of x) d.cw.push(c.shift());
		return x;
	}
	static x(m) {
		const v = DC.v(m);
		if (!v) return W.n('decodeMatrix v', v, m);
		const f = DC.f(m);
		if (!f) return W.n('decodeMatrix fI', f, m);
		const c = DC.c(m, v, f),
			d = DC.b(c, v, f.e);
		if (!d) return W.n('decodeMatrix d', d, m);
		const t = d.reduce((a, b) => a + b.nD, 0),
			r = W.u8ca(t);
		let j = 0;
		for (const b of d) {
			const a = RS.dec(b.cw, b.cw.length - b.nD);
			if (!a) return W.n('decodeMatrix cb c2:' + (b.cw.length - b.nD), a, m, b.cw);
			for (let i = 0; i < b.nD; i++) r[j++] = a[i];
		}
		try {
			return DD.dec(r, v.versionNumber);
		} catch (e) {
			return W.n('decodeMatrix e', e);
		}
	}
	static dec(m) {
		if (m == null) return W.n('decode mtx:' + m);
		const r = DC.x(m);
		if (r) return r;
		for (let x = 0; x < m.w; x++)
			for (let y = x + 1; y < m.h; y++)
				if (m.g(x, y) !== m.g(y, x)) {
					m.s(x, y, !m.g(x, y));
					m.s(y, x, !m.g(y, x));
				}
		return DC.x(m);
	}
}
/* 11 Extractor*/
class EX {
	static S(a, b, c, e) {
		const f = a.x - b.x + c.x - e.x,
			i = a.y - b.y + c.y - e.y;
		if (f === 0 && i === 0)
			return {
				a11: b.x - a.x,
				a12: b.y - a.y,
				a13: 0,
				a21: c.x - b.x,
				a22: c.y - b.y,
				a23: 0,
				a31: a.x,
				a32: a.y,
				a33: 1,
			};
		else {
			const j = b.x - c.x,
				k = e.x - c.x,
				l = b.y - c.y,
				m = e.y - c.y,
				d = j * m - k * l,
				n = (f * m - k * i) / d,
				o = (j * i - f * l) / d;
			return {
				a11: b.x - a.x + n * b.x,
				a12: b.y - a.y + n * b.y,
				a13: n,
				a21: e.x - a.x + o * e.x,
				a22: e.y - a.y + o * e.y,
				a23: o,
				a31: a.x,
				a32: a.y,
				a33: 1,
			};
		}
	}
	static Q(a, b, c, e) {
		const s = EX.S(a, b, c, e);
		return {
			a11: s.a22 * s.a33 - s.a23 * s.a32,
			a12: s.a13 * s.a32 - s.a12 * s.a33,
			a13: s.a12 * s.a23 - s.a13 * s.a22,
			a21: s.a23 * s.a31 - s.a21 * s.a33,
			a22: s.a11 * s.a33 - s.a13 * s.a31,
			a23: s.a13 * s.a21 - s.a11 * s.a23,
			a31: s.a21 * s.a32 - s.a22 * s.a31,
			a32: s.a12 * s.a31 - s.a11 * s.a32,
			a33: s.a11 * s.a22 - s.a12 * s.a21,
		};
	}
	static t(a, b) {
		return {
			a11: a.a11 * b.a11 + a.a21 * b.a12 + a.a31 * b.a13,
			a12: a.a12 * b.a11 + a.a22 * b.a12 + a.a32 * b.a13,
			a13: a.a13 * b.a11 + a.a23 * b.a12 + a.a33 * b.a13,
			a21: a.a11 * b.a21 + a.a21 * b.a22 + a.a31 * b.a23,
			a22: a.a12 * b.a21 + a.a22 * b.a22 + a.a32 * b.a23,
			a23: a.a13 * b.a21 + a.a23 * b.a22 + a.a33 * b.a23,
			a31: a.a11 * b.a31 + a.a21 * b.a32 + a.a31 * b.a33,
			a32: a.a12 * b.a31 + a.a22 * b.a32 + a.a32 * b.a33,
			a33: a.a13 * b.a31 + a.a23 * b.a32 + a.a33 * b.a33,
		};
	}
	static e(i, l) {
		const q = EX.Q(
				{ x: 3.5, y: 3.5 },
				{ x: l.dim - 3.5, y: 3.5 },
				{ x: l.dim - 6.5, y: l.dim - 6.5 },
				{ x: 3.5, y: l.dim - 3.5 }
			),
			s = EX.S(l.tL, l.tR, l.aP, l.bL),
			t = EX.t(s, q),
			m = BM.c(l.dim, l.dim),
			mF = (x, y) => {
				const d = t.a13 * x + t.a23 * y + t.a33;
				return {
					x: (t.a11 * x + t.a21 * y + t.a31) / d,
					y: (t.a12 * x + t.a22 * y + t.a32) / d,
				};
			};
		for (let y = 0; y < l.dim; y++)
			for (let x = 0; x < l.dim; x++) {
				const p = mF(x + 0.5, y + 0.5);
				m.s(x, y, i.g(Math.floor(p.x), Math.floor(p.y)));
			}
		return {
			m,
			mF,
		};
	}
}
/* 12 Locator*/
class LC {
	static MF = 4;
	static IQ = 0.5;
	static XQ = 1.5;
	static d = (a, b) => Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2));
	static s = (v) => v.reduce((a, b) => a + b);
	static P(a, b, c) {
		const d = LC.d(a, b),
			e = LC.d(b, c),
			f = LC.d(a, c),
			i = e >= d && e >= f ? [b, a, c] : f >= e && f >= d ? [a, b, c] : [a, c, b],
			l = i[1];
		let m = i[0],
			n = i[2];
		if ((n.x - l.x) * (m.y - l.y) - (n.y - l.y) * (m.x - l.x) < 0) {
			const j = [n, m];
			m = j[0];
			n = j[1];
		}
		return { bL: m, tL: l, tR: n };
	}
	static D(a, b, c, m) {
		const e =
			(LC.s(LC.B(a, c, m, 5)) / 7 +
				LC.s(LC.B(a, b, m, 5)) / 7 +
				LC.s(LC.B(c, a, m, 5)) / 7 +
				LC.s(LC.B(b, a, m, 5)) / 7) /
			4;
		if (e < 1) W.e('Invalid module size');
		const f = Math.round(LC.d(a, b) / e),
			g = Math.round(LC.d(a, c) / e),
			d = Math.floor((f + g) / 2) + 7;
		return { dim: d + (!(d % 4) ? 1 : d % 4 === 2 ? -1 : 0), mS: e };
	}
	static T(o, e, m, l) {
		const M = Math,
			a = [{ x: M.floor(o.x), y: M.floor(o.y) }],
			b = M.abs(e.y - o.y) > M.abs(e.x - o.x),
			c = M.floor(b ? o.y : o.x),
			d = M.floor(b ? o.x : o.y),
			f = M.floor(b ? e.y : e.x),
			g = M.floor(b ? e.x : e.y),
			h = M.abs(f - c),
			j = M.abs(g - d),
			k = c < f ? 1 : -1,
			n = d < g ? 1 : -1,
			t = [];
		let r = M.floor(-h / 2),
			p = W.T;
		for (let x = c, y = d; x !== f + k; x += k) {
			const q = b ? y : x,
				s = b ? x : y;
			if (m.g(q, s) !== p) {
				p = !p;
				a.push({ x: q, y: s });
				if (a.length === l + 1) break;
			}
			r += j;
			if (r > 0) {
				if (y === g) break;
				y += n;
				r -= h;
			}
		}
		for (let i = 0; i < l; i++) t.push(a[i] && a[i + 1] ? LC.d(a[i], a[i + 1]) : 0);
		return t;
	}
	static B(o, e, m, l) {
		const r = e.y - o.y,
			u = e.x - o.x,
			t = LC.T(o, e, m, Math.ceil(l / 2)),
			a = LC.T(o, { x: o.x - u, y: o.y - r }, m, Math.ceil(l / 2)),
			v = t.shift() + a.shift() - 1;
		let i;
		return (i = a.concat(v)).concat.apply(i, t);
	}
	static S(s, r) {
		const a = LC.s(s) / LC.s(r);
		let e = 0;
		r.forEach((ratio, i) => {
			e += Math.pow(s[i] - ratio * a, 2);
		});
		return { a, e };
	}
	static Q(p, r, m) {
		try {
			const a = LC.B(p, { x: -1, y: p.y }, m, r.length),
				b = LC.B(p, { x: p.x, y: -1 }, m, r.length),
				M = Math,
				c = {
					x: M.max(0, p.x - p.y) - 1,
					y: M.max(0, p.y - p.x) - 1,
				},
				d = LC.B(p, c, m, r.length),
				f = {
					x: M.min(m.w, p.x + p.y) + 1,
					y: M.min(m.h, p.y + p.x) + 1,
				},
				g = LC.B(p, f, m, r.length),
				h = LC.S(a, r),
				i = LC.S(b, r),
				j = LC.S(d, r),
				k = LC.S(g, r),
				l = M.sqrt(h.e * h.e + i.e * i.e + j.e * j.e + k.e * k.e),
				n = (h.a + i.a + j.a + k.a) / 4,
				o = (M.pow(h.a - n, 2) + M.pow(i.a - n, 2) + M.pow(j.a - n, 2) + M.pow(k.a - n, 2)) / n;
			return l + o;
		} catch (e) {
			console.log('scorePattern', e);
			return Infinity;
		}
	}
	static R(m, p) {
		const M = Math;
		let l = M.round(p.x);
		while (m.g(l, M.round(p.y))) l--;
		let r = M.round(p.x);
		while (m.g(r, M.round(p.y))) r++;
		const x = (l + r) / 2;
		let t = M.round(p.y);
		while (m.g(M.round(x), t)) t--;
		let b = M.round(p.y);
		while (m.g(M.round(x), b)) b++;
		const y = (t + b) / 2;
		return { x, y };
	}
	static l(m) {
		let F = [],
			A = [];
		const P = [],
			Q = [],
			M = Math,
			f1 = (y) => {
				let c = 0,
					d = false,
					e = [0, 0, 0, 0, 0],
					f2 = (x) => {
						const v = m.g(x, y);
						if (v === d) c++;
						else {
							e = [e[1], e[2], e[3], e[4], c];
							c = 1;
							d = v;
							const f = LC.s(e) / 7,
								g =
									M.abs(e[0] - f) < f &&
									M.abs(e[1] - f) < f &&
									M.abs(e[2] - 3 * f) < 3 * f &&
									M.abs(e[3] - f) < f &&
									M.abs(e[4] - f) < f &&
									!v,
								h = LC.s(e.slice(-3)) / 3,
								k = M.abs(e[2] - h) < h && M.abs(e[3] - h) < h && M.abs(e[4] - h) < h && v;
							if (g) {
								const n = x - e[3] - e[4],
									o = n - e[2],
									l = { s: o, e: n, y: y },
									s = F.filter(
										(q) =>
											(o >= q.B.s && o <= q.B.e) ||
											(n >= q.B.s && o <= q.B.e) ||
											(o <= q.B.s &&
												n >= q.B.e &&
												e[2] / (q.B.e - q.B.s) < LC.XQ &&
												e[2] / (q.B.e - q.B.s) > LC.IQ)
									);
								if (s.length > 0) s[0].B = l;
								else F.push({ T: l, B: l });
							}
							if (k) {
								const n = x - e[4],
									o = n - e[3],
									l = { s: o, y, e: n },
									s = A.filter(
										(q) =>
											(o >= q.B.s && o <= q.B.e) ||
											(n >= q.B.s && o <= q.B.e) ||
											(o <= q.B.s &&
												n >= q.B.e &&
												e[2] / (q.B.e - q.B.s) < LC.XQ &&
												e[2] / (q.B.e - q.B.s) > LC.IQ)
									);
								if (s.length > 0) s[0].B = l;
								else A.push({ T: l, B: l });
							}
						}
					};
				for (let x = -1; x <= m.w; x++) f2(x);
				W.cat(
					P,
					F.filter((q) => q.B.y !== y && q.B.y - q.T.y >= 2)
				);
				F = F.filter((q) => q.B.y === y);
				W.cat(
					Q,
					A.filter((q) => q.B.y !== y)
				);
				A = A.filter((q) => q.B.y === y);
			};
		for (let y = 0; y <= m.h; y++) f1(y);
		W.cat(
			P,
			F.filter((q) => q.B.y - q.T.y >= 2)
		);
		W.cat(Q, A);
		const G = P.filter((q) => q.B.y - q.T.y >= 2)
			.map((q) => {
				const x = (q.T.s + q.T.e + q.B.s + q.B.e) / 4,
					y = (q.T.y + q.B.y + 1) / 2;
				return m.g(M.round(x), M.round(y))
					? {
							C: LC.Q({ x: M.round(x), y: M.round(y) }, [1, 1, 3, 1, 1], m),
							x,
							y,
							S: LC.s([(q.T.e - q.T.s, q.B.e - q.B.s, q.B.y - q.T.y + 1)]) / 3,
					  }
					: 0;
			})
			.filter((q) => !!q)
			.sort((a, b) => a.C - b.C)
			.map((t, i, f) => {
				if (i > LC.MF) return null;
				const o = f
					.filter((p, ii) => i !== ii)
					.map((p) => {
						return {
							x: p.x,
							y: p.y,
							C: p.C + M.pow(p.S - t.S, 2) / t.S,
							S: p.S,
						};
					})
					.sort((a, b) => a.C - b.C);
				return o.length < 2 ? 0 : { p: [t].concat(o.slice(0, 2)), C: t.C + o[0].C + o[1].C };
			})
			.filter((q) => !!q)
			.sort((a, b) => a.C - b.C);
		if (G.length === 0) return null;
		const i = LC.P(G[0].p[0], G[0].p[1], G[0].p[2]),
			H = i.tR,
			I = i.tL,
			J = i.bL,
			K = LC.A(m, Q, H, I, J),
			r = [];
		if (K)
			r.push({
				aP: { x: K.aP.x, y: K.aP.y },
				bL: { x: J.x, y: J.y },
				dim: K.dim,
				tL: { x: I.x, y: I.y },
				tR: { x: H.x, y: H.y },
			});
		const L = LC.R(m, H),
			N = LC.R(m, I),
			O = LC.R(m, J),
			S = LC.A(m, Q, L, N, O);
		if (S)
			r.push({
				aP: {
					x: S.aP.x,
					y: S.aP.y,
				},
				bL: { x: O.x, y: O.y },
				tL: { x: N.x, y: N.y },
				tR: { x: L.x, y: L.y },
				dim: S.dim,
			});
		return r.length === 0 ? null : r;
	}
	static A(m, a, r, l, b) {
		let d, s;
		try {
			const i = LC.D(l, r, b, m);
			d = i.dim;
			s = i.mS;
		} catch (e) {
			return W.n('findAlignmentPattern e:', e);
		}
		const R = {
				x: r.x - l.x + b.x,
				y: r.y - l.y + b.y,
			},
			B = (LC.d(l, b) + LC.d(l, r)) / 2 / s,
			c = 1 - 3 / B,
			g = {
				x: l.x + c * (R.x - l.x),
				y: l.y + c * (R.y - l.y),
			},
			h = a
				.map((q) => {
					const x = (q.T.s + q.T.e + q.B.s + q.B.e) / 4,
						y = (q.T.y + q.B.y + 1) / 2,
						M = Math;
					return !m.g(M.floor(x), M.floor(y))
						? 0
						: { x, y, C: LC.Q({ x: M.floor(x), y: M.floor(y) }, [1, 1, 1], m) + LC.d({ x, y }, g) };
				})
				.filter((v) => !!v)
				.sort((a, b) => a.C - b.C);
		return { aP: B >= 15 && h.length ? h[0] : g, dim: d };
	}
}
/* 3 */
class JsQR {
	static s(m) {
		const L = LC.l(m);
		if (!L) return W.n('scan A ls:' + L);
		for (const l of L) {
			const e = EX.e(m, l),
				d = DC.dec(e.m);
			if (d)
				return {
					binaryData: d.b,
					data: d.t,
					chunks: d.c,
					version: d.v,
					location: {
						topRightCorner: e.mF(l.dim, 0),
						topLeftCorner: e.mF(0, 0),
						bottomRightCorner: e.mF(l.dim, l.dim),
						bottomLeftCorner: e.mF(0, l.dim),
						topRightFinderPattern: l.tR,
						topLeftFinderPattern: l.tL,
						bottomLeftFinderPattern: l.bL,
						bottomRightAlignmentPattern: l.aP,
					},
				};
		}
		return W.n(`scan B ls:${L}`);
	}
	static async exec(data, width, height, providedOptions = {}) {
		await W.init();
		const o = {
			inversionAttempts: 'attemptBoth',
		};
		for (const k in o) o[k] = providedOptions[k] || o[k];
		const i = o.inversionAttempts,
			s = i === 'attemptBoth' || i === 'invertFirst',
			t = i === 'onlyInvert' || i === 'invertFirst',
			j = BZ.b(data, width, height, s),
			r = JsQR.s(t ? j.v : j.z);
		return !r && (i === 'attemptBoth' || i === 'invertFirst') ? JsQR.s(t ? j.z : j.v) : r;
	}
}
export const jsQR = JsQR.exec;
