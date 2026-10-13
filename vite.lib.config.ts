import { copyFileSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

/**
 * Builds the npm package's `mcdc-analyzer/vitest` entry into dist-lib/.
 * Everything it needs (Babel parser, magic-string, the analyzer) is bundled,
 * so the published package has no runtime dependencies; vite and vitest come
 * from the user's project.
 */
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const entry = (file: string): string => new URL(`./src/integrations/vitest/${file}`, import.meta.url).pathname;

export default defineConfig({
  define: { __MCDC_VERSION__: JSON.stringify(version) },
  // The demo site's public/ files (preview image, verification) are not part of the package.
  publicDir: false,
  build: {
    outDir: 'dist-lib',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    lib: {
      formats: ['es'],
      entry: {
        vitest: entry('index.ts'),
        'vitest-runtime': entry('runtime.ts'),
        'vitest-setup': entry('setup.ts'),
        'vitest-global-setup': entry('globalSetup.ts'),
      },
    },
    rollupOptions: {
      external: ['vite', 'vitest', /^node:/, ...builtinModules],
      output: { entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js' },
    },
  },
  plugins: [
    {
      name: 'copy-public-types',
      closeBundle() {
        copyFileSync(entry('public.d.ts'), new URL('./dist-lib/vitest.d.ts', import.meta.url));
      },
    },
  ],
});
