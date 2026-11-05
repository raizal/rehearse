// Find diagrams and boxes by path, and the lanes a diagram shows (R9).

import type { Box, Diagram, Flow, Prd, RoleKind } from '@rehearse/core';

/** One swimlane: a role of flow.yaml `lanes`, in lane order. */
export interface LaneInfo {
  role: string;
  /** Role name from prd.yaml, else the role id. */
  label: string;
  kind?: RoleKind;
  /** True for a lane that a box names but flow.yaml does not list (validate reports it). */
  unknown?: boolean;
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
  const declared = (Array.isArray(flow?.lanes) ? [...flow.lanes] : [])
    .filter((l) => l && typeof l.role === 'string')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const used = new Set(boxes(diagram).map((b) => b.lane));
  const lanes: LaneInfo[] = [];
  const seen = new Set<string>();
  for (const l of declared) {
    if (seen.has(l.role) || (!isRoot && !used.has(l.role))) continue;
    seen.add(l.role);
    const role = roles.get(l.role);
    lanes.push(role ? { role: l.role, label: role.name, kind: role.kind } : { role: l.role, label: l.role });
  }
  for (const b of boxes(diagram)) {
    if (typeof b.lane !== 'string' || seen.has(b.lane)) continue;
    seen.add(b.lane);
    lanes.push({ role: b.lane, label: b.lane, unknown: true });
  }
  return lanes;
}
