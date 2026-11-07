// One map per story (S22, T57): the union of the story's scenario paths in the storyboard's role
// lanes (core `storyMap`, `layoutStoryMap`). A box many scenarios cross is drawn once; each path is
// its own line, the main path the spine. On a scenario's storyboard its path is in full colour and
// a button per step (the arrow keys move along it, as on the one-path chart); every other path is
// faded, not hidden, and out of the tab order. "Branches here: when …" marks where the scenario
// leaves the main path and "Joins the main path again" where it comes back. On the story page
// ("The story at a glance") nothing is active and each line opens its scenario. A box that a small
// change added (T62) carries "New in C1".

import { useMemo, type KeyboardEvent } from 'react';
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps, type NodeTypes } from '@xyflow/react';
import type { Id } from '@rehearse/core';
import { BoxCoverageBadge } from './CoverageBadge.js';
import { Follow, MAX_H, stepLabel, useWidth } from './StoryFlowChart.js';
import { SF, type SfLaidLane, type SfStep } from '../model/storyflow.js';
import type { ScenarioBranch, SmGhost, SmLayout, SmNode, StoryMap } from '../model/branches.js';
import type { ChangeRef } from '../model/changes.js';
import { ChangeMark } from './ChangeMark.js';

/** One colour per path, in branch order: the main path first. */
export const LINE_COLORS = ['#1E293B', '#2563EB', '#D97706', '#7C3AED', '#059669', '#DB2777', '#0891B2', '#B45309', '#475569'];

/** Colour of each scenario's line, by its place in the branch order. */
export function lineColors(map: StoryMap): Map<Id, string> {
  return new Map(map.branches.branches.map((b, i) => [b.scenarioId, LINE_COLORS[i % LINE_COLORS.length]!]));
}

/** The marker texts of the active scenario on the map: where it leaves the main path and where it comes back. */
export function branchMarkers(branch: ScenarioBranch | undefined): { branchAt?: string; branchText?: string; rejoinAt?: string } {
  if (!branch || branch.kind === 'main' || branch.kind === 'same') return {};
  return {
    ...(branch.kind === 'branch' && branch.atPath ? { branchAt: branch.atPath, branchText: `Branches here: when ${branch.condition}` } : {}),
    ...(branch.rejoin ? { rejoinAt: branch.rejoin.path } : {}),
  };
}

export const REJOIN_TEXT = 'Joins the main path again';

interface ActiveData extends Record<string, unknown> {
  node: SmNode;
  /** The step shown on the node: the current one when the path is on it, else the first visit. */
  step: SfStep;
  /** Every step index of the active scenario on this box (a loop visits it twice). */
  indexes: number[];
  total: number;
  color: string;
  laneLabel: string;
  current: boolean;
  seen: boolean;
  played: boolean;
  marker?: string;
  rejoin: boolean;
  change?: ChangeRef;
  onPick: (index: number) => void;
  onKey: (index: number, e: KeyboardEvent<HTMLButtonElement>) => void;
  refFn: (index: number, el: HTMLButtonElement | null) => void;
}
interface BoxData extends Record<string, unknown> {
  node: SmNode;
  color: string;
  /** Faded: not on the active scenario's path. */
  faded: boolean;
  testId: string;
  change?: ChangeRef;
}
interface GhostData extends Record<string, unknown> {
  ghost: SmGhost;
  color: string;
  testId: string;
}
interface LaneData extends Record<string, unknown> {
  lane: SfLaidLane;
  height: number;
  testId: string;
}

const Handles = ({ target }: { target?: boolean }) => (
  <>
    <Handle type="target" id="t" position={Position.Top} isConnectable={false} />
    <Handle type="source" id="b" position={Position.Bottom} isConnectable={false} />
    <Handle type="source" id="r" position={Position.Right} isConnectable={false} />
    <Handle type="source" id="l" position={Position.Left} isConnectable={false} />
    {target && (
      <>
        <Handle type="target" id="tr" position={Position.Right} isConnectable={false} />
        <Handle type="target" id="tl" position={Position.Left} isConnectable={false} />
      </>
    )}
  </>
);

