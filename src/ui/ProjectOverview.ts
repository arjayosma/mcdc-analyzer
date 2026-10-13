import { coveragePercent, type FileCoverage } from '../coverage/coverage';
import { projectSummary, type FileStats } from '../project/summary';
import { h } from './dom';
import { KIND_LABELS, plural } from './labels';
import { projectCoverage } from './selectors';
import type { AppState, Store } from './store';

export interface OverviewActions {
  readonly openFile: (path: string) => void;
  readonly openDecision: (path: string, decisionId: string) => void;
}

const FILE_ROWS = 200;

/**
 * Right-hand view while a project is open and no file is selected: totals,
 * the decisions needing the most tests, and every file with decisions.
 */
export class ProjectOverview {
  readonly element: HTMLElement;
  private showAllFiles = false;
  /** Measured coverage per file from the last run, while rendering. */
  private measured: ReadonlyMap<string, FileCoverage> | null = null;

  constructor(
    private readonly store: Store,
    private readonly actions: OverviewActions,
  ) {
    this.element = h('section', { class: 'project-overview', attrs: { 'aria-label': 'Project overview' } });
    store.subscribe((state, previous) => {
      if (
        state.project !== previous.project ||
        state.activePath !== previous.activePath ||
        state.progress !== previous.progress ||
        state.coverage !== previous.coverage
      ) {
        this.render(state);
      }
    });
    // Render the initial state too, so the overview starts hidden when no folder is open.
    this.render(store.get());
  }

