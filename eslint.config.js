import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import globals from 'globals';
import jsdoc from 'eslint-plugin-jsdoc';

export default defineConfig([
	js.configs.recommended,
	{
		plugins: {
			jsdoc,
		},
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
			},
			ecmaVersion: 2022,
			sourceType: 'module',
			parserOptions: {
				sourceType: 'module',
				requireConfigFile: false,
			},
		},
		settings: {},
		rules: {},
	},
	{
		files: ['**/*.js'],
		rules: {},
	},
	{
		files: ['**/*.test.js', '**/*.test.js'],
		rules: {},
	},
]);
