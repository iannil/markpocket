import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)),
    },
  },
  test: {
    include: ['packages/**/src/**/*.test.ts', 'apps/web/src/**/*.test.ts'],
    environment: 'node',
    typecheck: {
      enabled: true,
      include: ['packages/**/src/**/*.test-d.ts', 'apps/web/src/**/*.test-d.ts'],
      tsconfig: './packages/plugin-sdk/tsconfig.json',
    },
  },
});
