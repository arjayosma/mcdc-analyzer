import type { ConditionCoverage, DecisionCoverage } from '../coverage/coverage';
import type { DecisionAnalysis, IndependencePair, McdcMode } from '../engine';
import type { DecisionModel } from '../model/types';

/** User-facing wording shared by the app and the exported report. */
export const KIND_LABELS: Record<DecisionModel['kind'], string> = {
  if: 'if',
  while: 'while',
  'do-while': 'do…while',
  for: 'for',
  ternary: 'ternary',
  logical: 'logical',
};

export const MODE_LABELS: Record<McdcMode, string> = {
  masking: 'masking',
  'unique-cause': 'unique-cause',
};

export const conditionLabel = (index: number): string => `C${index + 1}`;

/** Test numbers are 1-based for people; row ids stay 0-based internally. */
export const testNumber = (rowId: number): string => `#${rowId + 1}`;

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function modeHelp(mode: McdcMode): string {
  return mode === 'masking'
    ? 'Masking MC/DC: other conditions may change between the two tests, as long as they cannot affect the outcome.'
    : 'Unique-cause MC/DC: only the condition under test may change (short-circuited conditions are "don\'t care").';
}

export function pairText(pair: IndependencePair | null | undefined, optionCount: number): string {
  if (!pair) return 'cannot be shown';
  const alternatives = optionCount - 1;
  return `${testNumber(pair.falseRow)} ↔ ${testNumber(pair.trueRow)}${alternatives > 0 ? ` (+${alternatives} alt)` : ''}`;
}

export interface SummaryChip {
  readonly text: string;
  readonly tone: 'plain' | 'strong' | 'warning' | 'covered';
  readonly title?: string;
}

export function decisionChips(result: DecisionAnalysis): SummaryChip[] {
  const chips: SummaryChip[] = [
    { text: plural(result.conditionCount, 'condition'), tone: 'plain' },
    { text: plural(result.rows.length, 'feasible test'), tone: 'plain' },
    { text: `MC/DC needs ${result.selection.rows.length}`, tone: 'strong' },
    { text: MODE_LABELS[result.mode], tone: 'plain', title: modeHelp(result.mode) },
  ];
  if (result.coupled) {
    chips.push({
      text: 'coupled conditions',
      tone: 'warning',
      title: 'The same condition appears more than once; its occurrences always change together.',
    });
  }
  if (result.truncated) {
    chips.push({
      text: 'truncated',
      tone: 'warning',
      title: 'The truth table hit the row limit; pairs and the minimal set may be incomplete.',
    });
  }
  if (!result.selection.optimal) {
    chips.push({
      text: 'set may not be minimal',
      tone: 'warning',
      title: 'The search budget ran out; the set is valid but may not be the smallest.',
    });
  }
  return chips;
}

/** Measured-coverage chip for a decision after a test run. */
export function coverageChip(measured: DecisionCoverage): SummaryChip {
  if (measured.evaluations === 0) {
    return { text: 'not reached', tone: 'warning', title: 'The tests never evaluated this decision' };
  }
  const complete = measured.covered === measured.coverable;
  return {
    text: `${complete ? '✓ ' : ''}covered ${measured.covered}/${measured.coverable}`,
    tone: complete ? 'covered' : 'warning',
    title: 'Conditions shown independent by the tests (measured)',
  };
}

/** Condition status after a test run: the observed pair, or the pair still needed. */
export function measuredPairText(measured: ConditionCoverage): string {
  if (measured.uncoverable) return 'cannot be shown';
  if (measured.observedPair) return `✓ ${testNumber(measured.observedPair.falseRow)} ↔ ${testNumber(measured.observedPair.trueRow)}`;
  const needed = measured.neededPair;
  return needed ? `needs ${testNumber(needed.falseRow)} ↔ ${testNumber(needed.trueRow)}` : 'not covered';
}

