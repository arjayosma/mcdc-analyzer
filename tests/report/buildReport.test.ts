import { describe, expect, it } from 'vitest';
import { javascriptAdapter } from '../../src/adapters/javascript';
import { analyzeSource } from '../../src/analysis';
import { buildReport, type ReportData } from '../../src/report/buildReport';
import { assembleTestPrompt, buildTestPromptParts, normalizeSource, sourceBlock } from '../../src/report/testPrompt';
import { decisionKey, fileKey, type ReportFile } from '../../src/report/types';

const generatedAt = new Date(2026, 9, 12, 9, 30);

function reportFor(files: readonly { path: string | null; source: string }[], projectName?: string) {
  const reportFiles: ReportFile[] = files.map(({ path, source }) => ({
    path,
    analysis: analyzeSource(source, javascriptAdapter, 'masking'),
  }));
  const cfgSvgs = new Map<string, string>();
  const conditionGraphSvgs = new Map<string, string>();
  reportFiles.forEach((file, index) => {
    const key = fileKey(index);
    for (const fn of file.analysis.program.functions) {
      cfgSvgs.set(`${key}-${fn.id}`, `<svg class="cfg-svg" data-fn="${fn.id}"></svg>`);
    }
    for (const d of file.analysis.program.decisions) {
      conditionGraphSvgs.set(decisionKey(key, d.id), `<svg class="condition-graph" data-decision="${d.id}"></svg>`);
    }
  });
  const html = buildReport({
    files: reportFiles,
    mode: 'masking',
    ...(projectName ? { projectName } : {}),
    generatedAt,
    cfgSvgs,
    conditionGraphSvgs,
    assets: { styles: '/* styles */', script: '/* script */' },
  });
  const json = /<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (json === undefined) throw new Error('report data missing');
  return { files: reportFiles, html, data: JSON.parse(json) as ReportData };
}

const report = (source: string) => reportFor([{ path: null, source }]);

const unescapeHtml = (text: string): string =>
  text
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

/** What the report script reads back as a file's source (see runtime.js sourceOf). */
function pageSource(html: string, key: string): string {
  const pattern = new RegExp(`<div class="src-line" id="${key}-L\\d+"><span class="ln" aria-hidden="true">\\d+</span><code>(.*?)</code></div>`, 'g');
  return [...html.matchAll(pattern)].map((match) => unescapeHtml(match[1] ?? '')).join('\n').trimEnd();
}

const SHIP = `function shouldShip(order) {
  if ((order.paid || order.invoiced) && order.inStock) {
    ship(order);
  } else {
    hold(order);
  }
}`;

