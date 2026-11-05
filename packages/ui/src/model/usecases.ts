// The use case diagram (S7-A1, D42, design page 4), built from the permission data simulate
// sends (`permissionMatrix`, `permissionBoxes`). Actors are the roles; one use case per box that
// writes data or makes a transition, ordered by lane, then flow; each use case points at the data
// (entities) it changes; a line goes from each actor to the use cases of its lane.

import type { Flow, Id, PermissionBoxes, PermissionMatrix, Prd, RoleKind } from '@rehearse/core';
import { boxAt, laneColor, lanesFor, parentPath, roleName } from './diagram.js';
import { byStoryOrder, flowPaths, servedStories, storyOrder } from './features.js';
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
  /** The data (entities) it changes, in write order. */
  entities: Id[];
  /** The stories it serves, in prd.yaml order. */
  stories: Id[];
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

/** A dashed line from a use case to the data it changes, with the changes as tags. */
export interface DataLink {
  path: string;
  entity: Id;
  tags: string[];
}

export interface UseCaseDiagram {
  actors: Actor[];
  /** Ordered by actor (lane order), then flow order. */
  useCases: UseCase[];
  /** The data that some use case changes, ordered so that lines cross as little as possible. */
  entities: Id[];
  links: { role: Id; path: string }[];
  dataLinks: DataLink[];
}

/** The entity of a write: `Story.status:draft->signed` → `Story`. */
export function writeEntity(text: string): Id {
  return writeChange(text).target.split('.')[0]!;
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
  const lanes = lanesFor(flow, prd, flow?.root, true);
  const roles = [...lanes.map((l) => l.role), ...[...new Set([...Object.keys(matrix), ...laneOf.values()])].filter((r) => !lanes.some((l) => l.role === r)).sort()];
  const order = flowPaths(flow);
  const at = (p: string) => {
    const i = order.indexOf(p);
    return i < 0 ? order.length : i;
  };
  const paths = [...laneOf.keys()].sort((a, b) => roles.indexOf(laneOf.get(a)!) - roles.indexOf(laneOf.get(b)!) || at(a) - at(b) || a.localeCompare(b));
  const cmp = byStoryOrder(storyOrder(prd, paths.flatMap((p) => storiesFor(flow, p))));

  const useCases: UseCase[] = paths.map((path) => {
    const box = boxAt(flow, path);
    const writes = Array.isArray(box?.writes) ? box.writes.filter((w): w is string => typeof w === 'string') : [];
    return {
      path,
      title: typeof box?.title === 'string' ? box.title : path,
      lane: laneOf.get(path)!,
      tags: writes.map(writeTag),
      entities: [...new Set(writes.map(writeEntity))],
      stories: storiesFor(flow, path).sort(cmp),
    };
  });

  const dataLinks: DataLink[] = useCases.flatMap((u) => {
    const box = boxAt(flow, u.path);
    const writes = Array.isArray(box?.writes) ? box.writes.filter((w): w is string => typeof w === 'string') : [];
    return u.entities.map((entity) => ({ path: u.path, entity, tags: writes.filter((w) => writeEntity(w) === entity).map(writeTag) }));
  });
  // Each entity at the mean place of the use cases that change it; ties in first-use order.
  const firstUse = [...new Set(useCases.flatMap((u) => u.entities))];
  const mean = (e: Id) => {
    const idx = useCases.flatMap((u, i) => (u.entities.includes(e) ? [i] : []));
    return idx.reduce((sum, i) => sum + i, 0) / idx.length;
  };
  const entities = [...firstUse].sort((a, b) => mean(a) - mean(b) || firstUse.indexOf(a) - firstUse.indexOf(b));

  const actors: Actor[] = roles.map((role) => {
    const lane = lanes.find((l) => l.role === role);
    const byEntity = matrix[role] ?? {};
    const writes = Object.values(byEntity).some((actions) => actions.includes('write') || actions.includes('transition')) || useCases.some((u) => u.lane === role);
    const kind = lane?.kind ?? (Array.isArray(prd?.roles) ? prd.roles.find((r) => r.id === role)?.kind : undefined);
    return {
      role,
      label: lane?.label ?? roleName(prd, role),
      ...(kind !== undefined ? { kind } : {}),
      color: lane?.color ?? laneColor(flow, role),
      readOnly: !writes,
      reads: Object.keys(byEntity).filter((e) => byEntity[e]!.includes('read')),
      useCases: useCases.filter((u) => u.lane === role).map((u) => u.path),
    };
  });
  const links = actors.flatMap((a) => a.useCases.map((path) => ({ role: a.role, path })));
  return { actors, useCases, entities, links, dataLinks };
}

/** The name of the system boundary: the EPIC folder name without its date, else the title. */
export function systemName(epic: string | undefined, title: string | undefined): string {
  const short = epic?.replace(/^\d{4}-\d{2}-\d{2}-/, '');
  return `${short || title || 'System'} record`;
}

/** One line of the "Check" note: `ok` lines say a rule holds, in words. */
export interface CheckLine {
  text: string;
  ok?: boolean;
}

