import type { DecisionModel } from '../model/types';
import type { Project, ProjectFile } from './types';

export interface FileStats {
  readonly path: string;
  readonly analyzed: boolean;
  readonly functions: number;
  readonly decisions: number;
  readonly conditions: number;
  readonly tests: number;
  readonly uncoverable: number;
  readonly errors: number;
  /** True when the file could not be parsed at all. */
  readonly failed: boolean;
}

export interface DecisionHotspot {
  readonly path: string;
  readonly decision: DecisionModel;
  readonly line: number;
  readonly tests: number;
  readonly uncoverable: number;
}

export interface ProjectSummary {
  readonly files: number;
  readonly analyzedFiles: number;
  readonly filesWithDecisions: number;
  readonly decisions: number;
  readonly conditions: number;
  readonly tests: number;
  readonly uncoverable: number;
  readonly filesWithErrors: number;
  readonly fileStats: readonly FileStats[];
  /** Decisions needing the most tests, then those with conditions that cannot be shown. */
  readonly hotspots: readonly DecisionHotspot[];
}

export function fileStats(file: ProjectFile): FileStats {
  const analysis = file.analysis;
  if (!analysis) {
    return {
      path: file.path,
      analyzed: false,
      functions: 0,
      decisions: 0,
      conditions: 0,
      tests: 0,
      uncoverable: 0,
      errors: 0,
      failed: false,
    };
  }
  const { summary, program } = analysis;
  return {
    path: file.path,
    analyzed: true,
    functions: summary.functions,
    decisions: summary.decisions,
    conditions: summary.conditions,
    tests: summary.tests,
    uncoverable: summary.uncoverable,
    errors: program.diagnostics.length,
    failed: program.diagnostics.length > 0 && program.functions.length === 0,
  };
}

export function summarizeProject(project: Project, hotspotLimit = 10): ProjectSummary {
  const stats = project.files.map(fileStats);
  const hotspots: DecisionHotspot[] = [];
  for (const file of project.files) {
    const analysis = file.analysis;
    if (!analysis) continue;
    const lineOf = lineFinder(analysis.program.source);
    for (const decision of analysis.program.decisions) {
      const result = analysis.decisions.get(decision.id);
      if (!result) continue;
      hotspots.push({
        path: file.path,
        decision,
        line: lineOf(decision.range.start),
        tests: result.selection.rows.length,
        uncoverable: result.uncoverable.length,
      });
    }
  }
  hotspots.sort((a, b) => b.tests - a.tests || b.uncoverable - a.uncoverable || a.path.localeCompare(b.path) || a.line - b.line);

  const sum = (pick: (s: FileStats) => number): number => stats.reduce((total, s) => total + pick(s), 0);
  return {
    files: stats.length,
    analyzedFiles: stats.filter((s) => s.analyzed).length,
    filesWithDecisions: stats.filter((s) => s.decisions > 0).length,
    decisions: sum((s) => s.decisions),
    conditions: sum((s) => s.conditions),
    tests: sum((s) => s.tests),
    uncoverable: sum((s) => s.uncoverable),
    filesWithErrors: stats.filter((s) => s.errors > 0).length,
    fileStats: stats,
    hotspots: hotspots.slice(0, hotspotLimit),
  };
}

const summaries = new WeakMap<Project, ProjectSummary>();

/** `summarizeProject`, computed once per project object (projects are never mutated). */
export function projectSummary(project: Project): ProjectSummary {
  let summary = summaries.get(project);
  if (!summary) {
    summary = summarizeProject(project);
    summaries.set(project, summary);
  }
  return summary;
}

function lineFinder(source: string): (offset: number) => number {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((starts[mid] ?? 0) <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
}
