import type { ConditionNode } from '../engine';

/**
 * Language-neutral program model produced by a language adapter and consumed
 * by the engine and UI. Positions are character offsets into `source`.
 */
export interface SourceRange {
  readonly start: number;
  readonly end: number;
}

export type DecisionKind = 'if' | 'while' | 'do-while' | 'for' | 'ternary' | 'logical';

export interface ConditionInfo {
  /** Occurrence index within the decision, in source order. */
  readonly index: number;
  /** Occurrences with the same group are the same condition (coupled). */
  readonly group: number;
  readonly text: string;
  readonly range: SourceRange;
}

export interface DecisionModel {
  readonly id: string;
  readonly kind: DecisionKind;
  readonly functionId: string;
  /** The boolean expression being decided (e.g. the `if` test). */
  readonly range: SourceRange;
  readonly text: string;
  readonly conditions: readonly ConditionInfo[];
  readonly tree: ConditionNode;
}

export type CfgNodeKind =
  | 'entry'
  | 'exit'
  /** Straight-line statements. */
  | 'block'
  /** Two-way branch on an MC/DC decision (`decisionId` is set). */
  | 'decision'
  /** Iteration without a boolean decision, e.g. `for…of` or `for (;;)`. */
  | 'loop'
  | 'switch'
  /** Structural merge point such as the head of a `do…while` or a `try`. */
  | 'join';

export interface CfgNode {
  readonly id: string;
  readonly kind: CfgNodeKind;
  readonly label: string;
  /** Source covered by this node; bolded when a path passes through it. */
  readonly ranges: readonly SourceRange[];
  /** For `decision` nodes: the decision this node branches on. */
  readonly decisionId?: string;
  /** Every decision located inside this node's ranges (including `decisionId`). */
  readonly decisionIds: readonly string[];
}

export type CfgEdgeKind = 'flow' | 'true' | 'false' | 'case' | 'catch' | 'return' | 'throw';

export interface CfgEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: CfgEdgeKind;
  readonly label?: string;
  /** Loop back-edge (to a loop head that precedes it). */
  readonly back?: boolean;
}

export interface ControlFlowGraph {
  readonly entry: string;
  readonly exit: string;
  readonly nodes: readonly CfgNode[];
  readonly edges: readonly CfgEdge[];
}

export interface FunctionModel {
  readonly id: string;
  readonly name: string;
  readonly range: SourceRange;
  readonly cfg: ControlFlowGraph;
  readonly decisionIds: readonly string[];
}

export interface Diagnostic {
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly range?: SourceRange;
}

export interface ProgramModel {
  readonly language: string;
  readonly source: string;
  readonly functions: readonly FunctionModel[];
  readonly decisions: readonly DecisionModel[];
  readonly diagnostics: readonly Diagnostic[];
}

export interface LanguageAdapter {
  readonly id: string;
  readonly name: string;
  parse(source: string): ProgramModel;
}
