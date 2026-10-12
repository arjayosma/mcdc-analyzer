import { describe, expect, it } from 'vitest';
import { javascriptAdapter } from '../../src/adapters/javascript';
import { analyzeSource } from '../../src/analysis';
import { summarizeProject } from '../../src/project/summary';
import type { Project, ProjectFile } from '../../src/project/types';

const file = (path: string, source: string, analyzed = true): ProjectFile => ({
  path,
  source,
  analysis: analyzed ? analyzeSource(source, javascriptAdapter, 'masking') : null,
  edited: false,
});

describe('summarizeProject', () => {
  const project: Project = {
    name: 'demo',
    files: [
      file('src/a.ts', 'function a(x, y) {\n  if (x && y) return 1;\n  return 0;\n}'),
      file('src/b.ts', 'function b(p, q, r) {\n  return (p || q) && r;\n}\nfunction c(m) { return (m && m.ok) || m; }'),
      file('src/broken.ts', 'if (a && {'),
      file('src/pending.ts', 'if (x) {}', false),
    ],
    skipped: [],
    otherFiles: 0,
  };

  it('adds up analyzed files and counts errors', () => {
    const summary = summarizeProject(project);

    expect(summary).toMatchObject({
      files: 4,
      analyzedFiles: 3,
      filesWithDecisions: 2,
      decisions: 3,
      conditions: 2 + 3 + 3,
      filesWithErrors: 1,
    });
    expect(summary.fileStats.find((s) => s.path === 'src/broken.ts')?.failed).toBe(true);
    expect(summary.fileStats.find((s) => s.path === 'src/pending.ts')?.analyzed).toBe(false);
  });

  it('ranks hotspots by required tests, then conditions that cannot be shown', () => {
    const summary = summarizeProject(project);

    expect(summary.hotspots.map((h) => [h.path, h.line, h.tests, h.uncoverable])).toEqual([
      ['src/b.ts', 2, 4, 0],
      // Same number of tests: the one with a condition that cannot be shown comes first.
      ['src/b.ts', 4, 3, 1],
      ['src/a.ts', 2, 3, 0],
    ]);
  });
});
