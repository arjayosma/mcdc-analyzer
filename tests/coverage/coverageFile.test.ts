import { describe, expect, it } from 'vitest';
import { COVERAGE_FORMAT, COVERAGE_VERSION, coverageFileToRun, parseCoverageFile } from '../../src/coverage/coverageFile';

const valid = {
  format: COVERAGE_FORMAT,
  version: COVERAGE_VERSION,
  tool: { name: 'mcdc-analyzer', version: '0.2.0' },
  runner: 'vitest',
  createdAt: '2026-10-13T00:00:00.000Z',
  project: 'shop',
  files: {
    'src/b.ts': { source: 'if (x) {}', evaluations: [] },
    'src/a.ts': {
      source: 'if (a && b) {}',
      evaluations: [{ decision: 'd0', values: [true, false], outcome: false, test: 'a > b', count: 3 }],
    },
  },
};

describe('parseCoverageFile', () => {
  it('accepts a coverage file written by the plugin', () => {
    expect(parseCoverageFile(JSON.stringify(valid)).project).toBe('shop');
  });

  it.each([
    ['not JSON', 'oops', 'This is not a JSON file.'],
    ['another JSON file', JSON.stringify({ name: 'package' }), 'This is not an MC/DC coverage file'],
    ['a newer version', JSON.stringify({ ...valid, version: 99 }), 'Unsupported coverage file version 99'],
    ['a missing files section', JSON.stringify({ ...valid, files: undefined }), 'has no "files" section'],
    ['an incomplete file entry', JSON.stringify({ ...valid, files: { 'x.ts': { source: 1 } } }), 'The entry for x.ts is incomplete.'],
    [
      'a malformed evaluation',
      JSON.stringify({ ...valid, files: { 'x.ts': { source: '', evaluations: [{ decision: 'd0', values: ['yes'] }] } } }),
      'An evaluation recorded for x.ts is malformed.',
    ],
  ])('explains %s', (_, text, message) => {
    expect(() => parseCoverageFile(text)).toThrow(message);
  });
});

describe('coverageFileToRun', () => {
  it('turns the file into project sources and a coverage run, sorted by path', () => {
    const { projectName, sources, run } = coverageFileToRun(parseCoverageFile(JSON.stringify(valid)), 'mcdc-coverage.json');

    expect(projectName).toBe('shop');
    expect(sources.map((s) => s.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(run.origin).toEqual({ kind: 'file', fileName: 'mcdc-coverage.json', runner: 'vitest', createdAt: '2026-10-13T00:00:00.000Z' });
    expect(run.observations).toEqual([{ path: 'src/a.ts', decisionId: 'd0', values: [true, false], outcome: false, test: 'a > b', count: 3 }]);
    expect(run.sources.get('src/b.ts')).toBe('if (x) {}');
  });
});
