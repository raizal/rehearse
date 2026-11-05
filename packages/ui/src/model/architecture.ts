// System architecture (design page 8) and its before / after (page 11), D43 proposed.
// Pure: what to draw and where. The server sends docs/system/architecture.yaml and the compare
// (as-is + the EPIC's change → to-be); ArchitectureView and BeforeAfterView only draw this.

import type { ArchColor, ArchitectureCompare, ArchNote, DiffStatus, Id, Part, PartKind, SystemArchitecture, SystemCompare, Zone } from '@rehearse/core';
import type { DEdge, DNode } from './graph.js';
import { layoutGrid, type Cell } from './grid.js';
import { wrapLines } from './text.js';

// ---------------------------------------------------------------- what to draw

export interface DrawZone {
  id: Id;
  name: string;
  about?: string;
  color: ArchColor;
  status?: DiffStatus;
}

export interface DrawPart {
  id: Id;
  name: string;
  kind: PartKind;
  zone?: Id;
  about?: string;
  color?: ArchColor;
  status?: DiffStatus;
}

export interface DrawLink {
  from: Id;
  to: Id;
  label?: string;
  status?: DiffStatus;
}

export interface ArchDrawing {
  zones: DrawZone[];
  parts: DrawPart[];
  links: DrawLink[];
  notes: ArchNote[];
}

/** Zone colours in order, for a zone that names none. */
const ZONE_COLORS: ArchColor[] = ['blue', 'purple', 'green', 'amber', 'grey'];

function drawZone(z: Zone, i: number, status?: DiffStatus): DrawZone {
  return { id: z.id, name: z.name, ...(z.about ? { about: z.about } : {}), color: z.color ?? ZONE_COLORS[i % ZONE_COLORS.length]!, ...(status ? { status } : {}) };
}

function drawPart(p: Part, status?: DiffStatus): DrawPart {
  return {
    id: p.id,
    name: p.name,
    kind: p.kind ?? 'component',
    ...(p.zone ? { zone: p.zone } : {}),
    ...(p.about ? { about: p.about } : {}),
    ...(p.color ? { color: p.color } : {}),
    ...(status ? { status } : {}),
  };
}

/** docs/system/architecture.yaml (or a to-be) as it is, with no status. */
export function drawingOf(arch: SystemArchitecture): ArchDrawing {
  return {
    zones: arch.zones.map((z, i) => drawZone(z, i)),
    parts: arch.components.map((p) => drawPart(p)),
    links: arch.links.map((l) => ({ from: l.from, to: l.to, ...(l.label ? { label: l.label } : {}) })),
    notes: arch.notes ?? [],
  };
}

/**
 * Before / after modes of page 11. `before`: the as-is with no status. `after`: the to-be, each
 * item with its status. `diff`: everything of both, removed items too (drawn red dashed).
 */
export type DiffSide = 'before' | 'after' | 'diff';

/** One drawing of the compare. Every side holds the same items in the same order, so one layout fits all. */
export function diffDrawing(c: ArchitectureCompare, side: DiffSide): ArchDrawing {
  const keep = (x: { before?: unknown; after?: unknown }) => (side === 'before' ? x.before !== undefined : side === 'after' ? x.after !== undefined : true);
  const st = (s: DiffStatus) => (side === 'before' ? undefined : s);
  return {
    zones: c.zones.filter(keep).map((z, i) => drawZone((side === 'before' ? z.before : (z.after ?? z.before))!, i, st(z.status))),
    parts: c.parts.filter(keep).map((p) => drawPart((side === 'before' ? p.before : (p.after ?? p.before))!, st(p.status))),
    links: c.links.filter(keep).map((l) => {
      const link = (side === 'before' ? l.before : (l.after ?? l.before))!;
      const status = st(l.status);
      return { from: l.from, to: l.to, ...(link.label ? { label: link.label } : {}), ...(status ? { status } : {}) };
    }),
    notes: ((side === 'before' ? c.before : c.after)?.notes ?? c.before?.notes ?? []) as ArchNote[],
  };
}

// ---------------------------------------------------------------- status in words and marks

export interface StatusLook {
  /** CSS class suffix: `is-added`, … */
  className: string;
  /** Status in words, for the badge and the accessible name. */
  word: string;
  /** Mark before the word; empty for same. */
  mark: string;
}

const LOOK: Record<DiffStatus, StatusLook> = {
  added: { className: 'is-added', word: 'added', mark: '+' },
  changed: { className: 'is-changed', word: 'changed', mark: '~' },
  same: { className: 'is-same', word: 'same', mark: '=' },
  removed: { className: 'is-removed', word: 'removed', mark: '−' },
};

