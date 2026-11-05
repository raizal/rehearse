// A story's before / after (design page 12), D43 proposed. Pure: which boxes of the story change,
// in which lane, where they stand, what the story changes in words, and what it touches in the
// system as built. StoryBeforeAfter only draws this.

import type { BoxDiff, DiffStatus, Id, Story } from '@rehearse/core';
import type { ReviewEpicView } from '../contract.js';
import { storiesOf } from './review.js';

export interface StoryBox {
  /** Box path, or `part:<id>` for a store in the Files lane. */
  key: string;
  title: string;
  /** In words: what goes in, or what changes. */
  sub: string;
  /** Lane role id, or `files`. */
  lane: string;
  status: DiffStatus;
  /** True for a step outside the record (a removed note with no as-is box). */
  outside: boolean;
  onBefore: boolean;
  onAfter: boolean;
  column: number;
}

export interface StoryLane {
  id: string;
  label: string;
}

export interface StoryEdge {
  from: string;
  to: string;
  label?: string;
  side: 'before' | 'after';
}

export interface StoryChangeRow {
  key: string;
  status: DiffStatus;
  area: 'box' | 'entity' | 'requirement' | 'file';
  item: string;
  /** Box path to open, for a box row. */
  path?: string;
  before: string;
  after: string;
  why: Id[];
}

export interface StoryImpact {
  /** As-is boxes the story touches (changed or kept). */
  boxes: { path: string; title: string; status: DiffStatus }[];
  /** Stories of finished EPICs that own those boxes. They stay frozen: the EPIC does not make them stale. */
  frozen: Id[];
  /** The EPIC those story ids belong to (docs/system/flow.yaml `epic`). */
  asIsEpic?: string;
  /** Scenarios written for this story, and boxes it adds that need one. */
  scenarios: number;
  newBoxes: number;
}

export interface StoryCompare {
  storyId: Id;
  story?: Story;
  /** False when the EPIC has no architecture.yaml or the repo no docs/system/: nothing to compare. */
  available: boolean;
  lanes: StoryLane[];
  boxes: StoryBox[];
  edges: StoryEdge[];
  rows: StoryChangeRow[];
  impact: StoryImpact;
  /** Decision ids behind the story's changes. */
  why: Id[];
}

const DASH = '—';
const FILES = 'files';
const ENDS = new Set(['start', 'end']);

function inputs(box: { inputs?: Record<string, unknown> } | undefined): string {
  const ins = Object.keys(box?.inputs ?? {});
  return ins.length ? `in: ${ins.join(', ')}` : '';
}

const serves = (b: BoxDiff, id: Id) => b.stories.includes(id) || (b.after?.stories ?? []).includes(id);

/** The before / after of one story. */
export function storyCompare(view: ReviewEpicView, storyId: Id): StoryCompare {
  const story = storiesOf(view.prd).find((s) => s.id === storyId);
  const c = view.compare;
  const empty: StoryImpact = { boxes: [], frozen: [], scenarios: 0, newBoxes: 0 };
  if (!c || !c.hasChange) return { storyId, ...(story ? { story } : {}), available: false, lanes: [], boxes: [], edges: [], rows: [], impact: empty, why: [] };

  // Start and end boxes mark the ends of the flow; they do not change what the story does.
  const diffs = c.boxes.filter((b) => b.inEpic && serves(b, storyId) && !ENDS.has((b.after ?? b.before)?.kind ?? ''));
  const boxes: StoryBox[] = diffs.map((b, column) => {
    const box = b.after ?? b.before;
    const outside = b.status === 'removed' && !b.before;
    return {
      key: b.path,
      title: b.title,
      sub: b.status === 'same' ? inputs(box) : (b.what ?? inputs(box)),
      lane: box?.lane ?? story?.role ?? FILES,
      status: b.status,
      outside,
      onBefore: b.status !== 'added',
      onAfter: b.status !== 'removed',
      column,
    };
  });
  // Files: stores the change adds or changes for this story.
  const stores = c.architecture.parts.filter((p) => (p.after ?? p.before)?.kind === 'store' && p.status !== 'same' && p.stories.includes(storyId));
  stores.forEach((p, i) => {
    const part = (p.after ?? p.before)!;
    boxes.push({ key: `part:${p.id}`, title: part.name, sub: p.what ?? part.about ?? '', lane: FILES, status: p.status, outside: false, onBefore: p.before !== undefined, onAfter: p.after !== undefined, column: i });
  });

  // Lanes in flow order, then the Files lane.
  const roleName = new Map((view.prd?.roles ?? []).map((r) => [r.id, r.name]));
  const order = [...(view.flow?.lanes ?? []), ...(view.system?.flow?.lanes ?? [])].sort((a, b) => a.order - b.order).map((l) => l.role);
  const used = new Set(boxes.map((b) => b.lane));
  const laneIds = [...new Set([...order, ...boxes.map((b) => b.lane)])].filter((l) => used.has(l) && l !== FILES);
  const lanes: StoryLane[] = laneIds.map((id) => ({ id, label: roleName.get(id) ?? id }));
  lanes.push({ id: FILES, label: 'Files' });

  // Edges of the root diagrams between boxes shown on that side.
  const edges: StoryEdge[] = [];
  const keys = (side: 'before' | 'after') => new Set(boxes.filter((b) => (side === 'before' ? b.onBefore : b.onAfter) && !b.outside).map((b) => b.key));
  const add = (flowEdges: { from: string; to: string; label?: string }[] | undefined, side: 'before' | 'after') => {
    const on = keys(side);
    for (const e of flowEdges ?? []) if (on.has(e.from) && on.has(e.to)) edges.push({ from: e.from, to: e.to, ...(e.label ? { label: e.label } : {}), side });
  };
  add(view.system?.flow?.root.edges, 'before');
  add(view.flow?.root.edges, 'after');

  // What changes in this story: boxes, entities, non-functional requirements, files.
  const rows: StoryChangeRow[] = diffs.map((b) => ({
    key: `box ${b.path}`,
    status: b.status,
    area: 'box',
    item: b.title,
    ...(b.status === 'removed' && !b.before ? {} : { path: b.path }),
    before: b.status === 'added' ? DASH : b.before ? inputs(b.before) || DASH : (b.what ?? DASH),
    after: b.status === 'same' ? 'no change' : b.status === 'removed' ? DASH : (b.what ?? DASH),
    why: b.why,
  }));
  // An entity change that names no story belongs to every story of the EPIC.
  for (const e of c.entities.filter((e) => e.inEpic && e.status !== 'same' && (e.stories.length === 0 || e.stories.includes(storyId)))) {
    rows.push({ key: `entity ${e.id}`, status: e.status, area: 'entity', item: e.id, before: e.before ? Object.keys(e.before.fields ?? {}).join(', ') || DASH : DASH, after: e.what ?? DASH, why: e.why });
  }
  const reqs = new Set(story?.requirements ?? []);
  for (const r of (view.prd?.requirements ?? []).filter((r) => reqs.has(r.id) && r.kind !== 'functional')) {
    rows.push({ key: `requirement ${r.id}`, status: 'added', area: 'requirement', item: `${r.kind} (${r.id})`, before: DASH, after: r.text, why: [] });
  }
  for (const p of stores) {
    const part = (p.after ?? p.before)!;
    rows.push({ key: `file ${p.id}`, status: p.status, area: 'file', item: part.name, before: p.before?.about ?? DASH, after: p.what ?? p.after?.about ?? DASH, why: p.why });
  }
  rows.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

  const touched = diffs.filter((b) => b.before && b.status !== 'removed');
  const impact: StoryImpact = {
    boxes: touched.map((b) => ({ path: b.path, title: b.title, status: b.status })),
    frozen: [...new Set(touched.flatMap((b) => b.asIsStories))].sort(),
    ...(c.asIsEpic ? { asIsEpic: c.asIsEpic } : {}),
    scenarios: view.scenarios.filter((sv) => sv.scenario.story === storyId).length,
    newBoxes: diffs.filter((b) => b.status === 'added').length,
  };
  const why = [...new Set(rows.flatMap((r) => r.why))].sort(byId);
  return { storyId, ...(story ? { story } : {}), available: true, lanes, boxes, edges, rows, impact, why };
}

