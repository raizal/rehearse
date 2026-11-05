// System architecture (design page 8) and its before / after (page 11), D43 proposed.
// Pure: what to draw and where. The server sends docs/system/architecture.yaml and the compare
// (as-is + the EPIC's change → to-be); ArchitectureView and BeforeAfterView only draw this.

import type { ArchColor, ArchitectureCompare, ArchNote, DiffStatus, Id, Part, PartKind, SystemArchitecture, SystemCompare, Zone } from '@rehearse/core';

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
  gap: 22,
  zoneHead: 40,
  zonePad: 16,
  zoneGap: 28,
  /** Most components side by side in one zone. */
  maxCols: 3,
  /** Width the zones fill before a new row of zones starts. */
  maxWidth: 1240,
  peopleW: 170,
  peopleGap: 60,
} as const;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ArchLayout {
  width: number;
  height: number;
  zones: Map<Id, Rect>;
  parts: Map<Id, Rect>;
  links: { from: Id; to: Id; x1: number; y1: number; x2: number; y2: number; lx: number; ly: number }[];
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

/**
 * Zones as boxes in rows (each a grid of its components, at most three across), filled left to
 * right up to `maxWidth`. People and outside systems with no zone stand in a column on the left,
 * each next to the zone it links to. A part whose zone is unknown gets a zone row of its own.
 * Links are straight lines between box borders with the label at the middle.
 */
export function archLayout(d: ArchDrawing): ArchLayout {
  const zoneIds = new Set(d.zones.map((z) => z.id));
  const loose = d.parts.filter((p) => !p.zone || !zoneIds.has(p.zone));
  const inZone = new Map<Id, DrawPart[]>(d.zones.map((z) => [z.id, []]));
  for (const p of d.parts) if (p.zone && zoneIds.has(p.zone)) inZone.get(p.zone)!.push(p);

  const left = loose.length ? ARCH.pad + ARCH.peopleW + ARCH.peopleGap : ARCH.pad;
  const zones = new Map<Id, Rect>();
  const parts = new Map<Id, Rect>();
  let x = left;
  let y = ARCH.pad;
  let rowH = 0;
  let width = left;
  for (const z of d.zones) {
    const members = inZone.get(z.id)!;
    const cols = Math.max(1, Math.min(ARCH.maxCols, members.length));
    const rows = Math.max(1, Math.ceil(members.length / cols));
    const w = ARCH.zonePad * 2 + cols * ARCH.partW + (cols - 1) * ARCH.gap;
    const h = ARCH.zoneHead + ARCH.zonePad + rows * ARCH.partH + (rows - 1) * ARCH.gap;
    if (x > left && x + w > left + ARCH.maxWidth) {
      x = left;
      y += rowH + ARCH.zoneGap;
      rowH = 0;
    }
    zones.set(z.id, { x, y, w, h });
    members.forEach((p, i) => {
      parts.set(p.id, {
        x: x + ARCH.zonePad + (i % cols) * (ARCH.partW + ARCH.gap),
        y: y + ARCH.zoneHead + Math.floor(i / cols) * (ARCH.partH + ARCH.gap),
        w: ARCH.partW,
        h: ARCH.partH,
      });
    });
    x += w + ARCH.zoneGap;
    rowH = Math.max(rowH, h);
    width = Math.max(width, x - ARCH.zoneGap);
  }
  let height = d.zones.length ? y + rowH : ARCH.pad;

  // People column: each one level with the first part it links to, then pushed down to not overlap.
  const wanted = loose.map((p, i) => {
    const other = d.links.map((l) => (l.from === p.id ? l.to : l.to === p.id ? l.from : undefined)).find((o) => o !== undefined && parts.has(o));
    const r = other ? parts.get(other)! : undefined;
    return { p, y: r ? r.y + r.h / 2 - ARCH.partH / 2 : ARCH.pad + i * (ARCH.partH + ARCH.gap), i };
  });
  wanted.sort((a, b) => a.y - b.y || a.i - b.i);
  let next = ARCH.pad;
  for (const w of wanted) {
    const top = Math.max(w.y, next);
    parts.set(w.p.id, { x: ARCH.pad, y: top, w: ARCH.peopleW, h: ARCH.partH });
    next = top + ARCH.partH + ARCH.gap;
    height = Math.max(height, top + ARCH.partH);
  }
  width = Math.max(width, loose.length ? ARCH.pad + ARCH.peopleW : 0);

  const links = d.links.flatMap((l) => {
    const a = parts.get(l.from);
    const b = parts.get(l.to);
    if (!a || !b) return [];
    const p1 = clipToRect(a, b.x + b.w / 2, b.y + b.h / 2);
    const p2 = clipToRect(b, a.x + a.w / 2, a.y + a.h / 2);
    return [{ from: l.from, to: l.to, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, lx: (p1.x + p2.x) / 2, ly: (p1.y + p2.y) / 2 }];
  });
  return { width: width + ARCH.pad, height: height + ARCH.pad, zones, parts, links };
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
