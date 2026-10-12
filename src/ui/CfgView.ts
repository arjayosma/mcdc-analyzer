import { layoutCfg, type CfgLayout } from '../cfg/layout';
import type { FunctionModel } from '../model/types';
import { renderCfgSvg } from './cfgSvg';
import { h } from './dom';
import { plural } from './labels';
import { select } from './selectors';
import type { AppState, Store } from './store';

const ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5];

/**
 * Function-level control-flow graph. Layout runs only when the graph changes;
 * selection changes just toggle classes so highlighting stays instant.
 */
export class CfgView {
  readonly element: HTMLElement;
  private readonly functionSelect: HTMLSelectElement;
  private readonly functionPicker: HTMLElement;
  private readonly canvas: HTMLElement;
  private readonly zoomLabel: HTMLElement;
  private svg: SVGSVGElement | null = null;
  private layout: CfgLayout | null = null;
  private renderedFn: FunctionModel | null = null;
  private layoutToken = 0;
  private zoom = 1;

  constructor(private readonly store: Store) {
    this.functionSelect = h('select', {
      class: 'fn-select',
      attrs: { id: 'fn-select' },
      on: {
        change: () =>
          this.store.set({
            functionId: this.functionSelect.value,
            decisionId: null,
            rowId: null,
            conditionIndex: null,
            focusNodeId: null,
          }),
      },
    });
    this.functionPicker = h('div', { class: 'fn-picker' }, [
      h('label', { attrs: { for: 'fn-select' } }, ['Function']),
      this.functionSelect,
    ]);
    this.zoomLabel = h('span', { class: 'zoom-label' }, ['100%']);
    this.canvas = h('div', { class: 'cfg-canvas' });
    this.element = h('section', { class: 'cfg-view', attrs: { 'aria-label': 'Control-flow graph' } }, [
      h('header', { class: 'panel-header' }, [
        this.functionPicker,
        h('div', { class: 'zoom-controls' }, [
          h('button', { class: 'icon-button', title: 'Zoom out', on: { click: () => this.stepZoom(-1) } }, ['−']),
          this.zoomLabel,
          h('button', { class: 'icon-button', title: 'Zoom in', on: { click: () => this.stepZoom(1) } }, ['+']),
          h('button', { class: 'text-button', title: 'Fit to width', on: { click: () => this.fit() } }, ['Fit']),
        ]),
      ]),
      this.canvas,
    ]);

    store.subscribe((state, previous) => {
      if (state.analysis !== previous.analysis || state.functionId !== previous.functionId) {
        this.renderFunctionPicker(state);
        void this.renderGraph(state);
      } else {
        this.highlight(state);
      }
    });
  }

  private renderFunctionPicker(state: AppState): void {
    const { fn } = select(state);
    const functions = state.analysis?.program.functions ?? [];
    this.functionSelect.replaceChildren(
      ...functions.map((candidate) =>
        h('option', { attrs: { value: candidate.id, selected: candidate.id === fn?.id } }, [
          `${candidate.name} · ${plural(candidate.decisionIds.length, 'decision')}`,
        ]),
      ),
    );
    if (fn) this.functionSelect.value = fn.id;
    this.functionSelect.disabled = functions.length <= 1;
    this.functionSelect.title = functions.length <= 1 ? 'This code has a single function' : `${functions.length} functions`;
  }


  private async renderGraph(state: AppState): Promise<void> {
    const { fn } = select(state);
    const token = ++this.layoutToken;
    if (!fn) {
      this.canvas.replaceChildren();
      this.svg = null;
      this.renderedFn = null;
      return;
    }
    const layout = await layoutCfg(fn.cfg);
    // A newer render started while elk was working; drop this result.
    if (token !== this.layoutToken) return;

    this.layout = layout;
    this.renderedFn = fn;
    this.svg = renderCfgSvg(layout, fn, {
      idPrefix: 'app-cfg',
      onActivate: (node) => {
        const target = node.decisionId ?? node.decisionIds[0];
        if (target) this.store.selectDecision(target);
        else this.store.set({ decisionId: null, rowId: null, conditionIndex: null, focusNodeId: node.id });
      },
    });
    // Start zoomed to fit the pane when that stays readable.
    this.zoom = Math.min(1, Math.max(0.6, (this.canvas.clientWidth - 8) / layout.width));
    this.applyZoom();
    this.canvas.replaceChildren(this.svg);
    this.revealEntry(layout, fn);
    this.highlight(this.store.get());
  }

  private highlight(state: AppState): void {
    if (!this.svg || !this.renderedFn) return;
    const { path, decisionNode } = select(state);
    const onPathNodes = new Set(path?.nodes);
    const onPathEdges = new Set(path?.edges);

    for (const element of this.svg.querySelectorAll<SVGGElement>('.cfg-node')) {
      const id = element.dataset.node ?? '';
      element.classList.toggle('on-path', onPathNodes.has(id));
      element.classList.toggle('is-selected', id === decisionNode?.id || id === state.focusNodeId);
    }
    for (const element of this.svg.querySelectorAll<SVGGElement>('.cfg-edge')) {
      const on = onPathEdges.has(Number(element.dataset.edge));
      element.classList.toggle('on-path', on);
      element.querySelector('path')?.setAttribute('marker-end', on ? 'url(#app-cfg-arrow-path)' : 'url(#app-cfg-arrow)');
      // Draw highlighted edges last so they sit above crossing edges.
      if (on) element.parentElement?.append(element);
    }

    const focus = this.svg.querySelector('.cfg-node.is-selected');
    focus?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }

  private revealEntry(layout: CfgLayout, fn: FunctionModel): void {
    const entry = layout.nodes.find((laidOut) => laidOut.node.id === fn.cfg.entry);
    if (!entry) return;
    const centre = (entry.x + entry.width / 2) * this.zoom;
    this.canvas.scrollTo({ left: Math.max(0, centre - this.canvas.clientWidth / 2), top: 0 });
  }

  private stepZoom(direction: 1 | -1): void {
    const current = ZOOM_STEPS.findIndex((step) => step >= this.zoom - 0.001);
    const next = ZOOM_STEPS[Math.min(Math.max((current === -1 ? 3 : current) + direction, 0), ZOOM_STEPS.length - 1)];
    this.zoom = next ?? 1;
    this.applyZoom();
  }

  private fit(): void {
    if (!this.layout) return;
    const available = this.canvas.clientWidth - 8;
    this.zoom = Math.min(1.5, Math.max(0.3, available / this.layout.width));
    this.applyZoom();
  }

  private applyZoom(): void {
    this.zoomLabel.textContent = `${Math.round(this.zoom * 100)}%`;
    if (!this.svg || !this.layout) return;
    this.svg.setAttribute('width', String(this.layout.width * this.zoom));
    this.svg.setAttribute('height', String(this.layout.height * this.zoom));
  }
}
