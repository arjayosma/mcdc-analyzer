import type * as t from '@babel/types';
import type {
  CfgEdge,
  CfgEdgeKind,
  CfgNode,
  CfgNodeKind,
  ControlFlowGraph,
  DecisionModel,
  SourceRange,
} from '../../model/types';
import { rangeOf, snippet } from './ast';

interface Pending {
  readonly from: string;
  readonly kind: CfgEdgeKind;
  readonly label?: string;
}

interface JumpTarget {
  readonly labels: readonly string[];
  /** `loop` accepts break/continue, `switch` break, `label` only a labelled break. */
  readonly kind: 'loop' | 'switch' | 'label';
  readonly breaks: Pending[];
  readonly continues: Pending[];
}

interface MutableNode {
  id: string;
  kind: CfgNodeKind;
  label: string;
  ranges: SourceRange[];
  decisionId?: string;
}

export interface CfgInput {
  readonly functionId: string;
  readonly name: string;
  /** Statements of the function body, or a single expression for `x => expr`. */
  readonly body: readonly t.Statement[] | t.Expression;
  readonly source: string;
  /** Decision ids keyed by the test expression node they were built from. */
  readonly decisionByTest: ReadonlyMap<t.Node, string>;
  /** Decisions owned by this function, used to tag nodes with what they contain. */
  readonly decisions: readonly DecisionModel[];
}

/**
 * Builds a statement-level control-flow graph. Expression-level decisions
 * (ternaries, `&&`/`||` outside a test) stay inside their block node and are
 * listed in `decisionIds` rather than split into branches.
 *
 * Approximations: `throw` goes straight to exit, and a `catch` is reachable
 * from the start of its `try`.
 */
export function buildCfg(input: CfgInput): ControlFlowGraph {
  return new CfgBuilder(input).build();
}

class CfgBuilder {
  private readonly nodes: MutableNode[] = [];
  private readonly edges: CfgEdge[] = [];
  private readonly targets: JumpTarget[] = [];
  private pending: Pending[] = [];
  private openBlock: MutableNode | null = null;
  private pendingLabels: string[] = [];
  private readonly entry: MutableNode;
  private readonly exit: MutableNode;

  constructor(private readonly input: CfgInput) {
    this.entry = this.createNode('entry', input.name, []);
    this.exit = { id: `${input.functionId}:exit`, kind: 'exit', label: 'exit', ranges: [] };
    this.pending = [{ from: this.entry.id, kind: 'flow' }];
  }

  build(): ControlFlowGraph {
    const { body } = this.input;
    if (Array.isArray(body)) {
      body.forEach((statement) => this.statement(statement));
      this.connect(this.pending, this.exit.id);
    } else {
      this.simple(body as t.Expression);
      this.connect(this.pending, this.exit.id, false, 'return');
    }
    this.nodes.push(this.exit);

    return {
      entry: this.entry.id,
      exit: this.exit.id,
      nodes: this.nodes.map((node) => this.finish(node)),
      edges: this.edges,
    };
  }

  private statement(node: t.Statement): void {
    switch (node.type) {
      case 'BlockStatement':
        node.body.forEach((statement) => this.statement(statement));
        return;
      case 'EmptyStatement':
      case 'FunctionDeclaration':
      case 'TSDeclareFunction':
      case 'TSInterfaceDeclaration':
      case 'TSTypeAliasDeclaration':
        return;
      case 'ExportNamedDeclaration':
      case 'ExportDefaultDeclaration':
        if (node.declaration?.type === 'FunctionDeclaration') return;
        this.simple(node);
        return;
      case 'IfStatement':
        return this.ifStatement(node);
      case 'WhileStatement':
        return this.whileStatement(node);
      case 'DoWhileStatement':
        return this.doWhileStatement(node);
      case 'ForStatement':
        return this.forStatement(node);
      case 'ForInStatement':
      case 'ForOfStatement':
        return this.forEachStatement(node);
      case 'SwitchStatement':
        return this.switchStatement(node);
      case 'TryStatement':
        return this.tryStatement(node);
      case 'LabeledStatement':
        return this.labeledStatement(node);
      case 'ReturnStatement':
        this.simple(node);
        return this.jumpToExit('return');
      case 'ThrowStatement':
        this.simple(node);
        return this.jumpToExit('throw');
      case 'BreakStatement':
        this.simple(node);
        return this.jump(node.label?.name ?? null, 'break');
      case 'ContinueStatement':
        this.simple(node);
        return this.jump(node.label?.name ?? null, 'continue');
      default:
        this.simple(node);
    }
  }

