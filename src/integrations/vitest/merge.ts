import { COVERAGE_FORMAT, COVERAGE_VERSION, type CoverageFile, type CoverageFileEvaluation } from '../../coverage/coverageFile';
import type { RawEvaluation } from './recorder';

/** What the plugin learned about each instrumented file while transforming it. */
export interface InstrumentedFile {
  readonly source: string;
  /** Condition count per decision id. */
  readonly decisionSizes: Readonly<Record<string, number>>;
}

export interface MergeOptions {
  readonly project: string;
  readonly toolVersion: string;
  readonly createdAt: string;
}

/**
 * Combines the evaluations from every worker into one coverage file. Every
 * instrumented file is included, even if no test reached its decisions.
 */
export function mergeEvaluations(
  files: ReadonlyMap<string, InstrumentedFile>,
  evaluations: readonly RawEvaluation[],
  options: MergeOptions,
): CoverageFile {
  const merged = new Map<string, Map<string, CoverageFileEvaluation>>();
  for (const evaluation of evaluations) {
    const file = files.get(evaluation.file);
    if (!file) continue;
    const size = file.decisionSizes[evaluation.decision] ?? evaluation.values.length;
    const values = Array.from({ length: size }, (_, i) => evaluation.values[i] ?? null);
    const key = `${evaluation.decision}\u0000${values.map(String).join(',')}\u0000${evaluation.outcome}\u0000${evaluation.test ?? ''}`;
    const byKey = merged.get(evaluation.file) ?? new Map<string, CoverageFileEvaluation>();
    const existing = byKey.get(key);
    byKey.set(
      key,
      existing
        ? { ...existing, count: existing.count + evaluation.count }
        : { decision: evaluation.decision, values, outcome: evaluation.outcome, test: evaluation.test, count: evaluation.count },
    );
    merged.set(evaluation.file, byKey);
  }

  const paths = [...files.keys()].sort((a, b) => a.localeCompare(b));
  return {
    format: COVERAGE_FORMAT,
    version: COVERAGE_VERSION,
    tool: { name: 'mcdc-analyzer', version: options.toolVersion },
    runner: 'vitest',
    createdAt: options.createdAt,
    project: options.project,
    files: Object.fromEntries(
      paths.map((path) => [
        path,
        {
          source: files.get(path)?.source ?? '',
          evaluations: [...(merged.get(path)?.values() ?? [])].sort(
            (a, b) =>
              a.decision.localeCompare(b.decision, 'en', { numeric: true }) ||
              (a.test ?? '').localeCompare(b.test ?? '') ||
              a.values.join().localeCompare(b.values.join()),
          ),
        },
      ]),
    ),
  };
}