const STATUS_ORDER: Record<DiffStatus, number> = { added: 0, changed: 1, removed: 2, same: 3 };

/** G2 before G10: by letter, then by number. */
function byId(a: string, b: string): number {
  const [, la = '', na = '0'] = /^([A-Z]+)(\d+)$/.exec(a) ?? [];
  const [, lb = '', nb = '0'] = /^([A-Z]+)(\d+)$/.exec(b) ?? [];
  return la.localeCompare(lb) || Number(na) - Number(nb);
}

/** "added: 4 boxes, 2 entities, 1 NFR" per status, for the chips above the story's diagrams. */
export function storyChangeSummary(rows: StoryChangeRow[]): { status: DiffStatus; text: string }[] {
  const noun: Record<StoryChangeRow['area'], [string, string]> = { box: ['box', 'boxes'], entity: ['entity', 'entities'], requirement: ['NFR', 'NFRs'], file: ['file', 'files'] };
  const out: { status: DiffStatus; text: string }[] = [];
  for (const status of ['added', 'changed', 'removed', 'same'] as const) {
    const of = rows.filter((r) => r.status === status);
    if (!of.length) continue;
    const parts = (['box', 'entity', 'requirement', 'file'] as const)
      .map((a) => [a, of.filter((r) => r.area === a).length] as const)
      .filter(([, n]) => n > 0)
      .map(([a, n]) => `${n} ${noun[a][n === 1 ? 0 : 1]}`);
    out.push({ status, text: `${status}: ${parts.join(', ')}` });
  }
  return out;
}

// ---------------------------------------------------------------- layout

export const STORY_BA = { head: 40, laneLabel: 92, laneH: 120, filesH: 100, colW: 170, boxW: 148, boxH: 64, pad: 12 } as const;

export interface StoryBaLayout {
  width: number;
  height: number;
  lanes: { id: string; label: string; y: number; h: number }[];
  boxes: Map<string, { x: number; y: number; w: number; h: number }>;
}

/** Lanes in rows, boxes in story order by column; one layout for both sides so they line up. */
export function storyBaLayout(sc: StoryCompare): StoryBaLayout {
  const lanes: StoryBaLayout['lanes'] = [];
  let y = STORY_BA.head;
  for (const l of sc.lanes) {
    const h = l.id === FILES ? STORY_BA.filesH : STORY_BA.laneH;
    lanes.push({ ...l, y, h });
    y += h;
  }
  const laneAt = new Map(lanes.map((l) => [l.id, l]));
  const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
  let cols = 1;
  for (const b of sc.boxes) {
    const lane = laneAt.get(b.lane)!;
    cols = Math.max(cols, b.column + 1);
    boxes.set(b.key, { x: STORY_BA.laneLabel + STORY_BA.pad + b.column * STORY_BA.colW, y: lane.y + (lane.h - STORY_BA.boxH) / 2, w: STORY_BA.boxW, h: STORY_BA.boxH });
  }
  return { width: STORY_BA.laneLabel + STORY_BA.pad * 2 + cols * STORY_BA.colW, height: y, lanes, boxes };
}
