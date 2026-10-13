import { rmSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { javascriptAdapter } from '../../src/adapters/javascript';
import { parseCoverageFile } from '../../src/coverage/coverageFile';
import mcdc from '../../src/integrations/vitest';
import { mergeEvaluations } from '../../src/integrations/vitest/merge';
import { createRecorder } from '../../src/integrations/vitest/recorder';
import { state } from '../../src/integrations/vitest/state';

describe('worker recorder', () => {
  it('counts identical evaluations, keeps test names and marks skipped conditions as null', () => {
    const recorder = createRecorder();
    const evaluate = (a: boolean, b: boolean) => {
      recorder.b('src/a.ts', 'd0');
      const result = recorder.c('src/a.ts', 'd0', 0, a) && recorder.c('src/a.ts', 'd0', 1, b);
      return recorder.e('src/a.ts', 'd0', result);
    };

    recorder.setTest('suite > first');
    evaluate(false, true);
    evaluate(false, true);
    recorder.setTest(null);
    evaluate(true, true);

    expect(recorder.drain()).toEqual([
      { file: 'src/a.ts', decision: 'd0', values: [false], outcome: false, test: 'suite > first', count: 2 },
      { file: 'src/a.ts', decision: 'd0', values: [true, true], outcome: true, test: null, count: 1 },
    ]);
    expect(recorder.drain()).toEqual([]);
  });

  it('returns the original values so instrumented code behaves the same', () => {
    const recorder = createRecorder();
    recorder.b('f', 'd0');
    const left = recorder.c('f', 'd0', 0, 'text');

    expect(left).toBe('text');
    expect(recorder.e('f', 'd0', 0)).toBe(0);
  });
});

describe('mergeEvaluations', () => {
  const files = new Map([
    ['src/a.ts', { source: 'if (a && b) {}', decisionSizes: { d0: 2 } }],
    ['src/untested.ts', { source: 'if (x) {}', decisionSizes: { d0: 1 } }],
  ]);

  it('pads values to each decision size, sums counts across workers and keeps unreached files', () => {
    const coverage = mergeEvaluations(
      files,
      [
        { file: 'src/a.ts', decision: 'd0', values: [false], outcome: false, test: 't', count: 2 },
        { file: 'src/a.ts', decision: 'd0', values: [false, null], outcome: false, test: 't', count: 3 },
        { file: 'src/a.ts', decision: 'd0', values: [true, true], outcome: true, test: 't', count: 1 },
        { file: 'src/unknown.ts', decision: 'd0', values: [true], outcome: true, test: null, count: 1 },
      ],
      { project: 'shop', toolVersion: '1.2.3', createdAt: '2026-10-13T00:00:00.000Z' },
    );

    expect(coverage.files['src/a.ts']?.evaluations).toEqual([
      { decision: 'd0', values: [false, null], outcome: false, test: 't', count: 5 },
      { decision: 'd0', values: [true, true], outcome: true, test: 't', count: 1 },
    ]);
    expect(coverage.files['src/untested.ts']).toEqual({ source: 'if (x) {}', evaluations: [] });
    expect(Object.keys(coverage.files)).toEqual(['src/a.ts', 'src/untested.ts']);
    // The result is a valid coverage file for the app.
    expect(parseCoverageFile(JSON.stringify(coverage)).project).toBe('shop');
  });
});

describe('vitest plugin transform', () => {
  const plugin = mcdc({ runtimeModule: '/pkg/vitest-runtime.js', setupModule: '/pkg/setup.js', globalSetupModule: '/pkg/global.js' });
  const config = plugin.config as (config: { root: string }) => { test: { setupFiles: string[]; globalSetup: string[] } };
  const configResolved = plugin.configResolved as (config: { root: string }) => void;
  const transform = plugin.transform as (code: string, id: string) => { code: string; map: { mappings: string } } | null;

  const configured = config({ root: '/project' });
  configResolved({ root: '/project' });
  // config() creates the folder workers write to; a real run's teardown removes it.
  afterAll(() => {
    if (state.partsDir) rmSync(state.partsDir, { recursive: true, force: true });
    state.partsDir = null;
  });

  it('adds the worker setup and teardown to the Vitest config', () => {
    expect(configured.test).toEqual({ setupFiles: ['/pkg/setup.js'], globalSetup: ['/pkg/global.js'] });
    expect(state.output).toBe('/project/mcdc-coverage.json');
    expect(state.project).toBe('project');
  });

  it('instruments source files and records their source', () => {
    const source = 'export function f(a: number, b?: string) {\n  if (a > 0 && b) return 1;\n  return 0;\n}\n';
    const result = transform(source, '/project/src/f.ts?v=123');

    expect(result?.code.startsWith('import { recorder as __mcdc } from "/pkg/vitest-runtime.js";\n')).toBe(true);
    expect(result?.code).toContain('__mcdc.c("src/f.ts","d0",0,(a > 0))');
    expect(result?.map.mappings.length).toBeGreaterThan(0);
    expect(state.files.get('src/f.ts')).toEqual({ source, decisionSizes: { d0: 2 } });
    // Same decision ids as the app computes for this source.
    expect(javascriptAdapter.parse(source).decisions.map((d) => d.id)).toEqual(['d0']);
  });

  it('keeps a shebang on the first line', () => {
    const result = transform('#!/usr/bin/env node\nif (a || b) run();\n', '/project/bin/cli.js');

    expect(result?.code.split('\n')[0]).toBe('#!/usr/bin/env node');
    expect(result?.code.split('\n')[1]).toContain('import { recorder as __mcdc }');
  });

  it('skips tests, dependencies, declaration files and code without decisions', () => {
    expect(transform('if (a && b) {}', '/project/src/f.test.ts')).toBeNull();
    expect(transform('if (a && b) {}', '/project/src/__tests__/f.ts')).toBeNull();
    expect(transform('if (a && b) {}', '/project/node_modules/lib/index.js')).toBeNull();
    expect(transform('declare const x: boolean;', '/project/src/types.d.ts')).toBeNull();
    expect(transform('export const add = (a, b) => a + b;', '/project/src/add.ts')).toBeNull();
    expect(transform('if (a && b) {}', '/project/src/styles.css')).toBeNull();
  });

  it('never instruments files outside the project or its own recorder', () => {
    expect(transform('if (a && b) {}', '/elsewhere/src/f.ts')).toBeNull();
    expect(transform('if (top) top[0] = true;', '/pkg/vitest-runtime.js')).toBeNull();
    // Even when the package sits inside the project (e.g. a local install).
    const local = mcdc({ runtimeModule: '/project/lib/mcdc/vitest-runtime.js' });
    (local.configResolved as (config: { root: string }) => void)({ root: '/project' });
    const localTransform = local.transform as (code: string, id: string) => unknown;
    expect(localTransform('if (top) top[0] = true;', '/project/lib/mcdc/vitest-runtime.js')).toBeNull();
    expect(localTransform('if (a && b) {}', '/project/src/f.ts')).not.toBeNull();
  });
});
