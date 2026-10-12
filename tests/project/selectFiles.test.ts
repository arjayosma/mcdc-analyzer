import { describe, expect, it } from 'vitest';
import { isSourceFile, looksMinified, selectFiles } from '../../src/project/selectFiles';

const entries = (paths: string[], size = 100) => paths.map((path) => ({ path, size }));

describe('selectFiles', () => {
  const files = entries([
    'src/index.ts',
    'src/app.tsx',
    'src/types.d.ts',
    'src/util.test.ts',
    'src/__tests__/app.ts',
    'src/vendor.min.js',
    'src/styles.css',
    'README.md',
    'node_modules/react/index.js',
    'node_modules/react/cjs/react.js',
    'dist/index.js',
    'packages/web/build/out.js',
    'generated/api.ts',
    'scripts/build.mjs',
  ]);

  it('keeps JS/TS sources and reports why the rest were skipped', () => {
    const result = selectFiles(files, [{ directory: '', content: 'generated/\n' }], { includeTests: false });

    expect(result.included).toEqual(['scripts/build.mjs', 'src/app.tsx', 'src/index.ts']);
    expect(result.skipped).toEqual([
      { path: 'dist/', reason: 'build output' },
      { path: 'generated/', reason: '.gitignore' },
      { path: 'node_modules/', reason: 'dependencies' },
      { path: 'packages/web/build/', reason: 'build output' },
      { path: 'src/__tests__/app.ts', reason: 'test file' },
      { path: 'src/util.test.ts', reason: 'test file' },
      { path: 'src/vendor.min.js', reason: 'minified' },
    ]);
    expect(result.otherFiles).toBe(3);
  });

  it('includes test files when asked', () => {
    const result = selectFiles(files, [], { includeTests: true });

    expect(result.included).toContain('src/util.test.ts');
    expect(result.included).toContain('src/__tests__/app.ts');
  });

  it('skips oversized files and enforces the file limit', () => {
    const result = selectFiles(
      [...entries(['a.ts', 'b.ts', 'c.ts']), { path: 'huge.ts', size: 2_000_000 }],
      [],
      { includeTests: false, maxFiles: 2 },
    );

    expect(result.included).toEqual(['a.ts', 'b.ts']);
    expect(result.skipped).toEqual([
      { path: 'huge.ts', reason: 'larger than 500 kB' },
      { path: 'c.ts', reason: 'file limit (2) reached' },
    ]);
  });

  it('lists gitignored source files individually', () => {
    const result = selectFiles(entries(['src/a.ts', 'src/secret.ts']), [{ directory: 'src', content: 'secret.ts' }], {
      includeTests: false,
    });

    expect(result.included).toEqual(['src/a.ts']);
    expect(result.skipped).toEqual([{ path: 'src/secret.ts', reason: '.gitignore' }]);
  });
});

describe('file type helpers', () => {
  it('recognises source files but not declaration files', () => {
    expect(['a.js', 'a.jsx', 'a.mjs', 'a.cjs', 'a.ts', 'a.tsx', 'a.mts', 'a.cts'].every(isSourceFile)).toBe(true);
    expect(isSourceFile('a.d.ts')).toBe(false);
    expect(isSourceFile('a.d.mts')).toBe(false);
    expect(isSourceFile('a.json')).toBe(false);
  });

  it('detects minified code by its very long lines', () => {
    expect(looksMinified(`var a=1;${'x'.repeat(5000)}`)).toBe(true);
    expect(looksMinified('const a = 1;\nconst b = 2;\n')).toBe(false);
  });
});
