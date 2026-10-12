import { describe, expect, it } from 'vitest';
import { parseJavaScript } from '../../../src/adapters/javascript';
import type { FunctionModel } from '../../../src/model/types';

/** Renders edges as "from -kind-> to" using node labels, for readable assertions. */
function edgesOf(fn: FunctionModel | undefined): string[] {
  if (!fn) throw new Error('function not found');
  const label = (id: string) => fn.cfg.nodes.find((node) => node.id === id)?.label ?? id;
  return fn.cfg.edges.map(
    (edge) =>
      `${label(edge.from)} -${edge.label ?? edge.kind}${edge.back ? ' (back)' : ''}-> ${label(edge.to)}`,
  );
}

const firstFunction = (source: string) => parseJavaScript(source).functions[0];

describe('javascript adapter: control-flow graph', () => {
  it('branches on if/else and merges afterwards', () => {
    const fn = firstFunction(`
      function f(a, b) {
        let x = 0;
        if (a && b) {
          x = 1;
        } else {
          x = 2;
        }
        return x;
      }`);

    expect(edgesOf(fn)).toEqual([
      'f -flow-> let x = 0;',
      'let x = 0; -flow-> if (a && b)',
      'if (a && b) -true-> x = 1;',
      'if (a && b) -false-> x = 2;',
      'x = 1; -flow-> return x;',
      'x = 2; -flow-> return x;',
      'return x; -return-> exit',
    ]);
    const decisionNode = fn?.cfg.nodes.find((node) => node.kind === 'decision');
    expect(decisionNode?.decisionId).toBe('d0');
  });

  it('wires while loops with break, continue and back-edges', () => {
    const fn = firstFunction(`
      function f() {
        while (more()) {
          if (skip) continue;
          if (stop) break;
          work();
        }
        done();
      }`);

    expect(edgesOf(fn)).toEqual([
      'f -flow-> while (more())',
      'while (more()) -true-> if (skip)',
      'if (skip) -true-> continue;',
      'if (skip) -false-> if (stop)',
      'if (stop) -true-> break;',
      'if (stop) -false-> work();',
      'work(); -flow (back)-> while (more())',
      'continue; -flow (back)-> while (more())',
      'while (more()) -false-> done();',
      'break; -flow-> done();',
      'done(); -flow-> exit',
    ]);
  });

  it('routes for-loop continues through the update and supports for (;;)', () => {
    const fn = firstFunction(`
      function f() {
        for (let i = 0; i < n; i++) { if (odd(i)) continue; use(i); }
        for (;;) { if (ready()) break; }
      }`);

    expect(edgesOf(fn)).toEqual([
      'f -flow-> let i = 0',
      'let i = 0 -flow-> for (…; i < n; …)',
      'for (…; i < n; …) -true-> if (odd(i))',
      'if (odd(i)) -true-> continue;',
      'if (odd(i)) -false-> use(i);',
      'use(i); -flow-> i++',
      'continue; -flow-> i++',
      'i++ -flow (back)-> for (…; i < n; …)',
      'for (…; i < n; …) -false-> for (;;)',
      'for (;;) -flow-> if (ready())',
      'if (ready()) -true-> break;',
      'if (ready()) -false (back)-> for (;;)',
      'break; -flow-> exit',
    ]);
  });

  it('evaluates the do-while test after the body', () => {
    expect(edgesOf(firstFunction('function f() { do { step(); } while (again); end(); }'))).toEqual([
      'f -flow-> do',
      'do -flow-> step();',
      'step(); -flow-> while (again)',
      'while (again) -true (back)-> do',
      'while (again) -false-> end();',
      'end(); -flow-> exit',
    ]);
  });

  it('models switch cases, fall-through and the no-match path', () => {
    const fn = firstFunction(`
      function f(k) {
        switch (k) {
          case 1:
          case 2: one(); break;
          case 3: three();
        }
      }`);

    expect(edgesOf(fn)).toEqual([
      'f -flow-> switch (k)',
      'switch (k) -case 2-> one(); (+1)',
      'switch (k) -case 1-> one(); (+1)',
      'switch (k) -case 3-> three();',
      'three(); -flow-> exit',
      'one(); (+1) -flow-> exit',
      'switch (k) -no match-> exit',
    ]);
  });

  it('models try/catch and for…of loops', () => {
    expect(
      edgesOf(firstFunction('function f(xs) { try { for (const x of xs) use(x); } catch (e) { log(e); } }')),
    ).toEqual([
      'f -flow-> try',
      'try -flow-> for (const x of xs)',
      'for (const x of xs) -next-> use(x);',
      'use(x); -flow (back)-> for (const x of xs)',
      'try -catch-> log(e);',
      'for (const x of xs) -done-> exit',
      'log(e); -flow-> exit',
    ]);
  });

  it('honours labelled break out of nested loops', () => {
    const edges = edgesOf(
      firstFunction('function f() { outer: for (const a of as) { for (const b of bs) { if (hit) break outer; } } after(); }'),
    );

    expect(edges).toContain('break outer; -flow-> after();');
  });

  it('leaves code after return unreachable', () => {
    const fn = firstFunction('function f() { return 1; dead(); }');
    const dead = fn?.cfg.nodes.find((node) => node.label === 'dead();');

    expect(dead).toBeDefined();
    expect(fn?.cfg.edges.some((edge) => edge.to === dead?.id)).toBe(false);
  });

  it('tags blocks and decision nodes with the expression-level decisions inside them', () => {
    const { functions, decisions } = parseJavaScript(
      'function f(a, b, c) { const v = a ? b : c; if (ok(x || y)) use(v); }',
    );
    const nodes = functions[0]?.cfg.nodes ?? [];
    const idOf = (text: string) => decisions.find((d) => d.text === text)?.id;

    expect(nodes.find((n) => n.label === 'const v = a ? b : c;')?.decisionIds).toEqual([idOf('a')]);
    expect(nodes.find((n) => n.kind === 'decision')?.decisionIds).toEqual([idOf('ok(x || y)'), idOf('x || y')]);
  });

  it('builds a single block for expression-bodied arrows', () => {
    const { functions } = parseJavaScript('const isAdult = (p) => p.age >= 18 && p.verified;');
    const arrow = functions.find((fn) => fn.name === 'isAdult');

    expect(edgesOf(arrow)).toEqual([
      'isAdult -flow-> p.age >= 18 && p.verified',
      'p.age >= 18 && p.verified -return-> exit',
    ]);
  });
});