  private ifStatement(node: t.IfStatement): void {
    const test = this.decisionNode(node.test, `if (${this.snip(node.test)})`);
    this.pending = [{ from: test, kind: 'true' }];
    this.statement(node.consequent);
    const afterThen = this.pending;
    this.pending = [{ from: test, kind: 'false' }];
    this.openBlock = null;
    if (node.alternate) this.statement(node.alternate);
    this.pending = [...afterThen, ...this.pending];
    this.openBlock = null;
  }

  private whileStatement(node: t.WhileStatement): void {
    const head = this.decisionNode(node.test, `while (${this.snip(node.test)})`);
    const target = this.pushTarget('loop');
    this.pending = [{ from: head, kind: 'true' }];
    this.statement(node.body);
    this.connect([...this.pending, ...target.continues], head, true);
    this.pending = [{ from: head, kind: 'false' }, ...target.breaks];
    this.popTarget();
  }

  private doWhileStatement(node: t.DoWhileStatement): void {
    const head = this.emit('join', 'do', []);
    const target = this.pushTarget('loop');
    this.pending = [{ from: head, kind: 'flow' }];
    this.statement(node.body);
    this.pending.push(...target.continues);
    const test = this.decisionNode(node.test, `while (${this.snip(node.test)})`);
    this.connect([{ from: test, kind: 'true' }], head, true);
    this.pending = [{ from: test, kind: 'false' }, ...target.breaks];
    this.popTarget();
  }

  private forStatement(node: t.ForStatement): void {
    if (node.init) this.simple(node.init);
    const head = node.test
      ? this.decisionNode(node.test, `for (…; ${this.snip(node.test)}; …)`)
      : this.emit('loop', 'for (;;)', []);
    const target = this.pushTarget('loop');
    this.pending = [{ from: head, kind: node.test ? 'true' : 'flow' }];
    this.statement(node.body);
    this.pending.push(...target.continues);
    if (node.update) {
      this.openBlock = null;
      this.simple(node.update);
    }
    this.connect(this.pending, head, true);
    this.pending = [...(node.test ? [{ from: head, kind: 'false' } as const] : []), ...target.breaks];
    this.popTarget();
  }

  private forEachStatement(node: t.ForInStatement | t.ForOfStatement): void {
    const range = { start: rangeOf(node.left).start, end: rangeOf(node.right).end };
    const head = this.emit('loop', `for (${snippet(this.input.source, range)})`, [range]);
    const target = this.pushTarget('loop');
    this.pending = [{ from: head, kind: 'true', label: 'next' }];
    this.statement(node.body);
    this.connect([...this.pending, ...target.continues], head, true);
    this.pending = [{ from: head, kind: 'false', label: 'done' }, ...target.breaks];
    this.popTarget();
  }

  private switchStatement(node: t.SwitchStatement): void {
    const head = this.emit('switch', `switch (${this.snip(node.discriminant)})`, [rangeOf(node.discriminant)]);
    const target = this.pushTarget('switch');
    let fallthrough: Pending[] = [];
    for (const switchCase of node.cases) {
      const label = switchCase.test ? `case ${this.snip(switchCase.test, 24)}` : 'default';
      this.pending = [{ from: head, kind: 'case', label }, ...fallthrough];
      this.openBlock = null;
      switchCase.consequent.forEach((statement) => this.statement(statement));
      fallthrough = this.pending;
    }
    const hasDefault = node.cases.some((switchCase) => !switchCase.test);
    this.pending = [
      ...fallthrough,
      ...target.breaks,
      ...(hasDefault ? [] : [{ from: head, kind: 'case', label: 'no match' } as const]),
    ];
    this.openBlock = null;
    this.popTarget();
  }

  private tryStatement(node: t.TryStatement): void {
    const head = this.emit('join', 'try', []);
    this.pending = [{ from: head, kind: 'flow' }];
    this.statement(node.block);
    const afterTry = this.pending;
    if (node.handler) {
      this.pending = [{ from: head, kind: 'catch', label: 'catch' }];
      this.openBlock = null;
      this.statement(node.handler.body);
      this.pending = [...afterTry, ...this.pending];
    }
    this.openBlock = null;
    if (node.finalizer) this.statement(node.finalizer);
  }

