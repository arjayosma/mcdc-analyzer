import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { bracketMatching, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, StateEffect, StateField, type Range } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  WidgetType,
  drawSelection,
  highlightActiveLine,
  keymap,
  lineNumbers,
  placeholder,
  type DecorationSet,
} from '@codemirror/view';
import { editorChrome, highlightStyle } from './editorTheme';
import { conditionLabel } from './labels';
import { currentCoverage, select } from './selectors';
import type { AppState, Store } from './store';

const setDecorations = StateEffect.define<DecorationSet>();

const decorationField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    let next = decorations.map(transaction.changes);
    for (const effect of transaction.effects) if (effect.is(setDecorations)) next = effect.value;
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const SNIPPET_PLACEHOLDER = 'Paste a JavaScript or TypeScript function, file or snippet here…';

class ConditionTag extends WidgetType {
  constructor(
    private readonly label: string,
    private readonly value: boolean | null | undefined,
  ) {
    super();
  }

  override eq(other: ConditionTag): boolean {
    return other.label === this.label && other.value === this.value;
  }

  toDOM(): HTMLElement {
    const tag = document.createElement('span');
    const valueClass = this.value === undefined ? '' : this.value === null ? ' is-skipped' : this.value ? ' is-true' : ' is-false';
    tag.className = `cm-condition-tag${valueClass}`;
    const valueText = this.value === undefined ? '' : this.value === null ? '·–' : this.value ? '·T' : '·F';
    tag.textContent = `${this.label}${valueText}`;
    tag.setAttribute('aria-hidden', 'true');
    return tag;
  }
}

/**
 * Editable source view. Decisions and conditions are underlined; the selected
 * path is bolded with a red line marker, matching the original tool's style.
 */
export class CodePane {
  readonly element: HTMLElement;
  private readonly view: EditorView;
  private readonly editable = new Compartment();
  private readonly placeholderText = new Compartment();

