import type { CfgEdge, CfgNode, ControlFlowGraph } from '../model/types';

export interface CfgPath {
  readonly nodes: readonly string[];
  /** Indices into `cfg.edges`, in path order. */
  readonly edges: readonly number[];
}

/**
 * A representative entry → exit path through `through`. When `outcome` is
 * given, the path leaves `through` on its true/false edge. Each segment is a
 * shortest path that avoids loop back-edges where possible, so the result is
 * the simplest concrete path a test with that outcome could take.
 */
export function examplePath(cfg: ControlFlowGraph, through: string, outcome?: boolean): CfgPath | null {
  const toTarget = shortestPath(cfg, cfg.entry, through);
  if (!toTarget) return null;

  const nodes = [...toTarget.nodes];
  const edges = [...toTarget.edges];
  let current = through;

  if (outcome !== undefined) {
    const kind = outcome ? 'true' : 'false';
    const branch = cfg.edges.findIndex((edge) => edge.from === through && edge.kind === kind);
    const edge = cfg.edges[branch];
    if (!edge) return { nodes, edges };
    edges.push(branch);
    nodes.push(edge.to);
    current = edge.to;
  }

  const toExit = shortestPath(cfg, current, cfg.exit);
  if (toExit) {
    nodes.push(...toExit.nodes.slice(1));
    edges.push(...toExit.edges);
  }
  return { nodes, edges };
}

/** The CFG node that hosts a decision: its branch node, or the block containing it. */
export function decisionHost(cfg: ControlFlowGraph, decisionId: string): CfgNode | null {
  return (
    cfg.nodes.find((node) => node.decisionId === decisionId) ??
    cfg.nodes.find((node) => node.decisionIds.includes(decisionId)) ??
    null
  );
}

/**
 * Example path for a test of a decision. Branch decisions leave on the test's
 * outcome; expression decisions inside a block just pass through it.
 */
export function decisionPath(cfg: ControlFlowGraph, decisionId: string, outcome: boolean | undefined): CfgPath | null {
  const host = decisionHost(cfg, decisionId);
  if (!host) return null;
  return examplePath(cfg, host.id, host.kind === 'decision' ? outcome : undefined);
}

function shortestPath(cfg: ControlFlowGraph, from: string, to: string): CfgPath | null {
  return bfs(cfg, from, to, (edge) => !edge.back) ?? bfs(cfg, from, to, () => true);
}

function bfs(cfg: ControlFlowGraph, from: string, to: string, allow: (edge: CfgEdge) => boolean): CfgPath | null {
  const via = new Map<string, number | null>([[from, null]]);
  const queue = [from];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) break;
    if (node === to) {
      const nodes: string[] = [];
      const edges: number[] = [];
      for (let at: string | undefined = to; at !== undefined; ) {
        nodes.unshift(at);
        const edgeIndex = via.get(at);
        if (edgeIndex === null || edgeIndex === undefined) break;
        edges.unshift(edgeIndex);
        at = cfg.edges[edgeIndex]?.from;
      }
      return { nodes, edges };
    }
    cfg.edges.forEach((edge, index) => {
      if (edge.from === node && !via.has(edge.to) && allow(edge)) {
        via.set(edge.to, index);
        queue.push(edge.to);
      }
    });
  }
  return null;
}
