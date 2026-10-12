import type { DecisionCoverage, RowHit } from '../coverage/coverage';
import type { DecisionAnalysis, TestRow } from '../engine';
import type { DecisionModel } from '../model/types';
import { renderConditionGraph } from './ConditionGraphView';
import { h } from './dom';
import { KIND_LABELS, conditionLabel, coverageChip as coverageChipInfo, decisionChips, measuredPairText, pairText, testNumber } from './labels';
import { currentCoverage, select, selectedDecisionCoverage } from './selectors';
import type { AppState, Store } from './store';

/**
 * Bottom-right panel: an overview of the function's decisions, or for the
 * selected decision its condition graph, independence pairs and truth table.
 */
export class DecisionPanel {
  readonly element: HTMLElement;
  private onlyMinimalSet = false;

  constructor(private readonly store: Store) {
    this.element = h('section', { class: 'decision-panel', attrs: { 'aria-label': 'Decision details' } });
    store.subscribe((state, previous) => {
      const changed =
        state.analysis !== previous.analysis ||
        state.functionId !== previous.functionId ||
        state.decisionId !== previous.decisionId ||
        state.rowId !== previous.rowId ||
        state.conditionIndex !== previous.conditionIndex ||
        state.coverage !== previous.coverage;
      if (changed) this.render(state);
    });
  }

  private render(state: AppState): void {
    const { decision, result, row } = select(state);
    const scrollTop = this.element.scrollTop;
    const sameDecision = this.element.dataset.decision === (decision?.id ?? '');
    this.element.dataset.decision = decision?.id ?? '';
    this.element.replaceChildren(
      ...(decision && result ? this.renderDecision(state, decision, result, row) : this.renderOverview(state)),
    );
    // Keep the reader's place while they click through rows of the same decision.
    if (sameDecision) this.element.scrollTop = scrollTop;
  }

  private renderOverview(state: AppState): Node[] {
    const { fn } = select(state);
    const analysis = state.analysis;
    if (!analysis || !fn) return [];
    const decisions = analysis.program.decisions.filter((d) => d.functionId === fn.id);
    if (decisions.length === 0) {
      return [
        h('div', { class: 'empty-note' }, [
          h('strong', {}, [fn.name]),
          ' has no decisions. Click a box in the graph to trace a path through it.',
        ]),
      ];
    }
    return [
      h('header', { class: 'panel-header' }, [
        h('h2', {}, [`Decisions in ${fn.name}`]),
        h('span', { class: 'muted' }, ['Select one to see its MC/DC tests']),
      ]),
      h(
        'ul',
        { class: 'decision-list' },
        decisions.map((decision) => {
          const result = analysis.decisions.get(decision.id);
          const measured = currentCoverage(state).file?.byDecision.get(decision.id);
          return h('li', {}, [
            h('button', { class: 'decision-item', on: { click: () => this.store.selectDecision(decision.id) } }, [
              h('span', { class: 'kind-badge' }, [KIND_LABELS[decision.kind]]),
              h('code', {}, [decision.text]),
              h('span', { class: 'decision-stats' }, [
                `${result?.conditionCount ?? 0} cond · ${result?.selection.rows.length ?? 0} tests`,
                result && result.uncoverable.length > 0
                  ? h('span', { class: 'chip is-warning' }, [`${result.uncoverable.length} not shown`])
                  : null,
                measured ? coverageChip(measured) : null,
              ]),
            ]),
          ]);
        }),
      ),
    ];
  }

  private renderDecision(state: AppState, decision: DecisionModel, result: DecisionAnalysis, row: TestRow | null): Node[] {
    const selectCondition = (index: number): void => {
      const pair = result.selection.pairs[index];
      const rowStillRelevant = pair && (state.rowId === pair.trueRow || state.rowId === pair.falseRow);
      this.store.set({
        conditionIndex: state.conditionIndex === index ? null : index,
        rowId: rowStillRelevant || !pair ? state.rowId : pair.trueRow,
      });
    };

    return [
      h('header', { class: 'panel-header decision-header' }, [
        h('button', {
          class: 'text-button',
          title: 'Back to all decisions',
          on: { click: () => this.store.selectDecision(null) },
        }, ['← All']),
        h('span', { class: 'kind-badge' }, [KIND_LABELS[decision.kind]]),
        h('code', { class: 'decision-text', title: decision.text }, [decision.text]),
      ]),
      this.renderSummary(result, selectedDecisionCoverage(state)),
      h('div', { class: 'decision-body' }, [
        h('div', { class: 'graph-block' }, [
          h('h3', {}, ['Condition flow']),
          h('div', { class: 'graph-scroll' }, [
            renderConditionGraph({
              decision,
              result,
              row,
              conditionIndex: state.conditionIndex,
              idPrefix: 'app-cg',
              onSelectCondition: selectCondition,
            }),
          ]),
        ]),
        this.renderConditions(state, decision, result, selectCondition),
      ]),
      this.renderTruthTable(state, decision, result),
    ];
  }

