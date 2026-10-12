import type { ProgramAnalysis } from '../analysis';

/** A file found when loading a folder, before its contents are read. */
export interface FileEntry {
  /** Path relative to the project root, with `/` separators. */
  readonly path: string;
  readonly size: number;
}

export interface SkippedEntry {
  /** A file path, or a folder path ending in `/`. */
  readonly path: string;
  readonly reason: string;
}

export interface ProjectFile {
  readonly path: string;
  readonly source: string;
  /** Null until the file has been analyzed (or after its source or the mode changed). */
  readonly analysis: ProgramAnalysis | null;
  /** True when edited in the app; edits stay in memory only. */
  readonly edited: boolean;
}

export interface Project {
  readonly name: string;
  readonly files: readonly ProjectFile[];
  readonly skipped: readonly SkippedEntry[];
  /** Files that are not JavaScript/TypeScript, counted but not listed. */
  readonly otherFiles: number;
}
