import type { CfgLayout, LaidOutNode } from '../cfg/layout';
import type { CfgNode, FunctionModel } from '../model/types';
import { s } from './dom';

export interface CfgSvgOptions {
  /** Prefix for marker ids, unique per SVG in a document. */
  readonly idPrefix: string;
  /** Makes nodes interactive; omitted for static output such as the report. */
  readonly onActivate?: (node: CfgNode) => void;
}

/** Draws a laid-out control-flow graph. Shared by the app and the HTML report. */
export function renderCfgSvg(layout: CfgLayout, fn: FunctionModel, options: CfgSvgOptions): SVGSVGElement {
  const { idPrefix } = options;
  const reachable = new Set([fn.cfg.entry, ...fn.cfg.edges.map((edge) => edge.to)]);

  const edges = layout.edges.map((laidOut) => {
    const d = laidOut.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    const classes = ['cfg-edge', `kind-${laidOut.edge.kind}`, laidOut.edge.back ? 'is-back' : ''].join(' ');
    return s('g', { class: classes, 'data-edge': laidOut.index }, [
      s('path', { d, 'marker-end': `url(#${idPrefix}-arrow)` }),
      laidOut.label ? s('text', { x: laidOut.label.x, y: laidOut.label.y, class: 'edge-label' }, [laidOut.label.text]) : null,
    ]);
  });

  const nodes = layout.nodes.map((laidOut) => drawNode(laidOut, reachable.has(laidOut.node.id), options));

  return s(
    'svg',
    {
      class: 'cfg-svg',
      viewBox: `0 0 ${layout.width} ${layout.height}`,
      width: layout.width,
      height: layout.height,
      role: 'img',
      'aria-label': `Control-flow graph of ${fn.name}`,
      'data-fn': fn.id,
      'data-arrow': idPrefix,
    },
    [arrowDefs(idPrefix, 7), s('g', {}, edges), s('g', {}, nodes)],
  );
}

/** Default and path-coloured arrowheads, referenced as `#<prefix>-arrow[-path]`. */
export function arrowDefs(idPrefix: string, size: number): SVGDefsElement {
  const arrow = (suffix: string, className: string): SVGMarkerElement =>
    s(
      'marker',
      {
        id: `${idPrefix}${suffix}`,
        class: className,
        viewBox: '0 0 10 10',
        refX: 9,
        refY: 5,
        markerWidth: size,
        markerHeight: size,
        orient: 'auto-start-reverse',
      },
      [s('path', { d: 'M 0 0 L 10 5 L 0 10 z' })],
    );
  return s('defs', {}, [arrow('-arrow', 'arrow'), arrow('-arrow-path', 'arrow arrow-path')]);
}

function drawNode(laidOut: LaidOutNode, reachable: boolean, options: CfgSvgOptions): SVGGElement {
  const { node, x, y, width: w, height: hgt } = laidOut;
  const shape =
    node.kind === 'decision'
      ? s('path', { d: `M 12 0 H ${w - 12} L ${w} ${hgt / 2} L ${w - 12} ${hgt} H 12 L 0 ${hgt / 2} Z` })
      : s('rect', { width: w, height: hgt, rx: node.kind === 'entry' || node.kind === 'exit' ? hgt / 2 : 5 });
  const nested = node.decisionIds.filter((id) => id !== node.decisionId);
  const badgeWidth = nested.length > 0 ? 26 : 0;
  const clickable = options.onActivate !== undefined && node.kind !== 'entry' && node.kind !== 'exit';
  const hint =
    node.kind === 'decision'
      ? 'Click to inspect this decision'
      : nested.length > 0
        ? `Contains ${nested.length} expression decision${nested.length > 1 ? 's' : ''} — click to inspect`
        : 'Click to show a path through here';
  const title = [node.label, clickable ? hint : null, reachable ? null : '(unreachable)'].filter(Boolean).join('\n');

  const group = s(
    'g',
    {
      class: `cfg-node kind-${node.kind}${reachable ? '' : ' is-unreachable'}${clickable ? ' is-clickable' : ''}`,
      transform: `translate(${x} ${y})`,
      'data-node': node.id,
      tabindex: clickable ? 0 : undefined,
      role: clickable ? 'button' : undefined,
    },
    [
      s('title', {}, [title]),
      shape,
      s('text', { x: (w - badgeWidth) / 2, y: hgt / 2, class: 'node-label' }, [node.label]),
      nested.length > 0
        ? s('g', { class: 'node-badge', transform: `translate(${w - 22} ${hgt / 2 - 8})` }, [
            s('rect', { width: 16, height: 16, rx: 8 }),
            s('text', { x: 8, y: 8 }, [String(nested.length)]),
          ])
        : null,
    ],
  );

  const { onActivate } = options;
  if (clickable && onActivate) {
    group.addEventListener('click', () => onActivate(node));
    group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onActivate(node);
      }
    });
  }
  return group;
}
