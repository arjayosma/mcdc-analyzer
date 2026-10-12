import { decisionHost, decisionPath } from '../cfg/paths';
import type { DecisionCoverage } from '../coverage/coverage';
import type { ConditionNode, DecisionAnalysis, McdcMode } from '../engine';
import type { DecisionModel, FunctionModel } from '../model/types';
import { KIND_LABELS, conditionLabel, plural, testNumber } from '../ui/labels';
import { decisionKey, fileKey, type ReportFile } from './types';

/** One file's share of the prompt: its source block pieces and its decision blocks. */
export interface PromptFile {
  /** e.g. "## Source code: `src/auth.ts`". */
  readonly header: string;
  readonly fence: string;
  readonly language: string;
  /** Source with `\r` line endings removed and trailing whitespace trimmed. */
  readonly source: string;
  /** Decision blocks keyed by report decision key (`F0-d3`), in source order. */
  readonly decisions: Readonly<Record<string, string>>;
}

/**
 * Pieces of the AI test-generation prompt, so the report can assemble a prompt
 * for the whole report, one file or one decision. Assemble with
 * `assembleTestPrompt`; report/runtime.js mirrors it exactly.
 */
export interface TestPromptParts {
  readonly intro: string;
  readonly heading: string;
  readonly outro: string;
  /** Keyed by report file key (`F0`), in file order. */
  readonly files: Readonly<Record<string, PromptFile>>;
}

const MODE_DESCRIPTIONS = {
  masking:
    'masking MC/DC: in each pair of tests, other conditions may also change as long as they cannot affect the outcome',
  'unique-cause':
    'unique-cause MC/DC: in each pair of tests, only the condition under test changes (short-circuited conditions are "don\'t care")',
} as const;

export function buildTestPromptParts(reportFiles: readonly ReportFile[], mode: McdcMode): TestPromptParts {
  const languages = new Set(reportFiles.map((file) => file.analysis.program.language));
  const language = [...languages].map((l) => (l === 'javascript' ? 'JavaScript/TypeScript' : l)).join(' and ') || 'JavaScript/TypeScript';
  const multiFile = reportFiles.length > 1;
  const measured = reportFiles.some((file) => file.coverage && file.coverage.decisionsReached > 0);

  const intro = `You are helping me write unit tests that achieve MC/DC (modified condition/decision coverage) for the ${language} code below.

A static MC/DC analysis (${MODE_DESCRIPTIONS[mode]}) has already worked out exactly which test cases are needed. Your job is to turn every required test case into a concrete, runnable unit test.

## Instructions

1. Use the test framework, file layout and conventions already used in my project (for example Vitest, Jest or Mocha). If you cannot tell which one, ask me before writing tests.
${
    measured
      ? '2. My existing tests were measured: rows marked "covered" already have a test. Write a test for every row marked **missing**; rows marked "optional" are not needed. Do not drop or merge missing cases: each one exists to prove that a specific condition independently changes its decision\'s outcome.'
      : '2. Write one test for every required test case listed below. Do not drop or merge cases: each one exists to prove that a specific condition independently changes its decision\'s outcome.'
  }
3. For each test, choose inputs (arguments, object fields, mocked dependencies) that make every condition take exactly the listed value. T and F mean the condition expression is truthy or falsy. "–" means the condition is not evaluated (short-circuited), so any value works; keep it simple and realistic.
4. Assert the observable behaviour that follows from the expected outcome (return value, thrown error, calls to collaborators, state changes), not the internal boolean. For a bare \`&&\` / \`||\` expression, the outcome is whether the whole expression is truthy; assert the actual value it produces.
5. Decisions inside loops or after earlier branches must be reached first: pick inputs that get execution there. The "Route" lines show an example path through the function for each outcome.
6. Name each test after the decision and case it covers, and add a short comment with the condition values, e.g. \`// line 6, test #2: C1=F, C2=T, C3=F -> true\`.
7. If a case cannot be set up from the outside (for example it needs private state), say so and explain which refactor or test seam would make it testable. Do not fake it.
8. Do not change the source code. List any condition under "Cannot be shown" as a code-review note: it never independently changes its decision, which usually means redundant or buggy logic.${
    multiFile ? '\n9. Put the tests for each source file next to that file, following the project\'s naming convention for test files.' : ''
  }`;

  const files: Record<string, PromptFile> = {};
  let number = 0;
  let total = 0;
  reportFiles.forEach((reportFile, index) => {
    const { program } = reportFile.analysis;
    const key = fileKey(index);
    const source = normalizeSource(program.source);
    const lineOf = lineFinder(program.source);
    const functions = new Map(program.functions.map((fn) => [fn.id, fn]));
    const decisions: Record<string, string> = {};
    for (const decision of program.decisions) {
      const result = reportFile.analysis.decisions.get(decision.id);
      const fn = functions.get(decision.functionId);
      if (!result || !fn) continue;
      number++;
      total += result.selection.rows.length;
      const coverage = reportFile.coverage?.byDecision.get(decision.id);
      decisions[decisionKey(key, decision.id)] = decisionBlock(number, decision, result, fn, reportFile.path, program.source, lineOf, coverage);
    }
    files[key] = {
      header: reportFile.path === null ? '## Source code' : `## Source code: ${inlineCode(reportFile.path)}`,
      fence: codeFence(source),
      language: program.language === 'javascript' ? 'ts' : '',
      source,
      decisions,
    };
  });

  return {
    intro,
    heading: '## Required test cases\n\nWrite every row marked "required"; the other rows are listed for context only.',
    outro: `## Output\n\nReturn the complete test file(s) ready to run. Then list: (a) any test case you could not implement and why, and (b) the review notes for conditions that cannot be shown. The full report has ${plural(total, 'required test')}; when only some decisions are included here, cover just those.`,
    files,
  };
}

