// The storyboard of one scenario as a flowchart (S6-A1, S5-A1, T37). One node per step, in path
// order, in the column of its lane (swimlanes top to bottom, like the flow view's lanes turned on
// their side). A decision step is a diamond; the edge to the next step carries the branch it
// takes. The other branches of that decision lead, faded, to the boxes they would go to.
// The layout is plain arithmetic: the path is a chain, so each step gets a row of its own.

import type { Flow, Prd, Scenario, ScenarioStep } from '@rehearse/core';
import { boxAt, diagramAt, laneColor, parentPath, UNKNOWN_LANE_COLOR, type LaneInfo } from './diagram.js';

export interface SfStep {
  id: string;
  /** 0-based step index. */
  index: number;
  /** Box path of the step (R21). */
  path: string;
  title: string;
  lane: string;
  decision: boolean;
  /** Title of the box the step's box sits in, for a step inside a nested diagram. */
  inside?: string;
  /** The branch the step takes: its `branch`, or the label of the edge it takes. */
  branch?: string;
}

/** A box a branch not taken would go to. */
export interface SfGhost {
  id: string;
  /** Index of the decision step. */
  from: number;
  path: string;
  title: string;
  lane: string;
  label?: string;
  error: boolean;
}

export interface SfEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  /** The scenario goes along this edge; false for a branch not taken. */
  taken: boolean;
  error: boolean;
}

export interface StoryFlow {
  lanes: LaneInfo[];
  steps: SfStep[];
  ghosts: SfGhost[];
  edges: SfEdge[];
}

const join = (diagramPath: string, id: string): string => (diagramPath === '' ? id : `${diagramPath}/${id}`);
const stepId = (i: number): string => `step-${i + 1}`;

interface Exit {
  to: string;
  label?: string;
  error: boolean;
}

/**
 * The exits of the step's box in its diagram: the one the scenario takes, and the others. Only
 * for a decision or a step with a `branch`, and only when the taken exit is known (by its label,
 * or by the next step's box in the same diagram).
 */
function exits(flow: Flow | undefined, steps: ScenarioStep[], i: number): { taken?: Exit; others: Exit[] } {
  const step = steps[i]!;
  const box = boxAt(flow, step.name);
  if (step.branch === undefined && box?.kind !== 'decision') return { others: [] };
  const diagramPath = parentPath(step.name);
  const id = step.name.split('/').pop()!;
  const edges = diagramAt(flow, diagramPath)?.edges;
  const out: Exit[] = (Array.isArray(edges) ? edges : [])
    .filter((e) => e && e.from === id && typeof e.to === 'string')
    .map((e) => ({ to: e.to, ...(e.label !== undefined ? { label: e.label } : {}), error: e.kind === 'error' }));
  let taken = step.branch !== undefined ? out.find((e) => e.label === step.branch) : undefined;
  const next = steps[i + 1]?.name;
  if (!taken && next !== undefined && (diagramPath === '' || next.startsWith(`${diagramPath}/`))) {
    const nextId = (diagramPath === '' ? next : next.slice(diagramPath.length + 1)).split('/')[0];
    taken = out.find((e) => e.to === nextId);
  }
  if (!taken) return { others: [] };
  return { taken, others: out.filter((e) => e !== taken && e.to !== taken.to).map((e) => ({ ...e, to: join(diagramPath, e.to) })) };
}

/** Lanes in flow.yaml lane order, only those the nodes use; a lane flow.yaml does not list comes last. */
function usedLanes(flow: Flow | undefined, prd: Prd | undefined, used: string[]): LaneInfo[] {
  const roles = new Map((Array.isArray(prd?.roles) ? prd.roles : []).map((r) => [r.id, r]));
  const declared = (Array.isArray(flow?.lanes) ? [...flow.lanes] : []).filter((l) => l && typeof l.role === 'string').sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const order = [...new Set([...declared.map((l) => l.role).filter((r) => used.includes(r)), ...used])];
  const known = new Set(declared.map((l) => l.role));
  return order.map((role) => {
    const r = roles.get(role);
    if (!known.has(role)) return { role, label: role, unknown: true, color: UNKNOWN_LANE_COLOR };
    return r ? { role, label: r.name, kind: r.kind, color: laneColor(flow, role) } : { role, label: role, color: laneColor(flow, role) };
  });
}