  private render(state: AppState): void {
    const { project, progress } = state;
    this.element.hidden = project === null || state.activePath !== null;
    if (!project || state.activePath !== null) return;
    const summary = projectSummary(project);
    const measured = projectCoverage(state);
    this.measured = measured?.byPath ?? null;

    const busy =
      progress && progress.phase !== 'exporting'
        ? h('div', { class: 'progress', attrs: { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': progress.total, 'aria-valuenow': progress.done } }, [
            h('span', {}, [`${progress.phase === 'reading' ? 'Reading' : 'Analyzing'} ${progress.done.toLocaleString('en')} / ${progress.total.toLocaleString('en')} files…`]),
            h('div', { class: 'progress-track' }, [
              h('div', { class: 'progress-bar', attrs: { style: `width:${progress.total ? (100 * progress.done) / progress.total : 0}%` } }),
            ]),
          ])
        : null;

    const tile = (label: string, value: number | string, tone?: 'strong' | 'warning' | 'covered'): HTMLElement =>
      h('div', { class: `stat-tile${tone ? ` is-${tone}` : ''}` }, [
        h('span', { class: 'stat-value' }, [typeof value === 'number' ? value.toLocaleString('en') : value]),
        h('span', { class: 'stat-label' }, [label]),
      ]);

    const filesWithContent = summary.fileStats
      .filter((s) => s.decisions > 0 || s.errors > 0)
      .sort((a, b) => b.tests - a.tests || b.uncoverable - a.uncoverable || a.path.localeCompare(b.path));
    const shownFiles = this.showAllFiles ? filesWithContent : filesWithContent.slice(0, FILE_ROWS);
    const quietFiles = summary.analyzedFiles - filesWithContent.length;

    const sections: (HTMLElement | null)[] = [
      h('header', { class: 'overview-header' }, [
        h('h2', {}, [project.name]),
        h('p', { class: 'muted' }, [
          `${plural(summary.files, 'file')} analyzed${project.skipped.length ? ` · ${project.skipped.length} skipped` : ''}. Pick a file on the left, or start from the decisions that need the most tests.`,
        ]),
        state.coverage?.origin?.kind === 'file'
          ? h('p', { class: 'muted' }, [
              'Measured coverage from ',
              h('strong', {}, [state.coverage.origin.fileName]),
              ` (${state.coverage.origin.runner}).`,
            ])
          : '',
      ]),
      busy,
      h('div', { class: 'stat-grid' }, [
        tile('files with decisions', summary.filesWithDecisions),
        tile('decisions', summary.decisions),
        tile('conditions', summary.conditions),
        tile('MC/DC tests needed', summary.tests, 'strong'),
        measured
          ? tile(
              `conditions covered by tests (${measured.totals.covered}/${measured.totals.coverable})`,
              `${coveragePercent(measured.totals) ?? 0}%`,
              measured.totals.covered === measured.totals.coverable ? 'covered' : 'warning',
            )
          : null,
        summary.uncoverable > 0 ? tile('conditions not shown', summary.uncoverable, 'warning') : null,
        summary.filesWithErrors > 0 ? tile('files with syntax errors', summary.filesWithErrors, 'warning') : null,
      ]),
      summary.hotspots.length
        ? h('section', { class: 'overview-block' }, [
            h('h3', {}, ['Decisions needing the most tests']),
            h('table', { class: 'overview-table' }, [
              h('thead', {}, [h('tr', {}, [h('th', {}, ['Decision']), h('th', {}, ['Where']), h('th', { class: 'num' }, ['Tests']), h('th', { class: 'num' }, ['Not shown'])])]),
              h(
                'tbody',
                {},
                summary.hotspots.map((spot) =>
                  h('tr', { class: 'is-clickable', attrs: { tabindex: 0 }, on: { click: () => this.actions.openDecision(spot.path, spot.decision.id), keydown: (e) => activateOnKey(e, () => this.actions.openDecision(spot.path, spot.decision.id)) } }, [
                    h('td', {}, [h('span', { class: 'kind-badge' }, [KIND_LABELS[spot.decision.kind]]), ' ', h('code', { title: spot.decision.text }, [truncate(spot.decision.text, 60)])]),
                    h('td', { class: 'path-cell' }, [h('code', {}, pathWithBreaks(`${spot.path}:${spot.line}`))]),
                    h('td', { class: 'num strong' }, [String(spot.tests)]),
                    h('td', { class: `num${spot.uncoverable ? ' warning' : ''}` }, [spot.uncoverable ? String(spot.uncoverable) : '–']),
                  ]),
                ),
              ),
            ]),
          ])
        : null,
      h('section', { class: 'overview-block' }, [
        h('h3', {}, ['Files']),
        filesWithContent.length
          ? h('table', { class: 'overview-table' }, [
              h('thead', {}, [
                h('tr', {}, [
                  h('th', {}, ['File']),
                  h('th', { class: 'num' }, ['Decisions']),
                  h('th', { class: 'num' }, ['Conditions']),
                  h('th', { class: 'num' }, ['Tests']),
                  h('th', { class: 'num' }, ['Not shown']),
                  h('th', { class: 'num' }, ['Errors']),
                  measured ? h('th', { class: 'num', title: 'Conditions covered by your last test run' }, ['Covered']) : null,
                ]),
              ]),
              h('tbody', {}, shownFiles.map((stats) => this.fileRow(stats))),
            ])
          : h('p', { class: 'muted' }, [summary.analyzedFiles < summary.files ? 'Still analyzing…' : 'No decisions found in this project.']),
        filesWithContent.length > shownFiles.length
          ? h('button', { class: 'text-button', on: { click: () => { this.showAllFiles = true; this.render(this.store.get()); } } }, [`Show all ${filesWithContent.length} files`])
          : null,
        quietFiles > 0 ? h('p', { class: 'muted' }, [`${plural(quietFiles, 'other file')} without decisions.`]) : null,
      ]),
    ];
    this.element.replaceChildren(...sections.filter((section) => section !== null));
  }

  private fileRow(stats: FileStats): HTMLElement {
    const open = (): void => this.actions.openFile(stats.path);
    return h('tr', { class: 'is-clickable', attrs: { tabindex: 0 }, on: { click: open, keydown: (e) => activateOnKey(e, open) } }, [
      h('td', { class: 'path-cell' }, [h('code', {}, pathWithBreaks(stats.path))]),
      h('td', { class: 'num' }, [String(stats.decisions)]),
      h('td', { class: 'num' }, [String(stats.conditions)]),
      h('td', { class: 'num strong' }, [String(stats.tests)]),
      h('td', { class: `num${stats.uncoverable ? ' warning' : ''}` }, [stats.uncoverable ? String(stats.uncoverable) : '–']),
      h('td', { class: `num${stats.errors ? ' warning' : ''}` }, [stats.errors ? String(stats.errors) : '–']),
      this.measured ? h('td', { class: 'num' }, [coverageText(this.measured.get(stats.path))]) : null,
    ]);
  }
}

/** Lets long paths wrap only after a `/`, so folder names stay intact. */
function pathWithBreaks(path: string): (string | HTMLElement)[] {
  return path.split('/').flatMap((part, index, parts) => (index < parts.length - 1 ? [`${part}/`, document.createElement('wbr')] : [part]));
}

function coverageText(coverage: FileCoverage | undefined): string {
  if (!coverage) return '–';
  const percent = coveragePercent(coverage);
  return `${coverage.covered}/${coverage.coverable}${percent === null ? '' : ` · ${percent}%`}`;
}

function activateOnKey(event: KeyboardEvent, action: () => void): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    action();
  }
}

function truncate(text: string, max: number): string {
  const single = text.replace(/\s+/g, ' ');
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}