  constructor(
    private readonly store: Store,
    onSourceChange: (source: string) => void,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'code-pane';

    this.view = new EditorView({
      parent: this.element,
      state: EditorState.create({
        doc: store.get().source,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          bracketMatching(),
          syntaxHighlighting(highlightStyle),
          editorChrome,
          javascript({ jsx: true, typescript: true }),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          this.placeholderText.of(placeholder(SNIPPET_PLACEHOLDER)),
          this.editable.of([]),
          EditorView.lineWrapping,
          decorationField,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onSourceChange(update.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            mousedown: (event, view) => this.handleClick(event, view),
          }),
        ],
      }),
    });

    store.subscribe((state, previous) => {
      const changed =
        state.analysis !== previous.analysis ||
        state.decisionId !== previous.decisionId ||
        state.rowId !== previous.rowId ||
        state.conditionIndex !== previous.conditionIndex ||
        state.focusNodeId !== previous.focusNodeId ||
        state.coverage !== previous.coverage;
      if (changed) this.render(state);
      if (state.decisionId !== previous.decisionId) this.revealDecision(state);
    });
  }

  /** Replaces the document (e.g. when loading an example). */
  setSource(source: string): void {
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: source } });
  }

  focus(): void {
    this.view.focus();
  }

  /** Read-only with a hint, e.g. while a project is open but no file is selected. */
  setReadOnly(readOnly: boolean, hint: string = SNIPPET_PLACEHOLDER): void {
    this.view.dispatch({
      effects: [
        this.editable.reconfigure(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
        this.placeholderText.reconfigure(placeholder(hint)),
      ],
    });
  }

  private render(state: AppState): void {
    // Positions are only valid for the exact text that was analyzed.
    if (!state.analysis || state.analysis.program.source !== this.view.state.doc.toString()) {
      this.view.dispatch({ effects: setDecorations.of(Decoration.none) });
      return;
    }
    this.view.dispatch({ effects: setDecorations.of(Decoration.set(this.decorations(state), true)) });
  }

  private decorations(state: AppState): Range<Decoration>[] {
    const analysis = state.analysis;
    if (!analysis) return [];
    const { decision, result, row, fn, path } = select(state);
    const doc = this.view.state.doc;
    const out: Range<Decoration>[] = [];
    const mark = (from: number, to: number, className: string): void => {
      if (to > from && to <= doc.length) out.push(Decoration.mark({ class: className }).range(from, to));
    };

    // Every condition in the program, so users can see what will be analyzed;
    // after a test run, also whether the tests covered it.
    const measured = currentCoverage(state).file;
    for (const other of analysis.program.decisions) {
      const uncoverable = new Set(analysis.decisions.get(other.id)?.uncoverable);
      const coverage = measured?.byDecision.get(other.id);
      for (const condition of other.conditions) {
        const classes = ['cm-condition'];
        if (uncoverable.has(condition.index)) classes.push('is-uncoverable');
        else if (coverage) classes.push(coverage.conditions[condition.index]?.observedPair ? 'is-covered' : 'is-not-covered');
        mark(condition.range.start, condition.range.end, classes.join(' '));
      }
    }

    // Example path: bold the source it passes through and flag its lines in red.
    if (fn && path) {
      const lines = new Set<number>();
      for (const nodeId of path.nodes) {
        const node = fn.cfg.nodes.find((n) => n.id === nodeId);
        for (const range of node?.ranges ?? []) {
          mark(range.start, range.end, 'cm-on-path');
          const first = doc.lineAt(range.start).number;
          const last = doc.lineAt(Math.min(range.end, doc.length)).number;
          for (let line = first; line <= last; line++) lines.add(line);
        }
      }
      for (const line of lines) out.push(Decoration.line({ class: 'cm-path-line' }).range(doc.line(line).from));
    }

    if (decision && result) {
      mark(decision.range.start, decision.range.end, 'cm-decision-selected');
      for (const condition of decision.conditions) {
        const value = row ? row.values[condition.index] : undefined;
        const classes = ['cm-condition-value'];
        if (value === true) classes.push('is-true');
        if (value === false) classes.push('is-false');
        if (value === null) classes.push('is-skipped');
        if (state.conditionIndex === condition.index) classes.push('is-focused');
        mark(condition.range.start, condition.range.end, classes.join(' '));
        out.push(
          Decoration.widget({ widget: new ConditionTag(conditionLabel(condition.index), value), side: 1 }).range(
            condition.range.end,
          ),
        );
      }
    }

    for (const diagnostic of analysis.program.diagnostics) {
      if (!diagnostic.range) continue;
      const from = Math.min(diagnostic.range.start, Math.max(doc.length - 1, 0));
      mark(from, Math.max(diagnostic.range.end, from + 1), 'cm-diagnostic');
    }

    return out;
  }

  private revealDecision(state: AppState): void {
    const { decision } = select(state);
    if (!decision || decision.range.end > this.view.state.doc.length) return;
    this.view.dispatch({ effects: EditorView.scrollIntoView(decision.range.start, { y: 'nearest' }) });
  }

  /** Clicking a condition selects its decision (innermost wins for nested ones). */
  private handleClick(event: MouseEvent, view: EditorView): boolean {
    if (event.button !== 0 || event.detail > 1) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    const analysis = this.store.get().analysis;
    if (pos === null || !analysis || analysis.program.source !== view.state.doc.toString()) return false;

    let best: { id: string; size: number; condition: number | null } | null = null;
    for (const decision of analysis.program.decisions) {
      const condition = decision.conditions.find((c) => c.range.start <= pos && pos <= c.range.end);
      if (!condition) continue;
      const size = condition.range.end - condition.range.start;
      if (!best || size < best.size) best = { id: decision.id, size, condition: condition.index };
    }
    if (best) this.store.selectDecision(best.id, best.condition);
    // Never swallow the event: the cursor should still move for editing.
    return false;
  }
}
