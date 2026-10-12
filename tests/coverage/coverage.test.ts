import { describe, expect, it } from 'vitest';
import { javascriptAdapter } from '../../src/adapters/javascript';
import { analyzeSource } from '../../src/analysis';
import { coveragePercent, decisionCoverage, fileCoverage } from '../../src/coverage/coverage';
import type { Observation } from '../../src/coverage/types';

const observe = (values: (boolean | null)[], outcome: boolean, test: string | null = null): Observation => ({
  path: null,
  decisionId: 'd0',
  values,
  outcome,
  test,
});

// (a && b) || c — rows: #0 F-F→F, #1 F-T→T, #2 TFF→F, #3 TFT→T, #4 TT-→T
const analysis = analyzeSource('if ((a && b) || c) go();', javascriptAdapter, 'masking');
const result = analysis.decisions.get('d0');
if (!result) throw new Error('missing decision');

describe('decisionCoverage', () => {
  it('reports nothing covered before any evaluation', () => {
    const coverage = decisionCoverage(result, []);

    expect(coverage).toMatchObject({ evaluations: 0, covered: 0, coverable: 3, unmatched: 0 });
    expect(coverage.outcomes).toEqual({ true: false, false: false });
    expect(coverage.missingRows).toEqual(result.selection.rows);
  });

  it('matches evaluations to rows and counts the tests that hit them', () => {
    const coverage = decisionCoverage(result, [
      observe([false, null, false], false, 'neither'),
      observe([false, null, false], false, 'neither again'),
      observe([true, true, null], true, 'both'),
    ]);

    expect(coverage.rowHits.get(0)).toEqual({ count: 2, tests: ['neither', 'neither again'] });
    expect(coverage.rowHits.get(4)).toEqual({ count: 1, tests: ['both'] });
    expect(coverage.outcomes).toEqual({ true: true, false: true });
  });

  it('marks a condition covered once both rows of one of its pairs were hit', () => {
    const coverage = decisionCoverage(result, [observe([false, null, false], false), observe([true, true, null], true)]);

    // Rows #0 and #4 form the only pair for C1 (a).
    expect(coverage.conditions[0]?.observedPair).toEqual({ condition: 0, falseRow: 0, trueRow: 4 });
    expect(coverage.covered).toBe(1);
    // C2 (b) needs #2 with #4; C3 (c) can reuse #0 with #1.
    expect(coverage.conditions[1]?.neededPair).toEqual({ condition: 1, falseRow: 2, trueRow: 4 });
    expect(coverage.conditions[2]?.neededPair).toEqual({ condition: 2, falseRow: 0, trueRow: 1 });
    expect(coverage.missingRows).toEqual([1, 2]);
  });

  it('reaches full coverage with a complete minimal set', () => {
    const rows = result.selection.rows.map((id) => result.rows[id]);
    const coverage = decisionCoverage(result, rows.map((row) => observe([...(row?.values ?? [])], row?.outcome ?? false)));

    expect(coverage.covered).toBe(3);
    expect(coverage.missingRows).toEqual([]);
    expect(coveragePercent(coverage)).toBe(100);
  });

  it('counts evaluations that match no row instead of guessing', () => {
    expect(decisionCoverage(result, [observe([true, null, true], true)]).unmatched).toBe(1);
  });

  it('leaves conditions that can never be shown out of the percentage', () => {
    const coupled = analyzeSource('function f(age, member) { return (age >= 18 && member) || age >= 18; }', javascriptAdapter, 'masking');
    const coverage = fileCoverage(coupled, []);

    expect(coverage).toMatchObject({ coverable: 2, covered: 0, decisions: 1, decisionsReached: 0 });
  });
});

describe('coverageFor', () => {
  it('shows coverage only for the exact source the run saw', async () => {
    const { coverageFor } = await import('../../src/ui/selectors');
    const run = {
      observations: [observe([false, null, false], false)],
      tests: [],
      logs: [],
      error: null,
      durationMs: 1,
      sources: new Map<string | null, string>([[null, analysis.program.source]]),
    };
    const edited = analyzeSource('if ((a && b) || c) go(); // edited', javascriptAdapter, 'masking');

    expect(coverageFor(run, null, analysis).file?.decisionsReached).toBe(1);
    expect(coverageFor(run, null, edited)).toEqual({ file: null, stale: true });
    expect(coverageFor(run, 'src/other.ts', analysis)).toEqual({ file: null, stale: false });
    expect(coverageFor(null, null, analysis)).toEqual({ file: null, stale: false });
  });
});
