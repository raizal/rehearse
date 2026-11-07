// Find diagrams and boxes by path, and the lanes a diagram shows (R9).

import type { Box, Diagram, Flow, Prd, RoleKind } from '../types.js';

/** One swimlane: a role of flow.yaml `lanes`, in lane order. */
export interface LaneInfo {
  role: string;
  /** Role name from prd.yaml, else the role id. */
  label: string;
  kind?: RoleKind;
  /** True for a lane that a box names but flow.yaml does not list (validate reports it). */
  unknown?: boolean;
  /** Lane colour, the same in every box diagram and the storyboard. */
  color: string;
}

/** Lane colours by flow.yaml lane order. Each lane also shows its role name, so colour is never the only cue. */
export const LANE_COLORS = ['#2563EB', '#7C3AED', '#059669', '#D97706', '#DB2777', '#0891B2', '#B45309', '#475569'];
/** Colour of a lane that flow.yaml does not list. */
export const UNKNOWN_LANE_COLOR = '#94A3B8';

function declaredLanes(flow: Flow | undefined) {
  return (Array.isArray(flow?.lanes) ? [...flow.lanes] : []).filter((l) => l && typeof l.role === 'string').sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** The colour of the lane of `role`: by its place in flow.yaml lane order. */
export function laneColor(flow: Flow | undefined, role: string | undefined): string {
  const i = declaredLanes(flow).findIndex((l) => l.role === role);
  return i < 0 ? UNKNOWN_LANE_COLOR : LANE_COLORS[i % LANE_COLORS.length]!;
}

/** Role name from prd.yaml, else the role id. */
export function roleName(prd: Prd | undefined, role: string | undefined): string {
  const found = Array.isArray(prd?.roles) ? prd.roles.find((r) => r && r.id === role) : undefined;
  return found?.name ?? role ?? '?';
}

export interface Crumb {
  /** '' for the root diagram, else the box path. */
  path: string;
  label: string;
  title: string;
}

function boxes(diagram: Diagram | undefined): Box[] {
  return Array.isArray(diagram?.boxes) ? diagram.boxes.filter((b) => b && typeof b === 'object') : [];
}

export function hasChildren(box: Box | undefined): boolean {
  return boxes(box?.children).length > 0;
}

/** The box at `path` (`simulate/contracts`), or undefined. */
export function boxAt(flow: Flow | undefined, path: string): Box | undefined {
  let diagram: Diagram | undefined = flow?.root;
  let found: Box | undefined;
  for (const id of path.split('/')) {
    found = boxes(diagram).find((b) => b.id === id);
    if (!found) return undefined;
    diagram = found.children;
  }
  return found;
}

/** The diagram shown at `path`: the root for '', else the children of that box. */
export function diagramAt(flow: Flow | undefined, path: string): Diagram | undefined {
  if (path === '') return flow?.root;
  const box = boxAt(flow, path);
  return hasChildren(box) ? box!.children : undefined;
}

/** Path of the diagram that contains the box at `path`. */
export function parentPath(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** Root first, then each box on the way down to `path` (S4-A2). */
export function breadcrumb(flow: Flow | undefined, path: string): Crumb[] {
  const out: Crumb[] = [{ path: '', label: 'root', title: flow?.epic ?? 'root' }];
  if (path === '') return out;
  const ids = path.split('/');
  ids.forEach((id, i) => {
    const p = ids.slice(0, i + 1).join('/');
    out.push({ path: p, label: id, title: boxAt(flow, p)?.title ?? id });
  });
  return out;
}

/**
 * Lanes in flow.yaml lane order. The root diagram shows every lane; a nested
 * diagram shows only the lanes its boxes use. A box with a lane that flow.yaml
 * does not list gets its own lane at the end, so no box is hidden.
 */
export function lanesFor(flow: Flow | undefined, prd: Prd | undefined, diagram: Diagram | undefined, isRoot: boolean): LaneInfo[] {
  const roles = new Map((Array.isArray(prd?.roles) ? prd.roles : []).map((r) => [r.id, r]));
  const declared = declaredLanes(flow);
  const used = new Set(boxes(diagram).map((b) => b.lane));
  const lanes: LaneInfo[] = [];
  const seen = new Set<string>();
  for (const l of declared) {
    if (seen.has(l.role) || (!isRoot && !used.has(l.role))) continue;
    seen.add(l.role);
    const role = roles.get(l.role);
    const color = laneColor(flow, l.role);
    lanes.push(role ? { role: l.role, label: role.name, kind: role.kind, color } : { role: l.role, label: l.role, color });
  }
  for (const b of boxes(diagram)) {
    if (typeof b.lane !== 'string' || seen.has(b.lane)) continue;
    seen.add(b.lane);
    lanes.push({ role: b.lane, label: b.lane, unknown: true, color: UNKNOWN_LANE_COLOR });
  }
  return lanes;
}
