import type { DecisionAnalysis, GraphTarget, TestRow } from '../engine';
import type { DecisionModel } from '../model/types';
import { arrowDefs } from './cfgSvg';
import { s } from './dom';
import { conditionLabel } from './labels';

const SPACING = 84;
const RADIUS = 16;
const PAD_X = 28;
const MID = 84;
const OUTCOME_OFFSET = 46;

interface Options {
  readonly decision: DecisionModel;
  readonly result: DecisionAnalysis;
  readonly row: TestRow | null;
  readonly conditionIndex: number | null;
  /** Prefix for marker ids, unique per SVG in a document. */
  readonly idPrefix: string;
  /** Makes condition nodes interactive; omitted for static output such as the report. */
  readonly onSelectCondition?: (index: number) => void;
}

/**
 * Short-circuit flow inside one decision. Conditions sit left to right in
 * source order; true edges arc above, false edges below, and the selected
 * test's route is drawn in the path colour.
 */
export function renderConditionGraph({
  decision,
  result,
  row,
  conditionIndex,
  idPrefix,
  onSelectCondition,
}: Options): SVGSVGElement {
  const marker = (onPath: boolean): string => `url(#${idPrefix}-arrow${onPath ? '-path' : ''})`;
  const n = result.conditionCount;
  const outcomeX = PAD_X + n * SPACING + 16;
  const width = outcomeX + RADIUS + PAD_X;
  const height = MID * 2;
  const uncoverable = new Set(result.uncoverable);
  const x = (index: number): number => PAD_X + RADIUS + index * SPACING;
  const outcomeY = (value: boolean): number => MID + (value ? -OUTCOME_OFFSET : OUTCOME_OFFSET);

  // Edges taken by the selected row: each evaluated condition follows its value.
  const taken = new Set<string>();
  const visited = new Set<number>(row?.order);
  if (row) for (const index of row.order) taken.add(`${index}:${row.values[index] ? 'T' : 'F'}`);

  const edgePath = (from: number, branch: boolean, target: GraphTarget): string => {
    const sx = x(from);
    const sy = MID + (branch ? -RADIUS : RADIUS);
    if (target.kind === 'condition') {
      const tx = x(target.index);
      const ty = MID + (branch ? -RADIUS : RADIUS);
      const lift = Math.min(22 + 16 * (target.index - from - 1), 70) * (branch ? -1 : 1);
      return `M ${sx} ${sy} C ${sx + 10} ${sy + lift}, ${tx - 10} ${ty + lift}, ${tx} ${ty}`;
    }
    const tx = outcomeX - RADIUS;
    const ty = outcomeY(target.value);
    const lift = (branch ? -1 : 1) * 30;
    return `M ${sx} ${sy} C ${sx + 18} ${sy + lift}, ${tx - 40} ${ty}, ${tx} ${ty}`;
  };

  const edges = result.graph.nodes.flatMap((node) =>
    ([true, false] as const).map((branch) => {
      const target = branch ? node.onTrue : node.onFalse;
      const on = taken.has(`${node.index}:${branch ? 'T' : 'F'}`);
      const labelX = x(node.index) + (branch ? 12 : 12);
      const labelY = MID + (branch ? -RADIUS - 10 : RADIUS + 14);
      return s('g', { class: `cg-edge ${branch ? 'is-true' : 'is-false'}${on ? ' on-path' : ''}`, 'data-branch': `${node.index}:${branch ? 'T' : 'F'}` }, [
        s('path', { d: edgePath(node.index, branch, target), 'marker-end': marker(on) }),
        s('text', { x: labelX, y: labelY, class: 'edge-label' }, [branch ? 'T' : 'F']),
      ]);
    }),
  );

  const entry = result.graph.entry;
  const entryEdge =
    entry.kind === 'condition'
      ? s('path', {
          class: `cg-entry${row ? ' on-path' : ''}`,
          d: `M ${x(entry.index) - RADIUS - 22} ${MID} H ${x(entry.index) - RADIUS - 1}`,
          'marker-end': marker(row !== null),
        })
      : null;

  const nodes = decision.conditions.map((condition) => {
    const classes = ['cg-node'];
    if (row && visited.has(condition.index)) classes.push('on-path');
    if (row && !visited.has(condition.index)) classes.push('is-skipped');
    if (conditionIndex === condition.index) classes.push('is-focused');
    if (uncoverable.has(condition.index)) classes.push('is-uncoverable');
    const group = s(
      'g',
      {
        class: classes.join(' '),
        transform: `translate(${x(condition.index)} ${MID})`,
        'data-cond': condition.index,
        tabindex: onSelectCondition ? 0 : undefined,
        role: onSelectCondition ? 'button' : undefined,
        'aria-label': `${conditionLabel(condition.index)}: ${condition.text}`,
      },
      [
        s('title', {}, [`${conditionLabel(condition.index)}: ${condition.text}`]),
        s('circle', { r: RADIUS }),
        s('text', { class: 'node-label' }, [conditionLabel(condition.index)]),
      ],
    );
    if (onSelectCondition) {
      group.addEventListener('click', () => onSelectCondition(condition.index));
      group.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelectCondition(condition.index);
        }
      });
    }
    return group;
  });

  const outcomes = ([true, false] as const).map((value) =>
    s('g', { class: `cg-outcome${row?.outcome === value ? ' on-path' : ''}`, transform: `translate(${outcomeX} ${outcomeY(value)})`, 'data-outcome': String(value) }, [
      s('title', {}, [`Decision outcome: ${value}`]),
      s('rect', { x: -RADIUS, y: -13, width: RADIUS * 2 + 8, height: 26, rx: 13 }),
      s('text', { x: 4, class: 'node-label' }, [value ? 'true' : 'false']),
    ]),
  );

  return s(
    'svg',
    {
      class: 'condition-graph',
      viewBox: `0 0 ${width + 8} ${height}`,
      width: width + 8,
      height,
      role: 'img',
      'aria-label': `Short-circuit flow of ${decision.text}`,
      'data-decision': decision.id,
      'data-arrow': idPrefix,
    },
    [arrowDefs(idPrefix, 6), entryEdge, ...edges, ...nodes, ...outcomes],
  );
}
