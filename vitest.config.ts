import { fileURLToPath } from 'node:url';

// Several tests import the auth stack (trpc init → better-auth), which warns
// "Base URL is not set" when BETTER_AUTH_URL is undefined — vitest doesn't
// load the app's .env. Default to the dev base URL (apps/web/.env uses
// PORT=7420); ||= keeps an operator-provided value in charge.
process.env.BETTER_AUTH_URL ||= 'http://localhost:7420';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)),
    },
  },
  test: {
    include: [
      'packages/**/src/**/*.test.ts',
      'apps/web/src/**/*.test.ts',
      'apps/web/src/**/*.test.tsx',
    ],
    environment: 'node',
    typecheck: {
      enabled: true,
      // Aligned with where *.test-d.ts files actually live today: only
      // packages/plugin-sdk has type-level tests, and `tsconfig` below is
      // that package's tsconfig (a single tsconfig can only cover one project
      // tree — add a second entry here if apps/web grows test-d files).
      include: ['packages/**/src/**/*.test-d.ts'],
      tsconfig: './packages/plugin-sdk/tsconfig.json',
    },
  },
});
