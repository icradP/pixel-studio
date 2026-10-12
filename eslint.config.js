import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'tests/output/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { ecmaVersion: 2022 },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  { files: ['dist/**/*.js'], languageOptions: { globals: globals.browser } },
  { files: ['tests/browser/**/*.js'], languageOptions: { globals: globals.browser } },
  { files: ['dist/sw.js', 'dist/pixel-worker.js'], languageOptions: { globals: globals.worker } },
  {
    files: ['*.{js,cjs}', 'tests/**/*.{js,mjs}', 'scripts/**/*.js'],
    languageOptions: { globals: globals.node },
  },
];
