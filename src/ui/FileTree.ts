import { fileStats, projectSummary, type FileStats } from '../project/summary';
import type { Project, ProjectFile } from '../project/types';
import { h } from './dom';
import { plural } from './labels';
import type { AppState, Store } from './store';

export interface FileTreeActions {
  readonly openFile: (path: string) => void;
  readonly showOverview: () => void;
  readonly setIncludeTests: (include: boolean) => void;
  readonly closeProject: () => void;
}

interface Folder {
  readonly name: string;
  readonly path: string;
  readonly folders: Map<string, Folder>;
  readonly files: ProjectFile[];
}

/** Collapsing folders by default above this many files keeps big trees usable. */
const EXPAND_ALL_LIMIT = 150;

/**
 * Sidebar listing the project's files as a folder tree, each with its
 * decision count and warning markers, plus the files that were skipped.
 */
export class FileTree {
  readonly element: HTMLElement;
  private readonly list: HTMLElement;
  private readonly header: HTMLElement;
  private readonly footer: HTMLElement;
  private readonly filterInput: HTMLInputElement;
  private readonly testsToggle: HTMLInputElement;
  /** Folders the user opened or closed; others follow the default. */
  private readonly toggled = new Map<string, boolean>();
  private renderedProject: Project | null = null;

  constructor(
    private readonly store: Store,
    private readonly actions: FileTreeActions,
  ) {
    this.header = h('div', { class: 'tree-header' });
    this.filterInput = h('input', {
      class: 'tree-filter',
      attrs: { type: 'search', placeholder: 'Filter files…', 'aria-label': 'Filter files' },
      on: { input: () => this.render(this.store.get(), true) },
    });
    this.testsToggle = h('input', {
      attrs: { type: 'checkbox' },
      on: { change: () => this.actions.setIncludeTests(this.testsToggle.checked) },
    });
    this.list = h('div', { class: 'tree-list', attrs: { role: 'tree', 'aria-label': 'Project files' } });
    this.footer = h('div', { class: 'tree-footer' });
    this.element = h('aside', { class: 'file-tree', attrs: { 'aria-label': 'Project' } }, [
      this.header,
      h('div', { class: 'tree-tools' }, [
        this.filterInput,
        h('label', { class: 'toggle', title: 'Include *.test.*, *.spec.* and __tests__ files' }, [this.testsToggle, 'Test files']),
      ]),
      this.list,
      this.footer,
    ]);

    store.subscribe((state, previous) => {
      if (state.project !== previous.project || state.activePath !== previous.activePath || state.progress !== previous.progress) {
        this.render(state, state.project !== this.renderedProject);
      }
    });
    // Render the initial state too, so the sidebar starts hidden when no folder is open.
    this.render(store.get(), true);
  }

  private render(state: AppState, structureChanged: boolean): void {
    const { project } = state;
    this.element.hidden = project === null;
    if (!project) return;
    this.renderedProject = project;
    this.testsToggle.checked = state.includeTests;
    const summary = projectSummary(project);

    this.header.replaceChildren(
      h('div', { class: 'tree-title' }, [
        h('strong', { title: project.name }, [project.name]),
        h('button', { class: 'icon-button', title: 'Close project', attrs: { 'aria-label': 'Close project' }, on: { click: () => this.actions.closeProject() } }, ['×']),
      ]),
      h('button', {
        class: `tree-overview${state.activePath === null ? ' is-active' : ''}`,
        on: { click: () => this.actions.showOverview() },
      }, [
        h('span', {}, ['Overview']),
        h('span', { class: 'muted' }, [`${plural(summary.files, 'file')} · ${plural(summary.tests, 'test')}`]),
      ]),
    );

    if (structureChanged || this.list.childElementCount === 0) this.renderList(project, state);
    else this.markActive(state.activePath);
    this.renderFooter(project);
  }

  private renderList(project: Project, state: AppState): void {
    const query = this.filterInput.value.trim().toLowerCase();
    if (query) {
      const matches = project.files.filter((file) => file.path.toLowerCase().includes(query));
      this.list.replaceChildren(
        ...(matches.length
          ? matches.map((file) => this.fileRow(file, file.path, 0, state.activePath))
          : [h('p', { class: 'muted tree-empty' }, ['No matching files'])]),
      );
      return;
    }
    const root = buildTree(project.files);
    const expandAll = project.files.length <= EXPAND_ALL_LIMIT;
    const activeFolders = ancestors(state.activePath);
    this.list.replaceChildren(...this.folderChildren(root, 0, expandAll, activeFolders, state.activePath));
  }

