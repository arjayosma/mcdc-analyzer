import { javascriptAdapter } from '../adapters/javascript';
import { analyzeSource, type ProgramAnalysis } from '../analysis';
import type { McdcMode } from '../engine';
import { buildProject, folderFromDropEntries, folderFromFileList, type LoadedFolder } from '../project/loadProject';
import { projectSummary } from '../project/summary';
import type { Project, ProjectFile } from '../project/types';
import { coveragePercent, type CoverageTotals } from '../coverage/coverage';
import { runTests } from '../coverage/runner';
import { exportReport, type ReportRequest } from '../report/exportReport';
import { CfgView } from './CfgView';
import { CodePane } from './CodePane';
import { DecisionPanel } from './DecisionPanel';
import { h } from './dom';
import { EXAMPLES } from './examples';
import { FileTree } from './FileTree';
import { helpSectionsFor, renderHelpHtml } from './helpContent';
import { plural } from './labels';
import { ProjectOverview } from './ProjectOverview';
import { coverageFor, currentCoverage, projectCoverage, testKey } from './selectors';
import { Store, type AppState } from './store';
import { starterTemplate, TestRunner } from './TestRunner';

const STORAGE_KEY = 'mcdc-tool:source';
const TESTS_STORAGE_KEY = 'mcdc-tool:tests';
const ANALYZE_DELAY_MS = 300;
/** Time slice for analyzing project files before yielding to the browser. */
const BATCH_MS = 40;

const NO_SELECTION = { functionId: null, decisionId: null, rowId: null, conditionIndex: null, focusNodeId: null } as const;

