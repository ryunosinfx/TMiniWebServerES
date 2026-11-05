import { io, N, T, Y, isArr, H, P, F, E } from './Y.js';
export class OPFS {
	static t = N;
	static p = N;
	static n = undefined;
	static d = 'OPFS_'; //特定管理域指定フォルダー名※複数同時使用を想定のため
	static co = { create: T };
	static rc = { recursive: T };
	static at0 = { at: 0 };
	static i = async n => {
		OPFS.p = await navigator.storage.persist(); //永続化呪文
		OPFS.t = await navigator.storage.getDirectory(); //init root
		if (n) OPFS.d = OPFS.mkDir(n);
		OPFS.d = Y.B2U(await H.d(OPFS.d + n, 10)); //常にハッシュBase64URL@SHA256で指定
	};
	static gDH = async (p, d, o) => {
		io(`OPFS gDH 1 p:${p}`, d, o);
		try {
			const x = d ? await d.getDirectoryHandle(p, o) : await OPFS.t.getDirectoryHandle(p, o);
			io(`OPFS gDH 3 p:${p}`, x);
			return x;
		} catch (e) {
			io(e);
		}
	};
	static gFH = (p, d, o) => (d ? d.getFileHandle(p, o) : OPFS.t.getFileHandle(p, o));
	static mkD = async (p, d) => {
		const a = await OPFS.isEd(p, d);
		return await OPFS.gDH(p, d, a ? undefined : OPFS.co);
	}; //async/await
	static gDHR = async (p, iN = T) => {
		const s = isArr(p) ? p : p.split(P);
		let t = OPFS.t;
		io(`OPFS gDHR p:${p}/t:${t}/iN:${iN}`, t);
		for (const d of s) {
			io(`OPFS gDHR 1 d:${d}/t:${t}/iN${iN}`, t);
			t = iN ? await OPFS.mkD(d, t) : await OPFS.gDH(d, t);
			io(`OPFS gDHR 2 d:${d}/t:${t}/iN${iN}`, t);
		}
		return t;
	};
	static mkDir = async (p, f = T) => await OPFS.gDHR(p, f);
	static gPH = async (p, f = T) => {
		const s = isArr(p) ? p : p.split(P);
		s.pop();
		io(`OPFS gPH p:${p} f:${f}`);
		return await OPFS.mkDir(s, f);
	};
	static mkFile = async p => {
		const s = p.split(P),
			b = s.pop(),
			h = await OPFS.gPH(p, T),
			a = await OPFS.isEf(p);
		io(`OPFS mkFile h:${h}/p:${p}/a:${a}`);
		return await OPFS.gFH(b, h, a ? undefined : OPFS.co);
	}; //async/await
	static isEd = async (p, d) => {
		try {
			io(`OPFS isEd 1 p:${p}`);
			const h = d ? await OPFS.gDH(p, d) : await OPFS.gDHR(p, F); //存在確認
			io(`OPFS isEd 2 p:${p}`, h);
			return h ? T : F;
		} catch (e) {
			io(e);
		}
		return F;
	};
	static isEf = async p => {
		try {
			io(`OPFS isEf 1 p:${p} h:`);
			const s = p.split(P),
				b = s.pop(),
				h = await OPFS.gPH(p, F), //存在確認
				a = await OPFS.gFH(b, h);
			io(`OPFS isEf 2 p:${p} fh:`, a, a.createSyncAccessHandle);
			return T;
		} catch (e) {
			io(e);
		}
		return F;
	};
	static rmd = async p => {
		const s = isArr(p) ? p : p.split(P),
			b = s.pop(),
			h = (await OPFS.isEd(p)) ? await OPFS.gPH(p, F) : N;
		return h ? await h.removeEntry(b, OPFS.rc) : N;
	};
	static rmf = async p => {
		const s = isArr(p) ? p : p.split(P),
			b = s.pop(),
			e = await OPFS.isEf(p),
			h = e ? await OPFS.gPH(p, F) : N;
		io(`OPFS rmf  p:${p}  b:${b} e:${e} h:`, h);
		return h ? await h.removeEntry(b, OPFS.rc) : N;
	};
	static iD = h => h && h.kind === 'directory';
	static ls = async (p = E, i = F, b, e) => {
		io('OPFS l 1 p:', p, i);
		const r = OPFS.d + (p ? P + p : ''),
			d = OPFS.iD(p) ? p : await OPFS.gDHR(r),
			a = isArr(b) ? b : [],
			c = e ? e : p;
		io('OPFS l 2 p:', p, i, r, d);
		for await (const [j, v] of d.entries()) {
			if (OPFS.iD(v))
				a.push({
					k: c + P + j,
					p: c,
					l: await OPFS.ls(v, i, a, c + P + j),
				});
			//kはファイル名、vはハンドラ
			else {
				const f = await v.getFile(),
					p = j.split('.'),
					h = i ? p.pop() : E,
					k = c + P + i ? p.join('.') : j;
				a.push({ k, t: f.type, lm: f.lastModified, h, p: c, s: f.size }); //kはファイル名、vはハンドラ
			}
		}
		return a;
	};
	static g = (n, h) => `${OPFS.d + P + n}.${h}`;
	static x = async (p, ab, i) => {
		const n = (await OPFS.w(OPFS.g(p, Y.B2U(await H.d(ab, 10))), ab)).split(OPFS.d + P)[1];
		return i ? n.split('.').pop() : n; //iがTrueの場合、hashのみを返す。
	}; //データを重複せずに書き込む系、ハッシュ値込みのファイル名を返す,iがTrueの場合はハッシュ値のみ
	static y = async (n, h) => await OPFS.r(OPFS.g(n, h)); //ファイル名&ハッシュでロード
	static rmh = async (n, h) => await OPFS.rmf(OPFS.g(n, h)); //ファイル名&ハッシュで削除
	static w = async (p, ab) => {
		io('OPFS.w p:', p);
		const d = await OPFS.mkFile(p); //Write ArrayBuffer
		if (d.createSyncAccessHandle) {
			const h = await d.createSyncAccessHandle();
			h.write(ab, OPFS.at0);
			h.flush();
			h.close();
		} else {
			const h = await d.createWritable();
			await h.write(ab);
			await h.close();
		}
		return p;
	};
	static r = async p => {
		const d = await OPFS.mkFile(p), // read as ArrayBuffer
			b = await d.getFile();
		return await b.arrayBuffer();
	};
}
