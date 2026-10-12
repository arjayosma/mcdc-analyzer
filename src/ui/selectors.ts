import { decisionHost, decisionPath, examplePath, type CfgPath } from '../cfg/paths';
import type { ProgramAnalysis } from '../analysis';
import { combineTotals, fileCoverage, type CoverageTotals, type DecisionCoverage, type FileCoverage } from '../coverage/coverage';
import type { CoverageRun } from '../coverage/types';
import type { DecisionAnalysis, TestRow } from '../engine';
import type { CfgNode, DecisionModel, FunctionModel } from '../model/types';
import type { AppState } from './store';

export interface Selection {
  readonly fn: FunctionModel | null;
  readonly decision: DecisionModel | null;
  readonly result: DecisionAnalysis | null;
  readonly row: TestRow | null;
  /** CFG node that hosts the selected decision (a decision node or the block containing it). */
  readonly decisionNode: CfgNode | null;
  readonly path: CfgPath | null;
}

export function select(state: AppState): Selection {
  const program = state.analysis?.program;
  const fn = program?.functions.find((f) => f.id === state.functionId) ?? program?.functions[0] ?? null;
  const decision = program?.decisions.find((d) => d.id === state.decisionId) ?? null;
  const result = (decision && state.analysis?.decisions.get(decision.id)) ?? null;
  const row = result?.rows.find((r) => r.id === state.rowId) ?? null;
  const decisionNode = (fn && decision && decisionHost(fn.cfg, decision.id)) ?? null;

  let path: CfgPath | null = null;
  if (fn && decision) {
    path = decisionPath(fn.cfg, decision.id, row?.outcome);
  } else if (fn && state.focusNodeId) {
    path = examplePath(fn.cfg, state.focusNodeId);
  }

  return { fn, decision, result, row, decisionNode, path };
}

/** Key for a file's test code and coverage: its project path, or `snippet`. */
export const testKey = (path: string | null): string => path ?? 'snippet';

export interface CoverageView {
  /** Coverage of the file in the editor, or null when there is none to show. */
  readonly file: FileCoverage | null;
  /** True when the code changed since the run, so the results no longer line up. */
  readonly stale: boolean;
}

const coverageCache = new WeakMap<CoverageRun, WeakMap<ProgramAnalysis, FileCoverage>>();

/** Coverage of `analysis` (the file at `path`) from a run, if the run saw this exact source. */
export function coverageFor(run: CoverageRun | null, path: string | null, analysis: ProgramAnalysis | null): CoverageView {
  if (!run || !analysis || !run.sources.has(path)) return { file: null, stale: false };
  if (run.sources.get(path) !== analysis.program.source) return { file: null, stale: true };
  let byAnalysis = coverageCache.get(run);
  if (!byAnalysis) {
    byAnalysis = new WeakMap();
    coverageCache.set(run, byAnalysis);
  }
  let coverage = byAnalysis.get(analysis);
  if (!coverage) {
    coverage = fileCoverage(analysis, run.observations.filter((o) => o.path === path));
    byAnalysis.set(analysis, coverage);
  }
  return { file: coverage, stale: false };
}

export function currentCoverage(state: AppState): CoverageView {
  return coverageFor(state.coverage, state.project ? state.activePath : null, state.analysis);
}

export function selectedDecisionCoverage(state: AppState): DecisionCoverage | null {
  const view = currentCoverage(state);
  return (state.decisionId && view.file?.byDecision.get(state.decisionId)) || null;
}

/** Measured coverage across every project file the last run saw unchanged. */
export function projectCoverage(state: AppState): { totals: CoverageTotals; byPath: ReadonlyMap<string, FileCoverage> } | null {
  if (!state.project || !state.coverage) return null;
  const byPath = new Map<string, FileCoverage>();
  for (const file of state.project.files) {
    const view = coverageFor(state.coverage, file.path, file.analysis);
    if (view.file && view.file.decisionsReached > 0) byPath.set(file.path, view.file);
  }
  return byPath.size ? { totals: combineTotals([...byPath.values()]), byPath } : null;
}
