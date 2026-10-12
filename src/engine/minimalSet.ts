import type { IndependencePair } from './independencePairs';

export interface TestSelection {
  /** Selected row ids, ascending. */
  readonly rows: readonly number[];
  /** Per condition occurrence: the pair that demonstrates it, or null if uncoverable. */
  readonly pairs: readonly (IndependencePair | null)[];
  /** False when the exact search ran out of budget and returned its best so far. */
  readonly optimal: boolean;
}

/**
 * Picks one independence pair per coverable condition so that the union of
 * rows is as small as possible. Starts from a greedy solution, then runs a
 * bounded branch-and-bound search to improve or prove it.
 */
export function selectMinimalSet(
  pairsByCondition: readonly (readonly IndependencePair[])[],
  searchBudget = 100_000,
): TestSelection {
  // Fewest options first keeps the search tree narrow.
  const targets = pairsByCondition
    .map((pairs, condition) => ({ condition, pairs }))
    .filter((target) => target.pairs.length > 0)
    .sort((a, b) => a.pairs.length - b.pairs.length || a.condition - b.condition);

  const emptyChoice = (): (IndependencePair | null)[] => pairsByCondition.map(() => null);

  let best = greedy(targets, emptyChoice());
  let steps = 0;
  let exhausted = false;

  const search = (depth: number, selected: Set<number>, chosen: (IndependencePair | null)[]): void => {
    if (exhausted) return;
    if (++steps > searchBudget) {
      exhausted = true;
      return;
    }
    if (selected.size >= best.rows.size) return;

    const target = targets[depth];
    if (!target) {
      best = { rows: new Set(selected), chosen: [...chosen] };
      return;
    }

    // A pair already inside the selection costs nothing, so it dominates.
    const free = target.pairs.find((pair) => selected.has(pair.falseRow) && selected.has(pair.trueRow));
    if (free) {
      chosen[target.condition] = free;
      search(depth + 1, selected, chosen);
      chosen[target.condition] = null;
      return;
    }
    if (selected.size + 1 >= best.rows.size) return;

    for (const pair of byAddedCost(target.pairs, selected)) {
      const added = [pair.falseRow, pair.trueRow].filter((row) => !selected.has(row));
      added.forEach((row) => selected.add(row));
      chosen[target.condition] = pair;
      search(depth + 1, selected, chosen);
      chosen[target.condition] = null;
      added.forEach((row) => selected.delete(row));
    }
  };

  search(0, new Set(), emptyChoice());

  return {
    rows: [...best.rows].sort((a, b) => a - b),
    pairs: best.chosen,
    optimal: !exhausted,
  };
}

interface Target {
  readonly condition: number;
  readonly pairs: readonly IndependencePair[];
}

interface Solution {
  rows: Set<number>;
  chosen: (IndependencePair | null)[];
}

function greedy(targets: readonly Target[], chosen: (IndependencePair | null)[]): Solution {
  const rows = new Set<number>();
  for (const target of targets) {
    const [pair] = byAddedCost(target.pairs, rows);
    if (!pair) continue;
    rows.add(pair.falseRow).add(pair.trueRow);
    chosen[target.condition] = pair;
  }
  return { rows, chosen };
}

function byAddedCost(pairs: readonly IndependencePair[], selected: ReadonlySet<number>): IndependencePair[] {
  const cost = (pair: IndependencePair): number =>
    Number(!selected.has(pair.falseRow)) + Number(!selected.has(pair.trueRow));
  return [...pairs].sort((a, b) => cost(a) - cost(b));
}
