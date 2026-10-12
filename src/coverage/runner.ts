import type { ProgramAnalysis } from '../analysis';
import { instrumentSource } from './instrument';
import { SNIPPET_FILE, type RunOutcome, type RunRequest } from './runtime';
import type { CoverageRun } from './types';

export interface RunnableFile {
  readonly path: string | null;
  readonly analysis: ProgramAnalysis;
}

export interface RunOptions {
  readonly files: readonly RunnableFile[];
  /** File whose top-level names the test code can use. */
  readonly entry: string | null;
  readonly testCode: string;
  readonly timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 5_000;

/** Instruments the files, runs the tests in a Web Worker and collects coverage. */
export async function runTests(options: RunOptions): Promise<CoverageRun> {
  const started = performance.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const request: RunRequest = {
    modules: options.files.map((file) => ({
      path: file.path,
      code: instrumentSource(file.analysis.program, file.path ?? SNIPPET_FILE),
      decisionSizes: Object.fromEntries(file.analysis.program.decisions.map((d) => [d.id, d.conditions.length])),
    })),
    entry: options.entry,
    testCode: options.testCode,
  };
  const sources = new Map(options.files.map((file) => [file.path, file.analysis.program.source]));

  const worker = new Worker(new URL('./runner.worker.ts', import.meta.url), { type: 'module' });
  const outcome = await new Promise<RunOutcome>((resolve) => {
    const timer = setTimeout(() => {
      resolve({
        observations: [],
        tests: [],
        logs: [],
        error: `Stopped after ${timeoutMs / 1000} s. Check for an infinite loop or a promise that never settles.`,
      });
    }, timeoutMs);
    worker.onmessage = (event: MessageEvent<RunOutcome>) => {
      clearTimeout(timer);
      resolve(event.data);
    };
    worker.onerror = (event) => {
      clearTimeout(timer);
      event.preventDefault();
      resolve({ observations: [], tests: [], logs: [], error: event.message || 'The test runner failed to start' });
    };
    worker.postMessage(request);
  });
  worker.terminate();

  return { ...outcome, durationMs: Math.round(performance.now() - started), sources };
}