/**
 * Joins prompt parts. `keys` may name files (\`F0\`) or decisions (\`F0-d3\`);
 * omitted means everything. Only the files involved contribute their source.
 */
export function assembleTestPrompt(parts: TestPromptParts, keys?: readonly string[]): string {
  const wanted = keys ? new Set(keys) : null;
  const sources: string[] = [];
  const blocks: string[] = [];
  for (const [key, file] of Object.entries(parts.files)) {
    const chosen = Object.entries(file.decisions)
      .filter(([decision]) => !wanted || wanted.has(key) || wanted.has(decision))
      .map(([, block]) => block);
    if (chosen.length === 0) continue;
    sources.push(sourceBlock(file, file.source));
    blocks.push(...chosen);
  }
  return [parts.intro, ...sources, parts.heading, ...blocks, parts.outro].join('\n\n');
}

/** A file's fenced source block; `source` is passed in so the report can supply it from the page. */
export function sourceBlock(file: PromptFile, source: string): string {
  return `${file.header}\n\n${file.fence}${file.language}\n${source}\n${file.fence}`;
}

/** Matches how the report renders source lines, so the page text equals this. */
export function normalizeSource(source: string): string {
  return source
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .join('\n')
    .replace(/\s+$/, '');
}

function decisionBlock(
  number: number,
  decision: DecisionModel,
  result: DecisionAnalysis,
  fn: FunctionModel,
  path: string | null,
  source: string,
  lineOf: (offset: number) => number,
  measured?: DecisionCoverage,
): string {
  const line = lineOf(decision.range.start);
  const required = new Set(result.selection.rows);
  const missing = new Set(measured?.missingRows);
  const demonstrates = new Map<number, string[]>();
  result.selection.pairs.forEach((pair, index) => {
    if (!pair) return;
    for (const rowId of [pair.falseRow, pair.trueRow]) {
      demonstrates.set(rowId, [...(demonstrates.get(rowId) ?? []), conditionLabel(index)]);
    }
  });

  const negated = negatedConditions(decision.tree);
  const conditions = decision.conditions
    .map(
      (condition) =>
        `- ${conditionLabel(condition.index)}: ${inlineCode(condition.text)}${
          negated.has(condition.index) ? ' (negated with `!` in the source; T/F is the value before the `!`)' : ''
        }`,
    )
    .join('\n');

  const header = `| Test | ${decision.conditions.map((c) => conditionLabel(c.index)).join(' | ')} | Expected outcome | Demonstrates | Status |`;
  const divider = `|${' --- |'.repeat(decision.conditions.length + 4)}`;
  // The work list first: missing rows when tests were measured, else the minimal set.
  const priority = (rowId: number): number =>
    measured ? (missing.has(rowId) ? 2 : measured.rowHits.has(rowId) ? 1 : 0) : Number(required.has(rowId));
  const ordered = [...result.rows].sort((a, b) => priority(b.id) - priority(a.id) || a.id - b.id);
  const rows = ordered.map((row) => {
    const values = decision.conditions.map((c) => {
      const value = row.values[c.index];
      return value === null || value === undefined ? '–' : value ? 'T' : 'F';
    });
    const hit = measured?.rowHits.get(row.id);
    const status = measured
      ? missing.has(row.id)
        ? '**missing**'
        : hit
          ? `covered (${hit.count}×)`
          : 'optional'
      : required.has(row.id)
        ? '**required**'
        : 'optional';
    return `| ${testNumber(row.id)} | ${values.join(' | ')} | ${row.outcome} | ${(demonstrates.get(row.id) ?? []).join(', ') || '–'} | ${status} |`;
  });

  const pairs = decision.conditions
    .map((condition) => {
      const conditionCoverage = measured?.conditions[condition.index];
      if (conditionCoverage && !conditionCoverage.uncoverable) {
        const { observedPair, neededPair } = conditionCoverage;
        if (observedPair) {
          return `- ${conditionLabel(condition.index)}: covered by tests ${testNumber(observedPair.falseRow)} (F) and ${testNumber(observedPair.trueRow)} (T)`;
        }
        if (neededPair) {
          return `- ${conditionLabel(condition.index)}: needs tests ${testNumber(neededPair.falseRow)} (F) and ${testNumber(neededPair.trueRow)} (T)`;
        }
      }
      const pair = result.selection.pairs[condition.index];
      return pair
        ? `- ${conditionLabel(condition.index)}: tests ${testNumber(pair.falseRow)} (F) and ${testNumber(pair.trueRow)} (T)`
        : `- ${conditionLabel(condition.index)}: cannot be shown`;
    })
    .join('\n');

  const notes: string[] = [];
  if (result.uncoverable.length > 0) {
    notes.push(
      `Cannot be shown: ${result.uncoverable
        .map((index) => `${conditionLabel(index)} ${inlineCode(decision.conditions[index]?.text ?? '')}`)
        .join(', ')}. No pair of tests can make this condition alone change the outcome. Flag it for review instead of writing a test for it.`,
    );
  }
  if (result.coupled) notes.push('Coupled conditions: the same expression appears more than once and always takes the same value.');
  if (result.truncated) notes.push('The truth table was truncated at 1024 rows; this list may be incomplete.');
  if (!result.selection.optimal) notes.push('The search for the smallest set ran out of budget; the set is valid but may not be minimal.');

  return [
    `### Decision ${number}: ${KIND_LABELS[decision.kind]} at line ${line} in ${inlineCode(fn.name)}${path === null ? '' : ` (${inlineCode(path)})`}`,
    inlineCode(decision.text),
    `Conditions:\n${conditions}`,
    `${requiredLine(result, measured)}\n\n${header}\n${divider}\n${rows.join('\n')}`,
    `Independence pairs:\n${pairs}`,
    routes(decision, fn, source, lineOf),
    ...notes.map((note) => `Note: ${note}`),
  ]
    .filter((part) => part !== '')
    .join('\n\n');
}