export function mountApp(root: HTMLElement): void {
  const store = new Store({
    source: readStoredSource(),
    mode: 'masking',
    analysis: null,
    project: null,
    activePath: null,
    includeTests: false,
    progress: null,
    testCode: readStoredTests(),
    coverage: null,
    running: false,
    stale: false,
    ...NO_SELECTION,
  });

  /** The folder behind the open project, kept to re-apply options such as test files. */
  let loadedFolder: LoadedFolder | null = null;
  /** Bumped to cancel an in-flight batch analysis when the project or mode changes. */
  let analysisRun = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const analyze = (source: string): ProgramAnalysis => analyzeSource(source, javascriptAdapter, store.get().mode);

  /** Shows a new analysis of the editor source, keeping the selection when it still exists. */
  const applyAnalysis = (analysis: ProgramAnalysis | null): void => {
    const { decisionId, functionId } = store.get();
    if (!analysis) {
      store.set({ analysis: null, stale: false, ...NO_SELECTION });
      return;
    }
    const keepFunction = analysis.program.functions.some((fn) => fn.id === functionId);
    const keepDecision = decisionId !== null && analysis.decisions.has(decisionId);
    store.set({
      analysis,
      stale: false,
      functionId: keepFunction ? functionId : (analysis.program.functions[0]?.id ?? null),
      focusNodeId: null,
    });
    if (keepDecision) {
      const { rowId, conditionIndex } = store.get();
      const result = analysis.decisions.get(decisionId);
      const rowExists = result?.rows.some((row) => row.id === rowId);
      const conditionExists = conditionIndex !== null && conditionIndex < (result?.conditionCount ?? 0);
      if (rowExists) store.set({ conditionIndex: conditionExists ? conditionIndex : null });
      else store.selectDecision(decisionId, conditionExists ? conditionIndex : null);
    } else {
      store.selectDecision(null);
    }
  };

  const updateProjectFile = (project: Project, path: string, patch: Partial<ProjectFile>): Project => ({
    ...project,
    files: project.files.map((file) => (file.path === path ? { ...file, ...patch } : file)),
  });

  /** Re-analyzes the editor source: the snippet, or the open project file. */
  const analyzeEditor = (): void => {
    clearTimeout(timer);
    const { source, project, activePath } = store.get();
    if (project && activePath) {
      const analysis = analyze(source);
      store.set({ project: updateProjectFile(project, activePath, { analysis }) });
      applyAnalysis(analysis);
      return;
    }
    applyAnalysis(source.trim() === '' ? null : analyze(source));
  };

  /** Analyzes every pending project file in time slices, keeping the page responsive. */
  const analyzeProject = async (): Promise<void> => {
    const run = ++analysisRun;
    const pending = store.get().project?.files.filter((file) => !file.analysis).map((file) => file.path) ?? [];
    const total = store.get().project?.files.length ?? 0;
    let done = total - pending.length;
    while (pending.length > 0) {
      const sliceEnd = performance.now() + BATCH_MS;
      let project = store.get().project;
      if (!project) return;
      const results = new Map<string, ProgramAnalysis>();
      while (pending.length > 0 && performance.now() < sliceEnd) {
        const path = pending.shift() ?? '';
        const file = project.files.find((f) => f.path === path);
        if (file && !file.analysis) results.set(path, analyze(file.source));
        done++;
      }
      project = { ...project, files: project.files.map((file) => (results.has(file.path) && !file.analysis ? { ...file, analysis: results.get(file.path) ?? null } : file)) };
      store.set({ project, progress: pending.length ? { phase: 'analyzing', done, total } : null });
      const activePath = store.get().activePath;
      if (activePath && results.has(activePath) && !store.get().analysis) applyAnalysis(results.get(activePath) ?? null);
      // Let the browser paint and handle input between slices.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (run !== analysisRun) return;
    }
    store.set({ progress: null });
  };

  const onSourceChange = (source: string): void => {
    const { project, activePath } = store.get();
    if (project) {
      const file = activePath ? project.files.find((f) => f.path === activePath) : undefined;
      // Loading a file into the editor also reports a change; only real edits count.
      if (!file || file.source === source) return;
      store.set({ project: updateProjectFile(project, file.path, { source, edited: true, analysis: null }), source, stale: true });
    } else {
      store.set({ source, stale: true });
      writeStoredSource(source);
    }
    clearTimeout(timer);
    timer = setTimeout(analyzeEditor, ANALYZE_DELAY_MS);
  };

  const codePane = new CodePane(store, onSourceChange);
  const cfgView = new CfgView(store);
  const decisionPanel = new DecisionPanel(store);

  const openFile = (path: string): void => {
    const { project } = store.get();
    const file = project?.files.find((f) => f.path === path);
    if (!project || !file) return;
    clearTimeout(timer);
    // Analyze now if the background pass has not reached this file yet.
    const analysis = file.analysis ?? analyze(file.source);
    store.set({
      project: file.analysis ? project : updateProjectFile(project, path, { analysis }),
      activePath: path,
      source: file.source,
      analysis: null,
      stale: false,
      ...NO_SELECTION,
    });
    codePane.setReadOnly(false);
    codePane.setSource(file.source);
    applyAnalysis(analysis);
  };

  const showOverview = (): void => {
    clearTimeout(timer);
    store.set({ activePath: null, source: '', analysis: null, stale: false, ...NO_SELECTION });
    codePane.setSource('');
    codePane.setReadOnly(true, 'Select a file from the project to view its code.');
  };

  const startProject = async (folder: LoadedFolder): Promise<void> => {
    analysisRun++;
    loadedFolder = folder;
    const previous = store.get().project;
    store.set({ progress: { phase: 'reading', done: 0, total: folder.entries.length }, coverage: previous?.name === folder.name ? store.get().coverage : null });
    const project = await buildProject(folder, { includeTests: store.get().includeTests }, (done, total) =>
      store.set({ progress: { phase: 'reading', done, total } }),
    );
    // Keep in-memory edits when the same folder is re-read (e.g. toggling test files).
    const edits = previous?.name === project.name ? new Map(previous.files.filter((f) => f.edited).map((f) => [f.path, f])) : new Map<string, ProjectFile>();
    const files = project.files.map((file) => edits.get(file.path) ?? file);
    const reopen = previous?.name === project.name ? store.get().activePath : null;
    store.set({ project: { ...project, files }, progress: { phase: 'analyzing', done: 0, total: files.length } });
    // Re-reading the same folder keeps the open file; a new folder starts at the overview.
    if (reopen && files.some((file) => file.path === reopen)) openFile(reopen);
    else showOverview();
    await analyzeProject();
  };

  const closeProject = (): void => {
    analysisRun++;
    loadedFolder = null;
    clearTimeout(timer);
    const source = readStoredSource();
    store.set({ project: null, activePath: null, progress: null, coverage: null, source, analysis: null, stale: false, ...NO_SELECTION });
    codePane.setReadOnly(false);
    codePane.setSource(source);
    analyzeEditor();
  };

  const fileTree = new FileTree(store, {
    openFile,
    showOverview,
    setIncludeTests: (includeTests) => {
      store.set({ includeTests });
      if (loadedFolder) void startProject(loadedFolder);
    },
    closeProject,
  });
  const overview = new ProjectOverview(store, {
    openFile,
    openDecision: (path, decisionId) => {
      openFile(path);
      store.selectDecision(decisionId);
    },
  });

  const testRunner = new TestRunner(store, {
    setTestCode: (key, code) => {
      store.set({ testCode: { ...store.get().testCode, [key]: code } });
      if (key === testKey(null)) writeStored(TESTS_STORAGE_KEY, code);
    },
    run: () => {
      const state = store.get();
      if (state.running || !state.analysis || state.stale) return;
      const entry = state.project ? state.activePath : null;
      const files = state.project
        ? state.project.files.flatMap((file) => (file.analysis ? [{ path: file.path, analysis: file.analysis }] : []))
        : [{ path: null, analysis: state.analysis }];
      store.set({ running: true });
      void runTests({ files, entry, testCode: state.testCode[testKey(entry)] ?? starterTemplate(state.analysis) }).then((coverage) =>
        store.set({ coverage, running: false }),
      );
    },
  });

  const loadExample = (id: string): void => {
    const example = EXAMPLES.find((e) => e.id === id);
    if (!example) return;
    if (store.get().project) closeProject();
    store.set({ ...NO_SELECTION });
    codePane.setSource(example.source);
    analyzeEditor();
  };

  const folderInput = h('input', {
    class: 'visually-hidden',
    attrs: { type: 'file', webkitdirectory: true, multiple: true, tabindex: -1, 'aria-hidden': 'true' },
    on: {
      change: () => {
        const files = folderInput.files;
        if (files && files.length > 0) void startProject(folderFromFileList(files));
        folderInput.value = '';
      },
    },
  });
  const openFolder = (): void => folderInput.click();

  const exampleSelect = h(
    'select',
    {
      class: 'example-select',
      attrs: { 'aria-label': 'Load an example' },
      on: {
        change: (event) => {
          const select = event.target as HTMLSelectElement;
          loadExample(select.value);
          select.value = '';
        },
      },
    },
    [h('option', { attrs: { value: '' } }, ['Load example…']), ...EXAMPLES.map((e) => h('option', { attrs: { value: e.id } }, [e.title]))],
  );

  const modeButtons = (['masking', 'unique-cause'] as const).map((mode) =>
    h(
      'button',
      {
        class: 'segment',
        attrs: { 'aria-pressed': mode === store.get().mode },
        title:
          mode === 'masking'
            ? 'Masking MC/DC (DO-178C): other conditions may change if they cannot affect the outcome'
            : 'Unique-cause MC/DC: only the condition under test changes (short-circuited conditions are don\'t care)',
        on: { click: () => setMode(mode) },
      },
      [mode === 'masking' ? 'Masking' : 'Unique-cause'],
    ),
  );
  const setMode = (mode: McdcMode): void => {
    modeButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === (mode === 'masking' ? 0 : 1))));
    store.set({ mode });
    const { project, activePath } = store.get();
    if (project) {
      // Every file needs re-analysis; the open one first so the view updates at once.
      store.set({ project: { ...project, files: project.files.map((file) => ({ ...file, analysis: null })) } });
      if (activePath) analyzeEditor();
      void analyzeProject();
    } else {
      analyzeEditor();
    }
  };

  const exportButton = h(
    'button',
    {
      class: 'text-button export-button',
      title: 'Download a standalone HTML report of every decision, its tests and paths',
      on: {
        click: () => {
          const request = reportRequest(store.get());
          if (!request) return;
          exportButton.disabled = true;
          exportButton.textContent = 'Exporting…';
          const multiFile = request.files.length > 1;
          exportReport(request, multiFile ? (done, total) => store.set({ progress: { phase: 'exporting', done, total } }) : undefined)
            .then(() => (exportButton.textContent = 'Export report'))
            .catch((error: unknown) => {
              console.error('Report export failed', error);
              exportButton.textContent = 'Export failed — retry';
            })
            .finally(() => {
              if (store.get().progress?.phase === 'exporting') store.set({ progress: null });
              exportButton.disabled = !canExport(store.get());
            });
        },
      },
    },
    ['Export report'],
  );

  const helpDialog = renderHelpDialog();
  const openHelp = (): void => {
    if (!helpDialog.open) helpDialog.showModal();
  };
  const helpButton = h(
    'button',
    { class: 'text-button help-button', title: 'How to use this tool and read its output (?)', on: { click: openHelp } },
    [h('span', { class: 'help-icon', attrs: { 'aria-hidden': 'true' } }, ['?']), 'Help'],
  );
  document.addEventListener('keydown', (event) => {
    const typing = event.target instanceof Element && event.target.closest('.cm-editor, input, select, textarea') !== null;
    if (event.key === '?' && !typing && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      openHelp();
    }
  });

  const summary = h('div', { class: 'summary', attrs: { 'aria-live': 'polite' } });
  const diagnostics = h('div', { class: 'diagnostics', attrs: { role: 'status' } });
  const welcome = renderWelcome(loadExample, () => codePane.focus(), openHelp, openFolder);
  const editorBar = h('div', { class: 'editor-bar' });
  const dropOverlay = h('div', { class: 'drop-overlay', attrs: { 'aria-hidden': 'true' } }, [
    h('div', {}, [h('strong', {}, ['Drop a folder to analyze it']), h('span', {}, ['or a single .js / .ts file to open it in the editor'])]),
  ]);
  const right = h('div', { class: 'right-pane' }, [diagnostics, welcome, overview.element, cfgView.element, decisionPanel.element]);
  const workspace = h('main', { class: 'workspace' }, [
    fileTree.element,
    h('section', { class: 'left-pane', attrs: { 'aria-label': 'Source code' } }, [editorBar, codePane.element, testRunner.element]),
    right,
  ]);

  root.replaceChildren(
    h('div', { class: 'app' }, [
      h('header', { class: 'toolbar' }, [
        h('div', { class: 'brand' }, [h('span', { class: 'logo', attrs: { 'aria-hidden': 'true' } }, ['◇']), 'MC/DC Analyzer']),
        h('button', { class: 'text-button open-folder', title: 'Analyze a whole folder (you can also drag one onto the page)', on: { click: openFolder } }, ['Open folder…']),
        exampleSelect,
        h('div', { class: 'segmented', attrs: { role: 'group', 'aria-label': 'MC/DC variant' } }, modeButtons),
        summary,
        exportButton,
        helpButton,
      ]),
      workspace,
    ]),
    folderInput,
    dropOverlay,
    helpDialog,
  );

  setUpDragAndDrop(dropOverlay, {
    folder: (entries) => void folderFromDropEntries(entries).then(startProject),
    file: (file) =>
      void file.text().then((source) => {
        if (store.get().project) closeProject();
        store.set({ ...NO_SELECTION });
        codePane.setSource(source);
        analyzeEditor();
      }),
  });

  store.subscribe((state) => {
    const hasProject = state.project !== null;
    const showingOverview = hasProject && state.activePath === null;
    const hasAnalysis = state.analysis !== null;
    workspace.classList.toggle('has-project', hasProject);
    // A fatal parse error leaves nothing to draw; show only the error banner.
    right.classList.toggle('is-empty', showingOverview || !hasAnalysis || state.analysis?.program.functions.length === 0);
    welcome.hidden = hasProject || hasAnalysis;
    renderSummary(summary, state);
    renderEditorBar(editorBar, state);
    if (exportButton.textContent !== 'Exporting…') exportButton.disabled = !canExport(state);
    renderDiagnostics(diagnostics, state);
  });

  if (store.get().source.trim() !== '') analyzeEditor();
  else store.set({});
}

