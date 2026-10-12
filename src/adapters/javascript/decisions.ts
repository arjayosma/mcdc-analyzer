import type * as t from '@babel/types';
import type { ConditionNode } from '../../engine';
import type { ConditionInfo, DecisionKind, DecisionModel } from '../../model/types';
import { childNodes, rangeOf, unwrapTypeWrappers } from './ast';

/** Node types whose evaluation may have side effects or differ between calls. */
const IMPURE_TYPES = new Set([
  'CallExpression',
  'OptionalCallExpression',
  'NewExpression',
  'UpdateExpression',
  'AssignmentExpression',
  'AwaitExpression',
  'YieldExpression',
  'TaggedTemplateExpression',
  'ImportExpression',
]);

export function isBooleanLogical(node: t.Node): node is t.LogicalExpression {
  return node.type === 'LogicalExpression' && (node.operator === '&&' || node.operator === '||');
}

export interface BuiltDecision {
  readonly decision: DecisionModel;
  /** Leaf expressions, which may contain further (nested) decisions. */
  readonly leaves: readonly t.Node[];
}

/**
 * Splits a boolean expression into its `&&`/`||`/`!` skeleton and condition
 * leaves. Leaves with identical source text are coupled (same group) unless
 * they may have side effects, since `f() && f()` can yield different values.
 */
export function buildDecision(
  expression: t.Node,
  kind: DecisionKind,
  id: string,
  functionId: string,
  source: string,
): BuiltDecision {
  const leaves: t.Node[] = [];
  const conditions: ConditionInfo[] = [];
  const groups = new Map<string, number>();
  let nextGroup = 0;

  const groupFor = (leaf: t.Node, text: string): number => {
    if (isImpure(leaf)) return nextGroup++;
    const key = text.replace(/\s+/g, '');
    const existing = groups.get(key);
    if (existing !== undefined) return existing;
    groups.set(key, nextGroup);
    return nextGroup++;
  };

  const build = (node: t.Node): ConditionNode => {
    const inner = unwrapTypeWrappers(node);
    if (isBooleanLogical(inner)) {
      return { kind: inner.operator === '&&' ? 'and' : 'or', left: build(inner.left), right: build(inner.right) };
    }
    if (inner.type === 'UnaryExpression' && inner.operator === '!') {
      return { kind: 'not', operand: build(inner.argument) };
    }
    const range = rangeOf(node);
    const text = source.slice(range.start, range.end);
    const leaf = { kind: 'condition', index: conditions.length, group: groupFor(node, text) } as const;
    conditions.push({ index: leaf.index, group: leaf.group, text, range });
    leaves.push(node);
    return leaf;
  };

  const tree = build(expression);
  const range = rangeOf(expression);
  return {
    decision: {
      id,
      kind,
      functionId,
      range,
      text: source.slice(range.start, range.end),
      conditions,
      tree,
    },
    leaves,
  };
}

function isImpure(node: t.Node): boolean {
  if (IMPURE_TYPES.has(node.type)) return true;
  if (node.type === 'UnaryExpression' && node.operator === 'delete') return true;
  return childNodes(node).some(isImpure);
}
