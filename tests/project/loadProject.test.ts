import { describe, expect, it } from 'vitest';
import { buildProject, folderFromFileList } from '../../src/project/loadProject';

/** Minimal stand-in for a File from a folder picker (webkitRelativePath is read-only on real Files). */
function pickedFile(relativePath: string, content: string): File {
  return {
    name: relativePath.split('/').pop() ?? relativePath,
    webkitRelativePath: relativePath,
    size: content.length,
    text: async () => content,
  } as unknown as File;
}

describe('loading a picked folder', () => {
  const picked = [
    pickedFile('shop/.gitignore', 'secret/\n'),
    pickedFile('shop/src/b.ts', 'export const b = (x, y) => x && y;'),
    pickedFile('shop/src/a.ts', 'export function a(p) { if (p) return 1; }'),
    pickedFile('shop/src/a.spec.ts', 'it("works", () => {});'),
    pickedFile('shop/secret/key.ts', 'export const key = 1;'),
    pickedFile('shop/node_modules/x/index.js', 'module.exports = 1;'),
    pickedFile('shop/src/bundle.ts', `var a=1;${'x'.repeat(5000)}`),
    pickedFile('shop/README.md', '# shop'),
  ];

  it('strips the picked folder name from paths and uses it as the project name', () => {
    const folder = folderFromFileList(picked);

    expect(folder.name).toBe('shop');
    expect(folder.entries.map((e) => e.path)).toContain('src/a.ts');
    expect(folder.entries.map((e) => e.path)).toContain('.gitignore');
  });

  it('reads only the selected files and reports everything it skipped', async () => {
    const progress: number[] = [];
    const project = await buildProject(folderFromFileList(picked), { includeTests: false }, (done) => progress.push(done));

    expect(project.name).toBe('shop');
    expect(project.files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(project.files.every((f) => f.analysis === null && !f.edited)).toBe(true);
    expect(project.skipped).toEqual([
      { path: 'node_modules/', reason: 'dependencies' },
      { path: 'secret/', reason: '.gitignore' },
      { path: 'src/a.spec.ts', reason: 'test file' },
      { path: 'src/bundle.ts', reason: 'looks minified or generated' },
    ]);
    expect(project.otherFiles).toBe(2);
    expect(progress.at(-1)).toBe(3);
  });

  it('includes test files when asked', async () => {
    const project = await buildProject(folderFromFileList(picked), { includeTests: true });

    expect(project.files.map((f) => f.path)).toContain('src/a.spec.ts');
  });
});
