const wi = window,
	E = '',
	pr = f => new Promise(f),
	st = (f, w) => setTimeout(f, w);
export class C {
	static p256 = '256px';
	static bi = 'linear-gradient(90deg, transparent 0 50%, blue 50% 100%)';
	static a = 'absolute';
	static dNone = { display: 'none' };
	static dBlock = { display: 'block' };
	static vH = { visibility: 'hidden' };
	static vV = { visibility: 'visible' };
}
const AttrMap = { t: 'text', n: 'name' };
export class Vw {
	static cnvtGebav2Camel(t = E) {
		if (!t) return t;
		const s = t.split('-');
		for (let i = 1, j = s.length; i < j; i++) {
			const w = s[i],
				l = w.length;
			s[i] = l > 0 ? w.substring(0, 1).toUpperCase() : `${l}` > 1 ? w.substring(1) : E;
		}
		return s.join(E);
	}
	static addHiddenDiv = (p, att = {}) => Vw.add(p, 'div', att, C.dNone);
	static add(p, tN, att = {}, sty = {}) {
		const e = Vw.ce(tN);
		Vw.sa(e, att);
		if (att.text || att.t) Vw.sT(e, att.text || att.t);
		Vw.styleSet(e, sty);
		if (p) p.appendChild(e);
		return e;
	}
	static d = document;
	static div = (p, att, sty) => Vw.add(p, 'div', att, sty);
	static h1 = (p, att, sty) => Vw.add(p, 'h1', att, sty);
	static h2 = (p, att, sty) => Vw.add(p, 'h2', att, sty);
	static btn = (p, att, sty) => Vw.add(p, 'button', att, sty);
	static ipt = (p, att, sty) => Vw.add(p, 'input', att, sty);
	static gi = i => Vw.d.getElementById(i);
	static rm = e => (e.parentNode ? e.parentNode.removeChild(e) : null);
	static rc = e => {
		while (e.firstChild) e.removeChild(e.firstChild);
	};
	static styleSet = (e, sty = {}) => Object.keys(sty).map(k => (e.style[Vw.cnvtGebav2Camel(k)] = sty[k])); // stypeSet
	static styleAdd = (e, k, v) => (e.style[Vw.cnvtGebav2Camel(k)] = v); //stypeAdd
	static getStyle = (e, k) => e.style[Vw.cnvtGebav2Camel(k)]; // GetStyle
	static toggleStyle = (e, k, v, v2) =>
		(e.style[Vw.cnvtGebav2Camel(k)] = e.style[Vw.cnvtGebav2Camel(k)] === v ? v2 : v); //toggleStyle
	static click = (e, cb) => Vw.ael(e, 'click', cb);
	static change = (e, cb) => Vw.ael(e, 'change', cb);
	static input = (e, cb) => Vw.ael(e, 'input', cb);
	static ael = (e, ev, cb) => (e.addEventListener(ev, cb) ? cb : cb);
	static rel = (e, ev, cb) => (e.removeEventListener(ev, cb) ? cb : cb);
	static sT = (e, msg) => (msg ? (e.textContent = msg) : e.textContent);
	static aC = (e, cN) => e.classList.add(cN);
	static rC = (e, cN) => e.classList.remove(cN);
	static tC = (e, cN) => e.classList.toggle(cN);
	static sa = (e, att) => Object.keys(att).map(k => e.setAttribute(`${AttrMap[k] || k}`, att[k]));
	static gB = () => Vw.d.getElementsByTagName('body')[0];
	static gT = (p, T) => p.getElementsByTagName(T)[0];
	static ce = tN => Vw.d.createElement(tN);
	static copy = async d => navigator.clipboard.writeText(d);
	static uO = (a, b) => {
		const c = {};
		for (const k in a) c[k] = a[k];
		for (const k in b) c[k] = b[k];
		return c;
	};
	static fr = f => {
		const r = new FileReader(),
			p = pr((rv, rj) => {
				r.onload = () => rv(r.result);
				r.onerror = () => rj(r.error);
			});
		return {
			asArrayBuffer() {
				r.readAsArrayBuffer(f);
				return p;
			},
			asBinaryString() {
				r.readAsBinaryString(f);
				return p;
			},
			asDataURL() {
				r.readAsDataURL(f);
				return p;
			},
			asText() {
				r.readAsText(f);
				return p;
			},
		};
	};
	static beDraggable(e) {
		const p = 'px',
			T = 'top',
			L = 'left',
			a = k => Vw.getStyle(e, k).split(p).join(E) * 1,
			b = (k, x) => Vw.styleAdd(e, k, x + p),
			m = {},
			f = evt => {
				st(() => {
					m.eX = evt.clientX;
					m.eY = evt.clientY;
					b(L, m.x + m.eX - m.sX);
					b(T, m.y + m.eY - m.sY);
				}, 1);
			};
		Vw.ael(e, 'mousedown', async evt => {
			Vw.styleAdd(e, 'cursor', 'grab');
			m.x = a(L);
			m.y = a(T);
			m.sX = evt.clientX;
			m.sY = evt.clientY;
			Vw.ael(wi, 'mousemove', f);
		});
		Vw.ael(wi, 'mouseup', () => {
			Vw.styleAdd(e, 'cursor', 'auto');
			Vw.rel(wi, 'mousemove', f);
		});
	}
}
