import type { CoverageRun, Observation } from './types';

/**
 * `mcdc-coverage.json`: what a test-runner integration records. It embeds each
 * file's source, so the app can rebuild the project from this one file and
 * the recorded decision ids always line up with the analysis.
 */
export const COVERAGE_FORMAT = 'mcdc-analyzer/coverage';
export const COVERAGE_VERSION = 1;

export interface CoverageFileEvaluation {
  readonly decision: string;
  /** Per condition occurrence: truthiness, or null when short-circuited. */
  readonly values: readonly (boolean | null)[];
  readonly outcome: boolean;
  readonly test: string | null;
  /** How many times this exact evaluation happened. */
  readonly count: number;
}

export interface CoverageFile {
  readonly format: typeof COVERAGE_FORMAT;
  readonly version: typeof COVERAGE_VERSION;
  readonly tool: { readonly name: string; readonly version: string };
  readonly runner: string;
  readonly createdAt: string;
  /** Project (root folder) name. */
  readonly project: string;
  /** Keyed by path relative to the project root, with `/` separators. */
  readonly files: Readonly<Record<string, { readonly source: string; readonly evaluations: readonly CoverageFileEvaluation[] }>>;
}

export class CoverageFileError extends Error {
  override readonly name = 'CoverageFileError';
}

/** Parses and validates a coverage file, with messages a user can act on. */
export function parseCoverageFile(text: string): CoverageFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new CoverageFileError('This is not a JSON file.');
  }
  if (!isRecord(data) || data.format !== COVERAGE_FORMAT) {
    throw new CoverageFileError('This is not an MC/DC coverage file (expected one written by mcdc-analyzer, e.g. mcdc-coverage.json).');
  }
  if (data.version !== COVERAGE_VERSION) {
    throw new CoverageFileError(`Unsupported coverage file version ${String(data.version)}; this app reads version ${COVERAGE_VERSION}.`);
  }
  if (!isRecord(data.files)) throw new CoverageFileError('The coverage file has no "files" section.');
  for (const [path, file] of Object.entries(data.files)) {
    if (!isRecord(file) || typeof file.source !== 'string' || !Array.isArray(file.evaluations)) {
      throw new CoverageFileError(`The entry for ${path} is incomplete.`);
    }
    for (const evaluation of file.evaluations) {
      if (
        !isRecord(evaluation) ||
        typeof evaluation.decision !== 'string' ||
        !Array.isArray(evaluation.values) ||
        !evaluation.values.every((v) => v === null || typeof v === 'boolean') ||
        typeof evaluation.outcome !== 'boolean' ||
        !(evaluation.test === null || typeof evaluation.test === 'string') ||
        typeof evaluation.count !== 'number'
      ) {
        throw new CoverageFileError(`An evaluation recorded for ${path} is malformed.`);
      }
    }
  }
  return data as unknown as CoverageFile;
}

/** The files to open as a project, and the coverage run measured against them. */
export function coverageFileToRun(file: CoverageFile, fileName: string): {
  readonly projectName: string;
  readonly sources: readonly { readonly path: string; readonly source: string }[];
  readonly run: CoverageRun;
} {
  const paths = Object.keys(file.files).sort((a, b) => a.localeCompare(b));
  const observations: Observation[] = paths.flatMap((path) =>
    (file.files[path]?.evaluations ?? []).map((evaluation) => ({
      path,
      decisionId: evaluation.decision,
      values: evaluation.values,
      outcome: evaluation.outcome,
      test: evaluation.test,
      count: evaluation.count,
    })),
  );
  return {
    projectName: file.project || fileName.replace(/\.json$/i, ''),
    sources: paths.map((path) => ({ path, source: file.files[path]?.source ?? '' })),
    run: {
      origin: { kind: 'file', fileName, runner: file.runner, createdAt: file.createdAt },
      observations,
      tests: [],
      logs: [],
      error: null,
      durationMs: 0,
      sources: new Map(paths.map((path) => [path, file.files[path]?.source ?? ''])),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
