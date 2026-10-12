import type { TestRow } from './truthTable';

/**
 * - `masking`: other conditions may differ between the two rows as long as the
 *   condition under test determines the outcome in both (DO-178C masking MC/DC).
 * - `unique-cause`: every other condition must hold the same value in both rows,
 *   except where short-circuiting makes it "don't care" in either row.
 */
export type McdcMode = 'masking' | 'unique-cause';

export interface IndependencePair {
  readonly condition: number;
  /** Row where the condition is false. */
  readonly falseRow: number;
  /** Row where the condition is true. */
  readonly trueRow: number;
}

/** All independence pairs, grouped by condition occurrence index. */
export function findIndependencePairs(
  rows: readonly TestRow[],
  conditionCount: number,
  mode: McdcMode,
): IndependencePair[][] {
  const pairs: IndependencePair[][] = Array.from({ length: conditionCount }, () => []);

  for (let condition = 0; condition < conditionCount; condition++) {
    const falseRows = rows.filter((row) => row.values[condition] === false);
    const trueRows = rows.filter((row) => row.values[condition] === true);
    for (const falseRow of falseRows) {
      for (const trueRow of trueRows) {
        if (falseRow.outcome === trueRow.outcome) continue;
        const valid =
          mode === 'masking'
            ? falseRow.determining[condition] === true && trueRow.determining[condition] === true
            : othersUnchanged(falseRow, trueRow, condition);
        if (valid) pairs[condition]?.push({ condition, falseRow: falseRow.id, trueRow: trueRow.id });
      }
    }
  }

  return pairs;
}

function othersUnchanged(a: TestRow, b: TestRow, condition: number): boolean {
  return a.values.every((value, index) => {
    if (index === condition) return true;
    const other = b.values[index];
    return value === null || other === null || value === other;
  });
}
