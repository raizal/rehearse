// Check docs/system/ and an EPIC's architecture.yaml (D43). An unknown id is a `reference` finding.
// - System: zone, part and link ids; each part's zone; each link's two ends; each note's zone.
// - Change: changed and removed items must be in the as-is, added ones must not; the to-be
//   must hold together (zones, link ends); box and entity notes name boxes and entities of the
//   EPIC or, when removed, of the as-is; stories are in prd.yaml; why ids are decisions.

import { indexBoxes } from '../flow-index.js';
import { RECORD_FILES, type EntityDef, type EpicRecord, type Finding, type Story } from '../types.js';
import { asArray, isObject } from '../util.js';
import { makeReport } from '../validate/report.js';
import { checkDoc } from '../validate/schema.js';
import type { Report } from '../types.js';
import { applyArchitectureChange, linkKey } from './compare.js';
import { loadSystem, systemFile } from './load.js';
import { SYSTEM_FILES, type ArchitectureChange, type ArchLink, type Part, type SystemArchitecture, type SystemRecord, type Zone } from './types.js';

const ARCH = systemFile(SYSTEM_FILES.architecture);
const CHANGE = RECORD_FILES.architecture;

function ref(file: string, path: string, message: string, refs: string[] = []): Finding {
  return { kind: 'reference', file, path, message, refs: [...refs].sort() };
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const v of values) (seen.has(v) ? dup : seen).add(v);
  return [...dup];
}

const idsOf = (xs: unknown[]) => xs.filter((x): x is { id: string } => isObject(x) && typeof x.id === 'string').map((x) => x.id);

/** Reference findings of docs/system/architecture.yaml (or of a to-be built from it). */
export function checkSystemArchitecture(arch: SystemArchitecture | undefined, file = ARCH): Finding[] {
  if (!isObject(arch)) return [];
  const out: Finding[] = [];
  const zones = asArray<Zone>(arch.zones);
  const parts = asArray<Part>(arch.components);
  for (const d of duplicates(idsOf(zones))) out.push(ref(file, `zone ${d}`, `duplicate zone id ${d}`));
  for (const d of duplicates(idsOf(parts))) out.push(ref(file, d, `duplicate component id ${d}`));
  const zoneIds = new Set(idsOf(zones));
  const partIds = new Set(idsOf(parts));
  for (const p of parts.filter(isObject)) {
    if (typeof p.zone === 'string' && !zoneIds.has(p.zone)) out.push(ref(file, String(p.id), `zone ${p.zone} unknown`));
  }
  const links = asArray<ArchLink>(arch.links).filter(isObject);
  for (const d of duplicates(links.map(linkKey))) out.push(ref(file, `link ${d.replace('\u0000', ' -> ')}`, 'duplicate link'));
  for (const l of links) {
    for (const end of [l.from, l.to]) {
      if (typeof end === 'string' && !partIds.has(end)) out.push(ref(file, `link ${l.from} -> ${l.to}`, `component ${end} unknown`));
    }
  }
  asArray<{ zone?: unknown }>(arch.notes).forEach((n, i) => {
    if (isObject(n) && typeof n.zone === 'string' && !zoneIds.has(n.zone)) out.push(ref(file, `notes[${i}]`, `zone ${n.zone} unknown`));
  });
  return out;
}

/** Schema and reference findings of a loaded docs/system/. */
export function checkSystem(system: SystemRecord): Finding[] {
  const out: Finding[] = [];
  const schemas = { [SYSTEM_FILES.architecture]: 'system', [SYSTEM_FILES.flow]: 'flow', [SYSTEM_FILES.entities]: 'entities' } as const;
  for (const [file, doc] of Object.entries(system.raw)) {
    const name = schemas[file as keyof typeof schemas];
    if (name) out.push(...checkDoc(name, systemFile(file), doc));
  }
  out.push(...checkSystemArchitecture(system.architecture));
  return out;
}

/** Load and check docs/system/. A missing folder is OK: the system has no as-is yet. */
export function validateSystem(dir: string): Report {
  const { system, findings } = loadSystem(dir);
  return makeReport('validate', [...findings, ...checkSystem(system)]);
}

