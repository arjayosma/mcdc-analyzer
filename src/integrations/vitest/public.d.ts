// Public type declarations for `mcdc-analyzer/vitest`, published as
// dist-lib/vitest.d.ts. src/integrations/vitest/index.ts checks it matches.
import type { Plugin } from 'vite';

export interface McdcVitestOptions {
  /** Globs of files to instrument (default: JS/TS source files). */
  include?: string | string[];
  /** Extra globs to skip, on top of node_modules, build output, *.d.ts and test files. */
  exclude?: string | string[];
  /** Where to write the coverage file, relative to the project root (default: `mcdc-coverage.json`). */
  output?: string;
  /** Project name shown in the app (default: the project root folder's name). */
  projectName?: string;
  /** @internal Module paths, overridden only by this package's own tests. */
  runtimeModule?: string;
  /** @internal */
  setupModule?: string;
  /** @internal */
  globalSetupModule?: string;
}

/**
 * Vitest plugin that records MC/DC coverage while your tests run and writes
 * `mcdc-coverage.json` for MC/DC Analyzer (https://arjayosma.github.io/mcdc-analyzer/).
 */
export default function mcdc(options?: McdcVitestOptions): Plugin;
