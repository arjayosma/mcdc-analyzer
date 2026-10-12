import { parse, type ParserPlugin } from '@babel/parser';
import type * as t from '@babel/types';
import type {
  DecisionKind,
  DecisionModel,
  Diagnostic,
  FunctionModel,
  LanguageAdapter,
  ProgramModel,
  SourceRange,
} from '../../model/types';
import { childNodes, isFunctionWithBody, lineAt, rangeOf, snippet, type FunctionWithBody } from './ast';
import { buildCfg } from './cfg';
import { buildDecision, isBooleanLogical } from './decisions';

const LANGUAGE = 'javascript';

/**
 * Tried in order until one parses without errors. Some plugins cannot be
 * combined: JSX with TypeScript angle-bracket casts, and the two decorator
 * proposals. TypeScript's legacy decorators (Angular, NestJS, TypeORM, MobX)
 * are the most common, so they come first; standard decorators (which also
 * allow `export @dec class` and `accessor` fields) are the fallback.
 */
const PLUGIN_SETS: readonly ParserPlugin[][] = [
  ['jsx', 'typescript', 'decorators-legacy'],
  ['jsx', 'typescript', 'decorators', 'decoratorAutoAccessors'],
  ['typescript', 'decorators-legacy'],
  ['typescript', 'decorators', 'decoratorAutoAccessors'],
  ['jsx', 'flow', 'decorators-legacy'],
];

export const javascriptAdapter: LanguageAdapter = {
  id: LANGUAGE,
  name: 'JavaScript / TypeScript',
  parse: parseJavaScript,
};

export function parseJavaScript(source: string): ProgramModel {
  // With error recovery, a wrong plugin set often still "succeeds" with errors,
  // so keep trying and use the attempt with the fewest (the first, on a tie).
  let file: ReturnType<typeof parse> | undefined;
  let firstError: unknown;
  for (const plugins of PLUGIN_SETS) {
    try {
      const attempt = parse(source, {
        sourceType: 'unambiguous',
        plugins,
        errorRecovery: true,
        // Snippets are often fragments of a larger function.
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
        allowNewTargetOutsideFunction: true,
        allowSuperOutsideMethod: true,
        allowUndeclaredExports: true,
      });
      const errorCount = attempt.errors?.length ?? 0;
      if (!file || errorCount < (file.errors?.length ?? 0)) file = attempt;
      if (errorCount === 0) break;
    } catch (error) {
      firstError ??= error;
    }
  }

  if (!file) {
    return { language: LANGUAGE, source, functions: [], decisions: [], diagnostics: [toDiagnostic(firstError)] };
  }

  const collected = new Collector(source).collect(file.program);
  return {
    language: LANGUAGE,
    source,
    ...collected,
    diagnostics: (file.errors ?? []).map(toDiagnostic),
  };
}

interface PendingFunction {
  readonly id: string;
  readonly name: string;
  readonly range: SourceRange;
  readonly body: readonly t.Statement[] | t.Expression;
}

/** Walks the AST once, registering functions and decisions in source order. */
class Collector {
  private readonly functions: PendingFunction[] = [];
  private readonly decisions: DecisionModel[] = [];
  private readonly decisionByTest = new Map<t.Node, string>();

  constructor(private readonly source: string) {}

  collect(program: t.Program): Pick<ProgramModel, 'functions' | 'decisions'> {
    const topLevel: PendingFunction = {
      id: 'f0',
      name: '(top level)',
      range: rangeOf(program),
      body: program.body,
    };
    this.functions.push(topLevel);
    this.visit(program, null, topLevel.id);

    const functions: FunctionModel[] = this.functions.map((fn) => {
      const decisions = this.decisions.filter((decision) => decision.functionId === fn.id);
      return {
        id: fn.id,
        name: fn.name,
        range: fn.range,
        cfg: buildCfg({
          functionId: fn.id,
          name: fn.name,
          body: fn.body,
          source: this.source,
          decisionByTest: this.decisionByTest,
          decisions,
        }),
        decisionIds: decisions.map((decision) => decision.id),
      };
    });

    // Drop the top-level pseudo-function when the snippet only declares functions.
    const [top, ...rest] = functions;
    const topIsEmpty = top && top.decisionIds.length === 0 && !top.cfg.nodes.some((node) => node.kind !== 'entry' && node.kind !== 'exit');
    return { functions: topIsEmpty ? rest : functions, decisions: this.decisions };
  }

