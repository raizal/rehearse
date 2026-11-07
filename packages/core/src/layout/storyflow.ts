// The storyboard of one scenario as a flowchart (S6-A1, S5-A1, T37). One node per step, in path
// order, in the column of its lane (swimlanes top to bottom, like the flow view's lanes turned on
// their side). A decision step is a diamond; the edge to the next step carries the branch it
// takes. The other branches of that decision lead, faded, to the boxes they would go to.
// The layout is plain arithmetic: the path is a chain, so each step gets a row of its own.

import type { Flow, Id, Prd, Scenario, ScenarioStep } from '../types.js';
import { storyBranches, type StoryBranches } from './branches.js';
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

// ---------------------------------------------------------------- one map per story (S22, T57)

/** A box of the story map: drawn once, however many scenarios go through it. */
export interface SmNode {
  id: string;
  path: string;
  title: string;
  lane: string;
  decision: boolean;
  inside?: string;
  /** Scenarios that go through the box, in branch order. */
  scenarios: Id[];
  /** On the main path. */
  main: boolean;
}

/** A line of the story map: one transition, with the scenarios that take it. */
export interface SmEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  error: boolean;
  /** The scenarios that take it; empty for an exit no scenario of the story takes (drawn faded). */
  scenarios: Id[];
  /** The path the line is drawn for: the main path, or the first branch (in branch order) that takes it; '' when none does. */
  line: Id;
  main: boolean;
  /** False for an exit of a decision no scenario takes: to a faded box, or to a box of the map. */
  taken: boolean;
}

/** A box a decision could go to that no scenario of the story takes. */
export interface SmGhost {
  id: string;
  /** Id of the decision node. */
  from: string;
  path: string;
  title: string;
  lane: string;
  label?: string;
  error: boolean;
}

export interface StoryMap {
  storyId: Id;
  branches: StoryBranches;
  lanes: LaneInfo[];
  nodes: SmNode[];
  ghosts: SmGhost[];
  edges: SmEdge[];
  /** Scenario id → the node id of each of its steps (a loop visits a node twice). */
  steps: Record<Id, string[]>;
}

/**
 * The union of a story's scenario paths (S22): one node per box, one line per transition, the main
 * path first. `override` is the owner's pick of the main path (review.yaml).
 */
export function storyMap(flow: Flow | undefined, prd: Prd | undefined, storyId: Id, scenarios: Scenario[], override?: Id): StoryMap {
  const own = scenarios.filter((s) => s && s.story === storyId);
  const branches = storyBranches(flow, storyId, own, override);
  const byId = new Map(own.map((s) => [s.id, s]));
  const ordered = branches.branches.map((b) => byId.get(b.scenarioId)).filter((s): s is Scenario => s !== undefined);
  const nodes = new Map<string, SmNode>();
  const edges = new Map<string, SmEdge>();
  const ghosts: SmGhost[] = [];
  const steps: Record<Id, string[]> = {};
  const taken = new Map<string, Set<string>>();
  const node = (path: string, scenarioId: Id, main: boolean): SmNode => {
    let n = nodes.get(path);
    if (!n) {
      const box = boxAt(flow, path);
      const parent = parentPath(path);
      n = {
        id: `box-${nodes.size + 1}`,
        path,
        title: box?.title ?? path,
        lane: typeof box?.lane === 'string' ? box.lane : '?',
        decision: box?.kind === 'decision',
        ...(parent !== '' ? { inside: boxAt(flow, parent)?.title ?? parent } : {}),
        scenarios: [],
        main,
      };
      nodes.set(path, n);
    }
    if (!n.scenarios.includes(scenarioId)) n.scenarios.push(scenarioId);
    if (main) n.main = true;
    return n;
  };
  const others: { from: SmNode; exits: Exit[] }[] = [];
  for (const sc of ordered) {
    const main = sc.id === branches.mainId;
    const list = (Array.isArray(sc.steps) ? sc.steps : []).filter((s) => s && typeof s.name === 'string');
    const ids = list.map((s) => node(s.name, sc.id, main).id);
    steps[sc.id] = ids;
    list.forEach((step, i) => {
      const { taken: t, others: rest } = exits(flow, list, i);
      if (rest.length) others.push({ from: nodes.get(step.name)!, exits: rest });
      if (i + 1 >= list.length) return;
      const label = step.branch ?? t?.label;
      const key = `${ids[i]}>${ids[i + 1]}|${label ?? ''}`;
      let e = edges.get(key);
      if (!e) {
        e = { id: `line-${edges.size + 1}`, from: ids[i]!, to: ids[i + 1]!, ...(label !== undefined ? { label } : {}), error: t?.error ?? false, scenarios: [], line: sc.id, main, taken: true };
        edges.set(key, e);
      }
      if (!e.scenarios.includes(sc.id)) e.scenarios.push(sc.id);
      if (main) e.main = true;
      const from = taken.get(ids[i]!) ?? new Set<string>();
      from.add(list[i + 1]!.name);
      taken.set(ids[i]!, from);
    });
  }
  // Exits of a decision no scenario takes, once per decision and target: a dashed line to the box
  // when the map has it, else to a faded box of its own.
  const exitKeys = new Set<string>();
  const untaken: SmEdge[] = [];
  for (const { from, exits: rest } of others) {
    for (const x of rest) {
      const key = `${from.id}>${x.to}`;
      if (exitKeys.has(key) || taken.get(from.id)?.has(x.to)) continue;
      exitKeys.add(key);
      let to = nodes.get(x.to)?.id;
      if (to === undefined) {
        const target = boxAt(flow, x.to);
        to = `ghost-${from.id}-${ghosts.length + 1}`;
        ghosts.push({ id: to, from: from.id, path: x.to, title: target?.title ?? x.to, lane: typeof target?.lane === 'string' ? target.lane : '?', ...(x.label !== undefined ? { label: x.label } : {}), error: x.error });
      }
      untaken.push({ id: `exit-${untaken.length + 1}`, from: from.id, to, ...(x.label !== undefined ? { label: x.label } : {}), error: x.error, scenarios: [], line: '', main: false, taken: false });
    }
  }
  const all = [...nodes.values()];
  return { storyId, branches, lanes: usedLanes(flow, prd, [...all.map((n) => n.lane), ...ghosts.map((g) => g.lane)]), nodes: all, ghosts, edges: [...edges.values(), ...untaken], steps };
}