  private labeledStatement(node: t.LabeledStatement): void {
    const { body } = node;
    const isLoopOrSwitch =
      body.type === 'WhileStatement' ||
      body.type === 'DoWhileStatement' ||
      body.type === 'ForStatement' ||
      body.type === 'ForInStatement' ||
      body.type === 'ForOfStatement' ||
      body.type === 'SwitchStatement' ||
      body.type === 'LabeledStatement';
    this.pendingLabels.push(node.label.name);
    if (isLoopOrSwitch) {
      this.statement(body);
      return;
    }
    const target = this.pushTarget('label');
    this.statement(body);
    this.pending.push(...target.breaks);
    this.popTarget();
  }

  private jumpToExit(kind: 'return' | 'throw'): void {
    this.connect(this.pending, this.exit.id, false, kind);
    this.pending = [];
    this.openBlock = null;
  }

  private jump(label: string | null, kind: 'break' | 'continue'): void {
    const accepts = (target: JumpTarget): boolean => {
      if (label !== null) return target.labels.includes(label) && (kind === 'break' || target.kind === 'loop');
      return kind === 'break' ? target.kind !== 'label' : target.kind === 'loop';
    };
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const target = this.targets[i];
      if (target && accepts(target)) {
        (kind === 'break' ? target.breaks : target.continues).push(...this.pending);
        break;
      }
    }
    this.pending = [];
    this.openBlock = null;
  }

  private pushTarget(kind: JumpTarget['kind']): JumpTarget {
    const target: JumpTarget = { labels: this.pendingLabels, kind, breaks: [], continues: [] };
    this.pendingLabels = [];
    this.targets.push(target);
    return target;
  }

  private popTarget(): void {
    this.targets.pop();
    this.openBlock = null;
  }

  /** Appends a straight-line statement to the open block, or starts a new one. */
  private simple(node: t.Node): void {
    const range = rangeOf(node);
    const [only] = this.pending;
    if (this.openBlock && this.pending.length === 1 && only?.from === this.openBlock.id) {
      this.openBlock.ranges.push(range);
      return;
    }
    const id = this.emit('block', '', [range]);
    this.pending = [{ from: id, kind: 'flow' }];
    this.openBlock = this.nodes[this.nodes.length - 1] ?? null;
  }

  private decisionNode(test: t.Expression, label: string): string {
    const decisionId = this.input.decisionByTest.get(test);
    return this.emit('decision', label, [rangeOf(test)], decisionId);
  }

  private emit(kind: CfgNodeKind, label: string, ranges: SourceRange[], decisionId?: string): string {
    const node = this.createNode(kind, label, ranges, decisionId);
    this.connect(this.pending, node.id);
    this.pending = [];
    return node.id;
  }

  private createNode(kind: CfgNodeKind, label: string, ranges: SourceRange[], decisionId?: string): MutableNode {
    const node: MutableNode = { id: `${this.input.functionId}:n${this.nodes.length}`, kind, label, ranges };
    if (decisionId !== undefined) node.decisionId = decisionId;
    this.nodes.push(node);
    this.openBlock = null;
    return node;
  }

  private connect(pending: readonly Pending[], to: string, back = false, kind?: CfgEdgeKind): void {
    for (const edge of pending) {
      this.edges.push({
        from: edge.from,
        to,
        kind: kind ?? edge.kind,
        ...(edge.label !== undefined ? { label: edge.label } : {}),
        ...(back ? { back } : {}),
      });
    }
  }

  private finish(node: MutableNode): CfgNode {
    const contains = (range: SourceRange): boolean =>
      node.ranges.some((outer) => outer.start <= range.start && range.end <= outer.end);
    const nested = this.input.decisions
      .filter((decision) => decision.id !== node.decisionId && contains(decision.range))
      .map((decision) => decision.id);
    const label =
      node.kind === 'block' && node.ranges[0]
        ? snippet(this.input.source, node.ranges[0]) + (node.ranges.length > 1 ? ` (+${node.ranges.length - 1})` : '')
        : node.label;
    return {
      id: node.id,
      kind: node.kind,
      label,
      ranges: node.ranges,
      ...(node.decisionId !== undefined ? { decisionId: node.decisionId } : {}),
      decisionIds: node.decisionId !== undefined ? [node.decisionId, ...nested] : nested,
    };
  }

  private snip(node: t.Node, max = 40): string {
    return snippet(this.input.source, rangeOf(node), max);
  }
}
