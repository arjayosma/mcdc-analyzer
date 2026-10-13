import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { bracketMatching, syntaxHighlighting } from '@codemirror/language';
import { Annotation, EditorState } from '@codemirror/state';
import { EditorView, drawSelection, keymap, lineNumbers } from '@codemirror/view';
import type { ProgramAnalysis } from '../analysis';
import { coveragePercent } from '../coverage/coverage';
import { h } from './dom';
import { editorChrome, highlightStyle } from './editorTheme';
import { plural } from './labels';
import { currentCoverage, testKey } from './selectors';
import type { AppState, Store } from './store';

export interface TestRunnerActions {
  readonly run: () => void;
  readonly setTestCode: (key: string, code: string) => void;
}

const COLLAPSED_KEY = 'mcdc-tool:tests-collapsed';
/** Marks programmatic document swaps so they are not saved back as edits. */
const loading = Annotation.define<boolean>();

/**
 * "Tests" panel under the editor: the user's test calls, a Run button and the
 * results of the last run (tests, console output, measured MC/DC coverage).
 */
export class TestRunner {
  readonly element: HTMLElement;
  private readonly view: EditorView;
  private readonly runButton: HTMLButtonElement;
  private readonly headerStatus: HTMLElement;
  private readonly results: HTMLElement;
  private shownKey: string | null = null;

  constructor(
    store: Store,
    private readonly actions: TestRunnerActions,
  ) {
    const run = (): boolean => {
      if (!this.runButton.disabled) this.actions.run();
      return true;
    };
    this.view = new EditorView({
      state: EditorState.create({
        doc: '',
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          bracketMatching(),
          syntaxHighlighting(highlightStyle),
          editorChrome,
          javascript({ jsx: true, typescript: true }),
          keymap.of([{ key: 'Mod-Enter', run }, ...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.updateListener.of((update) => {
            const fromLoad = update.transactions.some((tr) => tr.annotation(loading));
            if (update.docChanged && !fromLoad && this.shownKey !== null) {
              this.actions.setTestCode(this.shownKey, update.state.doc.toString());
            }
          }),
        ],
      }),
    });

    this.runButton = h('button', { class: 'run-button', title: 'Run the tests and measure MC/DC coverage (⌘/Ctrl+Enter)', on: { click: () => this.actions.run() } }, ['▶ Run']);
    this.headerStatus = h('span', { class: 'tests-status' });
    this.results = h('div', { class: 'tests-results', attrs: { 'aria-live': 'polite' } });

    const toggle = h('button', { class: 'tests-toggle', attrs: { 'aria-expanded': 'true' }, on: { click: () => this.setCollapsed(!this.element.classList.contains('is-collapsed')) } }, [
      h('span', { class: 'tree-caret', attrs: { 'aria-hidden': 'true' } }, ['▾']),
      h('strong', {}, ['Tests']),
    ]);
    this.element = h('section', { class: 'test-runner', attrs: { 'aria-label': 'Tests' } }, [
      h('header', { class: 'tests-header' }, [toggle, this.headerStatus, this.runButton]),
      h('div', { class: 'tests-body' }, [h('div', { class: 'tests-editor' }, [this.view.dom]), this.results]),
    ]);
    this.setCollapsed(readCollapsed());

    store.subscribe((state, previous) => {
      const key = testKey(state.project ? state.activePath : null);
      if (key !== this.shownKey || state.analysis !== previous.analysis) this.showCode(state, key);
      if (
        state.coverage !== previous.coverage ||
        state.running !== previous.running ||
        state.analysis !== previous.analysis ||
        state.source !== previous.source
      ) {
        this.render(state);
      }
    });
    this.showCode(store.get(), testKey(null));
    this.render(store.get());
  }

  private setCollapsed(collapsed: boolean): void {
    this.element.classList.toggle('is-collapsed', collapsed);
    const toggle = this.element.querySelector('.tests-toggle');
    toggle?.setAttribute('aria-expanded', String(!collapsed));
    const caret = toggle?.querySelector('.tree-caret');
    if (caret) caret.textContent = collapsed ? '▸' : '▾';
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      // Remembering the panel state is only a convenience.
    }
  }