export interface SmLayout extends SfLayout {
  /** Lines that go back up (a loop, or a branch that rejoins above): drawn on the side. */
  back: Set<string>;
}

/**
 * The story map in the storyboard's lane columns (layoutStoryFlow's arithmetic): the main path is
 * the spine, one row per step, in the first column of each lane. A box only branches visit sits in
 * a further column of its lane, in the row after the box it is reached from (lower when that slot
 * is taken). A decision's faded boxes sit beside it, in the next free column.
 */
export function layoutStoryMap(map: StoryMap): SmLayout {
  const cell = new Map<string, { lane: string; col: number; row: number; w: number; h: number }>();
  const used = new Set<string>();
  const slot = (lane: string, col: number, row: number) => `${lane}|${col}|${row}`;
  const place = (id: string, lane: string, minCol: number, row: number, w: number, h: number, maxCol = 3) => {
    for (let r = row; ; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        if (used.has(slot(lane, c, r))) continue;
        used.add(slot(lane, c, r));
        cell.set(id, { lane, col: c, row: r, w, h });
        return;
      }
    }
  };
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const sizeOf = (n: SmNode) => stepSize(n);
  const order = map.branches.branches.map((b) => b.scenarioId);
  let row = 0;
  for (const id of order) {
    const ids = map.steps[id] ?? [];
    ids.forEach((nid, i) => {
      if (cell.has(nid)) return;
      const n = byId.get(nid)!;
      const { w, h } = sizeOf(n);
      if (id === map.branches.mainId) place(nid, n.lane, 0, row++, w, h, 0);
      else {
        const prev = i > 0 ? cell.get(ids[i - 1]!) : undefined;
        place(nid, n.lane, 1, prev ? prev.row + 1 : 0, w, h);
      }
    });
  }
  for (const g of map.ghosts) {
    const from = cell.get(g.from);
    place(g.id, g.lane, 1, from?.row ?? 0, SF.ghostW, SF.ghostH, 6);
  }
  // Column widths per lane, row heights.
  const colW = new Map<string, number>();
  const rowH = new Map<number, number>();
  for (const c of cell.values()) {
    const k = `${c.lane}|${c.col}`;
    colW.set(k, Math.max(colW.get(k) ?? 0, c.w));
    rowH.set(c.row, Math.max(rowH.get(c.row) ?? 0, c.h));
  }
  const lanes: SfLaidLane[] = [];
  const colX = new Map<string, number>();
  let x = 0;
  for (const lane of map.lanes) {
    const cols = [...colW.keys()].filter((k) => k.startsWith(`${lane.role}|`)).map((k) => Number(k.split('|').pop())).sort((a, b) => a - b);
    let cx = x + SF.lanePad;
    cols.forEach((c, i) => {
      colX.set(`${lane.role}|${c}`, cx);
      cx += colW.get(`${lane.role}|${c}`)! + (i < cols.length - 1 ? SF.ghostGap : 0);
    });
    const w = Math.max(cx - x + SF.lanePad, SF.lanePad * 2 + SF.stepW);
    lanes.push({ ...lane, x, w });
    x += w;
  }
  const rows = [...rowH.keys()].sort((a, b) => a - b);
  const rowY = new Map<number, number>();
  let y = SF.headerH + SF.top;
  for (const r of rows) {
    rowY.set(r, y);
    y += rowH.get(r)! + SF.rowGap;
  }
  const nodes: Record<string, SfRect> = {};
  for (const [id, c] of cell) {
    const cw = colW.get(`${c.lane}|${c.col}`)!;
    const rh = rowH.get(c.row)!;
    nodes[id] = { x: colX.get(`${c.lane}|${c.col}`)! + (cw - c.w) / 2, y: rowY.get(c.row)! + (rh - c.h) / 2, w: c.w, h: c.h };
  }
  const back = new Set(map.edges.filter((e) => e.taken && (cell.get(e.to)?.row ?? 0) <= (cell.get(e.from)?.row ?? 0)).map((e) => e.id));
  const height = (rows.length ? y - SF.rowGap : y) + SF.bottom;
  return { width: Math.max(x, 1), height, lanes, nodes, back };
}
