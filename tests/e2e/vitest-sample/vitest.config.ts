// A tiny project that uses the *built* plugin exactly like an npm user would.
import { defineConfig } from 'vitest/config';
import mcdc from '../../../dist-lib/vitest.js';

export default defineConfig({
  plugins: [mcdc()],
});
