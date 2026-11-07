// Before / after → Flow (T42): the root of the flow as a flow chart on each side, in the swimlanes
// of the box drawer, with the status look of the Architecture subject. One layout of both sides,
// so a box stands in the same place on each. A click on a box of the EPIC opens the box drawer.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Background, BaseEdge, getSmoothStepPath, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow, type EdgeProps, type EdgeTypes, type NodeProps, type NodeTypes } from '@xyflow/react';
import type { Flow, Prd, SystemCompare } from '@rehearse/core';
import { statusLook, type DiffSide } from '../model/architecture.js';
import { KIND_ICON } from '../model/boxdrawer.js';
import { chartZoom, compareElements, detourPath, flowCompareChart, type CompareBoxNode, type FlowCompareChart } from '../model/flowcompare.js';
import { layoutDiagram, type SwimlaneLayout } from '../model/layout.js';
import { Side, StatusBadge } from './ArchitectureView.js';
import { LaneView } from './BoxDiagram.js';
import { BoxCoverageBadge } from './CoverageBadge.js';

function CompareBoxView({ data }: NodeProps<CompareBoxNode>) {
  const { item, status, lit } = data;
  const { box, path, steps, opens } = item;
  const look = statusLook(status);
  const cls = ['box', 'ba-box', `kind-${box.kind}`, look?.className, steps > 0 && 'has-children', opens && 'opens', lit && 'is-lit'].filter(Boolean).join(' ');
  return (
    <div
      className={cls}
      data-testid={`ba-box-${path}`}
      data-status={status ?? ''}
      data-kind={box.kind}
      title={`${path}: ${box.title}${look ? ` (${look.word})` : ''}${item.what && status ? `: ${item.what}` : ''}${opens ? ' — click to open' : ' — not in the flow of this EPIC'}`}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="box-top">
        <span className="box-kind">
          {KIND_ICON[box.kind] ?? '▭'} {box.kind}
        </span>
        <StatusBadge status={status === 'same' ? undefined : status} />
        {opens && <BoxCoverageBadge path={path} testId={`ba-coverage-${path}`} compact />}
      </div>
      <div className="box-title">{box.title}</div>
      {steps > 0 && (
        <div className="box-foot">
          <span className="box-open">▸ {steps} steps</span>
        </div>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

const nodeTypes: NodeTypes = { lane: LaneView, cbox: CompareBoxView };

/** A smooth step, but under the row when a straight line would cross boxes (see `detourPath`). */
function CompareEdgeView(p: EdgeProps) {
  const detour = detourPath(p.sourceX, p.sourceY, p.targetX, p.targetY);
  const [path, labelX, labelY] = detour
    ? [detour.path, detour.labelX, detour.labelY]
    : getSmoothStepPath({ sourceX: p.sourceX, sourceY: p.sourceY, sourcePosition: p.sourcePosition, targetX: p.targetX, targetY: p.targetY, targetPosition: p.targetPosition });
  return (
    <BaseEdge
      id={p.id}
      path={path}
      labelX={labelX}
      labelY={labelY}
      label={p.label}
      labelBgPadding={p.labelBgPadding}
      labelBgBorderRadius={p.labelBgBorderRadius}
      markerEnd={p.markerEnd}
      style={p.style}
      interactionWidth={p.interactionWidth}
    />
  );
}

const edgeTypes: EdgeTypes = { ba: CompareEdgeView };

const PAD = 12;

/** Zoom buttons above the chart, right-aligned, so they never cover a box or a lane label. */
function Tools({ zoom }: { zoom: number }) {
  const rf = useReactFlow();
  return (
    <div className="ba-flow-tools" role="toolbar" aria-label="Zoom the chart">
      <button type="button" className="ba-flow-tool" aria-label="Zoom out" onClick={() => void rf.zoomOut()}>
        −
      </button>
      <button type="button" className="ba-flow-tool" aria-label="Zoom in" onClick={() => void rf.zoomIn()}>
        +
      </button>
      <button type="button" className="ba-flow-tool" aria-label="Back to the start" onClick={() => void rf.setViewport({ x: PAD, y: PAD, zoom })}>
        Reset
      </button>
    </div>
  );
}

function Chart({ chart, layout, side, label, testId, onOpenBox }: { chart: FlowCompareChart; layout: SwimlaneLayout; side: DiffSide; label: string; testId: string; onOpenBox: (path: string) => void }) {
  const [hover, setHover] = useState<string | undefined>();
  const elements = useMemo(() => compareElements(chart, layout, side, hover), [chart, layout, side, hover]);
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const contentW = layout.lanes[0]?.width ?? 1;
  const contentH = layout.lanes.reduce((h, l) => h + l.height, 0);
  const { zoom, more } = chartZoom((width || 1200) - 2 * PAD, contentW);
  const height = Math.ceil(contentH * zoom + 2 * PAD);
  return (
    <ReactFlowProvider>
      <Tools zoom={zoom} />
      <div
        ref={wrap}
        className={`canvas ba-flow-chart${more ? ' has-more' : ''}`}
        data-testid={testId}
        role="group"
        aria-label={label}
        style={{ height }}
        data-hover={hover ?? ''}
        data-zoom={zoom.toFixed(2)}
      >
        <ReactFlow
          key={`${side} ${zoom.toFixed(3)}`}
          defaultViewport={{ x: PAD, y: PAD, zoom }}
          nodes={elements.nodes}
          edges={elements.edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          edgesFocusable={false}
          minZoom={0.2}
          zoomOnScroll={false}
          preventScrolling={false}
          proOptions={{ hideAttribution: true }}
          onNodeMouseEnter={(_, n) => n.type === 'cbox' && setHover((n as CompareBoxNode).data.item.path)}
          onNodeMouseLeave={() => setHover(undefined)}
          onNodeClick={(_, n) => {
            if (n.type !== 'cbox') return;
            const item = (n as CompareBoxNode).data.item;
            if (item.opens) onOpenBox(item.path);
          }}
        >
          <Background gap={24} size={1} />
        </ReactFlow>
        {more && (
          <p className="ba-flow-more" data-testid={`${testId}-more`} aria-hidden="true">
            drag to see more →
          </p>
        )}
      </div>
    </ReactFlowProvider>
  );
}

export type FlowMode = 'side' | 'diff' | 'before';

export interface FlowCompareProps {
  c: SystemCompare;
  asIs: Flow | undefined;
  epic: Flow | undefined;
  prd: Prd | undefined;
  mode: FlowMode;
  onOpenBox: (path: string) => void;
}

export function FlowCompare({ c, asIs, epic, prd, mode, onOpenBox }: FlowCompareProps) {
  const chart = useMemo(() => flowCompareChart(c, asIs, epic, prd), [c, asIs, epic, prd]);
  const [layout, setLayout] = useState<SwimlaneLayout | undefined>();
  useEffect(() => {
    let live = true;
    layoutDiagram(chart.diagram, chart.lanes).then(
      (l) => live && setLayout(l),
      () => live && setLayout({ lanes: [], boxes: [] }),
    );
    return () => {
      live = false;
    };
  }, [chart]);

  if (chart.boxes.length === 0) return <p className="muted small" data-testid="ba-flow-empty">Neither flow has a box to draw.</p>;
  const draw = (side: DiffSide, label: string) =>
    !layout ? (
      <p className="muted gd-status">Laying out the flow…</p>
    ) : side === 'before' && !chart.boxes.some((b) => b.onBefore) ? (
      <p className="muted small" data-testid="ba-flow-before-none">
        The repo has no <code>docs/system/flow.yaml</code>, so there is no flow as built to draw.
      </p>
    ) : (
      <Chart chart={chart} layout={layout} side={side} label={label} testId={`ba-flow-${side}`} onOpenBox={onOpenBox} />
    );
  const hint = (
    <p className="muted small ba-flow-hint">
      The root of the flow, one lane per role. A box with steps opens in the box drawer; hover a box to light its edges.
    </p>
  );
  // No flow as built: every box of the EPIC is new, and the chart says why.
  const allNew = !chart.boxes.some((b) => b.onBefore) && (
    <p className="small ba-flow-all-new" data-testid="ba-flow-all-new">
      The repo has no <code>docs/system/flow.yaml</code>, so every box of this EPIC is new.
    </p>
  );
  if (mode === 'diff') return (
    <>
      {hint}
      {allNew}
      {draw('diff', 'After with diff: every box and edge of the flow with its status')}
    </>
  );
  if (mode === 'before') return <Side title="Before · as-is, docs/system/flow.yaml">{draw('before', 'Before: the flow as built')}</Side>;
  return (
    <>
      {hint}
      {allNew}
      <div className={`ba-sides ba-flow-sides${chart.boxes.some((b) => b.onBefore) ? '' : ' is-before-none'}`}>
        <Side title="Before · as-is, docs/system/flow.yaml">{draw('before', 'Before: the flow as built')}</Side>
        <Side title="After · to-be with this EPIC" after>
          {draw('after', 'After: the flow with this EPIC')}
        </Side>
      </div>
    </>
  );
}