/** What Export covers: the whole project, or the snippet in the editor. */
function reportRequest(state: AppState): ReportRequest | null {
  // Measured coverage is included only for files the last run saw unchanged.
  const withCoverage = (path: string | null, analysis: ProgramAnalysis) => {
    const coverage = coverageFor(state.coverage, path, analysis).file;
    return coverage ? { path, analysis, coverage } : { path, analysis };
  };
  if (state.project) {
    const files = state.project.files.flatMap((file) => (file.analysis ? [withCoverage(file.path, file.analysis)] : []));
    return files.length ? { files, mode: state.mode, projectName: state.project.name } : null;
  }
  return state.analysis ? { files: [withCoverage(null, state.analysis)], mode: state.mode } : null;
}

function setUpDragAndDrop(
  overlay: HTMLElement,
  handlers: { folder: (entries: FileSystemEntry[]) => void; file: (file: File) => void },
): void {
  let depth = 0;
  const hasFiles = (event: DragEvent): boolean => event.dataTransfer?.types.includes('Files') ?? false;
  document.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    depth++;
    overlay.classList.add('is-visible');
  });
  document.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) overlay.classList.remove('is-visible');
  });
  document.addEventListener('dragover', (event) => {
    if (hasFiles(event)) event.preventDefault();
  });
  document.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth = 0;
    overlay.classList.remove('is-visible');
    // Entries must be taken synchronously, before the drop event finishes.
    const entries = [...(event.dataTransfer?.items ?? [])]
      .map((item) => item.webkitGetAsEntry())
      .filter((entry): entry is FileSystemEntry => entry !== null);
    const only = entries[0];
    const file = event.dataTransfer?.files[0];
    if (entries.length === 1 && only?.isFile && file) handlers.file(file);
    else if (entries.length > 0) handlers.folder(entries);
  });
}

