// Draws a laid-out diagram graph (model/graph.ts) as SVG: the shapes of the user flow, data flow
// and system flowchart. Every node with a box path is a button that opens the box in the flow
// view; a folded step has one button per box. Layout comes from the model; this only draws.

import { useEffect, useState } from 'react';
import { edgeLabelText, titleLines, type DEdge, type DGraph, type DNode, type GraphLayout, type Rect } from '../model/graph.js';
import { svgButton } from './svg.js';

export type LayoutState = { kind: 'busy' } | { kind: 'ready'; layout: GraphLayout } | { kind: 'error'; message: string };

/** Lay out `graph` with `layout` (async, ELK) each time the graph changes. */
export function useGraphLayout(graph: DGraph, layout: (g: DGraph) => Promise<GraphLayout>): LayoutState {
  const [state, setState] = useState<{ graph: DGraph; state: LayoutState } | undefined>();
  useEffect(() => {
    let live = true;
    layout(graph).then(
      (l) => live && setState({ graph, state: { kind: 'ready', layout: l } }),
      (e: unknown) => live && setState({ graph, state: { kind: 'error', message: e instanceof Error ? e.message : String(e) } }),
    );
    return () => {
      live = false;
    };
  }, [graph, layout]);
  return state && state.graph === graph ? state.state : { kind: 'busy' };
}

const KIND_WORDS: Record<string, string> = {
  start: 'start',
  end: 'end',
  screen: 'screen',
  action: 'user action',
  decision: 'decision',
  entity: 'external entity',
  process: 'process',
  store: 'data store',
  step: 'program step',
  terminal: 'start or end',
  document: 'output document',
  connector: 'box of another lane',
};

function pathD(points: { x: number; y: number }[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
}

function Lines({ lines, x, y, anchor = 'middle', className = 'gd-title' }: { lines: string[]; x: number; y: number; anchor?: 'start' | 'middle'; className?: string }) {
  return (
    <>
      {lines.map((t, i) => (
        <text key={i} x={x} y={y + i * 14} textAnchor={anchor} className={className}>
          {t}
        </text>
      ))}
    </>
  );
}

function Shape({ node, r }: { node: DNode; r: Rect }) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const lines = titleLines(node);
  const midText = (top: number) => <Lines lines={lines} x={cx} y={top} />;
  switch (node.shape) {
    case 'start':
    case 'end':
      return (
        <>
          {node.shape === 'end' && <circle cx={cx} cy={cy} r={r.w / 2} className="gd-dot-ring" />}
          <circle cx={cx} cy={cy} r={node.shape === 'end' ? r.w / 2 - 5 : r.w / 2} className="gd-dot" />
          {node.tag && (
            <text x={cx} y={r.y + r.h + 14} textAnchor="middle" className="gd-tag">
              {node.tag}
            </text>
          )}
          <Lines lines={lines} x={cx} y={r.y + r.h + (node.tag ? 28 : 14)} className="gd-dot-label" />
        </>
      );
    case 'decision':
      return (
        <>
          <polygon points={`${cx},${r.y} ${r.x + r.w},${cy} ${cx},${r.y + r.h} ${r.x},${cy}`} className="gd-shape" />
          {node.tag && (
            <text x={cx} y={cy - 16} textAnchor="middle" className="gd-tag">
              {node.tag}
            </text>
          )}
          {midText(cy + (lines.length === 1 ? 4 : -3))}
        </>
      );
    case 'store':
      return (
        <>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} className="gd-store-bg" />
          <path d={`M${r.x + r.w},${r.y} H${r.x} V${r.y + r.h} H${r.x + r.w} M${r.x + 40},${r.y} V${r.y + r.h}`} className="gd-shape gd-open" />
          <text x={r.x + 20} y={cy + 4} textAnchor="middle" className="gd-tag">
            {node.tag}
          </text>
          <text x={r.x + 50} y={cy + 4} className="gd-title">
            {node.title}
          </text>
        </>
      );
    case 'process':
      return (
        <>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={12} className="gd-shape" />
          <line x1={r.x} x2={r.x + r.w} y1={r.y + 24} y2={r.y + 24} className="gd-rule" />
          <text x={cx} y={r.y + 16} textAnchor="middle" className="gd-number">
            {node.tag}
          </text>
          {midText(r.y + 42)}
        </>
      );
    case 'entity':
      return (
        <>
          <rect x={r.x + 4} y={r.y + 4} width={r.w} height={r.h} className="gd-entity-shadow" />
          <rect x={r.x} y={r.y} width={r.w} height={r.h} className="gd-shape" />
          <text x={cx} y={cy} textAnchor="middle" className="gd-title">
            {node.title}
          </text>
          <text x={cx} y={cy + 14} textAnchor="middle" className="gd-tag">
            {node.tag}
          </text>
        </>
      );
    case 'document': {
      const b = r.y + r.h - 8;
      return (
        <>
          <path d={`M${r.x},${r.y} H${r.x + r.w} V${b} C${r.x + r.w * 0.75},${b - 12} ${r.x + r.w * 0.25},${b + 12} ${r.x},${b} Z`} className="gd-shape" />
          {midText(r.y + 18)}
        </>
      );
    }
    default: {
      const rx = node.shape === 'terminal' ? r.h / 2 : node.shape === 'action' ? 14 : node.shape === 'connector' ? 4 : 6;
      const top = node.tag ? r.y + 30 : r.y + 20;
      return (
        <>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={rx} className="gd-shape" />
          {node.tag && (
            <text x={cx} y={r.y + 14} textAnchor="middle" className="gd-tag">
              {node.shape === 'connector' ? `→ ${node.tag}` : node.tag}
            </text>
          )}
          {midText(node.tag ? top - 2 : top + (lines.length === 1 ? 4 : 0))}
        </>
      );
    }
  }
}

