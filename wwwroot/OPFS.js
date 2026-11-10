import { io, N, T, Y, isArr, H, P, F, E } from './Y.js';
export class OPFS {
	static t = N;
	static p = N;
	static n = undefined;
	static d = 'OPFS_'; //特定管理域指定フォルダー名※複数同時使用を想定のため
	static co = { create: T };
	static rc = { recursive: T };
	static at0 = { at: 0 };
	static rd = Promise.resolve(); //初期化完了Promise: ハンドラへ触れる操作は必ず await する(未初期化競合の解消)
	static i = n =>
		((OPFS.rd = (async () => {
			// Firefox(ヘッドレス)では persist() が解決しないことがあるためタイムアウト付き race で保護。
			// 永続化できなくても OPFS 自体は使用可能（persistence は最適化のお願いに過ぎない）。
			try {
				OPFS.p = await Promise.race([navigator.storage.persist(), new Promise(r => setTimeout(r, 3000, false))]);
			} catch (e) {
				OPFS.p = false;
			}
			OPFS.t = await navigator.storage.getDirectory(); //init root
			// 管理域名をハッシュしたディレクトリ（FS ルート直下の <OPFS.d>/ が作業ドメイン）。
			// 旧実装の OPFS.d = OPFS.mkDir(n) は Promise を d に代入した上 FS ルートに素の n ディレクトリを作る副作用があったため除去。
			OPFS.d = Y.B2U(await H.d('OPFS_' + n, 10)); //常にハッシュBase64URL@SHA256で指定
		})()),
		OPFS.rd);
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
		const s = isArr(p) ? p : String(p).split(P);
		// 基準点解決: 呼び出し系によって (a) 素の相対パス(meta/... 等)、(b) OPFS.d を既に接頭辞に含む絶対-ish(<hash>/... 等、ls/OPFS.g 由来)
		// の 2 種類が渡る。先頭がドメイン名なら FS ルートから、そうでなければドメインルート(<FSルート>/<OPFS.d>)から辿る。
		// これにより w/r/ls 全域で同一の実体 <FSルート>/<OPFS.d>/<相対パス> を指す（ドメイン分離の本来意図）。
		let t, segs;
		if (s[0] === OPFS.d) {
			t = OPFS.t;
			segs = s;
		} else {
			t = await OPFS.mkD(OPFS.d, OPFS.t); //ドメインルート自体は常に create で確保
			segs = s.filter(x => x && x !== '.');
		}
		for (const d of segs) {
			io(`OPFS gDHR 1 d:${d}/t:${t}/iN${iN}`, t);
			t = iN ? await OPFS.mkD(d, t) : await OPFS.gDH(d, t);
			io(`OPFS gDHR 2 d:${d}/t:${t}/iN${iN}`, t);
			if (!t) return t; //途中消失時は undefined（gDH が握りつぶし）で後段の例外を避ける
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
					h = i ? p.pop() : E, //拡張子分離は i=true のときのみ
					k = i ? p.join('.') : j; //旧実装 (c+P+i)?.. は常に真で無条件に最終 dot 尾を落としていた（meta/x.json → k=x）
				a.push({ k, t: f.type, lm: f.lastModified, h, p: c, s: f.size }); //kはファイル名、vはハンドラ
			}
		}
		return a;
	};
	static g = async (n, h) => ((await OPFS.rd), `${OPFS.d + P + n}.${h}`); //パス生成も初期化(deterministic hash dir)待ち
	static x = async (p, ab, i) => {
		const n = (await OPFS.w(await OPFS.g(p, Y.B2U(await H.d(ab, 10))), ab)).split(OPFS.d + P)[1];
		return i ? n.split('.').pop() : n; //iがTrueの場合、hashのみを返す。
	}; //データを重複せずに書き込む系、ハッシュ値込みのファイル名を返す,iがTrueの場合はハッシュ値のみ
	static y = async (n, h) => await OPFS.r(await OPFS.g(n, h)); //ファイル名&ハッシュでロード
	static rmh = async (n, h) => await OPFS.rmf(await OPFS.g(n, h)); //ファイル名&ハッシュで削除
	static w = async (p, ab) => {
		await OPFS.rd; //初期化(ルート/管理Dir)完了待ち
		io('OPFS.w p:', p);
		const d = await OPFS.mkFile(p); //Write ArrayBuffer
		if (d.createSyncAccessHandle) {
			const h = await d.createSyncAccessHandle();
			h.truncate(0); //旧内容を必ず消す（truncate 無しは上書き後尾に残骸残り→JSON 破損の原因）
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
	// 追記（jsonl 差分ログ用）。既存末尾へ seek/write で足す。既存無ければ新規作成。
	static ap = async (p, ab) => {
		await OPFS.rd;
		const d = await OPFS.mkFile(p);
		if (d.createSyncAccessHandle) {
			const h = await d.createSyncAccessHandle();
			const n = h.getSize();
			h.write(ab, { at: n });
			h.flush();
			h.close();
		} else {
			const f = await d.getFile(),
				h = await d.createWritable({ keepExistingData: true });
			await h.seek(f.size);
			await h.write(ab);
			await h.close();
		}
		return p;
	};
	static r = async p => {
		await OPFS.rd; //初期化完了待ち
		const d = await OPFS.mkFile(p), // read as ArrayBuffer
			b = await d.getFile();
		return await b.arrayBuffer();
	};
}
