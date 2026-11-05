// As-is + change → to-be (D4, D43). Pure functions: no file access.
// - Architecture: docs/system/architecture.yaml plus the EPIC's architecture.yaml.
// - Flow: docs/system/flow.yaml plus the EPIC's flow.yaml, matched by box path. The EPIC's flow
//   holds only its own scope, so an as-is box it does not have stays `same`; only a box note
//   with `change: removed` removes one.
// - Entities: docs/system/entities.yaml plus the EPIC's entities.yaml, matched by id.

import { indexBoxes } from '../flow-index.js';
import { canonicalJson } from '../hash.js';
import type { Box, EntityDef, EntityModel, Flow, Id } from '../types.js';
import { asArray, isObject } from '../util.js';
import type {
  ArchitectureChange,
  ArchitectureCompare,
  ArchLink,
  BoxDiff,
  BoxNote,
  ChangeReason,
  DiffCounts,
  DiffStatus,
  EntityDiff,
  EntityNote,
  LinkDiff,
  Part,
  PartDiff,
  SystemArchitecture,
  SystemCompare,
  SystemRecord,
  Zone,
  ZoneDiff,
} from './types.js';

/** A link is known by its two ends. */
export function linkKey(l: { from: Id; to: Id }): string {
  return `${l.from}\u0000${l.to}`;
}

