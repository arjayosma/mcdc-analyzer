import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so dist/ works when opened from any static host or sub-path.
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
