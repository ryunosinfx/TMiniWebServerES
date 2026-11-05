export class FileUtil {
	static oFL(elm, cb) {
		return () => {
			const [f] = elm.files;
			if (f) {
				const n = f.name,
					t = f.type,
					r = new FileReader();
				r.addEventListener('load', () => cb(n, t, r.result));
				r.addEventListener(
					'error',
					e => console.error(`Error occurred reading file: ${n}`, e) & cb(n, t, null)
				);
				r.readAsArrayBuffer(f);
			} else cb(null, null, null);
		};
	}

	static download(fn, c, mt = 'text/plain') {
		const b = new Blob([c], { type: mt }),
			a = document.createElement('a');
		a.style.display = 'none';
		a.download = fn;
		a.href = window.URL.createObjectURL(b);
		a.dataset.downloadurl = [mt, fn, a.href].join(':');
		document.body.appendChild(a);
		a.click();
		setTimeout(() => document.body.removeChild(a));
	}
}
