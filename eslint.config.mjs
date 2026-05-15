import nodecraft from '@nodecraft/eslint-config';

export default [
	{
		ignores: [
			'.cache',
			'dist',
			'docs',
			'misc',
			'temp',
			'coverage',
			'src/db/schema.js',
			'src/db/schema.d.ts',
			'vitest.config.js',
			'vitest.config.d.ts',
			'**/*.js.map',
		],
	},
	...nodecraft.configs.typescript,
	{
		rules: {
			// Disabled: its autofix strips the encoding argument from
			// `fs.readFileSync` so `JSON.parse` receives a Buffer. That is
			// valid at runtime but fails TypeScript's `JSON.parse(string)`
			// typing, so `lint:fix` would silently break the build.
			'unicorn/prefer-json-parse-buffer': 'off',

			// Re-allow TypeScript enums: this project relies on a dedicated
			// src/enums/ directory. Keeps the rest of Nodecraft's
			// no-restricted-syntax bans (definite assignment assertions).
			'no-restricted-syntax': [
				'error',
				{
					selector: 'VariableDeclarator[definite=true]',
					message: 'Do not use definite assignment assertions (`!`) on variables.',
				},
				{
					selector: 'PropertyDefinition[definite=true]',
					message: 'Do not use definite assignment assertions (`!`) on class properties.',
				},
			],
		},
	},
];
