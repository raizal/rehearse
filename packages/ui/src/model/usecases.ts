// The use case diagram (S7-A1, D42), built from the permission data simulate sends
// (`permissionMatrix`, `permissionBoxes`). Actors are the roles; one use case per box that
// writes data or makes a transition, grouped by story; each use case is tagged with the data
// it changes; a line goes from each actor to the use cases of its lane.

import type { Flow, Id, PermissionBoxes, PermissionMatrix, Prd, RoleKind } from '@rehearse/core';
import { boxAt, laneColor, lanesFor, parentPath, roleName } from './diagram.js';
import { byStoryOrder, flowPaths, servedStories, storyOrder } from './features.js';
import { storiesOf } from './review.js';
import { writeChange } from './storyview.js';

export interface Simulation {
  permissionMatrix: PermissionMatrix;
  permissionBoxes: PermissionBoxes;
}

/** The tag of a write: `Story.status draft → signed`, or `writes Order.status`. */
export function writeTag(text: string): string {
  const w = writeChange(text);
  return w.to === undefined ? `writes ${w.target}` : `${w.target} ${w.from || 'new'} → ${w.to}`;
}

export interface UseCase {
  path: string;
  title: string;
  lane: Id;
  /** What it changes, one tag per write. */
  tags: string[];
  /** Its group. */
  story?: Id;
  /** Other stories it serves. */
  alsoStories: Id[];
}

export interface UseCaseGroup {
  /** Undefined for use cases that serve no story. */
  storyId?: Id;
  want?: string;
  useCases: UseCase[];
}

export interface Actor {
  role: Id;
  label: string;
  kind?: RoleKind;
  color: string;
  /** The role writes nothing. */
  readOnly: boolean;
  /** Entities it reads. */
  reads: Id[];
  /** Paths of the use cases of its lane. */
  useCases: string[];
}

export interface UseCaseDiagram {
  actors: Actor[];
  groups: UseCaseGroup[];
  links: { role: Id; path: string }[];
}

/** The stories a box belongs to: those it serves, else those of its nearest parent that names some. */
function storiesFor(flow: Flow | undefined, path: string): Id[] {
  const own = servedStories(boxAt(flow, path));
  if (own.length > 0) return own;
  for (let p = parentPath(path); p !== ''; p = parentPath(p)) {
    const stories = boxAt(flow, p)?.stories;
    if (Array.isArray(stories) && stories.length > 0) return [...stories];
  }
  return [];
}

export function useCaseDiagram(simulation: Simulation | undefined, flow: Flow | undefined, prd: Prd | undefined): UseCaseDiagram {
  const matrix = simulation?.permissionMatrix ?? {};
  const boxes = simulation?.permissionBoxes ?? {};
  const laneOf = new Map<string, Id>();
  for (const [role, byEntity] of Object.entries(boxes)) {
    for (const byAction of Object.values(byEntity ?? {})) {
      for (const path of [...(byAction?.write ?? []), ...(byAction?.transition ?? [])]) if (!laneOf.has(path)) laneOf.set(path, role);
    }
  }
  const order = flowPaths(flow);
  const at = (p: string) => {
    const i = order.indexOf(p);
    return i < 0 ? order.length : i;
  };
  const paths = [...laneOf.keys()].sort((a, b) => at(a) - at(b) || a.localeCompare(b));
  const sorted = storyOrder(prd, paths.flatMap((p) => storiesFor(flow, p)));
  const cmp = byStoryOrder(sorted);

  const useCases: UseCase[] = paths.map((path) => {
    const box = boxAt(flow, path);
    const writes = Array.isArray(box?.writes) ? box.writes.filter((w): w is string => typeof w === 'string') : [];
    const stories = storiesFor(flow, path).sort(cmp);
    return {
      path,
      title: typeof box?.title === 'string' ? box.title : path,
      lane: laneOf.get(path)!,
      tags: writes.map(writeTag),
      ...(stories[0] !== undefined ? { story: stories[0] } : {}),
      alsoStories: stories.slice(1),
    };
  });
  const wants = new Map(storiesOf(prd).map((s) => [s.id, s.want]));
  const groups: UseCaseGroup[] = [];
  for (const id of [...sorted, undefined]) {
    const list = useCases.filter((u) => u.story === id);
    if (list.length === 0) continue;
    const want = id === undefined ? undefined : wants.get(id);
    groups.push({ ...(id !== undefined ? { storyId: id } : {}), ...(want !== undefined ? { want } : {}), useCases: list });
  }

  const ordered = groups.flatMap((g) => g.useCases);
  const lanes = lanesFor(flow, prd, flow?.root, true);
  const roles = [...lanes.map((l) => l.role), ...Object.keys(matrix).filter((r) => !lanes.some((l) => l.role === r)).sort()];
  const actors: Actor[] = roles.map((role) => {
    const lane = lanes.find((l) => l.role === role);
    const byEntity = matrix[role] ?? {};
    const writes = Object.values(byEntity).some((actions) => actions.includes('write') || actions.includes('transition'));
    const kind = lane?.kind ?? (Array.isArray(prd?.roles) ? prd.roles.find((r) => r.id === role)?.kind : undefined);
    return {
      role,
      label: lane?.label ?? roleName(prd, role),
      ...(kind !== undefined ? { kind } : {}),
      color: lane?.color ?? laneColor(flow, role),
      readOnly: !writes,
      reads: Object.keys(byEntity).filter((e) => byEntity[e]!.includes('read')),
      useCases: ordered.filter((u) => u.lane === role).map((u) => u.path),
    };
  });
  const links = actors.flatMap((a) => a.useCases.map((path) => ({ role: a.role, path })));
  return { actors, groups, links };
}

