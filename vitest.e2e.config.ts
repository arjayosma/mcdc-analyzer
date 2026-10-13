import { defineConfig } from 'vitest/config';

// End-to-end tests that spawn real tool runs; see `npm run test:e2e`.
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