  /** Loads the test code for the file in the editor (or a starter template). */
  private showCode(state: AppState, key: string): void {
    const stored = state.testCode[key];
    if (key === this.shownKey && stored !== undefined) return;
    const code = stored ?? starterTemplate(state.analysis);
    this.shownKey = key;
    if (code !== this.view.state.doc.toString()) {
      this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: code }, annotations: loading.of(true) });
    }
  }

  private render(state: AppState): void {
    const hasCode = state.analysis !== null && (state.analysis.program.functions.length > 0 || state.analysis.program.decisions.length > 0);
    this.element.hidden = state.analysis === null;
    this.runButton.disabled = state.running || !hasCode || state.stale;
    this.runButton.textContent = state.running ? 'Running…' : '▶ Run';

    const run = state.coverage;
    const view = currentCoverage(state);
    const percent = view.file ? coveragePercent(view.file) : null;
    this.headerStatus.replaceChildren(
      view.file
        ? h('span', { class: `chip ${view.file.covered === view.file.coverable ? 'is-covered' : 'is-warning'}` }, [
            `MC/DC ${view.file.covered}/${view.file.coverable}${percent === null ? '' : ` · ${percent}%`}`,
          ])
        : h('span', { class: 'muted' }, [view.stale ? 'Code changed since the last run' : 'Measure real coverage by running your calls']),
    );

    if (!run || !run.sources.has(state.project ? state.activePath : null)) {
      this.results.replaceChildren(
        h('p', { class: 'muted tests-hint' }, [
          'Write calls to the code above, then press Run (⌘/Ctrl+Enter). The code runs in an isolated worker; each evaluated decision is recorded and matched to its test vectors.',
        ]),
      );
      return;
    }

    const failed = run.tests.filter((t) => !t.ok).length;
    const evaluations = run.observations.reduce((sum, o) => sum + (o.count ?? 1), 0);
    const origin = run.origin?.kind === 'file' ? run.origin : null;
    const parts: (HTMLElement | null)[] = [
      origin
        ? h('p', { class: 'tests-origin' }, [
            'Coverage from ',
            h('strong', {}, [origin.fileName]),
            ` · ${origin.runner} run on ${formatDate(origin.createdAt)}. Running here replaces it with this panel's results.`,
          ])
        : null,
      run.error ? h('p', { class: 'tests-error' }, [h('strong', {}, ['Run stopped: ']), run.error]) : null,
      view.stale ? h('p', { class: 'tests-stale' }, ['The code changed since this run, so its results are hidden. Run again to update coverage.']) : null,
      h('p', { class: 'tests-summary' }, [
        origin
          ? plural(evaluations, 'decision evaluation')
          : `${plural(run.tests.length, 'test')}${failed ? ` · ${failed} failed` : ''} · ${plural(evaluations, 'decision evaluation')} · ${run.durationMs} ms`,
        view.file ? ` · ${view.file.decisionsComplete}/${view.file.decisions} decisions fully covered` : '',
      ]),
      run.tests.length
        ? h(
            'ul',
            { class: 'tests-list' },
            run.tests.map((test) =>
              h('li', { class: test.ok ? 'is-ok' : 'is-failed' }, [
                h('span', { class: 'test-mark', attrs: { 'aria-label': test.ok ? 'passed' : 'failed' } }, [test.ok ? '✓' : '✗']),
                h('span', {}, [test.name]),
                test.error ? h('code', { class: 'test-error' }, [test.error]) : null,
              ]),
            ),
          )
        : null,
      run.logs.length
        ? h('details', { class: 'tests-logs' }, [h('summary', {}, [`Console (${run.logs.length})`]), h('pre', {}, [run.logs.join('\n')])])
        : null,
    ];
    this.results.replaceChildren(...parts.filter((part) => part !== null));
  }
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

/** First content of the test editor: what to do, and the functions that can be called. */
export function starterTemplate(analysis: ProgramAnalysis | null): string {
  const names = (analysis?.program.functions ?? [])
    .map((fn) => fn.name)
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
  const first = names[0] ?? 'yourFunction';
  return [
    '// Measure real MC/DC coverage: call the code above, then press Run (⌘/Ctrl+Enter).',
    '// Each test() is reported on its own; plain top-level calls are recorded too.',
    names.length ? `// In scope: ${names.join(', ')}` : '// Top-level functions and exports of the file are in scope.',
    '',
    "test('first case', () => {",
    `  ${first}(/* arguments */);`,
    '});',
    '',
  ].join('\n');
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' });
}

