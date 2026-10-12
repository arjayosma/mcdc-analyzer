import type { ProgramAnalysis } from '../analysis';
import type { FileCoverage } from '../coverage/coverage';

/** One analyzed file in a report. `path` is null for a pasted snippet. */
export interface ReportFile {
  readonly path: string | null;
  readonly analysis: ProgramAnalysis;
  /** Coverage measured by the last test run, when it ran this exact source. */
  readonly coverage?: FileCoverage;
}

/** Report-wide keys: files are `F0`, `F1`, …; decisions are `F0-d3`. */
export const fileKey = (index: number): string => `F${index}`;
export const decisionKey = (file: string, decisionId: string): string => `${file}-${decisionId}`;
