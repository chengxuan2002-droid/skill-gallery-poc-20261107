import js from '@eslint/js';
import { globalIgnores } from 'eslint/config';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  globalIgnores([
    'skills/**',
    'node_modules/**',
    '.tools/**',
    'dist/**',
    'vendor/**',
    'tests/fixtures/**',
  ]),
  {
    files: ['assets/**/*.js'],
    ...js.configs.recommended,
    languageOptions: { sourceType: 'script', globals: globals.browser },
  },
  {
    files: ['scripts/**/*.js', 'tests/**/*.js'],
    ...js.configs.recommended,
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
  {
    files: ['eslint.config.mjs'],
    ...js.configs.recommended,
    languageOptions: { sourceType: 'module', globals: globals.node },
  },
  prettier,
];
