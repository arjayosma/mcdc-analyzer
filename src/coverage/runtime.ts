import type { Observation, TestResult } from './types';

/**
 * Executes instrumented code plus the user's test code and records every
 * decision evaluation. Has no DOM dependency: it runs inside the runner's
 * Web Worker in the app, and directly under Node in unit tests.
 */

/** Recorder file id for the pasted snippet (project files use their path). */
export const SNIPPET_FILE = '<snippet>';

export interface RunnerModule {
  /** Project-relative path, or null for the snippet. */
  readonly path: string | null;
  /** Instrumented source, still TypeScript/JSX/ESM (the runner transforms it). */
  readonly code: string;
  /** Condition count per decision id, so short-circuited slots can be marked. */
  readonly decisionSizes: Readonly<Record<string, number>>;
}

export interface RunRequest {
  readonly modules: readonly RunnerModule[];
  /** The module the test code runs alongside (its top-level names are in scope). */
  readonly entry: string | null;
  readonly testCode: string;
}

export interface RunOutcome {
  readonly observations: readonly Observation[];
  readonly tests: readonly TestResult[];
  readonly logs: readonly string[];
  readonly error: string | null;
}

/** Turns TypeScript/JSX/ESM into CommonJS JavaScript (Sucrase in the app). */
export type Transform = (code: string, path: string) => string;

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
const MAX_LOGS = 500;

/** Resolves a relative import between project files; null when it cannot. */
export function resolveImport(from: string | null, specifier: string, available: ReadonlySet<string>): string | null {
  if (from === null || !(specifier.startsWith('./') || specifier.startsWith('../'))) return null;
  const base = normalize(`${from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : ''}/${specifier}`);
  if (base === null) return null;
  // TypeScript ESM code imports './util.js' for './util.ts'.
  const withoutJsExtension = base.replace(/\.(m|c)?jsx?$/, '');
  const candidates = [
    base,
    ...RESOLVE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...RESOLVE_EXTENSIONS.map((extension) => `${withoutJsExtension}${extension}`),
    ...RESOLVE_EXTENSIONS.map((extension) => `${base}/index${extension}`),
  ];
  return candidates.find((candidate) => available.has(candidate)) ?? null;
}

function normalize(path: string): string | null {
  const parts: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.join('/');
}

/** Minimal React stand-in so JSX evaluates to plain objects instead of failing. */
const REACT_SHIM = Object.freeze({
  createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => ({
    type,
    props: { ...props, children },
  }),
  Fragment: 'Fragment',
});

export async function executeTests(request: RunRequest, transform: Transform): Promise<RunOutcome> {
  const observations: Observation[] = [];
  const tests: TestResult[] = [];
  const logs: string[] = [];
  const queued: { name: string; fn: () => unknown }[] = [];
  let currentTest: string | null = null;

  const sizes = new Map<string, number>();
  for (const module of request.modules) {
    for (const [id, size] of Object.entries(module.decisionSizes)) sizes.set(`${fileId(module.path)}|${id}`, size);
  }

  // One stack per decision, so recursion inside a condition records separately.
  const stacks = new Map<string, (boolean | null)[][]>();
  const recorder = {
    b(file: string, id: string): void {
      const key = `${file}|${id}`;
      const stack = stacks.get(key) ?? [];
      stack.push(new Array<boolean | null>(sizes.get(key) ?? 0).fill(null));
      stacks.set(key, stack);
    },
    c<T>(file: string, id: string, index: number, value: T): T {
      const top = stacks.get(`${file}|${id}`)?.at(-1);
      if (top) top[index] = Boolean(value);
      return value;
    },
    e<T>(file: string, id: string, value: T): T {
      const values = stacks.get(`${file}|${id}`)?.pop();
      if (values) {
        observations.push({
          path: file === SNIPPET_FILE ? null : file,
          decisionId: id,
          values,
          outcome: Boolean(value),
          test: currentTest,
        });
      }
      return value;
    },
  };

  const log = (level: string) => (...args: unknown[]) => {
    if (logs.length < MAX_LOGS) logs.push(`${level === 'log' ? '' : `[${level}] `}${args.map(formatValue).join(' ')}`);
  };
  const consoleShim = { log: log('log'), info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') };
  const test = (name: string, fn: () => unknown): void => {
    queued.push({ name: String(name), fn });
  };

  const byPath = new Map(request.modules.map((module) => [module.path, module]));
  const available = new Set(request.modules.flatMap((module) => (module.path === null ? [] : [module.path])));
  const cache = new Map<string | null, { exports: unknown }>();
  const PARAMS = ['exports', 'require', 'module', '__mcdc', 'console', 'React', 'test'] as const;

  const requireFrom = (from: string | null) => (specifier: string): unknown => {
    if (specifier === 'react' || specifier.startsWith('react/')) return { ...REACT_SHIM, default: REACT_SHIM };
    const target = resolveImport(from, specifier, available);
    if (target === null) {
      throw new Error(
        specifier.startsWith('.')
          ? `Cannot find "${specifier}" from ${from ?? 'the snippet'}${from === null ? ' (a snippet has no other files)' : ''}`
          : `Package "${specifier}" is not available in the browser runner; only project files can be imported`,
      );
    }
    return load(target);
  };

  const load = (path: string | null): unknown => {
    const cached = cache.get(path);
    if (cached) return cached.exports;
    const source = byPath.get(path);
    if (!source) throw new Error(`Unknown module ${path ?? SNIPPET_FILE}`);
    const module = { exports: {} as unknown };
    cache.set(path, module);
    const code = transform(source.code, path ?? 'snippet.tsx');
    new Function(...PARAMS, code)(module.exports, requireFrom(path), module, recorder, consoleShim, REACT_SHIM, test);
    return module.exports;
  };

  try {
    // The test code shares the entry module's scope so its functions can be called directly.
    const entry = byPath.get(request.entry);
    if (!entry) throw new Error('Nothing to run: the file is not part of the analysis');
    const entryCode = transform(entry.code, request.entry ?? 'snippet.tsx');
    const testCode = transform(request.testCode, `${request.entry ?? 'snippet'}.mcdc-test.tsx`);
    const module = { exports: {} as unknown };
    cache.set(request.entry, module);
    const body = `return (async () => {\n${entryCode}\n;\n${testCode}\n})();`;
    await new Function(...PARAMS, body)(module.exports, requireFrom(request.entry), module, recorder, consoleShim, REACT_SHIM, test);

    for (const { name, fn } of queued) {
      currentTest = name;
      try {
        await fn();
        tests.push({ name, ok: true });
      } catch (error) {
        tests.push({ name, ok: false, error: errorMessage(error) });
      }
    }
    currentTest = null;
    return { observations, tests, logs, error: null };
  } catch (error) {
    return { observations, tests, logs, error: errorMessage(error) };
  }
}

function fileId(path: string | null): string {
  return path ?? SNIPPET_FILE;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name === 'Error' ? '' : `${error.name}: `}${error.message}`;
  return `Thrown: ${formatValue(error)}`;
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
