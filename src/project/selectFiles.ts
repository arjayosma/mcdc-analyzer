import { IgnoreMatcher } from './ignore';
import type { FileEntry, SkippedEntry } from './types';

export const SOURCE_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'] as const;

/** Folders never worth analyzing, with the reason shown to the user. */
export const SKIP_DIRECTORIES: ReadonlyMap<string, string> = new Map([
  ['node_modules', 'dependencies'],
  ['bower_components', 'dependencies'],
  ['vendor', 'vendored code'],
  ['.git', 'version control'],
  ['.hg', 'version control'],
  ['.svn', 'version control'],
  ['dist', 'build output'],
  ['build', 'build output'],
  ['out', 'build output'],
  ['storybook-static', 'build output'],
  ['.next', 'framework build output'],
  ['.nuxt', 'framework build output'],
  ['.svelte-kit', 'framework build output'],
  ['.output', 'framework build output'],
  ['coverage', 'coverage output'],
  ['.nyc_output', 'coverage output'],
  ['.cache', 'cache'],
  ['.turbo', 'cache'],
  ['.parcel-cache', 'cache'],
  ['.yarn', 'package manager files'],
  ['.pnpm-store', 'package manager files'],
]);

export const MAX_FILE_BYTES = 500_000;
export const MAX_FILES = 2_000;

const TEST_FILE = /(^|\/)(__tests__|__mocks__)\/|\.(test|spec)\.[cm]?[jt]sx?$/;

export interface SelectOptions {
  readonly includeTests: boolean;
  readonly maxFiles?: number;
  readonly maxFileBytes?: number;
}

export interface Selection {
  /** Files to read and analyze, sorted by path. */
  readonly included: readonly string[];
  readonly skipped: readonly SkippedEntry[];
  /** Non-JavaScript/TypeScript files: counted, not listed. */
  readonly otherFiles: number;
}

export function isSourceFile(path: string): boolean {
  if (/\.d\.[cm]?ts$/.test(path)) return false;
  return SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension));
}

export function isTestFile(path: string): boolean {
  return TEST_FILE.test(path);
}

/** Built-in skip reason for a folder name, if any. */
export function skipDirectoryReason(name: string): string | undefined {
  return SKIP_DIRECTORIES.get(name);
}

/**
 * Decides which files of a loaded folder to analyze. Skipped folders are
 * reported once (e.g. `node_modules/`) rather than file by file.
 */
export function selectFiles(
  entries: readonly FileEntry[],
  gitignores: readonly { readonly directory: string; readonly content: string }[],
  options: SelectOptions,
): Selection {
  const maxFiles = options.maxFiles ?? MAX_FILES;
  const maxFileBytes = options.maxFileBytes ?? MAX_FILE_BYTES;
  const ignore = new IgnoreMatcher();
  for (const { directory, content } of gitignores) ignore.add(directory, content);

  const skippedFolders = new Map<string, string>();
  const skipped: SkippedEntry[] = [];
  const candidates: string[] = [];
  let otherFiles = 0;

  for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
    const folder = skippedFolder(entry.path, ignore);
    if (folder) {
      if (!skippedFolders.has(folder.path)) skippedFolders.set(folder.path, folder.reason);
      continue;
    }
    if (ignore.ignores(entry.path)) {
      if (isSourceFile(entry.path)) skipped.push({ path: entry.path, reason: '.gitignore' });
      continue;
    }
    if (!isSourceFile(entry.path)) {
      otherFiles++;
      continue;
    }
    if (/\.min\.[cm]?js$/.test(entry.path)) {
      skipped.push({ path: entry.path, reason: 'minified' });
    } else if (!options.includeTests && isTestFile(entry.path)) {
      skipped.push({ path: entry.path, reason: 'test file' });
    } else if (entry.size > maxFileBytes) {
      skipped.push({ path: entry.path, reason: `larger than ${Math.round(maxFileBytes / 1000)} kB` });
    } else {
      candidates.push(entry.path);
    }
  }

  for (const path of candidates.slice(maxFiles)) {
    skipped.push({ path, reason: `file limit (${maxFiles.toLocaleString('en')}) reached` });
  }

  return {
    included: candidates.slice(0, maxFiles),
    skipped: [
      ...[...skippedFolders].map(([path, reason]) => ({ path: `${path}/`, reason })),
      ...skipped,
    ],
    otherFiles,
  };
}

/** The outermost folder above `path` that is skipped, with its reason. */
function skippedFolder(path: string, ignore: IgnoreMatcher): { path: string; reason: string } | null {
  const segments = path.split('/');
  for (let i = 1; i < segments.length; i++) {
    const name = segments[i - 1] ?? '';
    const folder = segments.slice(0, i).join('/');
    const builtIn = skipDirectoryReason(name);
    if (builtIn) return { path: folder, reason: builtIn };
    if (ignore.ignoresDirectory(folder)) return { path: folder, reason: '.gitignore' };
  }
  return null;
}

/** Heuristic for generated or minified code that slipped past the name checks. */
export function looksMinified(source: string): boolean {
  const lines = source.split('\n');
  if (lines.length === 0) return false;
  const longest = Math.max(...lines.map((line) => line.length));
  return longest > 2_000 && source.length / lines.length > 300;
}
