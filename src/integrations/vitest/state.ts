import type { InstrumentedFile } from './merge';

/** Shared, in the main Vitest process, between the plugin and the global teardown. */
export interface PluginState {
  readonly files: Map<string, InstrumentedFile>;
  partsDir: string | null;
  output: string | null;
  project: string;
}

const KEY = Symbol.for('mcdc-analyzer.vitest');
const scope = globalThis as typeof globalThis & { [KEY]?: PluginState };

export const state: PluginState = (scope[KEY] ??= { files: new Map(), partsDir: null, output: null, project: 'project' });

/** Environment variable that tells workers where to write their results. */
export const PARTS_ENV = 'MCDC_ANALYZER_PARTS';