describe('buildReport', () => {
  it('renders a standalone document with summary, contents and every decision', () => {
    const { html } = report(SHIP);

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>MC/DC report — shouldShip</title>');
    expect(html).toContain('1 decision</span>');
    expect(html).toContain('3 conditions</span>');
    expect(html).toContain('href="#decision-F0-d0"');
    expect(html).toContain('id="decision-F0-d0"');
    expect(html).toContain('<svg class="cfg-svg" data-fn="f1"></svg>');
    expect(html).toContain('<svg class="condition-graph" data-decision="d0"></svg>');
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(html).toContain('<summary>How to read this report</summary>');
    expect(html).toContain('id="help-vectors"');
    // A single snippet has no per-file headings.
    expect(html).not.toContain('class="file-heading"');
  });

  it('marks exactly the minimal test set rows', () => {
    const { html, files } = report(SHIP);
    const inSet = html.match(/class="tt-row in-set"/g) ?? [];

    expect(inSet).toHaveLength(files[0]?.analysis.decisions.get('d0')?.selection.rows.length ?? -1);
  });

  it('records the traced source lines for each outcome', () => {
    const { data } = report(SHIP);
    const paths = data.decisions['F0-d0']?.paths;

    expect(paths?.true?.lines).toEqual([2, 3]);
    expect(paths?.false?.lines).toEqual([2, 5]);
    expect(data.initial).toEqual({ decision: 'F0-d0', row: data.decisions['F0-d0']?.initialRow });
  });

  it('wraps nested conditions with outermost-first keys and marks where each ends', () => {
    const { html } = report('if (isValid(x && y) || z) go();');

    expect(html).toContain('data-c="F0-d0:0 F0-d1:0" data-ends="F0-d1:0">x</span>');
    expect(html).toContain('data-c="F0-d0:0 F0-d1:1" data-ends="F0-d1:1">y</span>');
    expect(html).toContain('data-c="F0-d0:0" data-ends="F0-d0:0">)</span>');
  });

  it('flags conditions that cannot be shown independently', () => {
    const { html } = report('function f(a, m) { return (a && m) || a; }');

    expect(html).toContain('cannot be shown');
    expect(html).toContain('src-cond is-uncoverable');
  });

  it('escapes source so it cannot break out of the markup or the data script', () => {
    const { html, data } = report('if (tag === "</script><img src=x onerror=alert(1)>" && ok) {}');

    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;');
    expect(data.decisions['F0-d0']?.rows.length).toBe(3);
  });

  it('lists parse diagnostics when the source parsed with recoverable errors', () => {
    const { html } = report('let a = 1;\nlet a = 2;\nif (a && b) {}');

    expect(html).toContain('Parsed with errors');
  });

  it('embeds the AI prompt for copying, and the page source rebuilds it exactly', () => {
    const source = 'function f(a, b) {\r\n  if (a && b) {\r\n\r\n    go();\r\n  }\r\n}\r\n\r\n';
    const { html, data, files } = reportFor([{ path: null, source }]);
    const parts = buildTestPromptParts(files, 'masking');
    const textarea = /<textarea class="prompt-text"[^>]*>([\s\S]*?)<\/textarea>/.exec(html)?.[1] ?? '';

    expect(html).toContain('Generate test cases with AI');
    expect(html).toContain('data-prompt="all" hidden');
    expect(html).toContain('data-prompt="F0-d0" title="Copy an AI prompt');
    expect(unescapeHtml(textarea)).toBe(assembleTestPrompt(parts));
    // The embedded data omits sources; the script reads them from the rendered lines.
    expect(data.prompt.files.F0?.source).toBe('');
    expect(pageSource(html, 'F0')).toBe(normalizeSource(source));
    const fromPage = data.prompt.files.F0 && sourceBlock(data.prompt.files.F0, pageSource(html, 'F0'));
    expect(fromPage).toBe(parts.files.F0 && sourceBlock(parts.files.F0, parts.files.F0.source));
  });
});

describe('buildReport with several files', () => {
  const project = reportFor(
    [
      { path: 'src/ship.ts', source: SHIP },
      { path: 'src/constants.ts', source: 'export const LIMIT = 10;\n' },
      { path: 'src/auth.ts', source: 'export function canEdit(u) {\n  return u.admin || (u.owner && !u.locked);\n}\n' },
    ],
    'shop',
  );

  it('uses the project name and counts every file', () => {
    expect(project.html).toContain('<title>MC/DC report — shop</title>');
    expect(project.html).toContain('3 files</span>');
    expect(project.html).toContain('2 decisions</span>');
  });

  it('shows sections and sources only for files with decisions', () => {
    const { html } = project;

    expect(html).toContain('<section class="file" id="F0" data-file-section="F0">');
    expect(html).toContain('<section class="file" id="F2" data-file-section="F2">');
    expect(html).not.toContain('data-file-section="F1"');
    expect(html).toContain('<div class="source" data-file="F0">');
    expect(html).toContain('<div class="source" data-file="F2" hidden>');
    expect(html).toContain('1 file without decisions');
    expect(html).toContain('<li><code>src/constants.ts</code></li>');
  });

  it('namespaces ids per file and adds per-file prompt buttons', () => {
    const { html, data } = project;

    expect(html).toContain('id="F2-L2"');
    expect(html).toContain('id="decision-F2-d0"');
    expect(html).toContain('data-prompt="F2" title="Copy an AI prompt that writes the required tests for this file"');
    expect(data.decisions['F2-d0']?.file).toBe('F2');
    expect(data.files).toEqual({ F0: { path: 'src/ship.ts' }, F2: { path: 'src/auth.ts' } });
  });

  it('assembles per-file and per-decision prompts with only the sources they need', () => {
    const parts = buildTestPromptParts(project.files, 'masking');
    const forAuth = assembleTestPrompt(parts, ['F2']);
    const forShip = assembleTestPrompt(parts, ['F0-d0']);

    expect(forAuth).toContain('## Source code: `src/auth.ts`');
    expect(forAuth).not.toContain('## Source code: `src/ship.ts`');
    expect(forAuth).toContain('### Decision 2: logical at line 2 in `canEdit` (`src/auth.ts`)');
    expect(forShip).toContain('### Decision 1: if at line 2 in `shouldShip` (`src/ship.ts`)');
    expect(forShip).not.toContain('src/auth.ts');
    expect(assembleTestPrompt(parts)).toContain('9. Put the tests for each source file next to that file');
  });
});