export function statusLook(status: DiffStatus | undefined): StatusLook | undefined {
  return status ? LOOK[status] : undefined;
}

/** A link's status in words: an added link is a "new link". */
export function linkWord(status: DiffStatus | undefined): string | undefined {
  return status === 'added' ? 'new link' : status ? `${LOOK[status].word} link` : undefined;
}

export interface DiffCounts {
  added: number;
  changed: number;
  same: number;
  removed: number;
}

export function countStatuses(items: { status: DiffStatus }[]): DiffCounts {
  const n: DiffCounts = { added: 0, changed: 0, same: 0, removed: 0 };
  for (const i of items) n[i.status]++;
  return n;
}

/** "2 added · 4 changed · 5 same"; zero counts are left out. */
export function countsText(n: DiffCounts): string {
  const parts = (['added', 'changed', 'same', 'removed'] as const).filter((k) => n[k] > 0).map((k) => `${n[k]} ${k}`);
  return parts.length ? parts.join(' · ') : 'no change';
}

// ---------------------------------------------------------------- layout

export const ARCH = {
  pad: 16,
  partW: 190,
  partH: 76,
  /** Room for the zone name above the first row of its parts. */
  zoneHead: 36,
  zonePad: 16,
  /** Most components side by side in the biggest zone, and in the zones stacked left of it. */
  maxCols: 3,
  sideCols: 2,
  peopleW: 170,
} as const;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ArchLink {
  from: Id;
  to: Id;
  /** Orthogonal path from the border of `from` to the border of `to`. */
  points: { x: number; y: number }[];
  /** Where the label sits, when the link has one. */
  label?: Rect;
}

export interface ArchLayout {
  width: number;
  height: number;
  zones: Map<Id, Rect>;
  parts: Map<Id, Rect>;
  /** Notes by their index in `notes`: in their zone, or under all zones when they name none. */
  notes: Map<number, Rect>;
  links: ArchLink[];
}

/** Where a line from the centre of `r` towards (tx, ty) leaves the rectangle. */
export function clipToRect(r: Rect, tx: number, ty: number): { x: number; y: number } {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const s = Math.min(dx === 0 ? Infinity : r.w / 2 / Math.abs(dx), dy === 0 ? Infinity : r.h / 2 / Math.abs(dy));
  return { x: cx + dx * s, y: cy + dy * s };
}

/** The text drawn on a link: its label, and "new link" or "removed link" when it is one. */
export function linkText(l: DrawLink): string {
  return [l.label, l.status === 'added' || l.status === 'removed' ? linkWord(l.status) : undefined].filter(Boolean).join(' · ');
}

/** The lines of a note drawn in its zone, under its kind. */
export function noteLines(n: ArchNote, w: number = ARCH.partW): string[] {
  return wrapLines(n.text, lineChars(w), 6);
}

/** Characters of small text that fit on one line of a box `w` wide. */
export function lineChars(w: number): number {
  return Math.floor((w - 20) / 6);
}

export function noteWord(n: ArchNote): string {
  return n.kind === 'warning' ? 'Warning' : n.kind === 'trust' ? 'Trust' : 'Note';
}

const noteKey = (i: number) => `note ${i}`;

/** `compact`: narrower boxes, one part across in the stacked zones and two in the biggest, for a map that shares the page with another (page 11 side by side). */
export interface ArchOptions {
  compact?: boolean;
}

function sizes(o: ArchOptions) {
  return o.compact
    ? { sideCols: 1, maxCols: 2, partW: 160, peopleW: 120, partH: 64 }
    : { sideCols: ARCH.sideCols, maxCols: ARCH.maxCols, partW: ARCH.partW, peopleW: ARCH.peopleW, partH: ARCH.partH };
}

/**
 * Where each part and note stands, as the design draws page 8: people and outside systems in a
 * column on the left, each in the row of the first part it links to; the zone with the most
 * parts on the right, three across; the other zones stacked left of it, two across, while they
 * fit its height; the zones that do not fit in rows across the bottom. Notes stand in their zone.
 */