/** Reference findings of the EPIC's architecture.yaml against docs/system/, prd.yaml, flow.yaml and entities.yaml. */
export function checkArchitectureChange(record: EpicRecord): Finding[] {
  const change = record.architecture;
  if (!isObject(change)) return [];
  const out: Finding[] = [];
  const asIs = isObject(record.system?.architecture) ? record.system.architecture : undefined;
  const ch = change as ArchitectureChange;

  const checkList = (what: 'zone' | 'component', items: unknown[], asIsIds: Set<string>) => {
    const changes = items.filter((c): c is { id: string; change: string } => isObject(c) && typeof c.id === 'string');
    for (const d of duplicates(changes.map((c) => c.id))) out.push(ref(CHANGE, d, `${what} ${d} is changed more than once`));
    for (const c of changes) {
      if (c.change === 'added' && asIsIds.has(c.id)) out.push(ref(CHANGE, c.id, `${what} ${c.id} is already in ${ARCH}; use change: changed`));
      if ((c.change === 'changed' || c.change === 'removed') && !asIsIds.has(c.id)) {
        out.push(ref(CHANGE, c.id, asIs ? `${what} ${c.id} unknown in ${ARCH}` : `${what} ${c.id} cannot be ${c.change}: there is no ${ARCH}`));
      }
    }
  };
  checkList('zone', asArray(ch.zones), new Set(idsOf(asArray(asIs?.zones))));
  checkList('component', asArray(ch.components), new Set(idsOf(asArray(asIs?.components))));

  const asIsLinks = new Set(asArray<ArchLink>(asIs?.links).filter(isObject).map(linkKey));
  const linkChanges = asArray<ArchLink & { change?: string }>(ch.links).filter((l) => isObject(l) && typeof l.from === 'string' && typeof l.to === 'string');
  for (const d of duplicates(linkChanges.map(linkKey))) out.push(ref(CHANGE, `link ${d.replace('\u0000', ' -> ')}`, 'more than one change names this link'));
  for (const l of linkChanges) {
    const where = `link ${l.from} -> ${l.to}`;
    if (l.change === 'added' && asIsLinks.has(linkKey(l))) out.push(ref(CHANGE, where, `link is already in ${ARCH}; use change: changed`));
    if ((l.change === 'changed' || l.change === 'removed') && !asIsLinks.has(linkKey(l))) out.push(ref(CHANGE, where, `link unknown in ${ARCH}`));
  }

  // The to-be must hold together: zones of parts, ends of links.
  const toBe = applyArchitectureChange(asIs, ch).after;
  if (toBe) {
    const zoneIds = new Set(idsOf(toBe.zones));
    const partIds = new Set(idsOf(toBe.components));
    for (const p of toBe.components) {
      if (typeof p.zone === 'string' && !zoneIds.has(p.zone)) out.push(ref(CHANGE, p.id, `zone ${p.zone} unknown in the to-be`));
    }
    for (const l of linkChanges.filter((l) => l.change !== 'removed')) {
      for (const end of [l.from, l.to]) {
        if (!partIds.has(end)) out.push(ref(CHANGE, `link ${l.from} -> ${l.to}`, `component ${end} unknown in the to-be`));
      }
    }
  }

  // Box notes: boxes of this EPIC's flow, or removed boxes of the as-is flow.
  const epicBoxes = indexBoxes(record.flow);
  const asIsBoxes = indexBoxes(record.system?.flow);
  for (const n of asArray<{ path?: unknown; change?: unknown; title?: unknown }>(ch.boxes).filter(isObject)) {
    if (typeof n.path !== 'string') continue;
    if (n.change === 'removed') {
      if (epicBoxes.has(n.path)) out.push(ref(CHANGE, `box ${n.path}`, `box ${n.path} is removed but is still in ${RECORD_FILES.flow}`));
      else if (!asIsBoxes.has(n.path) && typeof n.title !== 'string') {
        out.push(ref(CHANGE, `box ${n.path}`, `box ${n.path} unknown in ${systemFile(SYSTEM_FILES.flow)}; a step outside the record needs a title`));
      }
    } else if (!epicBoxes.has(n.path)) {
      out.push(ref(CHANGE, `box ${n.path}`, `box ${n.path} unknown in ${RECORD_FILES.flow}`));
    }
  }
  const epicEntities = new Set(idsOf(asArray<EntityDef>(record.entities?.entities)));
  const asIsEntities = new Set(idsOf(asArray<EntityDef>(record.system?.entities?.entities)));
  for (const n of asArray<{ id?: unknown; change?: unknown }>(ch.entities).filter(isObject)) {
    if (typeof n.id !== 'string') continue;
    if (n.change === 'removed') {
      if (!asIsEntities.has(n.id)) out.push(ref(CHANGE, `entity ${n.id}`, `entity ${n.id} unknown in ${systemFile(SYSTEM_FILES.entities)}`));
    } else if (!epicEntities.has(n.id)) {
      out.push(ref(CHANGE, `entity ${n.id}`, `entity ${n.id} unknown in ${RECORD_FILES.entities}`));
    }
  }

  // Stories and decisions of every item.
  const storyIds = new Set(idsOf(asArray<Story>(record.prd?.stories)));
  const decisions = new Set(asArray<string>(record.decisions));
  const items: { where: string; stories?: unknown; why?: unknown }[] = [
    ...asArray<any>(ch.zones).filter(isObject).map((c) => ({ where: `zone ${c.id}`, stories: c.stories, why: c.why })),
    ...asArray<any>(ch.components).filter(isObject).map((c) => ({ where: String(c.id), stories: c.stories, why: c.why })),
    ...linkChanges.map((c: any) => ({ where: `link ${c.from} -> ${c.to}`, stories: c.stories, why: c.why })),
    ...asArray<any>(ch.boxes).filter(isObject).map((c) => ({ where: `box ${c.path}`, stories: c.stories, why: c.why })),
    ...asArray<any>(ch.entities).filter(isObject).map((c) => ({ where: `entity ${c.id}`, stories: c.stories, why: c.why })),
  ];
  for (const it of items) {
    for (const s of asArray<unknown>(it.stories).filter((s): s is string => typeof s === 'string')) {
      if (!record.prd) out.push(ref(CHANGE, it.where, `story ${s}: there is no ${RECORD_FILES.prd} yet`, [s]));
      else if (!storyIds.has(s)) out.push(ref(CHANGE, it.where, `story ${s} unknown`, [s]));
    }
    if (decisions.size === 0) continue;
    for (const w of asArray<unknown>(it.why).filter((w): w is string => typeof w === 'string')) {
      if (!decisions.has(w)) out.push(ref(CHANGE, it.where, `decision ${w} unknown (no brainstorm.md in docs/epics/ has it)`));
    }
  }
  return out;
}