// ---------------------------------------------------------------- layout

/** Sizes of the use case diagram, in SVG units. */
export const UCD = {
  actorX: 80,
  /** Half width of an actor figure with its label. */
  actorHalf: 36,
  actorGap: 96,
  boundaryX: 200,
  boundaryW: 600,
  top: 16,
  /** Room for the system name at the top of the boundary. */
  boundaryHead: 40,
  groupHead: 32,
  groupGap: 16,
  ovalRx: 120,
  ovalRy: 28,
  ovalInset: 40,
  row: 72,
  tagH: 18,
} as const;

export interface UseCaseLayout {
  width: number;
  height: number;
  boundary: { x: number; y: number; w: number; h: number };
  groups: { storyId?: Id; x: number; y: number; w: number; h: number }[];
  ovals: { path: string; cx: number; cy: number; rx: number; ry: number }[];
  actors: { role: Id; x: number; y: number }[];
  links: { role: Id; path: string; x1: number; y1: number; x2: number; y2: number }[];
}

/**
 * Groups stacked inside the system boundary, one use case per row with its tags on the right.
 * Each actor sits at the mean height of its use cases, at least `actorGap` below the one above;
 * read-only actors come after.
 */
export function useCaseLayout(d: UseCaseDiagram): UseCaseLayout {
  const groups: UseCaseLayout['groups'] = [];
  const ovals: UseCaseLayout['ovals'] = [];
  let y = UCD.top + UCD.boundaryHead;
  for (const g of d.groups) {
    const top = y;
    y += UCD.groupHead;
    for (const u of g.useCases) {
      const h = Math.max(UCD.row, u.tags.length * UCD.tagH + UCD.tagH);
      ovals.push({ path: u.path, cx: UCD.boundaryX + UCD.ovalInset + UCD.ovalRx, cy: y + h / 2, rx: UCD.ovalRx, ry: UCD.ovalRy });
      y += h;
    }
    groups.push({ ...(g.storyId !== undefined ? { storyId: g.storyId } : {}), x: UCD.boundaryX + 16, y: top, w: UCD.boundaryW - 32, h: y - top });
    y += UCD.groupGap;
  }
  const boundary = { x: UCD.boundaryX, y: UCD.top, w: UCD.boundaryW, h: Math.max(y, UCD.top + UCD.boundaryHead + UCD.groupGap) - UCD.top };
  const oval = new Map(ovals.map((o) => [o.path, o]));

  const actors: UseCaseLayout['actors'] = [];
  let last = -Infinity;
  const place = (role: Id, want: number) => {
    const at = Math.max(want, last + UCD.actorGap, UCD.top + UCD.boundaryHead);
    actors.push({ role, x: UCD.actorX, y: at });
    last = at;
  };
  for (const a of d.actors.filter((a) => a.useCases.length > 0)) {
    const ys = a.useCases.map((p) => oval.get(p)?.cy).filter((v): v is number => v !== undefined);
    place(a.role, ys.reduce((s, v) => s + v, 0) / Math.max(1, ys.length));
  }
  for (const a of d.actors.filter((a) => a.useCases.length === 0)) place(a.role, last + UCD.actorGap);
  const actorAt = new Map(actors.map((a) => [a.role, a]));

  const links = d.links.flatMap((l) => {
    const a = actorAt.get(l.role);
    const o = oval.get(l.path);
    return a && o ? [{ role: l.role, path: l.path, x1: a.x + UCD.actorHalf, y1: a.y, x2: o.cx - o.rx, y2: o.cy }] : [];
  });
  const height = Math.max(boundary.y + boundary.h, ...actors.map((a) => a.y + 60)) + UCD.top;
  return { width: UCD.boundaryX + UCD.boundaryW + UCD.top, height, boundary, groups, ovals, actors, links };
}