const Diamond = () => (
  <svg className="sf-diamond" viewBox={`0 0 ${SF.diamondW} ${SF.diamondH}`} preserveAspectRatio="none" aria-hidden="true">
    <polygon points={`${SF.diamondW / 2},2 ${SF.diamondW - 2},${SF.diamondH / 2} ${SF.diamondW / 2},${SF.diamondH - 2} 2,${SF.diamondH / 2}`} />
  </svg>
);

function ActiveView({ data }: NodeProps<Node<ActiveData, 'smactive'>>) {
  const { node, step, indexes, total, color, laneLabel, current, seen, played, marker, rejoin, change, onPick, onKey, refFn } = data;
  const n = step.index + 1;
  const cls = ['sf-node', node.decision ? 'is-decision' : 'is-step', 'is-active', current && 'is-current', seen && 'is-seen', played && 'is-played', 'nopan', 'nodrag'].filter(Boolean).join(' ');
  return (
    <>
      <button
        type="button"
        ref={(el) => indexes.forEach((i) => refFn(i, el))}
        className={cls}
        style={{ ['--lane' as string]: color, pointerEvents: 'all' }}
        tabIndex={current ? 0 : -1}
        data-testid={`card-step-${indexes[0]! + 1}`}
        data-step={step.index}
        data-steps={indexes.map((i) => i + 1).join(' ')}
        aria-current={current ? 'step' : undefined}
        aria-label={`${stepLabel(step, total, laneLabel, seen)}${marker ? `. ${marker}` : ''}${rejoin ? `. ${REJOIN_TEXT}` : ''}`}
        onClick={() => onPick(step.index)}
        onKeyDown={(e) => onKey(step.index, e)}
      >
        {node.decision && <Diamond />}
        <span className="sf-node-body">
          <span className="sf-node-top">
            <span className="sf-badge">{n}</span>
            <BoxCoverageBadge path={node.path} testId={`card-coverage-${n}`} compact />
            {seen && (
              <span className="sf-seen" aria-hidden="true">
                ✓
              </span>
            )}
          </span>
          <span className="sf-node-text">
            <span className="sf-title" data-testid={`card-node-title-${n}`}>
              {node.title}
            </span>
            {node.inside !== undefined && !node.decision && <span className="sf-inside">in {node.inside}</span>}
            {change && <ChangeMark change={change} testId={`card-node-change-${n}`} />}
          </span>
        </span>
      </button>
      {marker && (
        <span className="sf-marker is-branch" data-testid="card-marker-branch" aria-hidden="true">
          {marker}
        </span>
      )}
      {rejoin && (
        <span className="sf-marker is-rejoin" data-testid="card-marker-rejoin" aria-hidden="true">
          {REJOIN_TEXT}
        </span>
      )}
      <Handles target />
    </>
  );
}

function BoxView({ data }: NodeProps<Node<BoxData, 'smbox'>>) {
  const { node, color, faded, testId, change } = data;
  const cls = ['sf-node', 'sm-box', node.decision ? 'is-decision' : 'is-step', faded && 'is-faded', node.main && 'is-main'].filter(Boolean).join(' ');
  return (
    <>
      <div className={cls} style={{ ['--lane' as string]: color }} data-testid={testId} aria-hidden="true" title={node.title}>
        {node.decision && <Diamond />}
        <span className="sf-node-body">
          <span className="sf-node-text">
            <span className="sf-title">{node.title}</span>
            {node.inside !== undefined && !node.decision && <span className="sf-inside">in {node.inside}</span>}
            {change && <ChangeMark change={change} testId={`${testId}-change`} />}
          </span>
        </span>
      </div>
      <Handles target />
    </>
  );
}

function GhostView({ data }: NodeProps<Node<GhostData, 'smghost'>>) {
  const { ghost, color, testId } = data;
  return (
    <>
      <Handle type="target" id="tl" position={Position.Left} isConnectable={false} />
      <div className={`sf-ghost${ghost.error ? ' is-error' : ''}`} style={{ ['--lane' as string]: color }} data-testid={testId} title={`Not taken: ${ghost.label ?? 'other branch'} → ${ghost.title}`} aria-hidden="true">
        <span className="sf-ghost-title">{ghost.title}</span>
      </div>
      <Handle type="target" id="tr" position={Position.Right} isConnectable={false} />
    </>
  );
}

