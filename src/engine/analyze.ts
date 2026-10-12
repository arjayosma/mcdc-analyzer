import { buildConditionGraph, type ConditionGraph } from './conditionGraph';
import { validateTree, type ConditionNode } from './conditionTree';
import { findIndependencePairs, type IndependencePair, type McdcMode } from './independencePairs';
import { selectMinimalSet, type TestSelection } from './minimalSet';
import { buildTruthTable, type TestRow } from './truthTable';

export interface AnalyzeOptions {
  readonly mode?: McdcMode;
  /** Upper bound on truth-table rows before the analysis is marked truncated. */
  readonly maxRows?: number;
  /** Branch-and-bound step budget for the minimal test set search. */
  readonly searchBudget?: number;
}

export interface DecisionAnalysis {
  readonly mode: McdcMode;
  readonly conditionCount: number;
  /** True when any condition occurs more than once (shares a group). */
  readonly coupled: boolean;
  readonly rows: readonly TestRow[];
  readonly truncated: boolean;
  readonly pairs: readonly (readonly IndependencePair[])[];
  /** Occurrence indices with no independence pair in this mode. */
  readonly uncoverable: readonly number[];
  readonly selection: TestSelection;
  readonly graph: ConditionGraph;
}

export const DEFAULT_MAX_ROWS = 1024;

export function analyzeDecision(root: ConditionNode, options: AnalyzeOptions = {}): DecisionAnalysis {
  const mode = options.mode ?? 'masking';
  const leaves = validateTree(root);
  const { rows, truncated } = buildTruthTable(root, leaves, options.maxRows ?? DEFAULT_MAX_ROWS);
  const pairs = findIndependencePairs(rows, leaves.length, mode);

  return {
    mode,
    conditionCount: leaves.length,
    coupled: new Set(leaves.map((leaf) => leaf.group)).size < leaves.length,
    rows,
    truncated,
    pairs,
    uncoverable: pairs.flatMap((conditionPairs, index) => (conditionPairs.length === 0 ? [index] : [])),
    selection: selectMinimalSet(pairs, options.searchBudget),
    graph: buildConditionGraph(root, leaves.length),
  };
}
