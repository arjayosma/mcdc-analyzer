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
}

export interface TestResult {
  readonly name: string;
  readonly ok: boolean;
  readonly error?: string;
}

/** Everything one press of Run produced. */
export interface CoverageRun {
  readonly observations: readonly Observation[];
  readonly tests: readonly TestResult[];
  readonly logs: readonly string[];
  /** Error that stopped the run (syntax error, timeout, uncaught exception). */
  readonly error: string | null;
  readonly durationMs: number;
  /** Source of every instrumented file at run time, to detect stale results. */
  readonly sources: ReadonlyMap<string | null, string>;
}