export function storyFlow(flow: Flow | undefined, prd: Prd | undefined, scenario: Scenario): StoryFlow {
  const steps = (Array.isArray(scenario.steps) ? scenario.steps : []).filter((s) => s && typeof s.name === 'string');
  const out: StoryFlow = { lanes: [], steps: [], ghosts: [], edges: [] };
  steps.forEach((step, i) => {
    const box = boxAt(flow, step.name);
    const parent = parentPath(step.name);
    const { taken, others } = exits(flow, steps, i);
    const branch = step.branch ?? taken?.label;
    out.steps.push({
      id: stepId(i),
      index: i,
      path: step.name,
      title: box?.title ?? step.name,
      lane: typeof box?.lane === 'string' ? box.lane : '?',
      decision: box?.kind === 'decision',
      ...(parent !== '' ? { inside: boxAt(flow, parent)?.title ?? parent } : {}),
      ...(branch !== undefined ? { branch } : {}),
    });
    if (i + 1 < steps.length) {
      out.edges.push({ id: `e-${i + 1}`, from: stepId(i), to: stepId(i + 1), ...(branch !== undefined ? { label: branch } : {}), taken: true, error: taken?.error ?? false });
    }
    others.forEach((x, k) => {
      const target = boxAt(flow, x.to);
      const id = `ghost-${i + 1}-${k + 1}`;
      out.ghosts.push({ id, from: i, path: x.to, title: target?.title ?? x.to, lane: typeof target?.lane === 'string' ? target.lane : '?', ...(x.label !== undefined ? { label: x.label } : {}), error: x.error });
      out.edges.push({ id: `e-${id}`, from: stepId(i), to: id, ...(x.label !== undefined ? { label: x.label } : {}), taken: false, error: x.error });
    });
  });
  out.lanes = usedLanes(flow, prd, [...out.steps.map((s) => s.lane), ...out.ghosts.map((g) => g.lane)]);
  return out;
}

/** The branches the step did not take, with the boxes they lead to. */
export function notTaken(sf: StoryFlow, index: number): SfGhost[] {
  return sf.ghosts.filter((g) => g.from === index);
}

// ---------------------------------------------------------------- layout

export const SF = {
  stepW: 184,
  stepH: 62,
  diamondW: 200,
  diamondH: 96,
  ghostW: 156,
  ghostH: 44,
  ghostGap: 30,
  ghostStack: 8,
  lanePad: 16,
  headerH: 40,
  top: 18,
  rowGap: 44,
  bottom: 18,
} as const;

export interface SfRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SfLaidLane extends LaneInfo {
  x: number;
  w: number;
}

export interface SfLayout {
  width: number;
  height: number;
  lanes: SfLaidLane[];
  nodes: Record<string, SfRect>;
}

export const stepSize = (s: Pick<SfStep, 'decision'>): { w: number; h: number } => (s.decision ? { w: SF.diamondW, h: SF.diamondH } : { w: SF.stepW, h: SF.stepH });

/**
 * Lanes are columns, left to right in lane order; steps go down, one row each. A lane's column
 * has room for its widest step and, when a branch not taken leads into it, a slot on the right
 * for the faded boxes. The faded boxes of one decision sit in the decision's row.
 */
export function layoutStoryFlow(sf: StoryFlow): SfLayout {
  const lanes: SfLaidLane[] = [];
  let x = 0;
  for (const lane of sf.lanes) {
    const mine = sf.steps.filter((s) => s.lane === lane.role);
    const main = mine.some((s) => s.decision) ? SF.diamondW : SF.stepW;
    const ghostSlot = sf.ghosts.some((g) => g.lane === lane.role) ? SF.ghostGap + SF.ghostW : 0;
    const w = SF.lanePad * 2 + main + ghostSlot;
    lanes.push({ ...lane, x, w });
    x += w;
  }
  const byRole = new Map(lanes.map((l) => [l.role, l]));
  const mainW = (l: SfLaidLane): number => (sf.steps.some((s) => s.lane === l.role && s.decision) ? SF.diamondW : SF.stepW);
  const nodes: Record<string, SfRect> = {};
  let y = SF.headerH + SF.top;
  for (const step of sf.steps) {
    const lane = byRole.get(step.lane)!;
    const { w, h } = stepSize(step);
    nodes[step.id] = { x: lane.x + SF.lanePad + (mainW(lane) - w) / 2, y, w, h };
    // Faded boxes: stacked in their lane's slot, the first one level with the middle of the step.
    const count = new Map<string, number>();
    let bottom = y + h;
    for (const g of notTaken(sf, step.index)) {
      const gl = byRole.get(g.lane)!;
      const k = count.get(g.lane) ?? 0;
      count.set(g.lane, k + 1);
      const gy = y + (h - SF.ghostH) / 2 + k * (SF.ghostH + SF.ghostStack);
      nodes[g.id] = { x: gl.x + SF.lanePad + mainW(gl) + SF.ghostGap, y: gy, w: SF.ghostW, h: SF.ghostH };
      bottom = Math.max(bottom, gy + SF.ghostH);
    }
    y = bottom + SF.rowGap;
  }
  const height = (sf.steps.length ? y - SF.rowGap : y) + SF.bottom;
  return { width: Math.max(x, 1), height, lanes, nodes };
}
