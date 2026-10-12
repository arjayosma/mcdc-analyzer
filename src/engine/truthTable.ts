import {
  determiningLeaves,
  evaluate,
  parentMap,
  type ConditionLeaf,
  type ConditionNode,
  type GroupAssignment,
} from './conditionTree';

/** One row of the short-circuit truth table — a distinct feasible test case. */
export interface TestRow {
  readonly id: number;
  /** Per occurrence: true/false, or null for "don't care" (short-circuited). */
  readonly values: readonly (boolean | null)[];
  readonly outcome: boolean;
  /** Occurrence indices in evaluation order — the path through the decision. */
  readonly order: readonly number[];
  /** Per occurrence: whether it alone determines the outcome (masking sense). */
  readonly determining: readonly boolean[];
}

export interface TruthTable {
  readonly rows: readonly TestRow[];
  /** True when enumeration stopped at `maxRows`; later analysis is partial. */
  readonly truncated: boolean;
}

/**
 * Enumerates the short-circuit truth table by exploring each branch of the
 * decision instead of all 2^n assignments: only conditions that are actually
 * evaluated get a value, so `a && b && c` yields 4 rows rather than 8.
 * Coupled occurrences reuse their group's value once it has been assigned.
 */
export function buildTruthTable(
  root: ConditionNode,
  leaves: readonly ConditionLeaf[],
  maxRows: number,
): TruthTable {
  const parents = parentMap(root);
  const rows: TestRow[] = [];
  let truncated = false;

  for (const [, assignment] of explore(root, new Map())) {
    if (rows.length === maxRows) {
      truncated = true;
      break;
    }
    const evaluation = evaluate(root, assignment, leaves.length);
    rows.push({
      id: rows.length,
      values: evaluation.values,
      outcome: evaluation.outcome,
      order: evaluation.order,
      determining: determiningLeaves(leaves, parents, evaluation),
    });
  }

  return { rows, truncated };
}

function* explore(
  node: ConditionNode,
  assignment: GroupAssignment,
): Generator<[boolean, GroupAssignment]> {
  switch (node.kind) {
    case 'condition': {
      const existing = assignment.get(node.group);
      if (existing !== undefined) {
        yield [existing, assignment];
        return;
      }
      for (const value of [false, true]) {
        yield [value, new Map(assignment).set(node.group, value)];
      }
      return;
    }
    case 'not':
      for (const [value, next] of explore(node.operand, assignment)) yield [!value, next];
      return;
    case 'and':
      for (const [value, next] of explore(node.left, assignment)) {
        if (value) yield* explore(node.right, next);
        else yield [false, next];
      }
      return;
    case 'or':
      for (const [value, next] of explore(node.left, assignment)) {
        if (value) yield [true, next];
        else yield* explore(node.right, next);
      }
      return;
  }
}
