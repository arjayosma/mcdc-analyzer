import { describe, expect, it } from 'vitest';
import { analyzeDecision, type ConditionGraph, type ConditionNode, type TestRow } from '../../src/engine';
import { parseBool } from '../helpers/boolExpr';

/** Deterministic PRNG so failures are reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomExpression(random: () => number, conditions: number): string {
  const names = Array.from({ length: conditions }, (_, i) => `c${i}`);
  const build = (items: string[]): string => {
    if (items.length === 1) return random() < 0.2 ? `!${items[0]}` : (items[0] ?? '');
    const split = 1 + Math.floor(random() * (items.length - 1));
    const op = random() < 0.5 ? '&&' : '||';
    const expr = `(${build(items.slice(0, split))} ${op} ${build(items.slice(split))})`;
    return random() < 0.15 ? `!${expr}` : expr;
  };
  return build(names);
}

/** Follows the condition graph using a row's values; must reproduce its path. */
function walk(graph: ConditionGraph, row: TestRow): { order: number[]; outcome: boolean } {
  const order: number[] = [];
  let target = graph.entry;
  while (target.kind === 'condition') {
    order.push(target.index);
    const node = graph.nodes[target.index];
    const value = row.values[target.index];
    if (!node || value === null || value === undefined) throw new Error('graph walked into a skipped condition');
    target = value ? node.onTrue : node.onFalse;
  }
  return { order, outcome: target.value };
}

function popcount(mask: number): number {
  let count = 0;
  for (let rest = mask; rest; rest &= rest - 1) count++;
  return count;
}

const random = mulberry32(42);
const cases = Array.from({ length: 60 }, (_, i) => randomExpression(random, 1 + (i % 7)));

describe.each(cases)('engine invariants for %s', (source) => {
  const root: ConditionNode = parseBool(source);

  it('covers every condition of a non-coupled decision with both outcomes and at most 2N tests (masking)', () => {
    const analysis = analyzeDecision(root);
    const outcomes = new Set(analysis.selection.rows.map((id) => analysis.rows[id]?.outcome));

    // Masking MC/DC can need fewer than N+1 tests, e.g. (a||b) && (c||d) needs 4.
    expect(analysis.uncoverable).toEqual([]);
    expect(outcomes.size).toBe(2);
    expect(analysis.selection.rows.length).toBeLessThanOrEqual(2 * analysis.conditionCount);
  });

  it.each(['masking', 'unique-cause'] as const)('returns a set no larger than the brute-force minimum (%s)', (mode) => {
    const analysis = analyzeDecision(root, { mode });
    if (analysis.rows.length > 16) return;

    const covers = (mask: number): boolean =>
      analysis.pairs.every(
        (pairs) =>
          pairs.length === 0 || pairs.some((pair) => mask & (1 << pair.falseRow) && mask & (1 << pair.trueRow)),
      );
    let minimum = Infinity;
    for (let mask = 0; mask < 1 << analysis.rows.length; mask++) {
      if (covers(mask)) minimum = Math.min(minimum, popcount(mask));
    }

    expect(analysis.selection.optimal).toBe(true);
    expect(analysis.selection.rows).toHaveLength(minimum);
  });

  it.each(['masking', 'unique-cause'] as const)('selects only valid pairs drawn from the selected rows (%s)', (mode) => {
    const analysis = analyzeDecision(root, { mode });
    const selected = new Set(analysis.selection.rows);

    analysis.selection.pairs.forEach((pair, condition) => {
      if (!pair) {
        expect(analysis.uncoverable).toContain(condition);
        return;
      }
      const falseRow = analysis.rows[pair.falseRow];
      const trueRow = analysis.rows[pair.trueRow];
      expect(selected.has(pair.falseRow) && selected.has(pair.trueRow)).toBe(true);
      expect(falseRow?.values[condition]).toBe(false);
      expect(trueRow?.values[condition]).toBe(true);
      expect(falseRow?.outcome).not.toBe(trueRow?.outcome);
    });
  });

  it('agrees with the condition graph on every row path and outcome', () => {
    const analysis = analyzeDecision(root);

    for (const row of analysis.rows) {
      expect(walk(analysis.graph, row)).toEqual({ order: row.order, outcome: row.outcome });
    }
  });
});