/** The fields of a change item that describe the item, without change, why, stories and what. */
function itemFields<T extends object>(c: T): Partial<T> {
  const { change: _c, why: _w, stories: _s, what: _wh, ...rest } = c as Record<string, unknown>;
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function reason(c: ChangeReason | undefined): { why: Id[]; stories: Id[] } {
  return { why: [...asArray<Id>(c?.why)], stories: [...asArray<Id>(c?.stories)] };
}

/** `about: a → b; zone: x → y` for the fields that differ. */
function fieldChanges(before: object | undefined, after: object | undefined, keys: string[]): string | undefined {
  if (!before || !after) return undefined;
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const show = (v: unknown) => (v === undefined ? '—' : Array.isArray(v) ? v.join(', ') : String(v));
  const parts = keys.filter((k) => canonicalJson(b[k] ?? null) !== canonicalJson(a[k] ?? null)).map((k) => `${k}: ${show(b[k])} → ${show(a[k])}`);
  return parts.length > 0 ? parts.join('; ') : undefined;
}

interface Keyed<T, C> {
  key: string;
  before?: T;
  after?: T;
  change?: C;
}

/** Apply added / changed / removed items to a list keyed by `keyOf`. As-is order first, then additions. */
function applyList<T extends object, C extends { change: string }>(
  asIs: T[],
  changes: C[],
  keyOf: (x: T | C) => string,
): Keyed<T, C>[] {
  const out: Keyed<T, C>[] = asIs.map((x) => ({ key: keyOf(x), before: x, after: x }));
  const at = new Map(out.map((e, i) => [e.key, i]));
  for (const c of changes) {
    const key = keyOf(c);
    const i = at.get(key);
    if (c.change === 'removed') {
      if (i !== undefined) out[i] = { ...out[i]!, after: undefined, change: c };
      continue;
    }
    if (i !== undefined) {
      // `added` for an id the as-is has is a finding; here it merges like `changed`.
      out[i] = { ...out[i]!, after: { ...out[i]!.before!, ...itemFields(c) } as T, change: c };
    } else if (c.change === 'added') {
      // `changed` for an id the as-is lacks is a finding; it has nothing to change here.
      at.set(key, out.length);
      out.push({ key, after: itemFields(c) as unknown as T, change: c });
    }
  }
  return out;
}

function statusOf<T>(e: Keyed<T, unknown>): DiffStatus {
  if (e.before === undefined) return 'added';
  if (e.after === undefined) return 'removed';
  return e.change === undefined ? 'same' : 'changed';
}

/** The to-be architecture and the status of each zone, part and link. */
export function applyArchitectureChange(asIs: SystemArchitecture | undefined, change: ArchitectureChange | undefined): ArchitectureCompare {
  const before = isObject(asIs) ? asIs : undefined;
  const ch = isObject(change) ? change : undefined;
  const zoneKeyed = applyList<Zone, NonNullable<ArchitectureChange['zones']>[number]>(
    asArray<Zone>(before?.zones).filter(isObject),
    asArray<NonNullable<ArchitectureChange['zones']>[number]>(ch?.zones).filter(isObject),
    (x) => String(x.id),
  );
  const partKeyed = applyList<Part, NonNullable<ArchitectureChange['components']>[number]>(
    asArray<Part>(before?.components).filter(isObject),
    asArray<NonNullable<ArchitectureChange['components']>[number]>(ch?.components).filter(isObject),
    (x) => String(x.id),
  );
  const linkKeyed = applyList<ArchLink, NonNullable<ArchitectureChange['links']>[number]>(
    asArray<ArchLink>(before?.links).filter(isObject),
    asArray<NonNullable<ArchitectureChange['links']>[number]>(ch?.links).filter(isObject),
    (x) => linkKey(x),
  );

  const zones: ZoneDiff[] = zoneKeyed.map((e) => {
    const status = statusOf(e);
    const d: ZoneDiff = { id: e.key, status, ...reason(e.change) };
    if (e.before) d.before = e.before;
    if (e.after) d.after = e.after;
    const what = e.change?.what ?? (status === 'changed' ? fieldChanges(e.before, e.after, ['name', 'about', 'trust']) : undefined);
    if (what) d.what = what;
    return d;
  });
  const parts: PartDiff[] = partKeyed.map((e) => {
    const status = statusOf(e);
    const d: PartDiff = { id: e.key, status, ...reason(e.change) };
    if (e.before) d.before = e.before;
    if (e.after) d.after = e.after;
    const what = e.change?.what ?? (status === 'changed' ? fieldChanges(e.before, e.after, ['name', 'kind', 'zone', 'about']) : undefined);
    if (what) d.what = what;
    return d;
  });
  // A link to a removed part goes with it, for the reasons of that part.
  const removedPart = new Map(parts.filter((p) => p.status === 'removed').map((p) => [p.id, p]));
  const links: LinkDiff[] = linkKeyed.map((e) => {
    const ends = (e.after ?? e.before)!;
    const gone = removedPart.get(ends.from) ?? removedPart.get(ends.to);
    if (gone && e.after && e.before) {
      const d: LinkDiff = { from: ends.from, to: ends.to, status: 'removed', before: e.before, why: [...gone.why], stories: [...gone.stories], what: `goes with ${gone.id}` };
      return d;
    }
    const status = statusOf(e);
    const d: LinkDiff = { from: ends.from, to: ends.to, status, ...reason(e.change) };
    if (e.before) d.before = e.before;
    if (e.after) d.after = e.after;
    const what = e.change?.what ?? (status === 'changed' ? fieldChanges(e.before, e.after, ['label']) : undefined);
    if (what) d.what = what;
    return d;
  });

  const result: ArchitectureCompare = { zones, parts, links };
  if (before) result.before = before;
  if (before || ch) {
    const liveZones = new Set(zones.filter((z) => z.after).map((z) => z.id));
    const after: SystemArchitecture = {
      version: 1,
      zones: zones.flatMap((z) => (z.after ? [z.after] : [])),
      components: parts.flatMap((p) => (p.after ? [p.after] : [])),
      links: links.flatMap((l) => (l.after ? [l.after] : [])),
    };
    if (before?.title !== undefined) after.title = before.title;
    if (before?.about !== undefined) after.about = before.about;
    const notes = asArray<NonNullable<SystemArchitecture['notes']>[number]>(before?.notes).filter(
      (n) => isObject(n) && (n.zone === undefined || liveZones.has(n.zone)),
    );
    if (notes.length > 0) after.notes = notes;
    result.after = after;
  }
  return result;
}

// ---------------------------------------------------------------- flow

/** A box without the fields that say who it serves or how it is tested: those do not change what it does. */
function boxShape(box: Box): Record<string, unknown> {
  const { path: _p, children: _c, stories: _s, examples: _e, ...rest } = box;
  return rest;
}

function mapChanges(label: string, before: unknown, after: unknown): string | undefined {
  const b = isObject(before) ? (before as Record<string, unknown>) : {};
  const a = isObject(after) ? (after as Record<string, unknown>) : {};
  const parts: string[] = [];
  for (const k of Object.keys(a)) if (!(k in b)) parts.push(`+ ${k}`);
  for (const k of Object.keys(b)) if (!(k in a)) parts.push(`− ${k}`);
  for (const k of Object.keys(a)) if (k in b && b[k] !== a[k]) parts.push(`${k}: ${String(b[k])} → ${String(a[k])}`);
  return parts.length > 0 ? `${label}: ${parts.join(', ')}` : undefined;
}

function listChanges(label: string, before: unknown, after: unknown): string | undefined {
  const b = asArray<string>(before);
  const a = asArray<string>(after);
  const parts = [...a.filter((x) => !b.includes(x)).map((x) => `+ ${x}`), ...b.filter((x) => !a.includes(x)).map((x) => `− ${x}`)];
  return parts.length > 0 ? `${label}: ${parts.join(', ')}` : undefined;
}

/** What changes in a box, in words: `in: + contextBundle; title: a → b`. */
export function describeBoxChange(before: Box, after: Box): string {
  const parts = [
    fieldChanges(before, after, ['title', 'kind', 'lane']),
    mapChanges('in', before.inputs, after.inputs),
    mapChanges('out', before.outputs, after.outputs),
    listChanges('reads', before.reads, after.reads),
    listChanges('writes', before.writes, after.writes),
    listChanges('side effects', before.sideEffects, after.sideEffects),
    listChanges('error exits', before.errorExits, after.errorExits),
  ].filter((x): x is string => x !== undefined);
  return parts.length > 0 ? parts.join('; ') : 'no change';
}

/** A new box in words: `in: target, budget → out: contextBundle`. */
export function describeBox(box: Box): string {
  const ins = Object.keys(isObject(box.inputs) ? box.inputs : {});
  const outs = Object.keys(isObject(box.outputs) ? box.outputs : {});
  const parts = [ins.length ? `in: ${ins.join(', ')}` : '', outs.length ? `out: ${outs.join(', ')}` : ''].filter(Boolean);
  return parts.join(' → ');
}

/** The status of each box of the EPIC's flow against the as-is flow, then the as-is boxes it keeps or removes. */
export function compareFlows(asIs: Flow | undefined, epic: Flow | undefined, notes: BoxNote[] = []): BoxDiff[] {
  const asIdx = indexBoxes(asIs);
  const epIdx = indexBoxes(epic);
  const noteAt = new Map(asArray<BoxNote>(notes).filter((n) => isObject(n) && typeof n.path === 'string').map((n) => [n.path, n]));
  const out: BoxDiff[] = [];
  const seen = new Set<string>();
  const storiesOf = (box: Box | undefined, note: BoxNote | undefined) => [...new Set([...asArray<Id>(box?.stories), ...asArray<Id>(note?.stories)])];

  for (const [path, { box: after }] of epIdx) {
    seen.add(path);
    const before = asIdx.get(path)?.box;
    const note = noteAt.get(path);
    const status: DiffStatus = !before ? 'added' : canonicalJson(boxShape(before)) === canonicalJson(boxShape(after)) ? 'same' : 'changed';
    const what = note?.what ?? (status === 'changed' ? describeBoxChange(before!, after) : status === 'added' ? describeBox(after) : undefined);
    const d: BoxDiff = { path, title: after.title, status, after, inEpic: true, asIsStories: [...asArray<Id>(before?.stories)], why: [...asArray<Id>(note?.why)], stories: storiesOf(after, note) };
    if (before) d.before = before;
    if (what) d.what = what;
    out.push(d);
  }
  for (const [path, { box: before }] of asIdx) {
    if (seen.has(path)) continue;
    seen.add(path);
    const note = noteAt.get(path);
    const removed = note?.change === 'removed';
    const d: BoxDiff = {
      path,
      title: before.title,
      status: removed ? 'removed' : 'same',
      before,
      inEpic: removed,
      asIsStories: [...asArray<Id>(before.stories)],
      why: removed ? [...asArray<Id>(note.why)] : [],
      stories: removed ? storiesOf(undefined, note) : [],
    };
    if (!removed) d.after = before;
    if (removed && note.what) d.what = note.what;
    out.push(d);
  }
  // A removed step that the as-is flow never had (work done outside the tool), named by its title.
  for (const note of noteAt.values()) {
    if (seen.has(note.path) || note.change !== 'removed') continue;
    const d: BoxDiff = { path: note.path, title: note.title ?? note.path, status: 'removed', inEpic: true, asIsStories: [], why: [...asArray<Id>(note.why)], stories: storiesOf(undefined, note) };
    if (note.what) d.what = note.what;
    out.push(d);
  }
  return out;
}

// ---------------------------------------------------------------- entities

/** What changes in an entity, in words: `fields: + trust, kind: string → enum[a, b]`. */
export function describeEntityChange(before: EntityDef, after: EntityDef): string {
  const parts = [fieldChanges(before, after, ['about']), mapChanges('fields', before.fields, after.fields)].filter((x): x is string => x !== undefined);
  if (canonicalJson(before.lifecycle ?? null) !== canonicalJson(after.lifecycle ?? null)) parts.push('lifecycle changes');
  return parts.length > 0 ? parts.join('; ') : 'no change';
}

export function compareEntities(asIs: EntityModel | undefined, epic: EntityModel | undefined, notes: EntityNote[] = []): EntityDiff[] {
  const defs = (m: EntityModel | undefined) => asArray<EntityDef>(isObject(m) ? m.entities : undefined).filter((e) => isObject(e) && typeof e.id === 'string');
  const asById = new Map(defs(asIs).map((e) => [e.id, e]));
  const noteAt = new Map(asArray<EntityNote>(notes).filter((n) => isObject(n) && typeof n.id === 'string').map((n) => [n.id, n]));
  const out: EntityDiff[] = [];
  const seen = new Set<string>();
  for (const after of defs(epic)) {
    if (seen.has(after.id)) continue;
    seen.add(after.id);
    const before = asById.get(after.id);
    const note = noteAt.get(after.id);
    const status: DiffStatus = !before ? 'added' : canonicalJson(before) === canonicalJson(after) ? 'same' : 'changed';
    const what = note?.what ?? (status === 'changed' ? describeEntityChange(before!, after) : status === 'added' ? Object.keys(isObject(after.fields) ? after.fields : {}).join(', ') : undefined);
    const d: EntityDiff = { id: after.id, status, after, inEpic: true, ...reason(note) };
    if (before) d.before = before;
    if (what) d.what = what;
    out.push(d);
  }
  for (const before of asById.values()) {
    if (seen.has(before.id)) continue;
    const note = noteAt.get(before.id);
    const removed = note?.change === 'removed';
    const d: EntityDiff = { id: before.id, status: removed ? 'removed' : 'same', before, inEpic: removed, ...(removed ? reason(note) : { why: [], stories: [] }) };
    if (!removed) d.after = before;
    if (removed && note.what) d.what = note.what;
    out.push(d);
  }
  return out;
}

// ---------------------------------------------------------------- all

export interface EpicSide {
  flow?: Flow;
  entities?: EntityModel;
  architecture?: ArchitectureChange;
}

/** The whole before / after: architecture, flow and entities. */
export function compareSystem(system: Pick<SystemRecord, 'architecture' | 'flow' | 'entities'> | undefined, epic: EpicSide): SystemCompare {
  const change = isObject(epic.architecture) ? epic.architecture : undefined;
  const out: SystemCompare = {
    hasSystem: isObject(system?.architecture),
    hasChange: change !== undefined,
    architecture: applyArchitectureChange(system?.architecture, change),
    // Without a change file the EPIC's flow is not a change to the system: there is nothing to compare.
    boxes: change ? compareFlows(system?.flow, epic.flow, asArray<BoxNote>(change.boxes)) : [],
    entities: change ? compareEntities(system?.entities, epic.entities, asArray<EntityNote>(change.entities)) : [],
  };
  const asIsEpic = isObject(system?.flow) && typeof system.flow.epic === 'string' ? system.flow.epic : undefined;
  if (asIsEpic) out.asIsEpic = asIsEpic;
  return out;
}

/** How many items have each status. */
export function countDiffs(items: { status: DiffStatus }[]): DiffCounts {
  const c: DiffCounts = { added: 0, changed: 0, same: 0, removed: 0 };
  for (const i of items) c[i.status]++;
  return c;
}
