import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';
import tsParser from '@typescript-eslint/parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
	baseDirectory: __dirname,
});

const eslintConfig = [
	{
		ignores: ['**/.next/**', '**/node_modules/**', '**/dist/**', '**/build/**', '**/.turbo/**', '**/coverage/**'],
	},
	...nextCoreWebVitals,
	...nextTypescript,
	...compat.extends('plugin:@typescript-eslint/recommended'),
	{
		files: ['**/*.ts', '**/*.tsx'],
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				project: './tsconfig.json',
				ecmaVersion: 'latest',
				sourceType: 'module',
				ecmaFeatures: {
					jsx: true,
				},
			},
		},
		rules: {
			// Semicolons
			semi: ['error', 'always'],
			'no-extra-semi': 'error',

			// Next.js specific
			'@next/next/no-html-link-for-pages': 'error',
			'@next/next/no-img-element': 'error',
			'@next/next/no-script-component-in-head': 'error',
			'@next/next/google-font-display': 'error',
			'@next/next/google-font-preconnect': 'error',
			'@next/next/inline-script-id': 'error',
			'@next/next/no-head-import-in-document': 'error',
			'@next/next/no-title-in-document-head': 'error',
			'@next/next/no-typos': 'error',
			'@next/next/no-unwanted-polyfillio': 'error',

			// React specific
			'react/jsx-boolean-value': ['error', 'never'],
			'react/jsx-curly-brace-presence': ['error', 'never'],
			'react/jsx-no-duplicate-props': 'error',
			'react/jsx-no-useless-fragment': 'error',
			'react/jsx-pascal-case': 'error',
			'react/jsx-sort-props': [
				'error',
				{
					callbacksLast: true,
					shorthandFirst: true,
				},
			],
			'react/no-array-index-key': 'error',
			'react/no-unescaped-entities': 'error',
			'react/prop-types': 'off', // We use TypeScript
			'react/react-in-jsx-scope': 'off', // Not needed in Next.js

			// TypeScript specific
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_',
				},
			],
			'@typescript-eslint/no-explicit-any': 'error',
			'@typescript-eslint/explicit-function-return-type': [
				'error',
				{
					allowExpressions: true,
					allowTypedFunctionExpressions: true,
				},
			],
			'@typescript-eslint/no-floating-promises': 'error',
			'@typescript-eslint/no-misused-promises': [
				'error',
				{
					checksVoidReturn: false,
				},
			],
			'@typescript-eslint/await-thenable': 'error',
			'@typescript-eslint/no-for-in-array': 'error',
			'@typescript-eslint/no-unnecessary-type-assertion': 'error',
			'@typescript-eslint/prefer-as-const': 'error',
			'@typescript-eslint/prefer-optional-chain': 'error',
			'@typescript-eslint/unified-signatures': 'error',

			// General best practices
			'no-console': ['error', { allow: ['warn', 'error'] }],
			'no-debugger': 'error',
			'no-duplicate-imports': 'error',
			'no-unused-vars': 'off', // We use TypeScript's version
			'prefer-const': 'error',
			'no-var': 'error',
			eqeqeq: ['error', 'always'],
			curly: ['error', 'all'],
			'brace-style': ['error', '1tbs'],
			'arrow-body-style': ['error', 'as-needed'],
			'arrow-parens': ['error', 'as-needed'],
			'arrow-spacing': 'error',
			'comma-dangle': ['error', 'always-multiline'],
			'comma-spacing': 'error',
			'comma-style': 'error',
			quotes: ['error', 'single', { avoidEscape: true }],
			'space-before-function-paren': [
				'error',
				{
					anonymous: 'always',
					named: 'never',
					asyncArrow: 'always',
				},
			],
			'space-before-blocks': 'error',
			'space-infix-ops': 'error',
			'space-unary-ops': 'error',
			'spaced-comment': 'error',
			'object-curly-spacing': ['error', 'always'],
			'array-bracket-spacing': 'error',
			'computed-property-spacing': 'error',
			'template-curly-spacing': 'error',
			'max-len': [
				'warn',
				{
					code: 120,
					ignoreUrls: true,
					ignoreStrings: true,
					ignoreTemplateLiterals: true,
					ignoreRegExpLiterals: true,
					ignoreComments: true,
				},
			],
		},
	},
	...compat.extends('prettier'),
];

export default eslintConfig;
