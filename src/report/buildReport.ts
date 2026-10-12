import type { ProgramAnalysis } from '../analysis';
import { decisionHost, decisionPath } from '../cfg/paths';
import type { DecisionAnalysis, McdcMode } from '../engine';
import type { DecisionModel, FunctionModel } from '../model/types';
import { helpSectionsFor, renderHelpHtml } from '../ui/helpContent';
import { combineTotals, coveragePercent, type FileCoverage } from '../coverage/coverage';
import {
  KIND_LABELS,
  MODE_LABELS,
  conditionLabel,
  coverageChip,
  decisionChips,
  measuredPairText,
  pairText,
  plural,
  testNumber,
} from '../ui/labels';
import { assembleTestPrompt, buildTestPromptParts, type TestPromptParts } from './testPrompt';
import { decisionKey, fileKey, type ReportFile } from './types';

export interface ReportAssets {
  /** CSS inlined into the report. */
  readonly styles: string;
  /** Plain JS inlined into the report for row selection and path tracing. */
  readonly script: string;
}

export interface ReportInput {
  /** Files in display order; a pasted snippet is a single file with a null path. */
  readonly files: readonly ReportFile[];
  readonly mode: McdcMode;
  /** Project (folder) name, if any. */
  readonly projectName?: string;
  readonly generatedAt: Date;
  /** Pre-rendered CFG SVG markup keyed by `${fileKey}-${functionId}`. */
  readonly cfgSvgs: ReadonlyMap<string, string>;
  /** Pre-rendered condition graph SVG markup keyed by decision key (`F0-d3`). */
  readonly conditionGraphSvgs: ReadonlyMap<string, string>;
  readonly assets: ReportAssets;
}

/** Path data the report script uses to trace a test (see report/runtime.js). */
export interface ReportPath {
  readonly nodes: readonly string[];
  readonly edges: readonly number[];
  readonly lines: readonly number[];
}

export interface ReportData {
  /** AI prompt pieces without file sources; the script reads sources from the page. */
  readonly prompt: TestPromptParts;
  readonly initial: { readonly decision: string; readonly row: number } | null;
  readonly files: Readonly<Record<string, { readonly path: string | null }>>;
  readonly decisions: Readonly<
    Record<
      string,
      {
        readonly file: string;
        readonly fn: string;
        readonly host: string | null;
        readonly initialRow: number;
        readonly conditionCount: number;
        readonly rows: readonly {
          readonly values: readonly (boolean | null)[];
          readonly order: readonly number[];
          readonly outcome: boolean;
        }[];
        readonly paths: { readonly true: ReportPath | null; readonly false: ReportPath | null };
      }
    >
  >;
}

/** Prompts longer than this are not embedded as a no-JavaScript fallback. */
export const MAX_EMBEDDED_PROMPT = 300_000;

interface FileContext {
  readonly key: string;
  readonly path: string | null;
  readonly analysis: ProgramAnalysis;
  readonly lines: LineIndex;
  readonly coverage: FileCoverage | undefined;
}

/**
 * Builds a self-contained HTML report: source on the left, and for every
 * function its control-flow graph plus each decision's condition flow,
 * independence pairs and test vectors. Works without JavaScript; the inline
 * script adds click-to-trace (red path, bold source) like the app.
 *
 * With several files, only files that contain decisions get a section (a
 * single snippet is always shown), and the source pane switches per file.
 */
