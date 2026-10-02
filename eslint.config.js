import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: ['**/.next/**', '**/node_modules/**', '**/dist/**', '**/.turbo/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // Config files stay lintable (next.config.js carries the CSP/HSTS headers —
  // security-relevant), but most are CommonJS in an ESM-typed repo, so give
  // them CJS globals rather than a blanket ignore.
  {
    files: ['**/*.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        module: 'writable',
        require: 'writable',
        process: 'writable',
        console: 'writable',
        __dirname: 'writable',
      },
    },
    rules: {
      // CJS config files legitimately require() their plugins.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  // Type-aware rule for the server tree: an unawaited promise in a request
  // handler is a silent data-loss / ordering bug. Full recommendedTypeChecked
  // was tried and is too noisy for the existing codebase; this is the single
  // highest-value type-aware rule.
  {
    files: ['apps/web/src/server/**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  prettierConfig,
);