function FoldView({ node, r, testid, onOpenBox }: { node: DNode; r: Rect; testid: string; onOpenBox: (path: string) => void }) {
  return (
    <g className="gd-node shape-fold" data-testid={testid} data-shape="fold">
      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={8} className="gd-shape" />
      <text x={r.x + 10} y={r.y + 17} className="gd-fold-title">
        {node.title}
      </text>
      <text x={r.x + r.w - 10} y={r.y + 17} textAnchor="end" className="gd-tag">
        {node.tag}
      </text>
      {node.rows!.map((row, i) => (
        <g
          key={row.path}
          className="gd-row"
          data-testid={`${testid}-row-${row.path}`}
          {...svgButton(`Open box ${row.title} (${row.path}, ${row.lane}) in the flow view`, () => onOpenBox(row.path))}
        >
          <rect x={r.x + 4} y={r.y + 24 + i * 18} width={r.w - 8} height={17} rx={3} className="gd-row-bg" />
          <text x={r.x + 10} y={r.y + 36 + i * 18} className="gd-row-text">
            ▸ {edgeLabelText(row.title)}
          </text>
        </g>
      ))}
    </g>
  );
}

export interface GraphDiagramProps {
  /** Test id prefix: `uf`, `df` or `sf`. */
  prefix: string;
  label: string;
  graph: DGraph;
  layout: GraphLayout;
  onOpenBox: (path: string) => void;
}

export function GraphDiagram({ prefix, label, graph, layout, onOpenBox }: GraphDiagramProps) {
  const byId = new Map(graph.edges.map((e) => [e.id, e]));
  const marker = `${prefix}-arrow`;
  return (
    <svg className="gd" role="group" aria-label={label} viewBox={`0 0 ${layout.width} ${layout.height}`} width={layout.width} height={layout.height} data-testid={`${prefix}-svg`}>
      <defs>
        <marker id={marker} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="gd-arrow" />
        </marker>
      </defs>
      {graph.groups.map((g) => {
        const r = layout.groups[g.id];
        if (!r) return null;
        const open = g.path;
        return (
          <g key={g.id} className={`gd-group gd-${g.kind}`} data-testid={`${prefix}-group-${g.id}`}>
            <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={8} />
            {open ? (
              <text x={r.x + 10} y={r.y + 19} className="gd-group-title gd-link" {...svgButton(`Open box ${g.title} (${open}) in the flow view`, () => onOpenBox(open))} data-testid={`${prefix}-node-${open}`}>
                {g.title} ▸
              </text>
            ) : (
              <text x={r.x + 10} y={r.y + 19} className="gd-group-title">
                {g.title}
              </text>
            )}
          </g>
        );
      })}
      {layout.edges.map((le) => {
        const e: DEdge | undefined = byId.get(le.id);
        if (!e || le.points.length < 2) return null;
        return (
          <g key={le.id} className={`gd-edge edge-${e.kind}`} data-testid={`${prefix}-edge-${e.from}-${e.to}`} aria-hidden="true">
            <path d={pathD(le.points)} markerEnd={`url(#${marker})`} />
            {e.label && le.label && (
              <>
                <rect x={le.label.x - 2} y={le.label.y - 1} width={le.label.w + 4} height={le.label.h + 2} rx={3} className="gd-edge-label-bg" />
                <text x={le.label.x + le.label.w / 2} y={le.label.y + le.label.h - 3} textAnchor="middle" className="gd-edge-label">
                  {edgeLabelText(e.label)}
                </text>
              </>
            )}
          </g>
        );
      })}
      {graph.nodes.map((n) => {
        const r = layout.nodes[n.id];
        if (!r) return null;
        const testid = `${prefix}-node-${n.id}`;
        if (n.shape === 'fold') return <FoldView key={n.id} node={n} r={r} testid={testid} onOpenBox={onOpenBox} />;
        const words = `${n.tag ? `${n.tag} ` : ''}${n.title}, ${KIND_WORDS[n.shape] ?? n.shape}`;
        const open = n.path;
        return (
          <g
            key={n.id}
            className={`gd-node shape-${n.shape}${open ? ' gd-link' : ''}`}
            data-testid={testid}
            data-shape={n.shape}
            {...(open ? svgButton(`Open box ${words} (${open}) in the flow view`, () => onOpenBox(open)) : {})}
          >
            <title>{words}</title>
            <Shape node={n} r={r} />
          </g>
        );
      })}
    </svg>
  );
}

/** A legend entry: a small drawing of the shape and its name. */
export function LegendItem({ shape, children }: { shape: string; children: string }) {
  return (
    <li className="gd-legend-item">
      <svg width={30} height={18} aria-hidden="true" className={`gd-legend-swatch shape-${shape}`}>
        {shape === 'decision' ? (
          <polygon points="15,1 29,9 15,17 1,9" className="gd-shape" />
        ) : shape === 'start' || shape === 'end' ? (
          <circle cx={15} cy={9} r={7} className="gd-dot" />
        ) : shape === 'flow' || shape === 'error' ? (
          <line x1={2} y1={9} x2={28} y2={9} className={`gd-legend-line edge-${shape}`} />
        ) : (
          <rect x={2} y={2} width={26} height={14} rx={shape === 'action' || shape === 'process' ? 6 : 2} className="gd-shape" />
        )}
      </svg>
      {children}
    </li>
  );
}