  private renderSummary(result: DecisionAnalysis, measured: DecisionCoverage | null): HTMLElement {
    return h('div', { class: 'summary-chips' }, [
      ...decisionChips(result).map((chip) =>
        h('span', { class: chip.tone === 'plain' ? 'chip' : `chip is-${chip.tone}`, ...(chip.title ? { title: chip.title } : {}) }, [chip.text]),
      ),
      measured ? coverageChip(measured) : null,
      measured && measured.unmatched > 0
        ? h('span', { class: 'chip is-warning', title: 'Evaluations that matched no row of the (truncated) truth table' }, [`${measured.unmatched} unmatched`])
        : null,
    ]);
  }

  private renderConditions(
    state: AppState,
    decision: DecisionModel,
    result: DecisionAnalysis,
    selectCondition: (index: number) => void,
  ): HTMLElement {
    return h('div', { class: 'conditions-block' }, [
      h('h3', {}, ['Independence']),
      h(
        'ul',
        { class: 'condition-list' },
        decision.conditions.map((condition) => {
          const pair = result.selection.pairs[condition.index];
          const measured = selectedDecisionCoverage(state)?.conditions[condition.index];
          const classes = ['condition-item'];
          if (state.conditionIndex === condition.index) classes.push('is-focused');
          if (!pair) classes.push('is-uncoverable');
          if (measured?.observedPair) classes.push('is-covered');
          else if (measured && !measured.uncoverable) classes.push('is-not-covered');
          return h('li', {}, [
            h('button', { class: classes.join(' '), on: { click: () => selectCondition(condition.index) } }, [
              h('span', { class: 'cond-label' }, [conditionLabel(condition.index)]),
              h('code', { title: condition.text }, [condition.text]),
              h('span', { class: 'pair-text' }, [measured ? measuredPairText(measured) : pairText(pair, result.pairs[condition.index]?.length ?? 0)]),
            ]),
          ]);
        }),
      ),
    ]);
  }

