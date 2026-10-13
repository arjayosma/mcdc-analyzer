import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import MagicString from 'magic-string';
import { createFilter, type Plugin } from 'vite';
import { javascriptAdapter } from '../../adapters/javascript';
import { instrumentationInsertions } from '../../coverage/instrument';
import type PublicApi from './public';
import type { McdcVitestOptions } from './public';
import { PARTS_ENV, state } from './state';

export type { McdcVitestOptions } from './public';

const DEFAULT_INCLUDE = ['**/*.{js,jsx,mjs,ts,tsx,mts}'];
const DEFAULT_EXCLUDE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/coverage/**',
  '**/*.d.ts',
  '**/*.{test,spec}.?(c|m)[jt]s?(x)',
  '**/__tests__/**',
  '**/__mocks__/**',
  '**/{vite,vitest}.config.*',
];

/** A file shipped next to this one in the published package (see vite.lib.config.ts). */
const sibling = (name: string): string => {
  // Keep `import.meta.url` in a variable: Vite's build rewrites the literal
  // pattern `new URL('./…', import.meta.url)` into an asset lookup.
  const here = import.meta.url;
  return fileURLToPath(new URL(name, here)).split(sep).join('/');
};

/**
 * Vitest plugin that records MC/DC coverage while your tests run and writes
 * `mcdc-coverage.json`, which you can open in MC/DC Analyzer.
 *
 * ```ts
 * import mcdc from 'mcdc-analyzer/vitest';
 * export default defineConfig({ plugins: [mcdc()] });
 * ```
 */
export default function mcdc(options: McdcVitestOptions = {}): Plugin {
  let root = process.cwd();
  let filter = createFilter(DEFAULT_INCLUDE, DEFAULT_EXCLUDE);
  const runtime = options.runtimeModule ?? sibling('vitest-runtime.js');
  // This package's own files must never be instrumented: the recorder would record itself.
  const ownDir = runtime.slice(0, runtime.lastIndexOf('/') + 1);

  return {
    name: 'mcdc-analyzer',
    // Instrument the original source, before TypeScript and JSX are stripped.
    enforce: 'pre',

    config(config) {
      root = resolve(config.root ?? process.cwd());
      // Workers write their results here; the global teardown merges them.
      state.partsDir ??= mkdtempSync(join(tmpdir(), 'mcdc-analyzer-'));
      state.output = resolve(root, options.output ?? 'mcdc-coverage.json');
      state.project = options.projectName ?? basename(root);
      process.env[PARTS_ENV] = state.partsDir;
      return {
        test: {
          setupFiles: [options.setupModule ?? sibling('vitest-setup.js')],
          globalSetup: [options.globalSetupModule ?? sibling('vitest-global-setup.js')],
        },
      };
    },

    configResolved(resolved) {
      root = resolved.root;
      filter = createFilter(options.include ?? DEFAULT_INCLUDE, [...DEFAULT_EXCLUDE, ...toArray(options.exclude)], { resolve: root });
    },

    transform(code, id) {
      const file = (id.split('?')[0] ?? id).split(sep).join('/');
      const rootDir = `${root.split(sep).join('/').replace(/\/$/, '')}/`;
      // Only the project's own source: not virtual modules, files outside the root or this package.
      if (file.includes('\0') || !file.startsWith(rootDir) || file.startsWith(ownDir) || !filter(file)) return null;
      const program = javascriptAdapter.parse(code);
      // Nothing to measure, or code the analyzer could not parse at all.
      if (program.decisions.length === 0 || (program.diagnostics.length > 0 && program.functions.length === 0)) return null;

      const path = relative(root, file).split(sep).join('/');
      state.files.set(path, {
        source: code,
        decisionSizes: Object.fromEntries(program.decisions.map((d) => [d.id, d.conditions.length])),
      });

      const output = new MagicString(code);
      for (const insertion of instrumentationInsertions(program, path)) output.appendLeft(insertion.position, insertion.text);
      // A shebang must stay on the first line; the recorder import goes after it.
      const importAt = code.startsWith('#!') ? code.indexOf('\n') + 1 : 0;
      output.appendRight(importAt, `import { recorder as __mcdc } from ${JSON.stringify(runtime)};\n`);
      return { code: output.toString(), map: output.generateMap({ hires: true, source: file, includeContent: true }) };
    },
  };
}

function toArray(value: string | readonly string[] | undefined): string[] {
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : [...value];
}

// Keeps the hand-written public declaration file honest.
const matchesPublicApi: typeof PublicApi = mcdc;
void matchesPublicApi;
