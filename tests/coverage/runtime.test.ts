import { describe, expect, it } from 'vitest';
import { javascriptAdapter } from '../../src/adapters/javascript';
import { instrumentSource } from '../../src/coverage/instrument';
import { executeTests, resolveImport, SNIPPET_FILE, type RunnerModule } from '../../src/coverage/runtime';
import { sucraseTransform } from '../../src/coverage/transform';

function moduleFor(path: string | null, source: string): RunnerModule {
  const program = javascriptAdapter.parse(source);
  return {
    path,
    code: instrumentSource(program, path ?? SNIPPET_FILE),
    decisionSizes: Object.fromEntries(program.decisions.map((d) => [d.id, d.conditions.length])),
  };
}

const run = (source: string, testCode: string) =>
  executeTests({ modules: [moduleFor(null, source)], entry: null, testCode }, sucraseTransform);

describe('instrumentSource', () => {
  it('wraps decisions and conditions at their exact source positions', () => {
    const program = javascriptAdapter.parse('if (a && b) go();');

    expect(instrumentSource(program, 'f')).toBe(
      'if ((__mcdc.b("f","d0"),__mcdc.e("f","d0",(__mcdc.c("f","d0",0,(a)) && __mcdc.c("f","d0",1,(b)))))) go();',
    );
  });

  it('puts the decision outside its condition when both cover the same text', () => {
    const program = javascriptAdapter.parse('if (x) go();');

    expect(instrumentSource(program, 'f')).toBe('if ((__mcdc.b("f","d0"),__mcdc.e("f","d0",(__mcdc.c("f","d0",0,(x)))))) go();');
  });

  it('nests decisions found inside conditions', () => {
    const program = javascriptAdapter.parse('const v = ok(x && y) || z;');
    const code = instrumentSource(program, 'f');

    expect(code).toContain('__mcdc.c("f","d0",0,(ok((__mcdc.b("f","d1"),__mcdc.e("f","d1",(__mcdc.c("f","d1",0,(x)) && __mcdc.c("f","d1",1,(y))))))))');
  });
});

describe('executeTests: instrumentation keeps behaviour identical', () => {
  const SOURCE = `
    export const and = (a, b) => a && b;
    export const or = (a, b) => a || b;
    export const comma = (a, b, c) => (a, b) && c;
    export const objectLeaf = (a) => a && { kind: 'obj' };
    export const counter = { n: 2, positive() { return this.n > 0 && this.n < 10; } };
    export async function later(p) { return (await p) || 'fallback'; }
    export function depth(n) { return n > 0 && depth(n - 1) >= 0 ? n : 0; }
    export const label = (x) => x ? 'yes' : 'no';
  `;
  const CALLS = [
    'and(0, 1)', "and('a', 'b')", "or('', 0)", 'or(null, 7)', 'comma(1, 0, 5)', 'comma(1, 2, 5)',
    'objectLeaf(1)', 'objectLeaf(0)', 'counter.positive()', 'await later(Promise.resolve(0))',
    "await later(Promise.resolve('v'))", 'depth(3)', 'label(1)', 'label(0)',
  ];

  it('returns the same values as the original code', async () => {
    const original = sucraseTransform(SOURCE, 'plain.ts');
    const expected = await new Function('exports', `return (async () => {${original}; return [${CALLS.join(', ')}]; })();`)({});
    const outcome = await run(SOURCE, `globalThis.__results = [${CALLS.join(', ')}];`);

    expect(outcome.error).toBeNull();
    expect((globalThis as { __results?: unknown }).__results).toEqual(expected);
  });

  it('records one observation per evaluation, with short-circuited conditions as null', async () => {
    const outcome = await run(
      'function f(a, b) { if (a && b) return 1; return 0; }',
      'test("none", () => f(false, true)); test("first", () => f(true, false)); test("both", () => f(true, true));',
    );

    expect(outcome.observations.map((o) => [o.decisionId, o.values, o.outcome, o.test, o.path])).toEqual([
      ['d0', [false, null], false, 'none', null],
      ['d0', [true, false], false, 'first', null],
      ['d0', [true, true], true, 'both', null],
    ]);
    expect(outcome.tests).toEqual([
      { name: 'none', ok: true },
      { name: 'first', ok: true },
      { name: 'both', ok: true },
    ]);
  });

  it('keeps recursive evaluations of the same decision apart', async () => {
    const outcome = await run('function depth(n) { return n > 0 && depth(n - 1) >= 0 ? n : 0; }', 'depth(2);');
    const values = outcome.observations.map((o) => o.values);

    expect(values).toEqual([
      [false, null],
      [true, true],
      [true, true],
    ]);
  });

  it('reports failing tests, console output and stopping errors', async () => {
    const outcome = await run(
      'export function check(x: number): number { if (x < 0) throw new RangeError("negative"); return x; }',
      'console.log("start", { n: 1 }); test("ok", () => check(1)); test("throws", () => check(-1));',
    );

    expect(outcome.logs).toEqual(['start {"n":1}']);
    expect(outcome.tests).toEqual([
      { name: 'ok', ok: true },
      { name: 'throws', ok: false, error: 'RangeError: negative' },
    ]);

    const broken = await run('function f() {}', 'f(;');
    expect(broken.error).toMatch(/SyntaxError|Unexpected/);
  });

  it('runs JSX with a React stand-in', async () => {
    const outcome = await run(
      'export const View = ({ busy }: { busy: boolean }) => <div>{busy && <span>…</span>}</div>;',
      'globalThis.__view = View({ busy: true });',
    );

    expect(outcome.error).toBeNull();
    expect(outcome.observations.map((o) => o.outcome)).toEqual([true]);
  });
});