export function archCells(d: ArchDrawing, o: ArchOptions = {}): Map<string, Cell> {
  const { sideCols, maxCols } = sizes(o);
  const zoneIds = new Set(d.zones.map((z) => z.id));
  const members = new Map<Id, string[]>(d.zones.map((z) => [z.id, []]));
  for (const p of d.parts) if (p.zone && zoneIds.has(p.zone)) members.get(p.zone)!.push(p.id);
  d.notes.forEach((n, i) => {
    if (n.zone && zoneIds.has(n.zone)) members.get(n.zone)!.push(noteKey(i));
  });
  const loose = d.parts.filter((p) => !p.zone || !zoneIds.has(p.zone));
  const base = loose.length ? 1 : 0;
  const cells = new Map<string, Cell>();
  const place = (ids: string[], row: number, col: number, across: number): number => {
    ids.forEach((id, i) => cells.set(id, { row: row + Math.floor(i / across), col: col + (i % across) }));
    return Math.ceil(ids.length / across);
  };

  const zones = d.zones.filter((z) => members.get(z.id)!.length > 0);
  const size = (z: DrawZone) => members.get(z.id)!.length;
  const main = zones.reduce<DrawZone | undefined>((a, z) => (!a || size(z) > size(a) ? z : a), undefined);
  const mainRows = main ? Math.ceil(size(main) / maxCols) : 0;
  const side: DrawZone[] = [];
  const bottom: DrawZone[] = [];
  let sideRows = 0;
  for (const z of zones) {
    if (z === main) continue;
    const rows = Math.ceil(size(z) / sideCols);
    if (sideRows === 0 || sideRows + rows <= mainRows) {
      side.push(z);
      sideRows += rows;
    } else bottom.push(z);
  }
  let row = 0;
  for (const z of side) row += place(members.get(z.id)!, row, base, sideCols);
  if (main) place(members.get(main.id)!, 0, side.length ? base + sideCols : base, maxCols);
  row = Math.max(sideRows, mainRows);
  const across = side.length ? sideCols + maxCols : maxCols;
  for (const z of bottom) row += place(members.get(z.id)!, row, base, across);
  row += place(
    d.notes.flatMap((n, i) => (n.zone && zoneIds.has(n.zone) ? [] : [noteKey(i)])),
    row,
    base,
    across,
  );

  // People: in the row of the first part they link to, or the nearest free row.
  const taken = new Set<number>();
  for (const p of loose) {
    const other = d.links.map((l) => (l.from === p.id ? l.to : l.to === p.id ? l.from : undefined)).find((o) => o !== undefined && cells.has(o) && cells.get(o)!.col >= base);
    const want = other ? cells.get(other)!.row : row;
    let r = want;
    for (let k = 0; taken.has(r); k++) r = k % 2 === 0 ? want + k / 2 + 1 : Math.max(0, want - (k + 1) / 2);
    taken.add(r);
    cells.set(p.id, { row: r, col: 0 });
  }
  return cells;
}

/**
 * Page 8 laid out on a grid (archCells): links are orthogonal and run between the boxes, never
 * through one; each zone is a frame round its parts and notes, with its name on top.
 */
export function archLayout(d: ArchDrawing, o: ArchOptions = {}): ArchLayout {
  const cells = archCells(d, o);
  const { partW, peopleW, partH } = sizes(o);
  const nodes: DNode[] = [
    ...d.parts.map((p): DNode => ({ id: p.id, shape: 'step', title: p.name, w: p.zone && d.zones.some((z) => z.id === p.zone) ? partW : peopleW, h: partH })),
    ...d.notes.map((n, i): DNode => ({ id: noteKey(i), shape: 'step', title: n.text, w: partW, h: Math.max(partH, 34 + noteLines(n, partW).length * 14) })),
  ];
  const ids = new Set(d.parts.map((p) => p.id));
  const kept = d.links.filter((l) => ids.has(l.from) && ids.has(l.to) && l.from !== l.to);
  const edges: DEdge[] = kept.map((l, i) => ({ id: String(i), from: l.from, to: l.to, kind: 'normal', ...(linkText(l) ? { label: linkText(l) } : {}) }));
  const g = layoutGrid({ nodes, edges, groups: [] }, cells, { channel: 40, channelTop: ARCH.zonePad, channelBottom: ARCH.zoneHead, gutterSide: ARCH.zonePad });

  const parts = new Map<Id, Rect>(d.parts.map((p) => [p.id, g.nodes[p.id]!]));
  const notes = new Map<number, Rect>(d.notes.map((_, i) => [i, g.nodes[noteKey(i)]!]));
  const zones = new Map<Id, Rect>();
  for (const z of d.zones) {
    const inside = [...d.parts.filter((p) => p.zone === z.id).map((p) => g.nodes[p.id]!), ...d.notes.flatMap((n, i) => (n.zone === z.id ? [g.nodes[noteKey(i)]!] : []))];
    if (!inside.length) continue;
    const x = Math.min(...inside.map((r) => r.x)) - ARCH.zonePad;
    const y = Math.min(...inside.map((r) => r.y)) - ARCH.zoneHead;
    zones.set(z.id, { x, y, w: Math.max(...inside.map((r) => r.x + r.w)) + ARCH.zonePad - x, h: Math.max(...inside.map((r) => r.y + r.h)) + ARCH.zonePad - y });
  }
  const links = g.edges.map((e): ArchLink => {
    const l = kept[Number(e.id)]!;
    return { from: l.from, to: l.to, points: e.points, ...(e.label ? { label: e.label } : {}) };
  });
  return { width: g.width, height: g.height, zones, parts, notes, links };
}

