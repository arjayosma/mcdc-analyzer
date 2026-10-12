import type { ProgramAnalysis } from '../analysis';
import type { McdcMode } from '../engine';
import type { CoverageRun } from '../coverage/types';
import type { Project } from '../project/types';

export interface Progress {
  readonly phase: 'reading' | 'analyzing' | 'exporting';
  readonly done: number;
  readonly total: number;
}

export interface AppState {
  /** Source in the editor: the pasted snippet, or the open project file. */
  readonly source: string;
  readonly mode: McdcMode;
  /** Analysis of `source`; every code, graph and decision view reads this. */
  readonly analysis: ProgramAnalysis | null;
  /** A loaded folder, or null in single-snippet mode. */
  readonly project: Project | null;
  /** The project file shown in the editor; null shows the project overview. */
  readonly activePath: string | null;
  readonly includeTests: boolean;
  /** Long-running work (reading, analyzing or exporting a project). */
  readonly progress: Progress | null;
  /** Test code per file: `snippet`, or the project file path. */
  readonly testCode: Readonly<Record<string, string>>;
  /** Result of the last test run; matched to files by their source at run time. */
  readonly coverage: CoverageRun | null;
  readonly running: boolean;
  /** True while the latest edit has not been analyzed yet. */
  readonly stale: boolean;
  readonly functionId: string | null;
  readonly decisionId: string | null;
  /** Selected truth-table row of the selected decision. */
  readonly rowId: number | null;
  /** Focused condition occurrence of the selected decision. */
  readonly conditionIndex: number | null;
  /** A CFG node to route the example path through when no decision is selected. */
  readonly focusNodeId: string | null;
}

type Listener = (state: AppState, previous: AppState) => void;

export class Store {
  private listeners: Listener[] = [];

  constructor(private state: AppState) {}

  get(): AppState {
    return this.state;
  }

  set(patch: Partial<AppState>): void {
    const previous = this.state;
    this.state = { ...previous, ...patch };
    for (const listener of this.listeners) listener(this.state, previous);
  }

  subscribe(listener: Listener): void {
    this.listeners.push(listener);
  }

  /** Selects a decision, its function, and the first test of its minimal set. */
  selectDecision(decisionId: string | null, conditionIndex: number | null = null): void {
    const { analysis } = this.state;
    const decision = analysis?.program.decisions.find((d) => d.id === decisionId);
    if (!analysis || !decision) {
      this.set({ decisionId: null, rowId: null, conditionIndex: null });
      return;
    }
    const result = analysis.decisions.get(decision.id);
    const chosen = conditionIndex !== null ? result?.selection.pairs[conditionIndex] : undefined;
    this.set({
      functionId: decision.functionId,
      decisionId: decision.id,
      rowId: chosen?.trueRow ?? result?.selection.rows[0] ?? result?.rows[0]?.id ?? null,
      conditionIndex,
      focusNodeId: null,
    });
  }
}
