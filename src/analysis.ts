import { analyzeDecision, type DecisionAnalysis, type McdcMode } from './engine';
import type { LanguageAdapter, ProgramModel } from './model/types';

export interface ProgramAnalysis {
  readonly program: ProgramModel;
  readonly mode: McdcMode;
  /** Keyed by decision id. */
  readonly decisions: ReadonlyMap<string, DecisionAnalysis>;
  readonly summary: CoverageSummary;
}

export interface CoverageSummary {
  readonly functions: number;
  readonly decisions: number;
  readonly conditions: number;
  readonly uncoverable: number;
  /** Total tests across all decisions' minimal sets. */
  readonly tests: number;
}

/** Parses source with the adapter and runs the MC/DC engine on every decision. */
export function analyzeSource(source: string, adapter: LanguageAdapter, mode: McdcMode): ProgramAnalysis {
  const program = adapter.parse(source);
  const decisions = new Map(program.decisions.map((decision) => [decision.id, analyzeDecision(decision.tree, { mode })]));
  const all = [...decisions.values()];

  return {
    program,
    mode,
    decisions,
    summary: {
      functions: program.functions.length,
      decisions: all.length,
      conditions: all.reduce((sum, analysis) => sum + analysis.conditionCount, 0),
      uncoverable: all.reduce((sum, analysis) => sum + analysis.uncoverable.length, 0),
      tests: all.reduce((sum, analysis) => sum + analysis.selection.rows.length, 0),
    },
  };
}