export function buildReport(input: ReportInput): string {
  const { generatedAt, cfgSvgs, conditionGraphSvgs, assets, mode } = input;
  const all: FileContext[] = input.files.map((file, index) => ({
    key: fileKey(index),
    path: file.path,
    analysis: file.analysis,
    lines: new LineIndex(file.analysis.program.source),
    coverage: file.coverage,
  }));
  const multiFile = all.length > 1;
  const shown = multiFile ? all.filter((file) => file.analysis.program.decisions.length > 0) : all;
  const prompt = buildTestPromptParts(input.files, mode);
  const data = buildData(shown, prompt);
  const title = reportTitle(input);

  const totals = all.reduce(
    (sum, { analysis: { summary } }) => ({
      functions: sum.functions + summary.functions,
      decisions: sum.decisions + summary.decisions,
      conditions: sum.conditions + summary.conditions,
      tests: sum.tests + summary.tests,
      uncoverable: sum.uncoverable + summary.uncoverable,
    }),
    { functions: 0, decisions: 0, conditions: 0, tests: 0, uncoverable: 0 },
  );
  const summaryChips = [
    multiFile ? chip(plural(all.length, 'file')) : '',
    chip(plural(totals.functions, 'function')),
    chip(plural(totals.decisions, 'decision')),
    chip(plural(totals.conditions, 'condition')),
    chip(plural(totals.tests, 'MC/DC test'), 'strong'),
    totals.uncoverable > 0 ? chip(`${totals.uncoverable} not shown`, 'warning') : '',
    measuredChip(all),
  ].join('');

  const withErrors = all.filter((file) => file.analysis.program.diagnostics.length > 0);
  const diagnostics =
    withErrors.length > 0
      ? `<div class="report-diagnostics" role="note"><strong>Parsed with errors:</strong><ul>${withErrors
          .flatMap((file) =>
            file.analysis.program.diagnostics.map(
              (d) => `<li>${file.path === null ? '' : `<code>${escapeHtml(file.path)}</code>: `}${escapeHtml(d.message)}</li>`,
            ),
          )
          .join('')}</ul></div>`
      : '';

  const withoutDecisions = multiFile ? all.filter((file) => file.analysis.program.decisions.length === 0) : [];
  const languages = [...new Set(all.map((file) => file.analysis.program.language))].join(', ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="MC/DC Analyzer">
<title>${escapeHtml(title)}</title>
<style>
${assets.styles}
</style>
</head>
<body>
<header class="report-header">
  <div>
    <h1>${escapeHtml(title)}</h1>
    <p class="meta">Generated ${escapeHtml(formatDate(generatedAt))} · ${escapeHtml(MODE_LABELS[mode])} MC/DC · ${escapeHtml(languages)}</p>
  </div>
  <div class="summary-chips">${summaryChips}</div>
</header>
${diagnostics}
<p class="report-hint">Click a test row to trace it: the source it runs through is <strong>bolded with a red marker</strong> and its path is drawn in red in the graphs. ★ marks the minimal MC/DC test set; – means the condition is not evaluated (short-circuited).${
    all.some((file) => file.coverage) ? ' <strong>Hits</strong> shows how often the measured tests ran each vector; rows marked <em>needed</em> are still missing.' : ''
  }</p>
<details class="report-help">
  <summary>How to read this report</summary>
  <div class="help-body">${renderHelpHtml(helpSectionsFor('report'), 3)}</div>
</details>
${renderPromptSection(prompt, totals.tests, multiFile)}
<div class="report-layout">
  <aside class="source-pane" aria-label="Source code">
    <h2>Source${multiFile ? ` <span class="source-path">${escapeHtml(shown[0]?.path ?? '')}</span>` : ''}</h2>
    ${shown.map((file, i) => `<div class="source" data-file="${file.key}"${i > 0 ? ' hidden' : ''}>${renderSource(file)}</div>`).join('\n')}
  </aside>
  <main>
    ${renderToc(shown, multiFile)}
    ${shown.map((file) => renderFile(file, multiFile, cfgSvgs, conditionGraphSvgs)).join('\n')}
    ${renderFilesWithoutDecisions(withoutDecisions)}
  </main>
</div>
<footer class="report-footer">Generated by MC/DC Analyzer · static analysis — tests are required vectors, not measured coverage.</footer>
<script type="application/json" id="report-data">${jsonForScript(data)}</script>
<script>
${assets.script}
</script>
</body>
</html>
`;
}

function reportTitle(input: ReportInput): string {
  if (input.projectName) return `MC/DC report — ${input.projectName}`;
  const functions = input.files.flatMap((file) => file.analysis.program.functions);
  const named = functions.filter((fn) => fn.name !== '(top level)' && !fn.name.startsWith('anonymous'));
  if (named.length === 0) return 'MC/DC report';
  const shown = named.slice(0, 3).map((fn) => fn.name).join(', ');
  return `MC/DC report — ${shown}${named.length > 3 ? ` +${named.length - 3}` : ''}`;
}

/**
 * "Generate test cases with AI": the full prompt in a read-only textarea (so it
 * can be copied without JavaScript, when not too large) plus copy buttons the
 * script enables.
 */
function renderPromptSection(prompt: TestPromptParts, totalTests: number, multiFile: boolean): string {
  const hasDecisions = Object.values(prompt.files).some((file) => Object.keys(file.decisions).length > 0);
  if (!hasDecisions) return '';
  const full = assembleTestPrompt(prompt);
  const preview =
    full.length <= MAX_EMBEDDED_PROMPT
      ? `<details class="prompt-preview">
    <summary>Show prompt (${full.length.toLocaleString('en')} characters)</summary>
    <textarea class="prompt-text" readonly rows="18" aria-label="AI test generation prompt" spellcheck="false">${escapeHtml(full)}</textarea>
  </details>`
      : `<p class="muted">The full prompt is ${full.length.toLocaleString('en')} characters, too long to embed here. Use the per-file or per-decision buttons for smaller prompts.</p>`;
  return `<section class="report-prompt" aria-labelledby="prompt-title">
  <div class="prompt-intro">
    <div>
      <h2 id="prompt-title">Generate test cases with AI</h2>
      <p>Paste this prompt into an AI coding assistant (for example Claude) to turn the ${plural(totalTests, 'required test')} below into runnable unit tests for your framework. ${
        multiFile ? 'Each file and each decision also has its own copy button.' : 'Each decision also has its own <strong>Copy test prompt</strong> button.'
      }</p>
      <p class="muted">The prompt includes your source code. Only paste it into tools approved for this code.</p>
    </div>
    <button type="button" class="copy-prompt" data-prompt="all" hidden>Copy prompt</button>
  </div>
  ${preview}
</section>`;
}

function renderToc(files: readonly FileContext[], multiFile: boolean): string {
  const functionItems = (file: FileContext): string =>
    file.analysis.program.functions
      .map((fn) => {
        const decisions = file.analysis.program.decisions.filter((d) => d.functionId === fn.id);
        if (multiFile && decisions.length === 0) return '';
        const children = decisions
          .map((decision) => {
            const result = file.analysis.decisions.get(decision.id);
            const warn = result && result.uncoverable.length > 0 ? ` <span class="chip is-warning">${result.uncoverable.length} not shown</span>` : '';
            return `<li><a href="#decision-${decisionKey(file.key, decision.id)}"><span class="kind-badge">${escapeHtml(KIND_LABELS[decision.kind])}</span> <code>${escapeHtml(truncate(decision.text, 70))}</code></a>${warn}</li>`;
          })
          .join('');
        return `<li><a href="#${file.key}-${fn.id}"><code>${escapeHtml(fn.name)}</code></a> <span class="muted">${plural(decisions.length, 'decision')}</span>${children ? `<ul>${children}</ul>` : ''}</li>`;
      })
      .join('');

  const items = multiFile
    ? files.map((file) => {
        const { summary } = file.analysis;
        return `<li class="toc-file"><a href="#${file.key}"><code>${escapeHtml(file.path ?? '')}</code></a> <span class="muted">${plural(summary.decisions, 'decision')} · ${plural(summary.tests, 'test')}</span><ul>${functionItems(file)}</ul></li>`;
      })
    : files.map(functionItems);
  return `<nav class="toc" aria-label="Contents"><h2>Contents</h2><ul>${items.join('')}</ul></nav>`;
}

function renderFile(
  file: FileContext,
  multiFile: boolean,
  cfgSvgs: ReadonlyMap<string, string>,
  conditionGraphSvgs: ReadonlyMap<string, string>,
): string {
  const { program, summary } = file.analysis;
  const functions = program.functions.filter(
    (fn) => !multiFile || program.decisions.some((d) => d.functionId === fn.id),
  );
  const heading = multiFile
    ? `<header class="file-heading">
    <h2><code>${escapeHtml(file.path ?? '')}</code></h2>
    <span class="muted">${plural(summary.decisions, 'decision')} · ${plural(summary.tests, 'MC/DC test')}${summary.uncoverable > 0 ? ` · ${summary.uncoverable} not shown` : ''}${
      file.coverage ? ` · covered ${file.coverage.covered}/${file.coverage.coverable}` : ''
    }</span>
    <button type="button" class="text-button show-source" data-show-source="${file.key}">Show source</button>
    <button type="button" class="copy-prompt is-small" data-prompt="${file.key}" title="Copy an AI prompt that writes the required tests for this file" hidden>Copy file prompt</button>
  </header>`
    : '';
  return `<section class="file" id="${file.key}" data-file-section="${file.key}">
  ${heading}
  ${functions.map((fn) => renderFunction(fn, file, cfgSvgs, conditionGraphSvgs)).join('\n')}
</section>`;
}

function renderFilesWithoutDecisions(files: readonly FileContext[]): string {
  if (files.length === 0) return '';
  return `<details class="no-decisions">
  <summary>${plural(files.length, 'file')} without decisions</summary>
  <ul>${files.map((file) => `<li><code>${escapeHtml(file.path ?? '')}</code></li>`).join('')}</ul>
</details>`;
}

function renderFunction(
  fn: FunctionModel,
  file: FileContext,
  cfgSvgs: ReadonlyMap<string, string>,
  conditionGraphSvgs: ReadonlyMap<string, string>,
): string {
  const { analysis, lines, key } = file;
  const decisions = analysis.program.decisions.filter((d) => d.functionId === fn.id);
  const line = lines.lineOf(fn.range.start);
  const body = decisions.length
    ? decisions
        .map((decision) => {
          const result = analysis.decisions.get(decision.id);
          const dKey = decisionKey(key, decision.id);
          return result ? renderDecision(dKey, decision, result, file, conditionGraphSvgs.get(dKey) ?? '') : '';
        })
        .join('\n')
    : '<p class="muted">No decisions in this function.</p>';
  return `<section class="function" id="${key}-${fn.id}">
  <h2><code>${escapeHtml(fn.name)}</code> <a class="line-link" href="#${key}-L${line}">line ${line}</a></h2>
  <figure class="cfg-figure"><figcaption>Control-flow graph</figcaption><div class="cfg-scroll">${cfgSvgs.get(`${key}-${fn.id}`) ?? ''}</div></figure>
  ${body}
</section>`;
}

function renderDecision(
  dKey: string,
  decision: DecisionModel,
  result: DecisionAnalysis,
  file: FileContext,
  graphSvg: string,
): string {
  const line = file.lines.lineOf(decision.range.start);
  const measured = file.coverage?.byDecision.get(decision.id);
  const missing = new Set(measured?.missingRows);
  const inSet = new Set(result.selection.rows);
  const shownBy = new Map<number, string[]>();
  result.selection.pairs.forEach((pair, index) => {
    if (!pair) return;
    for (const rowId of [pair.falseRow, pair.trueRow]) {
      shownBy.set(rowId, [...(shownBy.get(rowId) ?? []), conditionLabel(index)]);
    }
  });

  const chips = [...decisionChips(result), ...(measured ? [coverageChip(measured)] : [])]
    .map((c) => chip(c.text, c.tone === 'plain' ? undefined : c.tone, c.title))
    .join('');

  const conditions = decision.conditions
    .map((condition) => {
      const pair = result.selection.pairs[condition.index];
      const conditionCoverage = measured?.conditions[condition.index];
      const status = conditionCoverage
        ? conditionCoverage.observedPair
          ? ' is-covered'
          : conditionCoverage.uncoverable
            ? ''
            : ' is-not-covered'
        : '';
      const text = conditionCoverage ? measuredPairText(conditionCoverage) : pairText(pair, result.pairs[condition.index]?.length ?? 0);
      return `<li class="condition-item${pair ? '' : ' is-uncoverable'}${status}"><span class="cond-label">${conditionLabel(condition.index)}</span><code title="${escapeHtml(condition.text)}">${escapeHtml(condition.text)}</code><span class="pair-text">${escapeHtml(text)}</span></li>`;
    })
    .join('');

  const cell = (value: boolean | null | undefined): string =>
    value === null || value === undefined
      ? '<span class="value is-skipped" title="Not evaluated (short-circuited)">–</span>'
      : `<span class="value ${value ? 'is-true' : 'is-false'}">${value ? 'T' : 'F'}</span>`;

  const header = `<tr><th>Test</th>${decision.conditions
    .map((c) => `<th title="${escapeHtml(c.text)}">${conditionLabel(c.index)}</th>`)
    .join('')}<th>Outcome</th><th title="Conditions whose chosen independence pair uses this test">Shows</th>${
    measured ? '<th title="How many times the measured tests ran this vector">Hits</th>' : ''
  }</tr>`;

  const rows = result.rows
    .map(
      (row) =>
        `<tr class="tt-row${inSet.has(row.id) ? ' in-set' : ''}${measured?.rowHits.has(row.id) ? ' is-hit' : ''}${missing.has(row.id) ? ' is-missing' : ''}" data-decision="${dKey}" data-row="${row.id}" tabindex="0" aria-selected="false"><td class="test-id">${testNumber(row.id)}${inSet.has(row.id) ? '<span class="set-mark" title="In the minimal MC/DC test set">★</span>' : ''}</td>${decision.conditions
          .map((c) => `<td>${cell(row.values[c.index])}</td>`)
          .join('')}<td class="outcome">${cell(row.outcome)}</td><td class="shows">${(shownBy.get(row.id) ?? []).join(' ')}</td>${
          measured ? hitsCell(measured.rowHits.get(row.id), missing.has(row.id)) : ''
        }</tr>`,
    )
    .join('');

  return `<article class="decision" id="decision-${dKey}" data-decision="${dKey}">
  <header class="decision-heading"><span class="kind-badge">${escapeHtml(KIND_LABELS[decision.kind])}</span><code class="decision-text">${escapeHtml(decision.text)}</code><a class="line-link" href="#${file.key}-L${line}">line ${line}</a><button type="button" class="copy-prompt is-small" data-prompt="${dKey}" title="Copy an AI prompt that writes the required tests for this decision" hidden>Copy test prompt</button></header>
  <div class="summary-chips">${chips}</div>
  <div class="decision-body">
    <div class="graph-block"><h3>Condition flow</h3><div class="graph-scroll">${graphSvg}</div></div>
    <div class="conditions-block"><h3>Independence</h3><ul class="condition-list">${conditions}</ul></div>
  </div>
  <div class="truth-table-block"><h3>Test vectors</h3><div class="table-scroll"><table class="truth-table"><thead>${header}</thead><tbody>${rows}</tbody></table></div></div>
</article>`;
}

/**
 * Source listing with every condition wrapped in a span. Conditions can nest
 * (`ok(a && b) || c`), so each line is cut at every condition boundary and a
 * segment lists all conditions covering it, outermost first.
 */
function renderSource(file: FileContext): string {
  const { analysis, lines, key } = file;
  const { source, decisions } = analysis.program;
  const spans = decisions
    .flatMap((decision) => {
      const uncoverable = new Set(analysis.decisions.get(decision.id)?.uncoverable);
      return decision.conditions.map((condition) => ({
        key: `${decisionKey(key, decision.id)}:${condition.index}`,
        start: condition.range.start,
        end: condition.range.end,
        uncoverable: uncoverable.has(condition.index),
      }));
    })
    .sort((a, b) => b.end - b.start - (a.end - a.start));

  return lines.lines
    .map(({ start, end }, i) => {
      const number = i + 1;
      const onLine = spans.filter((span) => span.start < end && span.end > start);
      const cuts = new Set([start, end]);
      for (const span of onLine) {
        if (span.start > start) cuts.add(span.start);
        if (span.end < end) cuts.add(span.end);
      }
      const points = [...cuts].sort((a, b) => a - b);
      let html = '';
      for (let p = 0; p < points.length - 1; p++) {
        const from = points[p] ?? start;
        const to = points[p + 1] ?? end;
        const text = escapeHtml(source.slice(from, to).replace(/\r$/, ''));
        const covering = onLine.filter((span) => span.start <= from && to <= span.end);
        if (covering.length === 0) {
          html += text;
          continue;
        }
        const ends = covering.filter((span) => span.end === to).map((span) => span.key);
        const uncoverable = covering.some((span) => span.uncoverable);
        html += `<span class="src-cond${uncoverable ? ' is-uncoverable' : ''}" data-c="${covering.map((span) => span.key).join(' ')}"${ends.length ? ` data-ends="${ends.join(' ')}"` : ''}>${text}</span>`;
      }
      // The page text of these lines is the prompt's source (see runtime.js), so add nothing else.
      return `<div class="src-line" id="${key}-L${number}"><span class="ln" aria-hidden="true">${number}</span><code>${html}</code></div>`;
    })
    .join('');
}

function buildData(files: readonly FileContext[], prompt: TestPromptParts): ReportData {
  const decisions: Record<string, ReportData['decisions'][string]> = {};
  const fileInfo: Record<string, { path: string | null }> = {};
  let initial: ReportData['initial'] = null;

  for (const file of files) {
    const { analysis, lines, key } = file;
    fileInfo[key] = { path: file.path };
    const functions = new Map(analysis.program.functions.map((fn) => [fn.id, fn]));
    for (const decision of analysis.program.decisions) {
      const result = analysis.decisions.get(decision.id);
      const fn = functions.get(decision.functionId);
      if (!result || !fn) continue;
      const pathFor = (outcome: boolean): ReportPath | null => {
        const path = decisionPath(fn.cfg, decision.id, outcome);
        if (!path) return null;
        const lineSet = new Set<number>();
        for (const nodeId of path.nodes) {
          const node = fn.cfg.nodes.find((n) => n.id === nodeId);
          for (const range of node?.ranges ?? []) {
            for (let l = lines.lineOf(range.start); l <= lines.lineOf(Math.max(range.end - 1, range.start)); l++) lineSet.add(l);
          }
        }
        return { nodes: path.nodes, edges: path.edges, lines: [...lineSet].sort((a, b) => a - b) };
      };
      const dKey = decisionKey(key, decision.id);
      const initialRow = result.selection.rows[0] ?? 0;
      decisions[dKey] = {
        file: key,
        fn: fn.id,
        host: decisionHost(fn.cfg, decision.id)?.id ?? null,
        initialRow,
        conditionCount: result.conditionCount,
        rows: result.rows.map((row) => ({ values: row.values, order: row.order, outcome: row.outcome })),
        paths: { true: pathFor(true), false: pathFor(false) },
      };
      initial ??= { decision: dKey, row: initialRow };
    }
  }

  // Sources are read from the rendered page by the script, so they are not duplicated here.
  const promptWithoutSources: TestPromptParts = {
    ...prompt,
    files: Object.fromEntries(Object.entries(prompt.files).map(([key, file]) => [key, { ...file, source: '' }])),
  };
  return { prompt: promptWithoutSources, initial, files: fileInfo, decisions };
}

/** Maps offsets to 1-based line numbers. */
class LineIndex {
  readonly lines: { start: number; end: number }[] = [];

  constructor(source: string) {
    let start = 0;
    for (let i = 0; i <= source.length; i++) {
      if (i === source.length || source[i] === '\n') {
        this.lines.push({ start, end: i });
        start = i + 1;
      }
    }
  }

  lineOf(offset: number): number {
    let low = 0;
    let high = this.lines.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((this.lines[mid]?.start ?? 0) <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  }
}

function measuredChip(files: readonly FileContext[]): string {
  const measured = files.flatMap((file) => (file.coverage && file.coverage.decisionsReached > 0 ? [file.coverage] : []));
  if (measured.length === 0) return '';
  const totals = combineTotals(measured);
  const percent = coveragePercent(totals);
  return chip(
    `covered ${totals.covered}/${totals.coverable}${percent === null ? '' : ` (${percent}%)`}`,
    totals.covered === totals.coverable ? 'covered' : 'warning',
    'Conditions shown independent by the measured tests',
  );
}

function hitsCell(hit: { count: number; tests: readonly string[] } | undefined, missing: boolean): string {
  if (hit) {
    const tests = hit.tests.length ? `&#10;Tests: ${escapeHtml(hit.tests.join(', '))}` : '';
    return `<td class="hits is-hit" title="Evaluated ${hit.count}×${tests}">${hit.count}×</td>`;
  }
  return missing
    ? '<td class="hits is-missing" title="Needed to complete MC/DC for this decision">needed</td>'
    : '<td class="hits" title="Not evaluated by the tests">–</td>';
}

function chip(text: string, tone?: 'strong' | 'warning' | 'covered', title?: string): string {
  return `<span class="chip${tone ? ` is-${tone}` : ''}"${title ? ` title="${escapeHtml(title)}"` : ''}>${escapeHtml(text)}</span>`;
}

function truncate(text: string, max: number): string {
  const single = text.replace(/\s+/g, ' ');
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}

function formatDate(date: Date): string {
  return date.toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' });
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** JSON safe to embed in a <script> element (no `</script>` or line separators). */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