describe('executeTests with several project files', () => {
  it('loads relative imports, including .js specifiers for .ts files', async () => {
    const outcome = await executeTests(
      {
        modules: [
          moduleFor('src/rules.ts', 'export const isAdult = (age: number) => age >= 18 && age < 130;'),
          moduleFor('src/shop.ts', "import { isAdult } from './rules.js';\nexport const canBuy = (age: number, stock: number) => isAdult(age) && stock > 0;"),
        ],
        entry: 'src/shop.ts',
        testCode: 'test("adult", () => canBuy(30, 1));',
      },
      sucraseTransform,
    );

    expect(outcome.error).toBeNull();
    expect(outcome.observations.map((o) => [o.path, o.decisionId, o.outcome])).toEqual([
      ['src/rules.ts', 'd0', true],
      ['src/shop.ts', 'd0', true],
    ]);
  });

  it('explains why npm packages cannot be imported', async () => {
    const outcome = await executeTests(
      { modules: [moduleFor('src/a.ts', "import _ from 'lodash';\nexport const x = _.identity(1);")], entry: 'src/a.ts', testCode: '' },
      sucraseTransform,
    );

    expect(outcome.error).toContain('Package "lodash" is not available in the browser runner');
  });
});

describe('resolveImport', () => {
  const files = new Set(['src/a.ts', 'src/lib/index.tsx', 'src/util.ts', 'shared/x.js']);

  it('resolves relative paths, extensions, index files and .js specifiers', () => {
    expect(resolveImport('src/a.ts', './util', files)).toBe('src/util.ts');
    expect(resolveImport('src/a.ts', './util.js', files)).toBe('src/util.ts');
    expect(resolveImport('src/a.ts', './lib', files)).toBe('src/lib/index.tsx');
    expect(resolveImport('src/lib/index.tsx', '../../shared/x', files)).toBe('shared/x.js');
  });

  it('refuses bare packages, paths outside the project and snippet imports', () => {
    expect(resolveImport('src/a.ts', 'react', files)).toBeNull();
    expect(resolveImport('src/a.ts', '../../../etc', files)).toBeNull();
    expect(resolveImport(null, './util', files)).toBeNull();
  });
});