function list(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`;
}

function andList(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/**
 * What the diagram shows about who may change what, in words: each agent never changes the data
 * that only people change; the data that one role alone changes; the roles that change no data.
 */
export function permissionChecks(d: UseCaseDiagram): CheckLine[] {
  const writers = new Map<Id, Set<Id>>(d.entities.map((e) => [e, new Set()]));
  for (const u of d.useCases) for (const e of u.entities) writers.get(e)?.add(u.lane);
  const kind = new Map(d.actors.map((a) => [a.role, a.kind]));
  const label = new Map(d.actors.map((a) => [a.role, a.label]));
  const out: CheckLine[] = [];
  const humanOnly = d.entities.filter((e) => [...writers.get(e)!].every((r) => kind.get(r) === 'human'));
  for (const a of d.actors.filter((a) => a.kind === 'agent')) {
    if (humanOnly.length > 0) out.push({ text: `${a.label} never changes ${list(humanOnly)}.`, ok: true });
  }
  const byOne = new Map<Id, Id[]>();
  for (const e of d.entities) {
    const w = [...writers.get(e)!];
    if (w.length === 1) byOne.set(w[0]!, [...(byOne.get(w[0]!) ?? []), e]);
  }
  for (const [role, es] of byOne) out.push({ text: `Only ${label.get(role) ?? role} changes ${andList(es)}.` });
  for (const a of d.actors.filter((a) => a.readOnly)) out.push({ text: `${a.label} changes no data.` });
  return out;
}

// ---------------------------------------------------------------- layout

/** Sizes of the use case diagram, in SVG units (design page 4, with the page margin taken off). */
export const UCD = {
  width: 1600,
  actorX: 120,
  boundaryX: 480,
  boundaryW: 760,
  /** Room for the system name at the top of the boundary. */
  boundaryHead: 56,
  ovalX: 560,
  ovalW: 360,
  ovalH: 76,
  ovalGap: 22,
  dataX: 1340,
  dataW: 260,
  dataH: 64,
  dataHead: 22,
  /** Least gap between two data boxes. */
  dataGap: 24,
  /** Height of one actor figure with its name and kind. */
  actorH: 200,
  minHeight: 900,
} as const;

export interface UseCaseLayout {
  width: number;
  height: number;
  boundary: { x: number; y: number; w: number; h: number };
  ovals: { path: string; cx: number; cy: number; rx: number; ry: number }[];
  /** Actor figures: the head's top at `y`; the shoulders, where lines start, at `y + 64`. */
  actors: { role: Id; x: number; y: number }[];
  data: { entity: Id; x: number; y: number; w: number; h: number }[];
  links: { role: Id; path: string; x1: number; y1: number; x2: number; y2: number }[];
  dataLinks: { path: string; entity: Id; x1: number; y1: number; x2: number; y2: number }[];
}

/**
 * Three columns: actors spread evenly down the left, the use case ovals stacked in the middle of
 * the system boundary, the data boxes spread evenly down the right. A solid line joins each actor
 * to its use cases; a dashed arrow goes from each use case to the data it changes.
 */
export function useCaseLayout(d: UseCaseDiagram): UseCaseLayout {
  const n = d.useCases.length;
  const stack = n * (UCD.ovalH + UCD.ovalGap) - (n > 0 ? UCD.ovalGap : 0);
  const height = Math.max(UCD.minHeight, UCD.boundaryHead + stack + 40, d.entities.length * (UCD.dataH + UCD.dataGap) + UCD.dataGap, d.actors.length * UCD.actorH);
  const top = Math.max(UCD.boundaryHead, (height - stack) / 2);
  const ovals = d.useCases.map((u, i) => ({ path: u.path, cx: UCD.ovalX + UCD.ovalW / 2, cy: top + i * (UCD.ovalH + UCD.ovalGap) + UCD.ovalH / 2, rx: UCD.ovalW / 2, ry: UCD.ovalH / 2 }));
  const rgap = height / Math.max(1, d.actors.length);
  const actors = d.actors.map((a, i) => ({ role: a.role, x: UCD.actorX, y: Math.round(i * rgap + rgap / 2 - 90) }));
  const m = d.entities.length;
  const eg = (height - m * UCD.dataH) / (m + 1);
  const data = d.entities.map((entity, i) => ({ entity, x: UCD.dataX, y: Math.round(eg + i * (UCD.dataH + eg)), w: UCD.dataW, h: UCD.dataH }));
  const oval = new Map(ovals.map((o) => [o.path, o]));
  const actorAt = new Map(actors.map((a) => [a.role, a]));
  const dataAt = new Map(data.map((x) => [x.entity, x]));
  const links = d.links.flatMap((l) => {
    const a = actorAt.get(l.role);
    const o = oval.get(l.path);
    return a && o ? [{ role: l.role, path: l.path, x1: a.x + 40, y1: a.y + 64, x2: o.cx - o.rx, y2: o.cy }] : [];
  });
  const dataLinks = d.dataLinks.flatMap((l) => {
    const o = oval.get(l.path);
    const e = dataAt.get(l.entity);
    return o && e ? [{ path: l.path, entity: l.entity, x1: o.cx + o.rx, y1: o.cy, x2: e.x - 2, y2: e.y + e.h / 2 }] : [];
  });
  return { width: UCD.width, height, boundary: { x: UCD.boundaryX, y: 0, w: UCD.boundaryW, h: height }, ovals, actors, data, links, dataLinks };
}
