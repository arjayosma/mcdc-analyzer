import type { ConditionNode } from './conditionTree';

export type GraphTarget =
  | { readonly kind: 'condition'; readonly index: number }
  | { readonly kind: 'outcome'; readonly value: boolean };

export interface ConditionGraphNode {
  readonly index: number;
  readonly onTrue: GraphTarget;
  readonly onFalse: GraphTarget;
}

/**
 * Short-circuit control flow inside one decision: each condition occurrence
 * jumps to the next condition to evaluate, or straight to an outcome.
 */
export interface ConditionGraph {
  readonly entry: GraphTarget;
  /** Indexed by condition occurrence. */
  readonly nodes: readonly ConditionGraphNode[];
}

export function buildConditionGraph(root: ConditionNode, leafCount: number): ConditionGraph {
  const nodes = new Array<ConditionGraphNode>(leafCount);

  // Returns the entry point of `node` given where its true/false results flow.
  const link = (node: ConditionNode, onTrue: GraphTarget, onFalse: GraphTarget): GraphTarget => {
    switch (node.kind) {
      case 'condition':
        nodes[node.index] = { index: node.index, onTrue, onFalse };
        return { kind: 'condition', index: node.index };
      case 'not':
        return link(node.operand, onFalse, onTrue);
      case 'and':
        return link(node.left, link(node.right, onTrue, onFalse), onFalse);
      case 'or':
        return link(node.left, onTrue, link(node.right, onTrue, onFalse));
    }
  };

  const entry = link(root, { kind: 'outcome', value: true }, { kind: 'outcome', value: false });
  return { entry, nodes };
}