  private visit(node: t.Node, parent: t.Node | null, functionId: string): void {
    if (isFunctionWithBody(node)) {
      const id = `f${this.functions.length}`;
      this.functions.push({
        id,
        name: this.functionName(node, parent),
        range: rangeOf(node),
        body: node.body.type === 'BlockStatement' ? node.body.body : node.body,
      });
      this.visitChildren(node, [], id);
      return;
    }

    switch (node.type) {
      case 'IfStatement':
        this.decision(node.test, 'if', functionId);
        return this.visitChildren(node, ['test'], functionId);
      case 'WhileStatement':
        this.decision(node.test, 'while', functionId);
        return this.visitChildren(node, ['test'], functionId);
      case 'DoWhileStatement':
        this.decision(node.test, 'do-while', functionId);
        return this.visitChildren(node, ['test'], functionId);
      case 'ForStatement':
        if (node.test) this.decision(node.test, 'for', functionId);
        return this.visitChildren(node, ['test'], functionId);
      case 'ConditionalExpression':
        this.decision(node.test, 'ternary', functionId);
        return this.visitChildren(node, ['test'], functionId);
      case 'LogicalExpression':
        if (isBooleanLogical(node)) return this.decision(node, 'logical', functionId);
        return this.visitChildren(node, [], functionId);
      default:
        return this.visitChildren(node, [], functionId);
    }
  }

  private visitChildren(node: t.Node, skipKeys: readonly string[], functionId: string): void {
    for (const child of childNodes(node, skipKeys)) this.visit(child, node, functionId);
  }

  private decision(expression: t.Node, kind: DecisionKind, functionId: string): void {
    const id = `d${this.decisions.length}`;
    const { decision, leaves } = buildDecision(expression, kind, id, functionId, this.source);
    this.decisions.push(decision);
    this.decisionByTest.set(expression, id);
    // Leaves can hold nested decisions, e.g. `ok(a && b) || c` or a ternary.
    for (const leaf of leaves) this.visit(leaf, expression, functionId);
  }

  private functionName(node: FunctionWithBody, parent: t.Node | null): string {
    if ((node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') && node.id) return node.id.name;
    if (node.type === 'ObjectMethod' || node.type === 'ClassMethod' || node.type === 'ClassPrivateMethod') {
      const key = this.keyName(node.key);
      return node.kind === 'get' || node.kind === 'set' ? `${node.kind} ${key}` : key;
    }
    if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name;
    if ((parent?.type === 'ObjectProperty' || parent?.type === 'ClassProperty') && !parent.computed) {
      return this.keyName(parent.key);
    }
    if (parent?.type === 'AssignmentExpression') return snippet(this.source, rangeOf(parent.left), 32);
    return `anonymous (line ${lineAt(this.source, node.start ?? 0)})`;
  }

  private keyName(key: t.Node): string {
    if (key.type === 'Identifier') return key.name;
    if (key.type === 'StringLiteral') return key.value;
    if (key.type === 'PrivateName') return `#${key.id.name}`;
    return `[${snippet(this.source, rangeOf(key), 24)}]`;
  }
}

function toDiagnostic(error: unknown): Diagnostic {
  const message = error instanceof Error ? error.message : String(error);
  const pos = (error as { pos?: unknown } | null)?.pos;
  return typeof pos === 'number'
    ? { severity: 'error', message, range: { start: pos, end: pos } }
    : { severity: 'error', message };
}
