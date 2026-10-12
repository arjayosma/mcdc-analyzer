/**
 * Language-neutral boolean expression tree for a single decision.
 *
 * Each leaf is one *occurrence* of a condition in source order (`index`).
 * Occurrences that are the same condition (e.g. `a` in `a && b || a`) share a
 * `group`, so they always take the same value — these are "coupled" conditions.
 * For non-coupled decisions `group === index`.
 */
export interface ConditionLeaf {
  readonly kind: 'condition';
  readonly index: number;
  readonly group: number;
}

export interface NotNode {
  readonly kind: 'not';
  readonly operand: ConditionNode;
}

export interface BinaryNode {
  readonly kind: 'and' | 'or';
  readonly left: ConditionNode;
  readonly right: ConditionNode;
}

export type ConditionNode = ConditionLeaf | NotNode | BinaryNode;

/** Value of each group (condition) in a test; missing = not assigned. */
export type GroupAssignment = ReadonlyMap<number, boolean>;

export interface Evaluation {
  readonly outcome: boolean;
  /** Per occurrence: its value, or null when short-circuited (not evaluated). */
  readonly values: readonly (boolean | null)[];
  /** Occurrence indices in the order they were evaluated. */
  readonly order: readonly number[];
  /** Value of every evaluated node; absent nodes were short-circuited. */
  readonly nodeValues: ReadonlyMap<ConditionNode, boolean>;
}

/** Leaves in source (left-to-right) order. */
export function collectLeaves(root: ConditionNode): ConditionLeaf[] {
  const out: ConditionLeaf[] = [];
  const visit = (node: ConditionNode): void => {
    switch (node.kind) {
      case 'condition':
        out.push(node);
        return;
      case 'not':
        visit(node.operand);
        return;
      default:
        visit(node.left);
        visit(node.right);
    }
  };
  visit(root);
  return out;
}

/**
 * Checks that leaf indices are exactly 0..n-1 in source order, so they can be
 * used directly as array positions by the rest of the engine.
 */
export function validateTree(root: ConditionNode): ConditionLeaf[] {
  const leaves = collectLeaves(root);
  leaves.forEach((leaf, position) => {
    if (leaf.index !== position) {
      throw new Error(
        `Condition leaves must be indexed 0..n-1 in source order; found index ${leaf.index} at position ${position}`,
      );
    }
  });
  return leaves;
}

export function parentMap(root: ConditionNode): Map<ConditionNode, NotNode | BinaryNode> {
  const parents = new Map<ConditionNode, NotNode | BinaryNode>();
  const visit = (node: ConditionNode): void => {
    if (node.kind === 'not') {
      parents.set(node.operand, node);
      visit(node.operand);
    } else if (node.kind !== 'condition') {
      parents.set(node.left, node);
      parents.set(node.right, node);
      visit(node.left);
      visit(node.right);
    }
  };
  visit(root);
  return parents;
}

/** Evaluates with short-circuit semantics (`&&`/`||` skip the right operand). */
export function evaluate(root: ConditionNode, assignment: GroupAssignment, leafCount: number): Evaluation {
  const values: (boolean | null)[] = new Array<boolean | null>(leafCount).fill(null);
  const order: number[] = [];
  const nodeValues = new Map<ConditionNode, boolean>();

  const visit = (node: ConditionNode): boolean => {
    let result: boolean;
    switch (node.kind) {
      case 'condition': {
        const value = assignment.get(node.group);
        if (value === undefined) {
          throw new Error(`No value assigned for condition group ${node.group}`);
        }
        values[node.index] = value;
        order.push(node.index);
        result = value;
        break;
      }
      case 'not':
        result = !visit(node.operand);
        break;
      case 'and':
        result = visit(node.left) && visit(node.right);
        break;
      case 'or':
        result = visit(node.left) || visit(node.right);
        break;
    }
    nodeValues.set(node, result);
    return result;
  };

  const outcome = visit(root);
  return { outcome, values, order, nodeValues };
}

/**
 * Masking analysis: an evaluated occurrence *determines* the outcome when no
 * ancestor operator masks it, i.e. every `&&` sibling is true (or skipped) and
 * every `||` sibling is false (or skipped). In that case flipping only this
 * occurrence would flip the decision.
 */
export function determiningLeaves(
  leaves: readonly ConditionLeaf[],
  parents: ReadonlyMap<ConditionNode, NotNode | BinaryNode>,
  evaluation: Evaluation,
): boolean[] {
  return leaves.map((leaf) => {
    if (evaluation.values[leaf.index] === null) return false;
    let node: ConditionNode = leaf;
    for (let parent = parents.get(node); parent; node = parent, parent = parents.get(node)) {
      if (parent.kind === 'not') continue;
      const sibling = parent.left === node ? parent.right : parent.left;
      const siblingValue = evaluation.nodeValues.get(sibling);
      if (siblingValue === undefined) continue;
      const controlling = parent.kind === 'and' ? false : true;
      if (siblingValue === controlling) return false;
    }
    return true;
  });
}
