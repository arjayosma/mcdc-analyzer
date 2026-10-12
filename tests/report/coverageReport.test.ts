import { describe, expect, it } from 'vitest';
import { javascriptAdapter } from '../../src/adapters/javascript';
import { analyzeSource } from '../../src/analysis';
import { fileCoverage } from '../../src/coverage/coverage';
import type { Observation } from '../../src/coverage/types';
import { buildReport } from '../../src/report/buildReport';
import { assembleTestPrompt, buildTestPromptParts } from '../../src/report/testPrompt';
import type { ReportFile } from '../../src/report/types';

// (a && b) || c — rows: #1 F-F→F, #2 F-T→T, #3 TFF→F, #4 TFT→T, #5 TT-→T (1-based)
const SOURCE = 'export function f(a, b, c, d) {\n  if ((a && b) || c) return 1;\n  return d && !a ? 2 : 0;\n}';
const analysis = analyzeSource(SOURCE, javascriptAdapter, 'masking');
const seen = (decisionId: string, values: (boolean | null)[], outcome: boolean, test: string): Observation => ({
  path: null,
  decisionId,
  values,
  outcome,
  test,
});
// Rows #1 and #5 of d0 were run: C1 (a) covered, C2 and C3 not. d1 never reached.
const coverage = fileCoverage(analysis, [seen('d0', [false, null, false], false, 'none'), seen('d0', [true, true, null], true, 'all')]);
const files: ReportFile[] = [{ path: null, analysis, coverage }];

function report(): string {
  return buildReport({
    files,
    mode: 'masking',
    generatedAt: new Date(2026, 9, 12),
    cfgSvgs: new Map(),
    conditionGraphSvgs: new Map(),
    assets: { styles: '', script: '' },
  });
}

describe('report with measured coverage', () => {
  it('adds coverage chips, a Hits column and needed rows', () => {
    const html = report();

    expect(html).toContain('covered 1/5 (20%)');
    expect(html).toContain('covered 1/3</span>');
    expect(html).toContain('not reached</span>');
    expect(html).toContain('<th title="How many times the measured tests ran this vector">Hits</th>');
    expect(html).toContain('<td class="hits is-hit" title="Evaluated 1×&#10;Tests: none">1×</td>');
    expect(html).toContain('<td class="hits is-missing" title="Needed to complete MC/DC for this decision">needed</td>');
    expect(html).toContain('✓ #1 ↔ #5');
    expect(html).toContain('needs #3 ↔ #5');
  });

  it('asks the AI only for the missing tests', () => {
    const prompt = assembleTestPrompt(buildTestPromptParts(files, 'masking'));

    expect(prompt).toContain('rows marked "covered" already have a test. Write a test for every row marked **missing**');
    expect(prompt).toContain('Covered by my existing tests: 1/3 conditions. Still needed: 2 more tests.');
    expect(prompt).toContain('| #3 | T | F | F | false | C2 | **missing** |');
    expect(prompt).toContain('| #1 | F | – | F | false | C1, C3 | covered (1×) |');
    expect(prompt).toContain('- C1: covered by tests #1 (F) and #5 (T)');
    expect(prompt).toContain('Not reached by my existing tests.');
  });

  it('says when a decision needs nothing more', () => {
    const rows = analysis.decisions.get('d0')?.rows ?? [];
    const full = fileCoverage(analysis, rows.map((row) => seen('d0', [...row.values], row.outcome, 'all')));
    const prompt = assembleTestPrompt(buildTestPromptParts([{ path: null, analysis, coverage: full }], 'masking'));

    expect(prompt).toContain('Already fully covered by my existing tests (3/3 conditions). Nothing to write for this decision.');
  });
});
