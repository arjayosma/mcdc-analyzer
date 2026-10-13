/** One evaluation of a decision, as recorded while tests ran. */
export interface Observation {
  /** Project file path, or null for the pasted snippet. */
  readonly path: string | null;
  readonly decisionId: string;
  /** Per condition occurrence: truthiness, or null when short-circuited. */
  readonly values: readonly (boolean | null)[];
  readonly outcome: boolean;
  /** Name of the `test()` that was running, if any. */
  readonly test: string | null;
  /** Identical evaluations recorded together (from coverage files); 1 when absent. */
  readonly count?: number;
}

export interface TestResult {
  readonly name: string;
  readonly ok: boolean;
  readonly error?: string;
}

/** Where a coverage run came from: the in-app Tests panel or a loaded coverage file. */
export type CoverageOrigin =
  | { readonly kind: 'runner' }
  | { readonly kind: 'file'; readonly fileName: string; readonly runner: string; readonly createdAt: string };

/** Everything one press of Run (or one loaded coverage file) produced. */
export interface CoverageRun {
  readonly origin?: CoverageOrigin;
  readonly observations: readonly Observation[];
  readonly tests: readonly TestResult[];
  readonly logs: readonly string[];
  /** Error that stopped the run (syntax error, timeout, uncaught exception). */
  readonly error: string | null;
  readonly durationMs: number;
  /** Source of every instrumented file at run time, to detect stale results. */
  readonly sources: ReadonlyMap<string | null, string>;
}
