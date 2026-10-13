import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { javascriptAdapter } from '../../src/adapters/javascript';
import { analyzeSource } from '../../src/analysis';
import { fileCoverage } from '../../src/coverage/coverage';
import { coverageFileToRun, parseCoverageFile, type CoverageFile } from '../../src/coverage/coverageFile';

const sample = fileURLToPath(new URL('./vitest-sample/', import.meta.url));
const output = `${sample}mcdc-coverage.json`;
const vitestBin = fileURLToPath(new URL('../../node_modules/vitest/vitest.mjs', import.meta.url));

/**
 * Runs real Vitest on a sample project that uses the built plugin from
 * dist-lib/ (run `npm run test:e2e`, which builds it first), then reads the
 * result back through the app's own loading and coverage code.
 */
describe('mcdc-analyzer/vitest end to end', () => {
  let coverage: CoverageFile;
  let log: string;

  beforeAll(() => {
    rmSync(output, { force: true });
    // Run from the sample folder, like a developer running `npx vitest run` in their project.
    const raw = execFileSync(process.execPath, [vitestBin, 'run'], {
      cwd: sample,
      encoding: 'utf8',
      env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    // CI terminals may still colour the output; compare plain text.
    log = stripVTControlCharacters(raw);
    coverage = parseCoverageFile(readFileSync(output, 'utf8'));
  });

  it('writes a coverage file for the instrumented source files only', () => {
    expect(existsSync(output)).toBe(true);
    expect(log).toContain('[mcdc-analyzer] MC/DC coverage for 2 files (2 reached) written to mcdc-coverage.json');
    expect(Object.keys(coverage.files)).toEqual(['src/pricing.ts', 'src/rules.ts']);
    // The sample's own tests (including the stack-trace check) all passed with the plugin on.
    expect(log).toMatch(/Tests\s+5 passed \(5\)/);
    expect(coverage.runner).toBe('vitest');
    expect(coverage.project).toBe('vitest-sample');
  });

  it('records full test names and counts repeated evaluations', () => {
    const pricing = coverage.files['src/pricing.ts']?.evaluations ?? [];

    expect(pricing).toContainEqual({ decision: 'd0', values: [true, true], outcome: true, test: 'discount > gives members over 18 a discount on big orders', count: 1 });
    // The loop condition ran 4 times in one test: 2 free items matched C1 or C2.
    const loop = pricing.filter((e) => e.decision === 'd1');
    expect(loop.reduce((sum, e) => sum + e.count, 0)).toBe(4);
    expect(loop.every((e) => e.test === 'counts free items')).toBe(true);
  });

  it('measures coverage in the app from the loaded file', () => {
    const { sources, run } = coverageFileToRun(coverage, 'mcdc-coverage.json');
    const rules = sources.find((s) => s.path === 'src/rules.ts');
    const analysis = analyzeSource(rules?.source ?? '', javascriptAdapter, 'masking');
    const measured = fileCoverage(analysis, run.observations.filter((o) => o.path === 'src/rules.ts'));

    // age >= 18 && (member || age >= 65) && !banned: only C1 (age) is shown independent by these tests.
    expect(measured).toMatchObject({ coverable: 4, covered: 1, decisionsReached: 1 });
  });
});