function renderEditorBar(element: HTMLElement, state: AppState): void {
  const file = state.project?.files.find((f) => f.path === state.activePath);
  element.hidden = !file;
  if (!file) return;
  element.replaceChildren(
    h('code', { class: 'editor-path', title: file.path }, [file.path]),
    file.edited
      ? h('span', { class: 'chip is-warning', title: 'Changes are kept in this browser tab only and are not saved to disk.' }, ['edited · not saved'])
      : '',
  );
}

function canExport(state: AppState): boolean {
  if (state.progress) return false;
  if (state.project) return state.project.files.some((file) => file.analysis) && !state.stale;
  return !state.stale && (state.analysis?.program.functions.length ?? 0) > 0;
}

function renderHelpDialog(): HTMLDialogElement {
  const sections = helpSectionsFor('app');
  const body = h('div', { class: 'help-body' });
  // Static, escaped help content (see helpContent.ts).
  body.innerHTML = renderHelpHtml(sections);

  const links = sections.map((section) =>
    h(
      'button',
      {
        class: 'help-nav-link',
        attrs: { 'data-section': section.id },
        on: { click: () => body.querySelector(`#help-${section.id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }) },
      },
      [section.short],
    ),
  );
  const header = h('header', { class: 'help-header' }, [
    h('div', { class: 'help-title-row' }, [
      h('h1', { attrs: { id: 'help-title' } }, ['MC/DC Analyzer — Help']),
      h('button', { class: 'icon-button', title: 'Close (Esc)', attrs: { 'aria-label': 'Close help' }, on: { click: () => dialog.close() } }, ['×']),
    ]),
    h('nav', { class: 'help-nav', attrs: { 'aria-label': 'Help sections' } }, links),
  ]);
  const dialog: HTMLDialogElement = h('dialog', { class: 'help-dialog', attrs: { 'aria-labelledby': 'help-title' } }, [header, body]);

  // Mark the jump link of the section currently at the top of the dialog.
  const markActive = (): void => {
    const threshold = header.getBoundingClientRect().bottom + 24;
    let active = sections[0]?.id;
    for (const element of body.querySelectorAll<HTMLElement>('.help-section')) {
      if (element.getBoundingClientRect().top <= threshold) active = element.id.replace(/^help-/, '');
    }
    for (const link of links) {
      const isActive = link.dataset.section === active;
      link.classList.toggle('is-active', isActive);
      if (isActive) {
        link.setAttribute('aria-current', 'true');
        // Keep the active link visible in the horizontally scrolling row.
        const nav = link.parentElement;
        if (nav) {
          const left = link.offsetLeft - nav.offsetLeft;
          if (left < nav.scrollLeft || left + link.offsetWidth > nav.scrollLeft + nav.clientWidth - 32) {
            nav.scrollTo({ left: Math.max(0, left - 24), behavior: 'smooth' });
          }
        }
      } else {
        link.removeAttribute('aria-current');
      }
    }
  };
  dialog.addEventListener('scroll', markActive, { passive: true });
  dialog.addEventListener('toggle', markActive);

  // Clicking the backdrop (outside the dialog box) closes it.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  return dialog;
}

function renderWelcome(
  loadExample: (id: string) => void,
  focusEditor: () => void,
  openHelp: () => void,
  openFolder: () => void,
): HTMLElement {
  return h('div', { class: 'welcome' }, [
    h('h1', {}, ['Paste code to analyze']),
    h('p', {}, [
      'For every decision (',
      h('code', {}, ['if']),
      ', loops, ternaries, ',
      h('code', {}, ['&&']),
      ' / ',
      h('code', {}, ['||']),
      ') this finds the smallest set of tests that shows each condition independently changing the outcome — modified condition/decision coverage.',
    ]),
    h('div', { class: 'welcome-actions' }, [
      h('button', { class: 'primary-button', on: { click: focusEditor } }, ['Paste or type in the editor']),
      h('button', { class: 'primary-button is-secondary', on: { click: openFolder } }, ['Open a folder…']),
      h('button', { class: 'text-button', on: { click: openHelp } }, ['How to read the results']),
    ]),
    h('p', { class: 'muted welcome-note' }, [
      'You can also drag a project folder onto the page. Files are read in your browser only; nothing is uploaded.',
    ]),
    h('h2', {}, ['Or start from an example']),
    h(
      'div',
      { class: 'example-grid' },
      EXAMPLES.map((example) =>
        h('button', { class: 'example-card', on: { click: () => loadExample(example.id) } }, [
          h('strong', {}, [example.title]),
          h('span', {}, [example.description]),
        ]),
      ),
    ),
  ]);
}

function renderSummary(element: HTMLElement, state: AppState): void {
  if (state.project) {
    const project = projectSummary(state.project);
    const parts = [
      h('span', {}, [plural(project.files, 'file')]),
      h('span', {}, [plural(project.decisions, 'decision')]),
      h('span', {}, [plural(project.tests, 'MC/DC test')]),
      project.uncoverable > 0
        ? h('span', { class: 'is-warning', title: 'Conditions with no independence pair in this mode' }, [`${project.uncoverable} not shown`])
        : null,
      coverageSummary(projectCoverage(state)?.totals ?? null),
      state.progress ? h('span', { class: 'muted' }, [`${state.progress.phase}… ${state.progress.done}/${state.progress.total}`]) : null,
    ];
    element.replaceChildren(...parts.filter((part) => part !== null));
    return;
  }
  const summary = state.analysis?.summary;
  if (!summary) {
    element.replaceChildren();
    return;
  }
  const parts = [
    h('span', {}, [plural(summary.decisions, 'decision')]),
    h('span', {}, [plural(summary.conditions, 'condition')]),
    h('span', {}, [plural(summary.tests, 'MC/DC test')]),
    summary.uncoverable > 0
      ? h('span', { class: 'is-warning', title: 'Conditions with no independence pair in this mode' }, [`${summary.uncoverable} not shown`])
      : null,
    coverageSummary(currentCoverage(state).file),
    state.stale ? h('span', { class: 'muted' }, ['updating…']) : null,
  ];
  element.replaceChildren(...parts.filter((part) => part !== null));
}

function coverageSummary(totals: CoverageTotals | null): HTMLElement | null {
  if (!totals) return null;
  const percent = coveragePercent(totals);
  return h('span', { class: totals.covered === totals.coverable ? 'is-covered' : 'is-warning', title: 'Measured by your last test run' }, [
    `covered ${totals.covered}/${totals.coverable}${percent === null ? '' : ` (${percent}%)`}`,
  ]);
}

function renderDiagnostics(element: HTMLElement, state: AppState): void {
  const diagnostics = state.analysis?.program.diagnostics ?? [];
  element.hidden = diagnostics.length === 0;
  const fatal = diagnostics.length > 0 && state.analysis?.program.functions.length === 0;
  element.replaceChildren(
    ...diagnostics.slice(0, 3).map((diagnostic) => h('p', {}, [h('strong', {}, ['Syntax error: ']), diagnostic.message])),
    fatal ? h('p', { class: 'muted' }, ['Fix the error to see the analysis.']) : '',
  );
}

function readStoredSource(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeStoredSource(source: string): void {
  writeStored(STORAGE_KEY, source);
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode); the draft just isn't remembered.
  }
}

/** The snippet's test code survives reloads; project test code lives in memory. */
function readStoredTests(): Record<string, string> {
  try {
    const code = localStorage.getItem(TESTS_STORAGE_KEY);
    return code === null ? {} : { [testKey(null)]: code };
  } catch {
    return {};
  }
}
