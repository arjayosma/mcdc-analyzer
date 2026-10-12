import { describe, expect, it } from 'vitest';
import { parseJavaScript } from '../../src/adapters/javascript';
import { examplePath } from '../../src/cfg/paths';
import type { FunctionModel } from '../../src/model/types';

const labels = (fn: FunctionModel, nodes: readonly string[]) =>
  nodes.map((id) => fn.cfg.nodes.find((node) => node.id === id)?.label);

const fnOf = (source: string): FunctionModel => {
  const fn = parseJavaScript(source).functions[0];
  if (!fn) throw new Error('no function');
  return fn;
};

const decisionNode = (fn: FunctionModel, label: string) => {
  const node = fn.cfg.nodes.find((n) => n.label === label);
  if (!node) throw new Error(`no node ${label}`);
  return node.id;
};

describe('examplePath', () => {
  const fn = fnOf(`
    function f(a, b) {
      init();
      if (a && b) { yes(); } else { no(); }
      while (more()) { if (b) return 1; step(); }
      return 0;
    }`);

  it('leaves a decision on the requested outcome and reaches exit', () => {
    const path = examplePath(fn.cfg, decisionNode(fn, 'if (a && b)'), false);

    expect(labels(fn, path?.nodes ?? [])).toEqual([
      'f',
      'init();',
      'if (a && b)',
      'no();',
      'while (more())',
      'return 0;',
      'exit',
    ]);
    expect(path?.edges.map((i) => fn.cfg.edges[i]?.kind)).toEqual(['flow', 'flow', 'false', 'flow', 'false', 'return']);
  });

  it('follows the true branch into a loop body without taking back-edges', () => {
    const path = examplePath(fn.cfg, decisionNode(fn, 'if (b)'), true);

    expect(labels(fn, path?.nodes ?? [])).toEqual([
      'f',
      'init();',
      'if (a && b)',
      'yes();',
      'while (more())',
      'if (b)',
      'return 1;',
      'exit',
    ]);
  });

  it('passes through a non-decision node when no outcome is given', () => {
    const path = examplePath(fn.cfg, decisionNode(fn, 'step();'));

    expect(labels(fn, path?.nodes ?? []).slice(-4)).toEqual(['step();', 'while (more())', 'return 0;', 'exit']);
  });

  it('returns null for unreachable nodes', () => {
    const dead = fnOf('function g() { return 1; dead(); }');

    expect(examplePath(dead.cfg, decisionNode(dead, 'dead();'))).toBeNull();
  });
});