// ---------------------------------------------------------------- change table (page 11)

export type ChangeArea = 'component' | 'store' | 'person' | 'outside' | 'zone' | 'link' | 'box' | 'entity';

export interface ChangeRow {
  key: string;
  status: DiffStatus;
  area: ChangeArea;
  /** Name of the part, link, box or entity. */
  item: string;
  before: string;
  after: string;
  why: Id[];
  stories: Id[];
}

const DASH = '—';

/** What a link is, in words: "rehearse CLI → @rehearse/graph". */
function linkName(c: ArchitectureCompare, from: Id, to: Id): string {
  const name = (id: Id) => {
    const p = c.parts.find((x) => x.id === id);
    return (p?.after ?? p?.before)?.name ?? id;
  };
  return `${name(from)} → ${name(to)}`;
}

/**
 * Rows of "Changes in this EPIC": every zone, part, link, box and entity the EPIC adds, changes
 * or removes, in that order. After says what changes (`what`) when the change file says it.
 */
export function changeRows(c: SystemCompare): ChangeRow[] {
  const rows: ChangeRow[] = [];
  const a = c.architecture;
  for (const z of a.zones.filter((z) => z.status !== 'same')) {
    rows.push({ key: `zone ${z.id}`, status: z.status, area: 'zone', item: (z.after ?? z.before)!.name, before: z.before?.about ?? (z.before ? z.before.name : DASH), after: z.after ? (z.what ?? z.after.about ?? z.after.name) : DASH, why: z.why, stories: z.stories });
  }
  for (const p of a.parts.filter((p) => p.status !== 'same')) {
    const part = (p.after ?? p.before)!;
    rows.push({
      key: `part ${p.id}`,
      status: p.status,
      area: part.kind ?? 'component',
      item: part.name,
      before: p.before ? (p.before.about ?? DASH) : DASH,
      after: p.after ? (p.what ?? p.after.about ?? DASH) : (p.what ?? DASH),
      why: p.why,
      stories: p.stories,
    });
  }
  for (const l of a.links.filter((l) => l.status !== 'same')) {
    rows.push({
      key: `link ${l.from} ${l.to}`,
      status: l.status,
      area: 'link',
      item: linkName(a, l.from, l.to),
      before: l.before ? (l.before.label ?? 'link') : DASH,
      after: l.after ? (l.what ?? l.after.label ?? 'link') : (l.what ?? DASH),
      why: l.why,
      stories: l.stories,
    });
  }
  for (const b of c.boxes.filter((b) => b.inEpic && b.status !== 'same')) {
    rows.push({ key: `box ${b.path}`, status: b.status, area: 'box', item: b.title, before: b.status === 'added' ? DASH : b.before ? boxText(b.before) : DASH, after: b.what ?? DASH, why: b.why, stories: b.stories });
  }
  for (const e of c.entities.filter((e) => e.inEpic && e.status !== 'same')) {
    rows.push({ key: `entity ${e.id}`, status: e.status, area: 'entity', item: e.id, before: e.before ? Object.keys(e.before.fields ?? {}).join(', ') || DASH : DASH, after: e.what ?? DASH, why: e.why, stories: e.stories });
  }
  return rows;
}

function boxText(b: { inputs?: Record<string, unknown> }): string {
  const ins = Object.keys(b.inputs ?? {});
  return ins.length ? `in: ${ins.join(', ')}` : DASH;
}

/** The note above the change table: stories exist only once prd.yaml does. */
export function storyNote(hasPrd: boolean, rows: ChangeRow[]): string | undefined {
  if (!hasPrd) return 'Stories: none yet. This EPIC has no prd.yaml, so each change links to its decisions. After prd.yaml, each change also links to its story.';
  const without = rows.filter((r) => r.stories.length === 0).length;
  return without ? `${without} of ${rows.length} changes name no story yet.` : undefined;
}

/** The YAML to show when a repo has no docs/system/architecture.yaml. */
export const ARCH_EXAMPLE = `# docs/system/architecture.yaml: the system as built
version: 1
zones:
  - { id: repo, name: Repo machine, about: your user account }
components:
  - { id: user, name: User, kind: person }
  - { id: cli, name: my CLI, zone: repo, about: what it does }
  - { id: files, name: git repo, kind: store, zone: repo }
links:
  - { from: user, to: cli, label: runs }
  - { from: cli, to: files, label: read / write }
`;
