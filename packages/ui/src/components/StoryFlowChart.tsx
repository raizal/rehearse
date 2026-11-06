// The storyboard's flowchart (S6-A1, S5-A1, T37): the scenario's path as React Flow nodes in lane
// columns, laid out by model/storyflow.ts. Each step is a button (a diamond for a decision); the
// edges the path takes are solid, with the branch label; the branches not taken are dashed and
// lead to faded boxes. Only the current step is in the tab order; the arrow keys move along the
// path (the caller handles them). The canvas fits its width and follows the current step.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, useReactFlow, useStore, type Edge, type Node, type NodeProps, type NodeTypes } from '@xyflow/react';
import { SF, type SfGhost, type SfLaidLane, type SfLayout, type SfStep, type StoryFlow } from '../model/storyflow.js';

interface StepData extends Record<string, unknown> {
  step: SfStep;
  total: number;
  color: string;
  laneLabel: string;
  current: boolean;
  seen: boolean;
  /** Steps before the current one: the part of the path already played. */
  played: boolean;
  onPick: (index: number) => void;
  onKey: (index: number, e: KeyboardEvent<HTMLButtonElement>) => void;
  refFn: (index: number, el: HTMLButtonElement | null) => void;
}
interface GhostData extends Record<string, unknown> {
  ghost: SfGhost;
  color: string;
}
interface LaneData extends Record<string, unknown> {
  lane: SfLaidLane;
  height: number;
}

type StepNode = Node<StepData, 'sfstep'>;
type GhostNode = Node<GhostData, 'sfghost'>;
type LaneNode = Node<LaneData, 'sflane'>;

/** What a screen reader hears for a step node; ends with ", seen" once seen. */
export function stepLabel(step: SfStep, total: number, laneLabel: string, seen: boolean): string {
  const kind = step.decision ? 'decision' : 'step';
  const branch = step.branch !== undefined ? `, takes "${step.branch}"` : '';
  return `Step ${step.index + 1} of ${total}: ${step.title} (${laneLabel} ${kind})${branch}${seen ? ', seen' : ''}`;
}

function StepView({ data }: NodeProps<StepNode>) {
  const { step, total, color, laneLabel, current, seen, played, onPick, onKey, refFn } = data;
  const n = step.index + 1;
  const cls = ['sf-node', step.decision ? 'is-decision' : 'is-step', current && 'is-current', seen && 'is-seen', played && 'is-played', 'nopan', 'nodrag'].filter(Boolean).join(' ');
  return (
    <>
      <Handle type="target" id="t" position={Position.Top} isConnectable={false} />
      <button
        type="button"
        ref={(el) => refFn(step.index, el)}
        className={cls}
        // React Flow turns pointer events off on nodes that are not selectable or draggable.
        style={{ ['--lane' as string]: color, pointerEvents: 'all' }}
        tabIndex={current ? 0 : -1}
        data-testid={`card-step-${n}`}
        data-step={step.index}
        aria-current={current ? 'step' : undefined}
        aria-label={stepLabel(step, total, laneLabel, seen)}
        onClick={() => onPick(step.index)}
        onKeyDown={(e) => onKey(step.index, e)}
      >
        {step.decision && (
          <svg className="sf-diamond" viewBox={`0 0 ${SF.diamondW} ${SF.diamondH}`} preserveAspectRatio="none" aria-hidden="true">
            <polygon points={`${SF.diamondW / 2},2 ${SF.diamondW - 2},${SF.diamondH / 2} ${SF.diamondW / 2},${SF.diamondH - 2} 2,${SF.diamondH / 2}`} />
          </svg>
        )}
        <span className="sf-node-body">
          <span className="sf-node-top">
            <span className="sf-badge">{n}</span>
            {seen && (
              <span className="sf-seen" aria-hidden="true">
                ✓
              </span>
            )}
          </span>
          <span className="sf-node-text">
            <span className="sf-title" data-testid={`card-node-title-${n}`}>
              {step.title}
            </span>
            {step.inside !== undefined && !step.decision && <span className="sf-inside">in {step.inside}</span>}
          </span>
        </span>
      </button>
      <Handle type="source" id="b" position={Position.Bottom} isConnectable={false} />
      <Handle type="source" id="r" position={Position.Right} isConnectable={false} />
      <Handle type="source" id="l" position={Position.Left} isConnectable={false} />
    </>
  );
}

function GhostView({ data }: NodeProps<GhostNode>) {
  const { ghost, color } = data;
  return (
    <>
      <Handle type="target" id="l" position={Position.Left} isConnectable={false} />
      <div className={`sf-ghost${ghost.error ? ' is-error' : ''}`} style={{ ['--lane' as string]: color }} data-testid={`card-ghost-${ghost.from + 1}-${ghost.path}`} title={`Not taken: ${ghost.label ?? 'other branch'} → ${ghost.title}`} aria-hidden="true">
        <span className="sf-ghost-title">{ghost.title}</span>
      </div>
      <Handle type="target" id="r" position={Position.Right} isConnectable={false} />
    </>
  );
}