  private folderChildren(folder: Folder, depth: number, expandAll: boolean, activeFolders: Set<string>, activePath: string | null): HTMLElement[] {
    const rows: HTMLElement[] = [];
    for (const child of [...folder.folders.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      // Collapse single-child folder chains (src/app/utils) into one row.
      let node = child;
      let label = child.name;
      while (node.files.length === 0 && node.folders.size === 1) {
        const only = [...node.folders.values()][0];
        if (!only) break;
        node = only;
        label = `${label}/${only.name}`;
      }
      const open = this.toggled.get(node.path) ?? (expandAll || depth === 0 || activeFolders.has(node.path));
      const counts = folderCounts(node);
      const row = h(
        'button',
        {
          class: 'tree-row tree-folder',
          attrs: { 'aria-expanded': open, style: `--depth:${depth}` },
          on: {
            click: () => {
              this.toggled.set(node.path, !open);
              const state = this.store.get();
              if (state.project) this.renderList(state.project, state);
            },
          },
        },
        [
          h('span', { class: 'tree-caret', attrs: { 'aria-hidden': 'true' } }, [open ? '▾' : '▸']),
          h('span', { class: 'tree-name' }, [label]),
          counts.warnings > 0 ? h('span', { class: 'tree-dot is-warning', title: 'Contains conditions that cannot be shown' }) : null,
          counts.decisions > 0 ? h('span', { class: 'tree-count' }, [String(counts.decisions)]) : null,
        ],
      );
      rows.push(row);
      if (open) rows.push(...this.folderChildren(node, depth + 1, expandAll, activeFolders, activePath));
    }
    for (const file of [...folder.files].sort((a, b) => a.path.localeCompare(b.path))) {
      rows.push(this.fileRow(file, file.path.split('/').pop() ?? file.path, depth, activePath));
    }
    return rows;
  }

  private fileRow(file: ProjectFile, label: string, depth: number, activePath: string | null): HTMLElement {
    const stats = fileStats(file);
    return h(
      'button',
      {
        class: `tree-row tree-file${file.path === activePath ? ' is-active' : ''}${stats.analyzed && stats.decisions === 0 && !stats.errors ? ' is-quiet' : ''}`,
        title: fileTitle(file, stats),
        attrs: { 'data-path': file.path, style: `--depth:${depth}`, role: 'treeitem', 'aria-current': file.path === activePath ? 'true' : undefined },
        on: { click: () => this.actions.openFile(file.path) },
      },
      [
        h('span', { class: 'tree-name' }, [label]),
        file.edited ? h('span', { class: 'tree-dot is-edited', title: 'Edited in memory' }) : null,
        stats.errors > 0 ? h('span', { class: 'tree-dot is-error', title: 'Syntax errors' }) : null,
        stats.uncoverable > 0 ? h('span', { class: 'tree-dot is-warning', title: `${stats.uncoverable} not shown` }) : null,
        !stats.analyzed
          ? h('span', { class: 'tree-count is-pending' }, ['…'])
          : stats.decisions > 0
            ? h('span', { class: 'tree-count' }, [String(stats.decisions)])
            : null,
      ],
    );
  }

  private markActive(activePath: string | null): void {
    for (const row of this.list.querySelectorAll<HTMLElement>('.tree-file')) {
      const active = row.dataset.path === activePath;
      row.classList.toggle('is-active', active);
      if (active) row.setAttribute('aria-current', 'true');
      else row.removeAttribute('aria-current');
    }
  }

  private renderFooter(project: Project): void {
    if (project.skipped.length === 0 && project.otherFiles === 0) {
      this.footer.replaceChildren();
      return;
    }
    this.footer.replaceChildren(
      h('details', { class: 'tree-skipped' }, [
        h('summary', {}, [`Skipped (${project.skipped.length})`]),
        h(
          'ul',
          {},
          project.skipped.slice(0, 500).map((entry) => h('li', { title: entry.reason }, [h('code', {}, [entry.path]), h('span', { class: 'muted' }, [entry.reason])])),
        ),
        project.skipped.length > 500 ? h('p', { class: 'muted' }, [`…and ${project.skipped.length - 500} more`]) : null,
        project.otherFiles > 0 ? h('p', { class: 'muted' }, [`${plural(project.otherFiles, 'other file')} (not JavaScript/TypeScript)`]) : null,
      ]),
    );
  }
}

function buildTree(files: readonly ProjectFile[]): Folder {
  const root: Folder = { name: '', path: '', folders: new Map(), files: [] };
  for (const file of files) {
    const segments = file.path.split('/');
    let folder = root;
    for (const segment of segments.slice(0, -1)) {
      const path = folder.path ? `${folder.path}/${segment}` : segment;
      let next = folder.folders.get(segment);
      if (!next) {
        next = { name: segment, path, folders: new Map(), files: [] };
        folder.folders.set(segment, next);
      }
      folder = next;
    }
    folder.files.push(file);
  }
  return root;
}

function folderCounts(folder: Folder): { decisions: number; warnings: number } {
  let decisions = 0;
  let warnings = 0;
  for (const file of folder.files) {
    const stats = fileStats(file);
    decisions += stats.decisions;
    warnings += stats.uncoverable;
  }
  for (const child of folder.folders.values()) {
    const counts = folderCounts(child);
    decisions += counts.decisions;
    warnings += counts.warnings;
  }
  return { decisions, warnings };
}

function ancestors(path: string | null): Set<string> {
  const result = new Set<string>();
  if (!path) return result;
  const segments = path.split('/');
  for (let i = 1; i < segments.length; i++) result.add(segments.slice(0, i).join('/'));
  return result;
}

function fileTitle(file: ProjectFile, stats: FileStats): string {
  if (!stats.analyzed) return `${file.path}\nNot analyzed yet`;
  const parts = [
    file.path,
    `${plural(stats.decisions, 'decision')} · ${plural(stats.tests, 'MC/DC test')}`,
    stats.uncoverable > 0 ? `${stats.uncoverable} not shown` : null,
    stats.errors > 0 ? plural(stats.errors, 'syntax error') : null,
    file.edited ? 'Edited in memory (not saved to disk)' : null,
  ];
  return parts.filter(Boolean).join('\n');
}
