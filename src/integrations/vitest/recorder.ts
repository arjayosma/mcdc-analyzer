/**
 * Runs inside Vitest workers. Instrumented modules call `__mcdc.b/c/e` (see
 * src/coverage/instrument.ts); identical evaluations are counted instead of
 * stored one by one, so hot loops do not grow memory.
 */
export interface RawEvaluation {
  readonly file: string;
  readonly decision: string;
  /** Possibly shorter than the decision's condition count; padded when merging. */
  readonly values: readonly (boolean | null)[];
  readonly outcome: boolean;
  readonly test: string | null;
  readonly count: number;
}

export interface Recorder {
  b(file: string, id: string): void;
  c<T>(file: string, id: string, index: number, value: T): T;
  e<T>(file: string, id: string, value: T): T;
  /** Name of the test now running, recorded with each evaluation. */
  setTest(name: string | null): void;
  /** Returns what was recorded since the last drain and starts afresh. */
  drain(): RawEvaluation[];
}

export function createRecorder(): Recorder {
  const stacks = new Map<string, (boolean | null)[][]>();
  let counts = new Map<string, RawEvaluation>();
  let currentTest: string | null = null;

  return {
    b(file, id) {
      const key = `${file}\u0000${id}`;
      const stack = stacks.get(key) ?? [];
      stack.push([]);
      stacks.set(key, stack);
    },
    c(file, id, index, value) {
      const top = stacks.get(`${file}\u0000${id}`)?.at(-1);
      if (top) top[index] = Boolean(value);
      return value;
    },
    e(file, id, value) {
      const values = stacks.get(`${file}\u0000${id}`)?.pop();
      if (values) {
        // Holes are conditions that were never evaluated.
        const dense = Array.from(values, (v) => (v === undefined ? null : v));
        const outcome = Boolean(value);
        const key = `${file}\u0000${id}\u0000${dense.map((v) => (v === null ? '-' : v ? 'T' : 'F')).join('')}\u0000${outcome}\u0000${currentTest ?? ''}`;
        const existing = counts.get(key);
        counts.set(key, existing ? { ...existing, count: existing.count + 1 } : { file, decision: id, values: dense, outcome, test: currentTest, count: 1 });
      }
      return value;
    },
    setTest(name) {
      currentTest = name;
    },
    drain() {
      const drained = [...counts.values()];
      counts = new Map();
      return drained;
    },
  };
}
