import { looksMinified, selectFiles, skipDirectoryReason } from './selectFiles';
import type { FileEntry, Project, ProjectFile, SkippedEntry } from './types';

/** A file found in a loaded folder, with a handle to read it later. */
export interface LoadedEntry extends FileEntry {
  readonly file: File;
}

/** Everything found in a folder, before filtering. Kept so options can be re-applied. */
export interface LoadedFolder {
  readonly name: string;
  readonly entries: readonly LoadedEntry[];
  /** Folders skipped while walking (drag-and-drop never descends into them). */
  readonly preSkipped: readonly SkippedEntry[];
}

export interface BuildOptions {
  readonly includeTests: boolean;
}

const READ_CONCURRENCY = 16;

/** From `<input type="file" webkitdirectory>`: paths are relative to the picked folder. */
export function folderFromFileList(files: Iterable<File>): LoadedFolder {
  const list = [...files];
  const first = list[0]?.webkitRelativePath ?? '';
  const name = first.includes('/') ? (first.split('/')[0] ?? 'project') : 'files';
  const entries = list.map((file) => {
    const relative = file.webkitRelativePath || file.name;
    const path = relative.includes('/') ? relative.slice(relative.indexOf('/') + 1) : relative;
    return { path, size: file.size, file };
  });
  return { name, entries, preSkipped: [] };
}

/**
 * From drag-and-drop. `roots` must be collected synchronously in the drop
 * handler (`item.webkitGetAsEntry()`). Dependency and build folders are not
 * walked at all, which keeps large repositories fast to load.
 */
export async function folderFromDropEntries(roots: readonly FileSystemEntry[]): Promise<LoadedFolder> {
  const single = roots.length === 1 && roots[0]?.isDirectory ? roots[0] : null;
  const entries: LoadedEntry[] = [];
  const preSkipped: SkippedEntry[] = [];

  const walk = async (entry: FileSystemEntry, path: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      entries.push({ path, size: file.size, file });
      return;
    }
    if (!entry.isDirectory) return;
    const reason = skipDirectoryReason(entry.name);
    if (reason && path !== '') {
      preSkipped.push({ path: `${path}/`, reason });
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns results in batches until it returns an empty array.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, path ? `${path}/${child.name}` : child.name);
    }
  };

  if (single) await walk(single, '');
  else for (const root of roots) await walk(root, root.name);

  return { name: single?.name ?? 'dropped files', entries, preSkipped };
}

/** Applies the skip rules and .gitignore files, then reads the selected files. */
export async function buildProject(
  folder: LoadedFolder,
  options: BuildOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<Project> {
  const gitignores = await Promise.all(
    folder.entries
      .filter((entry) => entry.path === '.gitignore' || entry.path.endsWith('/.gitignore'))
      .map(async (entry) => ({
        directory: entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '',
        content: await entry.file.text(),
      })),
  );
  const selection = selectFiles(folder.entries, gitignores, options);
  const byPath = new Map(folder.entries.map((entry) => [entry.path, entry]));

  const sources = new Array<string | null>(selection.included.length).fill(null);
  let done = 0;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < selection.included.length) {
      const index = next++;
      const entry = byPath.get(selection.included[index] ?? '');
      sources[index] = entry ? await entry.file.text() : null;
      onProgress?.(++done, selection.included.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, selection.included.length) }, worker));

  const files: ProjectFile[] = [];
  const minified: SkippedEntry[] = [];
  selection.included.forEach((path, index) => {
    const source = sources[index];
    if (source === null || source === undefined) return;
    if (looksMinified(source)) minified.push({ path, reason: 'looks minified or generated' });
    else files.push({ path, source, analysis: null, edited: false });
  });

  return {
    name: folder.name,
    files,
    skipped: [...folder.preSkipped, ...selection.skipped, ...minified],
    otherFiles: selection.otherFiles,
  };
}
