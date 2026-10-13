import type { ProgramAnalysis } from '../analysis';
import type { DecisionAnalysis, IndependencePair } from '../engine';
import type { Observation } from './types';

export interface RowHit {
  readonly count: number;
  /** Names of the tests that hit this row (empty for calls outside `test()`). */
  readonly tests: readonly string[];
}

export interface ConditionCoverage {
  /** No independence pair exists in this mode, so it can never be covered. */
  readonly uncoverable: boolean;
  /** An independence pair whose two rows were both hit. */
  readonly observedPair: IndependencePair | null;
  /** For an uncovered condition: the pair needing the fewest extra tests. */
  readonly neededPair: IndependencePair | null;
}

export interface DecisionCoverage {
  readonly evaluations: number;
  readonly rowHits: ReadonlyMap<number, RowHit>;
  /** Evaluations that matched no truth-table row (e.g. a truncated table). */
  readonly unmatched: number;
  readonly outcomes: { readonly true: boolean; readonly false: boolean };
  readonly conditions: readonly ConditionCoverage[];
  readonly covered: number;
  readonly coverable: number;
  /** Rows still to test, in id order, to complete MC/DC for this decision. */
  readonly missingRows: readonly number[];
}

export interface CoverageTotals {
  readonly covered: number;
  readonly coverable: number;
  readonly decisions: number;
  /** Decisions evaluated at least once. */
  readonly decisionsReached: number;
  /** Decisions with every coverable condition covered. */
  readonly decisionsComplete: number;
}

export interface FileCoverage extends CoverageTotals {
  readonly byDecision: ReadonlyMap<string, DecisionCoverage>;
}

const rowKey = (values: readonly (boolean | null)[]): string => values.map((v) => (v === null ? '-' : v ? 'T' : 'F')).join('');

export function decisionCoverage(result: DecisionAnalysis, observations: readonly Observation[]): DecisionCoverage {
  const rowsByKey = new Map(result.rows.map((row) => [rowKey(row.values), row.id]));
  const hits = new Map<number, { count: number; tests: Set<string> }>();
  let unmatched = 0;
  const outcomes = { true: false, false: false };

  let evaluations = 0;
  for (const observation of observations) {
    const times = observation.count ?? 1;
    evaluations += times;
    outcomes[observation.outcome ? 'true' : 'false'] = true;
    const rowId = rowsByKey.get(rowKey(observation.values));
    if (rowId === undefined) {
      unmatched += times;
      continue;
    }
    const hit = hits.get(rowId) ?? { count: 0, tests: new Set<string>() };
    hit.count += times;
    if (observation.test !== null) hit.tests.add(observation.test);
    hits.set(rowId, hit);
  }

  const isHit = (rowId: number): boolean => hits.has(rowId);
  const conditions = result.pairs.map((pairs, index): ConditionCoverage => {
    if (pairs.length === 0) return { uncoverable: true, observedPair: null, neededPair: null };
    const observedPair = pairs.find((pair) => isHit(pair.falseRow) && isHit(pair.trueRow)) ?? null;
    if (observedPair) return { uncoverable: false, observedPair, neededPair: null };
    // Prefer the pair needing fewest new tests; on a tie, the one the minimal set chose.
    const chosen = result.selection.pairs[index];
    const missing = (pair: IndependencePair): number => Number(!isHit(pair.falseRow)) + Number(!isHit(pair.trueRow));
    const neededPair = [...pairs].sort((a, b) => missing(a) - missing(b) || Number(b === chosen) - Number(a === chosen))[0] ?? null;
    return { uncoverable: false, observedPair: null, neededPair };
  });

  const missingRows = new Set<number>();
  for (const condition of conditions) {
    for (const rowId of condition.neededPair ? [condition.neededPair.falseRow, condition.neededPair.trueRow] : []) {
      if (!isHit(rowId)) missingRows.add(rowId);
    }
  }

  return {
    evaluations,
    rowHits: new Map([...hits].map(([rowId, hit]) => [rowId, { count: hit.count, tests: [...hit.tests] }])),
    unmatched,
    outcomes,
    conditions,
    covered: conditions.filter((c) => c.observedPair).length,
    coverable: conditions.filter((c) => !c.uncoverable).length,
    missingRows: [...missingRows].sort((a, b) => a - b),
  };
}

/** Coverage of one file's decisions from the observations recorded for it. */
export function fileCoverage(analysis: ProgramAnalysis, observations: readonly Observation[]): FileCoverage {
  const byId = new Map<string, Observation[]>();
  for (const observation of observations) {
    byId.set(observation.decisionId, [...(byId.get(observation.decisionId) ?? []), observation]);
  }
  const byDecision = new Map<string, DecisionCoverage>();
  for (const decision of analysis.program.decisions) {
    const result = analysis.decisions.get(decision.id);
    if (result) byDecision.set(decision.id, decisionCoverage(result, byId.get(decision.id) ?? []));
  }
  return { byDecision, ...totals([...byDecision.values()]) };
}

export function totals(decisions: readonly DecisionCoverage[]): CoverageTotals {
  return {
    covered: decisions.reduce((sum, d) => sum + d.covered, 0),
    coverable: decisions.reduce((sum, d) => sum + d.coverable, 0),
    decisions: decisions.length,
    decisionsReached: decisions.filter((d) => d.evaluations > 0).length,
    decisionsComplete: decisions.filter((d) => d.covered === d.coverable).length,
  };
}

export function combineTotals(parts: readonly CoverageTotals[]): CoverageTotals {
  return parts.reduce(
    (sum, part) => ({
      covered: sum.covered + part.covered,
      coverable: sum.coverable + part.coverable,
      decisions: sum.decisions + part.decisions,
      decisionsReached: sum.decisionsReached + part.decisionsReached,
      decisionsComplete: sum.decisionsComplete + part.decisionsComplete,
    }),
    { covered: 0, coverable: 0, decisions: 0, decisionsReached: 0, decisionsComplete: 0 },
  );
}

/** "68%" style figure, or null when nothing can be covered. */
export function coveragePercent(part: Pick<CoverageTotals, 'covered' | 'coverable'>): number | null {
  return part.coverable === 0 ? null : Math.round((100 * part.covered) / part.coverable);
}
