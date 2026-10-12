import type * as t from '@babel/types';
import type { SourceRange } from '../../model/types';

const NON_CHILD_KEYS = new Set([
  'type',
  'start',
  'end',
  'loc',
  'range',
  'extra',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'comments',
  'tokens',
  'errors',
]);

function isNode(value: unknown): value is t.Node {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

/** Direct child nodes in source order, without needing @babel/traverse. */
export function childNodes(node: t.Node, skipKeys: readonly string[] = []): t.Node[] {
  const children: t.Node[] = [];
  // Babel nodes are plain objects; iterate their fields generically.
  for (const [key, value] of Object.entries(node as unknown as Record<string, unknown>)) {
    if (NON_CHILD_KEYS.has(key) || skipKeys.includes(key)) continue;
    if (Array.isArray(value)) children.push(...value.filter(isNode));
    else if (isNode(value)) children.push(value);
  }
  return children.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
}

export function rangeOf(node: t.Node): SourceRange {
  if (node.start == null || node.end == null) {
    throw new Error(`Babel node ${node.type} has no source position`);
  }
  return { start: node.start, end: node.end };
}

/** One-line, length-limited source excerpt for labels. */
export function snippet(source: string, range: SourceRange, max = 48): string {
  const text = source.slice(range.start, range.end).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) if (source[i] === '\n') line++;
  return line;
}

export type FunctionWithBody =
  | t.FunctionDeclaration
  | t.FunctionExpression
  | t.ArrowFunctionExpression
  | t.ObjectMethod
  | t.ClassMethod
  | t.ClassPrivateMethod;

export function isFunctionWithBody(node: t.Node): node is FunctionWithBody {
  switch (node.type) {
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
    case 'ObjectMethod':
    case 'ClassMethod':
    case 'ClassPrivateMethod':
      return true;
    default:
      return false;
  }
}

/** Strips TypeScript/Flow wrappers that do not change a value's truthiness. */
export function unwrapTypeWrappers(node: t.Node): t.Node {
  let current = node;
  for (;;) {
    switch (current.type) {
      case 'TSAsExpression':
      case 'TSSatisfiesExpression':
      case 'TSNonNullExpression':
      case 'TSTypeAssertion':
      case 'TypeCastExpression':
      case 'ParenthesizedExpression':
        current = current.expression;
        break;
      default:
        return current;
    }
  }
}