function requiredLine(result: DecisionAnalysis, measured: DecisionCoverage | undefined): string {
  if (!measured) return `Required tests: ${result.selection.rows.length} of ${result.rows.length} possible.`;
  if (measured.evaluations === 0) {
    return `Not reached by my existing tests. Required tests: ${result.selection.rows.length} of ${result.rows.length} possible (all **missing**).`;
  }
  if (measured.covered === measured.coverable) {
    return `Already fully covered by my existing tests (${measured.covered}/${measured.coverable} conditions). Nothing to write for this decision.`;
  }
  return `Covered by my existing tests: ${measured.covered}/${measured.coverable} conditions. Still needed: ${plural(measured.missingRows.length, 'more test')}.`;
}

/** Example routes through the function, as source lines with their code. */
function routes(
  decision: DecisionModel,
  fn: FunctionModel,
  source: string,
  lineOf: (offset: number) => number,
): string {
  const host = decisionHost(fn.cfg, decision.id);
  if (!host) return '';
  const describe = (outcome: boolean | undefined): string | null => {
    const path = decisionPath(fn.cfg, decision.id, outcome);
    if (!path) return null;
    const labels = path.nodes.flatMap((id) => {
      const node = fn.cfg.nodes.find((n) => n.id === id);
      if (!node || node.kind === 'entry') return ['start'];
      if (node.kind === 'exit') return ['end'];
      // Structural nodes such as `try` or `do` have no source of their own.
      const range = node.ranges[0];
      if (!range) return [];
      const text = source.slice(range.start, range.end).replace(/\s+/g, ' ').trim();
      const short = text.length > 70 ? `${text.slice(0, 69)}…` : text;
      // Decision nodes cover only the test, so restore the keyword: `if (…)`, `while (…)`.
      const code = node.kind === 'decision' ? `${node.label.split(' ')[0] ?? ''} (${short})` : short;
      return [`line ${lineOf(range.start)} ${inlineCode(code)}`];
    });
    return labels.join(' → ');
  };
  if (host.kind !== 'decision') {
    const route = describe(undefined);
    return route ? `Route (the decision is inside this step): ${route}` : 'Route: not reachable from the function start.';
  }
  const whenTrue = describe(true);
  const whenFalse = describe(false);
  return [
    whenTrue ? `Route when true: ${whenTrue}` : null,
    whenFalse ? `Route when false: ${whenFalse}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Occurrence indices that sit under a `!` somewhere in the decision tree. */
function negatedConditions(tree: ConditionNode): Set<number> {
  const negated = new Set<number>();
  const visit = (node: ConditionNode, underNot: boolean): void => {
    if (node.kind === 'condition') {
      if (underNot) negated.add(node.index);
    } else if (node.kind === 'not') {
      visit(node.operand, true);
    } else {
      visit(node.left, underNot);
      visit(node.right, underNot);
    }
  };
  visit(tree, false);
  return negated;
}

/** Markdown inline code that survives backticks inside the text. */
function inlineCode(text: string): string {
  const single = text.replace(/\s+/g, ' ').trim();
  const longest = Math.max(0, ...(single.match(/`+/g) ?? []).map((run) => run.length));
  const ticks = '`'.repeat(longest + 1);
  return longest > 0 ? `${ticks} ${single} ${ticks}` : `${ticks}${single}${ticks}`;
}

/** A code fence longer than any backtick run inside the source. */
function codeFence(source: string): string {
  const longest = Math.max(0, ...(source.match(/`+/g) ?? []).map((run) => run.length));
  return '`'.repeat(Math.max(3, longest + 1));
}

function lineFinder(source: string): (offset: number) => number {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  return (offset) => {
    let line = 0;
    while (line + 1 < starts.length && (starts[line + 1] ?? Infinity) <= offset) line++;
    return line + 1;
  };
}
