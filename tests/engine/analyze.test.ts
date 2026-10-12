import { describe, expect, it } from 'vitest';
import { analyzeDecision, type DecisionAnalysis } from '../../src/engine';
import { formatRow, parseBool } from '../helpers/boolExpr';

const pairIds = (analysis: DecisionAnalysis): [number, number][][] =>
  analysis.pairs.map((pairs) => pairs.map((pair) => [pair.falseRow, pair.trueRow]));

describe('analyzeDecision', () => {
  it('builds the short-circuit truth table for a && b', () => {
    const analysis = analyzeDecision(parseBool('a && b'));

    expect(analysis.rows.map(formatRow)).toEqual(['F- => F', 'TF => F', 'TT => T']);
    expect(pairIds(analysis)).toEqual([[[0, 2]], [[1, 2]]]);
    expect(analysis.selection.rows).toEqual([0, 1, 2]);
    expect(analysis.selection.optimal).toBe(true);
  });

  it('builds the short-circuit truth table for a || b', () => {
    const analysis = analyzeDecision(parseBool('a || b'));

    expect(analysis.rows.map(formatRow)).toEqual(['FF => F', 'FT => T', 'T- => T']);
    expect(pairIds(analysis)).toEqual([[[0, 2]], [[0, 1]]]);
    expect(analysis.selection.rows).toEqual([0, 1, 2]);
  });

  it('inverts the outcome through negation', () => {
    const analysis = analyzeDecision(parseBool('!(a || b)'));

    expect(analysis.rows.map(formatRow)).toEqual(['FF => T', 'FT => F', 'T- => F']);
    expect(analysis.selection.rows).toHaveLength(3);
  });

  it('finds masking pairs and an N+1 test set for (a && b) || c', () => {
    const analysis = analyzeDecision(parseBool('(a && b) || c'));

    expect(analysis.rows.map(formatRow)).toEqual([
      'F-F => F',
      'F-T => T',
      'TFF => F',
      'TFT => T',
      'TT- => T',
    ]);
    expect(pairIds(analysis)).toEqual([
      [[0, 4]],
      [[2, 4]],
      [
        [0, 1],
        [0, 3],
        [2, 1],
        [2, 3],
      ],
    ]);
    expect(analysis.uncoverable).toEqual([]);
    expect(analysis.selection.rows).toHaveLength(4);
    expect(analysis.selection.rows).toEqual(expect.arrayContaining([0, 2, 4]));
  });

  it('needs N+1 tests for a && (b || c) && d', () => {
    const analysis = analyzeDecision(parseBool('a && (b || c) && d'));

    expect(analysis.uncoverable).toEqual([]);
    expect(analysis.selection.rows).toHaveLength(5);
  });

  it('flags coupled conditions and reports what each mode can and cannot cover', () => {
    const source = parseBool('a && b || a');
    const masking = analyzeDecision(source);
    const uniqueCause = analyzeDecision(source, { mode: 'unique-cause' });

    expect(masking.coupled).toBe(true);
    expect(masking.rows.map(formatRow)).toEqual(['F-F => F', 'TFT => T', 'TT- => T']);
    // `b` is redundant: the decision is equivalent to `a`.
    expect(masking.uncoverable).toEqual([1]);
    expect(pairIds(masking)).toEqual([[[0, 2]], [], [[0, 1]]]);
    // Unique-cause cannot show the second `a` because the first always changes with it.
    expect(uniqueCause.uncoverable).toEqual([1, 2]);
    expect(uniqueCause.selection.pairs[2]).toBeNull();
  });

  it('marks the truth table as truncated when it exceeds maxRows', () => {
    const analysis = analyzeDecision(parseBool('a && b && c'), { maxRows: 2 });

    expect(analysis.truncated).toBe(true);
    expect(analysis.rows).toHaveLength(2);
  });

  it('builds the short-circuit condition graph', () => {
    const { graph } = analyzeDecision(parseBool('(a && b) || !c'));
    const T = { kind: 'outcome', value: true };
    const F = { kind: 'outcome', value: false };
    const cond = (index: number) => ({ kind: 'condition', index });

    expect(graph.entry).toEqual(cond(0));
    expect(graph.nodes).toEqual([
      { index: 0, onTrue: cond(1), onFalse: cond(2) },
      { index: 1, onTrue: T, onFalse: cond(2) },
      { index: 2, onTrue: F, onFalse: T },
    ]);
  });

  it('rejects trees whose leaf indices are not in source order', () => {
    expect(() =>
      analyzeDecision({
        kind: 'and',
        left: { kind: 'condition', index: 1, group: 1 },
        right: { kind: 'condition', index: 0, group: 0 },
      }),
    ).toThrow(/indexed 0..n-1/);
  });

  it('reports a non-optimal selection when the search budget runs out', () => {
    const analysis = analyzeDecision(parseBool('(a || b) && (c || d) && (e || f)'), { searchBudget: 1 });

    expect(analysis.selection.optimal).toBe(false);
    expect(analysis.selection.pairs.every((pair) => pair !== null)).toBe(true);
  });
});
