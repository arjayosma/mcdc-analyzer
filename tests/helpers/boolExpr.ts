import type { ConditionNode } from '../../src/engine';
import type { TestRow } from '../../src/engine';

/**
 * Tiny parser for test fixtures: identifiers, `!`, `&&`, `||` and parentheses.
 * Each identifier occurrence becomes a leaf; repeated names share a group.
 */
export function parseBool(source: string): ConditionNode {
  const tokens = source.match(/[A-Za-z_]\w*|&&|\|\||[!()]/g) ?? [];
  const groups = new Map<string, number>();
  let position = 0;
  let leafIndex = 0;

  const peek = (): string | undefined => tokens[position];
  const expect = (token: string): void => {
    if (tokens[position++] !== token) throw new Error(`Expected ${token} in ${source}`);
  };

  const parseOr = (): ConditionNode => {
    let node = parseAnd();
    while (peek() === '||') {
      position++;
      node = { kind: 'or', left: node, right: parseAnd() };
    }
    return node;
  };
  const parseAnd = (): ConditionNode => {
    let node = parseUnary();
    while (peek() === '&&') {
      position++;
      node = { kind: 'and', left: node, right: parseUnary() };
    }
    return node;
  };
  const parseUnary = (): ConditionNode => {
    const token = tokens[position++];
    if (token === '!') return { kind: 'not', operand: parseUnary() };
    if (token === '(') {
      const node = parseOr();
      expect(')');
      return node;
    }
    if (!token || !/^[A-Za-z_]/.test(token)) throw new Error(`Unexpected ${token ?? 'end'} in ${source}`);
    if (!groups.has(token)) groups.set(token, groups.size);
    return { kind: 'condition', index: leafIndex++, group: groups.get(token) ?? 0 };
  };

  const root = parseOr();
  if (position !== tokens.length) throw new Error(`Trailing input in ${source}`);
  return root;
}

/** Compact row rendering, e.g. "TF- => F". */
export function formatRow(row: TestRow): string {
  const cells = row.values.map((value) => (value === null ? '-' : value ? 'T' : 'F')).join('');
  return `${cells} => ${row.outcome ? 'T' : 'F'}`;
}