function LaneView({ data }: NodeProps<Node<LaneData, 'smlane'>>) {
  const { lane, height, testId } = data;
  return (
    <div className={`sf-lane${lane.unknown ? ' is-unknown' : ''}`} data-testid={testId} style={{ width: lane.w, height, ['--lane' as string]: lane.color }} aria-hidden="true">
      <div className="sf-lane-head">
        <span className="sf-lane-label">{lane.label}</span>
        <span className="sf-lane-kind">{lane.unknown ? 'unknown lane' : (lane.kind ?? '')}</span>
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = { smactive: ActiveView, smbox: BoxView, smghost: GhostView, smlane: LaneView };

/** The active scenario on the storyboard; absent on the story page. */
export interface MapActive {
  scenarioId: Id;
  branch?: ScenarioBranch;
  /** The scenario's steps as the one-path model has them (titles, branches), by index. */
  steps: SfStep[];
  current: number;
  seen: ReadonlySet<number>;
  onPick: (index: number) => void;
  onKey: (index: number, e: KeyboardEvent<HTMLButtonElement>) => void;
  refFn: (index: number, el: HTMLButtonElement | null) => void;
}

export interface StoryMapChartProps {
  map: StoryMap;
  layout: SmLayout;
  label: string;
  /** Test id of the canvas. */
  testId: string;
  /** Prefix of the test ids of its lanes (`<prefix>-lane-<role>`), faded boxes (`<prefix>-map-node-<path>`) and not-taken boxes (`<prefix>-ghost-<step or box>-<path>`). */
  prefix: string;
  active?: MapActive;
  /** The story page: a line opens its scenario. */
  onOpenScenario?: (id: Id) => void;
  /** Box path → the small change that added the box (T62). */
  changes?: ReadonlyMap<string, ChangeRef>;
}

/** React Flow nodes and edges of the laid-out story map, the active scenario (if any) highlighted. */
export function mapElements({ map, layout, prefix, active, changes }: Omit<StoryMapChartProps, 'label' | 'onOpenScenario' | 'testId'>): { nodes: Node[]; edges: Edge[] } {
  const lane = new Map(layout.lanes.map((l) => [l.role, l]));
  const colors = lineColors(map);
  const fixed = { draggable: false, selectable: false, focusable: false, connectable: false } as const;
  const path = active ? (map.steps[active.scenarioId] ?? []) : [];
  const onPath = new Set(path);
  const markers = branchMarkers(active?.branch);
  const nodes: Node[] = layout.lanes.map((l) => ({ id: `lane-${l.role}`, type: 'smlane', position: { x: l.x, y: 0 }, width: l.w, height: layout.height, zIndex: 0, ...fixed, data: { lane: l, height: layout.height, testId: `${prefix}-lane-${l.role}` } }));
  for (const n of map.nodes) {
    const r = layout.nodes[n.id]!;
    const l = lane.get(n.lane);
    const color = l?.color ?? '#94A3B8';
    const base = { id: n.id, position: { x: r.x, y: r.y }, width: r.w, height: r.h, ...fixed };
    const change = changes?.get(n.path);
    if (active && onPath.has(n.id)) {
      const indexes = path.flatMap((id, i) => (id === n.id ? [i] : []));
      const shown = indexes.includes(active.current) ? active.current : indexes[0]!;
      const step = active.steps[shown]!;
      nodes.push({
        ...base,
        type: 'smactive',
        zIndex: 3,
        data: {
          node: n,
          step,
          indexes,
          total: path.length,
          color,
          laneLabel: l?.label ?? n.lane,
          current: shown === active.current,
          seen: active.seen.has(shown),
          played: indexes[0]! < active.current,
          ...(markers.branchAt === n.path ? { marker: markers.branchText } : {}),
          rejoin: markers.rejoinAt === n.path,
          ...(change ? { change } : {}),
          onPick: active.onPick,
          onKey: active.onKey,
          refFn: active.refFn,
        },
      });
    } else {
      nodes.push({ ...base, type: 'smbox', zIndex: 2, data: { node: n, color, faded: active !== undefined, testId: `${prefix}-map-node-${n.path}`, ...(change ? { change } : {}) } });
    }
  }
  for (const g of map.ghosts) {
    const r = layout.nodes[g.id]!;
    // Named by the active scenario's step at the decision, as the one-path chart names them, else by the decision's box.
    const at = active ? path.indexOf(g.from) : -1;
    const from = at >= 0 ? String(at + 1) : (map.nodes.find((n) => n.id === g.from)?.path ?? g.from);
    nodes.push({ id: g.id, type: 'smghost', position: { x: r.x, y: r.y }, width: r.w, height: r.h, zIndex: 1, ...fixed, data: { ghost: g, color: lane.get(g.lane)?.color ?? '#94A3B8', testId: `${prefix}-ghost-${from}-${g.path}` } });
  }
  // The active scenario's lines: which transitions it takes, and how far it has played.
  const activeAt = new Map<string, number>();
  path.forEach((id, i) => {
    if (i + 1 < path.length) {
      const key = `${id}>${path[i + 1]}`;
      if (!activeAt.has(key)) activeAt.set(key, i);
    }
  });
  const edges: Edge[] = map.edges.map((e) => {
    const from = layout.nodes[e.from]!;
    const to = layout.nodes[e.to]!;
    const back = layout.back.has(e.id);
    const left = to.x + to.w <= from.x;
    const at = active && e.scenarios.includes(active.scenarioId) ? activeAt.get(`${e.from}>${e.to}`) : undefined;
    const on = at !== undefined;
    const faded = active !== undefined && !on;
    const color = e.taken ? (colors.get(on ? active!.scenarioId : e.line) ?? LINE_COLORS[0]!) : undefined;
    return {
      id: e.id,
      source: e.from,
      target: e.to,
      sourceHandle: !e.taken ? (left ? 'l' : 'r') : back ? 'r' : 'b',
      targetHandle: !e.taken ? (left ? 'tr' : 'tl') : back ? 'tr' : 't',
      type: 'smoothstep',
      zIndex: on ? 2 : 1,
      focusable: false,
      selectable: false,
      data: { line: e.line, scenarios: e.scenarios },
      className: ['sf-edge', 'sm-line', e.taken ? 'is-taken' : 'is-ghost', e.main && 'is-main', on && 'is-active', faded && 'is-faded', on && at! < active!.current && 'is-played', e.error && 'is-error'].filter(Boolean).join(' '),
      ...(color ? { style: { stroke: color } } : {}),
      ...(e.label !== undefined ? { label: e.label, labelBgPadding: [4, 2] as [number, number], labelBgBorderRadius: 4 } : {}),
      ...(e.taken ? { markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, ...(color ? { color } : {}) } } : {}),
    };
  });
  return { nodes, edges };
}

export function StoryMapChart(props: StoryMapChartProps) {
  const { layout, label, testId, active, onOpenScenario } = props;
  const [ref, width] = useWidth<HTMLDivElement>();
  const elements = useMemo(() => mapElements(props), [props.map, props.layout, props.prefix, props.active, props.changes]); // eslint-disable-line react-hooks/exhaustive-deps
  const zoom = width > 1 ? Math.min(1, (width - 4) / layout.width) : 1;
  const height = Math.max(160, Math.min(MAX_H, Math.ceil(layout.height * zoom) + 4));
  const currentId = active ? props.map.steps[active.scenarioId]?.[active.current] : undefined;
  return (
    <div ref={ref} className="sf-canvas sm-canvas" style={{ height }} data-testid={testId} role="group" aria-label={label}>
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
        {...(onOpenScenario ? { onEdgeClick: (_: unknown, edge: Edge) => { const line = (edge.data as { line?: string } | undefined)?.line; if (line) onOpenScenario(line); } } : {})}
      >
        <Follow layout={layout} current={active?.current ?? 0} id={currentId} />
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