function LaneView({ data }: NodeProps<LaneNode>) {
  const { lane, height } = data;
  return (
    <div className={`sf-lane${lane.unknown ? ' is-unknown' : ''}`} data-testid={`card-lane-${lane.role}`} style={{ width: lane.w, height, ['--lane' as string]: lane.color }} aria-hidden="true">
      <div className="sf-lane-head">
        <span className="sf-lane-label">{lane.label}</span>
        <span className="sf-lane-kind">{lane.unknown ? 'unknown lane' : (lane.kind ?? '')}</span>
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = { sfstep: StepView, sfghost: GhostView, sflane: LaneView };

export interface StoryFlowChartProps {
  sf: StoryFlow;
  layout: SfLayout;
  current: number;
  seen: ReadonlySet<number>;
  label: string;
  onPick: (index: number) => void;
  onKey: (index: number, e: KeyboardEvent<HTMLButtonElement>) => void;
  refFn: (index: number, el: HTMLButtonElement | null) => void;
}

/** React Flow nodes and edges of the laid-out flowchart. */
export function chartElements({ sf, layout, current, seen, onPick, onKey, refFn }: Omit<StoryFlowChartProps, 'label'>): { nodes: Node[]; edges: Edge[] } {
  const lane = new Map(layout.lanes.map((l) => [l.role, l]));
  const fixed = { draggable: false, selectable: false, focusable: false, connectable: false } as const;
  const nodes: Node[] = [
    ...layout.lanes.map((l): LaneNode => ({ id: `lane-${l.role}`, type: 'sflane', position: { x: l.x, y: 0 }, width: l.w, height: layout.height, zIndex: 0, ...fixed, data: { lane: l, height: layout.height } })),
    ...sf.steps.map((s): StepNode => {
      const r = layout.nodes[s.id]!;
      const l = lane.get(s.lane);
      return {
        id: s.id,
        type: 'sfstep',
        position: { x: r.x, y: r.y },
        width: r.w,
        height: r.h,
        zIndex: 2,
        ...fixed,
        data: { step: s, total: sf.steps.length, color: l?.color ?? '#94A3B8', laneLabel: l?.label ?? s.lane, current: s.index === current, seen: seen.has(s.index), played: s.index < current, onPick, onKey, refFn },
      };
    }),
    ...sf.ghosts.map((g): GhostNode => {
      const r = layout.nodes[g.id]!;
      return { id: g.id, type: 'sfghost', position: { x: r.x, y: r.y }, width: r.w, height: r.h, zIndex: 1, ...fixed, data: { ghost: g, color: lane.get(g.lane)?.color ?? '#94A3B8' } };
    }),
  ];
  const edges: Edge[] = sf.edges.map((e) => {
    const from = layout.nodes[e.from]!;
    const to = layout.nodes[e.to]!;
    const left = to.x + to.w <= from.x;
    const played = e.taken && Number(e.from.slice(5)) <= current;
    return {
      id: e.id,
      source: e.from,
      target: e.to,
      sourceHandle: e.taken ? 'b' : left ? 'l' : 'r',
      targetHandle: e.taken ? 't' : left ? 'r' : 'l',
      type: 'smoothstep',
      zIndex: 1,
      focusable: false,
      selectable: false,
      className: ['sf-edge', e.taken ? 'is-taken' : 'is-ghost', played && 'is-played', e.error && 'is-error'].filter(Boolean).join(' '),
      ...(e.label !== undefined ? { label: e.label, labelBgPadding: [4, 2] as [number, number], labelBgBorderRadius: 4 } : {}),
      ...(e.taken ? { markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 } } : {}),
    };
  });
  return { nodes, edges };
}

/** Width of an element, followed as it changes; 0 when it has no layout (tests). */
function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Refit when the canvas changes size; pan to the current step when it is out of view. */
function Follow({ layout, current, id }: { layout: SfLayout; current: number; id: string | undefined }) {
  const rf = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  useEffect(() => {
    if (width > 1 && height > 1) void rf.fitView({ padding: 0.02, maxZoom: 1 });
  }, [rf, width, height]);
  useEffect(() => {
    const r = id !== undefined ? layout.nodes[id] : undefined;
    if (!r || width <= 1 || height <= 1) return;
    const { x, y, zoom } = rf.getViewport();
    const left = -x / zoom;
    const top = -y / zoom;
    const inView = r.x >= left && r.y >= top && r.x + r.w <= left + width / zoom && r.y + r.h <= top + height / zoom;
    if (!inView) void rf.setCenter(r.x + r.w / 2, r.y + r.h / 2, { zoom, duration: 200 });
    // Only a new current step moves the view.
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** The tallest the canvas grows before the chart zooms out (zoom and pan for big ones). */
const MAX_H = 1100;

export function StoryFlowChart(props: StoryFlowChartProps) {
  const { sf, layout, current, label } = props;
  const [ref, width] = useWidth<HTMLDivElement>();
  const elements = useMemo(() => chartElements(props), [props.sf, props.layout, props.current, props.seen, props.onPick, props.onKey, props.refFn]); // eslint-disable-line react-hooks/exhaustive-deps
  const zoom = width > 1 ? Math.min(1, (width - 4) / layout.width) : 1;
  const height = Math.max(160, Math.min(MAX_H, Math.ceil(layout.height * zoom) + 4));
  return (
    <div ref={ref} className="sf-canvas" style={{ height }} data-testid="card-flow" role="group" aria-label={label}>
      <ReactFlow
        nodes={elements.nodes}
        edges={elements.edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        disableKeyboardA11y
        fitView
        fitViewOptions={{ padding: 0.02, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={1.6}
        zoomOnScroll={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
      >
        <Follow layout={layout} current={current} id={sf.steps[current]?.id} />
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
