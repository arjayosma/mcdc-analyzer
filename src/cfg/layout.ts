import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import type { CfgEdge, CfgNode, ControlFlowGraph } from '../model/types';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface LaidOutNode {
  readonly node: CfgNode;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LaidOutEdge {
  readonly index: number;
  readonly edge: CfgEdge;
  readonly points: readonly Point[];
  readonly label?: { readonly text: string } & Point;
}

export interface CfgLayout {
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly LaidOutNode[];
  readonly edges: readonly LaidOutEdge[];
}

const CHAR_WIDTH = 7.4;
const LABEL_HEIGHT = 14;

export function edgeLabel(edge: CfgEdge): string | undefined {
  if (edge.label !== undefined) return edge.label;
  if (edge.kind === 'true') return 'T';
  if (edge.kind === 'false') return 'F';
  return undefined;
}

export function nodeSize(node: CfgNode): { width: number; height: number } {
  const badge = node.decisionIds.length > (node.decisionId ? 1 : 0) ? 26 : 0;
  const width = Math.min(Math.max(node.label.length * CHAR_WIDTH + 28 + badge, 64), 340);
  return { width, height: node.kind === 'decision' ? 36 : 30 };
}

let elkInstance: Promise<{ layout(graph: ElkNode): Promise<ElkNode> }> | null = null;

/** Loads elkjs on first use so it is split out of the initial bundle. */
function elk(): Promise<{ layout(graph: ElkNode): Promise<ElkNode> }> {
  elkInstance ??= import('elkjs/lib/elk.bundled.js').then(({ default: ELK }) => new ELK());
  return elkInstance;
}

/** Layered top-to-bottom layout with orthogonal edges, as in a flowchart. */
export async function layoutCfg(cfg: ControlFlowGraph): Promise<CfgLayout> {
  const edges: ElkExtendedEdge[] = cfg.edges.map((edge, index) => {
    const text = edgeLabel(edge);
    return {
      id: `e${index}`,
      sources: [edge.from],
      targets: [edge.to],
      ...(text !== undefined ? { labels: [{ text, width: text.length * 6.5 + 6, height: LABEL_HEIGHT }] } : {}),
    };
  });

  const result = await (await elk()).layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.spacing.nodeNodeBetweenLayers': '34',
      'elk.spacing.nodeNode': '28',
      'elk.spacing.edgeNode': '16',
      'elk.spacing.edgeLabel': '4',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      // Nodes are in source order, so edges to earlier nodes are the loop back-edges.
      'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
      'elk.padding': '[top=16,left=16,bottom=16,right=16]',
    },
    children: cfg.nodes.map((node) => ({
      id: node.id,
      ...nodeSize(node),
      ...(node.kind === 'entry' || node.kind === 'exit'
        ? { layoutOptions: { 'elk.layered.layering.layerConstraint': node.kind === 'entry' ? 'FIRST' : 'LAST' } }
        : {}),
    })),
    edges,
  });

  const byId = new Map(cfg.nodes.map((node) => [node.id, node]));
  const nodes: LaidOutNode[] = (result.children ?? []).flatMap((child) => {
    const node = byId.get(child.id);
    return node ? [{ node, x: child.x ?? 0, y: child.y ?? 0, width: child.width ?? 0, height: child.height ?? 0 }] : [];
  });

  const laidOutEdges: LaidOutEdge[] = (result.edges ?? []).flatMap((elkEdge) => {
    const index = Number(elkEdge.id.slice(1));
    const edge = cfg.edges[index];
    if (!edge) return [];
    const points = (elkEdge.sections ?? []).flatMap((section) => [
      section.startPoint,
      ...(section.bendPoints ?? []),
      section.endPoint,
    ]);
    const label = elkEdge.labels?.[0];
    return [
      {
        index,
        edge,
        points,
        ...(label?.text !== undefined
          ? { label: { text: label.text, x: (label.x ?? 0) + (label.width ?? 0) / 2, y: (label.y ?? 0) + LABEL_HEIGHT / 2 } }
          : {}),
      },
    ];
  });

  return { width: result.width ?? 0, height: result.height ?? 0, nodes, edges: laidOutEdges };
}