  private renderTruthTable(state: AppState, decision: DecisionModel, result: DecisionAnalysis): HTMLElement {
    const inSet = new Set(result.selection.rows);
    const focusedPair = state.conditionIndex !== null ? result.selection.pairs[state.conditionIndex] : null;
    const shownBy = new Map<number, number[]>();
    result.selection.pairs.forEach((pair, index) => {
      if (!pair) return;
      for (const rowId of [pair.falseRow, pair.trueRow]) shownBy.set(rowId, [...(shownBy.get(rowId) ?? []), index]);
    });
    const rows = this.onlyMinimalSet ? result.rows.filter((r) => inSet.has(r.id)) : result.rows;
    const measured = selectedDecisionCoverage(state);
    const missing = new Set(measured?.missingRows);

    const cell = (value: boolean | null | undefined): HTMLElement =>
      value === null || value === undefined
        ? h('span', { class: 'value is-skipped', title: 'Not evaluated (short-circuited)' }, ['–'])
        : h('span', { class: `value ${value ? 'is-true' : 'is-false'}` }, [value ? 'T' : 'F']);

    const body = rows.map((row) => {
      const classes = ['tt-row'];
      if (inSet.has(row.id)) classes.push('in-set');
      if (row.id === state.rowId) classes.push('is-selected');
      if (focusedPair && (row.id === focusedPair.falseRow || row.id === focusedPair.trueRow)) classes.push('is-pair');
      const hit = measured?.rowHits.get(row.id);
      if (hit) classes.push('is-hit');
      if (missing.has(row.id)) classes.push('is-missing');
      const tr = h(
        'tr',
        {
          class: classes.join(' '),
          attrs: { tabindex: 0, 'aria-selected': row.id === state.rowId, 'data-row': row.id },
          on: {
            click: () => this.store.set({ rowId: row.id }),
            keydown: (event) => this.onRowKey(event, rows, row.id),
          },
        },
        [
          h('td', { class: 'test-id' }, [
            testNumber(row.id),
            inSet.has(row.id) ? h('span', { class: 'set-mark', title: 'In the minimal MC/DC test set' }, ['★']) : null,
          ]),
          ...decision.conditions.map((condition) =>
            h('td', { class: state.conditionIndex === condition.index ? 'is-focused-col' : '' }, [cell(row.values[condition.index])]),
          ),
          h('td', { class: 'outcome' }, [cell(row.outcome)]),
          h('td', { class: 'shows' }, [(shownBy.get(row.id) ?? []).map(conditionLabel).join(' ')]),
          measured ? hitsCell(hit, missing.has(row.id)) : null,
        ],
      );
      return tr;
    });

    const toggle = h('label', { class: 'toggle' }, [
      h('input', {
        attrs: { type: 'checkbox', checked: this.onlyMinimalSet },
        on: {
          change: (event) => {
            this.onlyMinimalSet = (event.target as HTMLInputElement).checked;
            this.render(this.store.get());
          },
        },
      }),
      'Minimal set only',
    ]);

    return h('div', { class: 'truth-table-block' }, [
      h('div', { class: 'block-header' }, [
        h('h3', {}, ['Test vectors']),
        h('span', { class: 'muted' }, [
          measured
            ? '★ = in minimal MC/DC set · – = not evaluated · Hits = times your tests ran this vector'
            : '★ = in minimal MC/DC set · – = not evaluated',
        ]),
        toggle,
      ]),
      h('div', { class: 'table-scroll' }, [
        h('table', { class: 'truth-table' }, [
          h('thead', {}, [
            h('tr', {}, [
              h('th', {}, ['Test']),
              ...decision.conditions.map((condition) =>
                h(
                  'th',
                  {
                    class: state.conditionIndex === condition.index ? 'is-focused-col' : '',
                    title: condition.text,
                  },
                  [
                    h('button', {
                      class: 'th-button',
                      on: {
                        click: () =>
                          this.store.set({ conditionIndex: state.conditionIndex === condition.index ? null : condition.index }),
                      },
                    }, [conditionLabel(condition.index)]),
                  ],
                ),
              ),
              h('th', {}, ['Outcome']),
              h('th', { title: 'Conditions whose chosen independence pair uses this test' }, ['Shows']),
              measured ? h('th', { title: 'How many times the last test run evaluated this vector' }, ['Hits']) : null,
            ]),
          ]),
          h('tbody', {}, body),
        ]),
      ]),
    ]);
  }

  private onRowKey(event: KeyboardEvent, rows: readonly TestRow[], rowId: number): void {
    const position = rows.findIndex((row) => row.id === rowId);
    const next = event.key === 'ArrowDown' ? rows[position + 1] : event.key === 'ArrowUp' ? rows[position - 1] : undefined;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.store.set({ rowId });
    } else if (next) {
      event.preventDefault();
      this.store.set({ rowId: next.id });
      this.element.querySelector<HTMLElement>(`tr[data-row="${next.id}"]`)?.focus();
    }
  }
}

function coverageChip(measured: DecisionCoverage): HTMLElement {
  const chip = coverageChipInfo(measured);
  return h('span', { class: `chip is-${chip.tone}`, ...(chip.title ? { title: chip.title } : {}) }, [chip.text]);
}

function hitsCell(hit: RowHit | undefined, missing: boolean): HTMLElement {
  if (hit) {
    const tests = hit.tests.length ? `\nTests: ${hit.tests.join(', ')}` : '';
    return h('td', { class: 'hits is-hit', title: `Evaluated ${hit.count}×${tests}` }, [`${hit.count}×`]);
  }
  return h('td', { class: `hits${missing ? ' is-missing' : ''}`, title: missing ? 'Needed to complete MC/DC for this decision' : 'Not evaluated by your tests' }, [missing ? 'needed' : '–']);
}

