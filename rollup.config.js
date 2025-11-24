import terser from '@rollup/plugin-terser';

export default {
	input: 'main.js',
	output: [
		{
			file: 'bundle.js',
			format: 'es',
		},
		{
			file: 'bundle.min.js',
			format: 'es',
			plugins: [terser()],
		},
	],
};
