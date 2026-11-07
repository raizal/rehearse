// Box `validate/refs`: check references across files (R3, R21).
// story → requirement, story → role, box → story, box → lane → role, lifecycle actor → role,
// state access → entity field, scenario → story, criterion, box path.
// The checks run on drafts that may also have schema findings, so they guard every access.

import { hasChildren, indexBoxes, type BoxEntry } from '../flow-index.js';
import {
  RECORD_FILES,
  type AcceptanceCriterion,
  type Box,
  type EntityDef,
  type EpicRecord,
  type Finding,
  type Lane,
  type Requirement,
  type Role,
  type Story,
} from '../types.js';
import { asArray, isObject } from '../util.js';

const PRD = RECORD_FILES.prd;
const FLOW = RECORD_FILES.flow;
const ENTITIES = RECORD_FILES.entities;

function ref(file: string, path: string, message: string, refs: string[] = []): Finding {
  return { kind: 'reference', file, path, message, refs: [...refs].sort() };
}

function ids<T extends { id?: unknown }>(items: T[]): string[] {
  return items.filter((x) => isObject(x) && typeof x.id === 'string').map((x) => x.id as string);
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const v of values) (seen.has(v) ? dup : seen).add(v);
  return [...dup];
}

export function checkRefs(record: EpicRecord): Finding[] {
  const out: Finding[] = [];
  const prd = isObject(record.prd) ? record.prd : undefined;
  const roles = asArray<Role>(prd?.roles);
  const requirements = asArray<Requirement>(prd?.requirements);
  const stories = asArray<Story>(prd?.stories).filter(isObject) as Story[];
  const roleIds = new Set(ids(roles));
  const reqIds = new Set(ids(requirements));
  const storyById = new Map(stories.filter((s) => typeof s.id === 'string').map((s) => [s.id, s]));

  // ---- prd.yaml
  if (prd) {
    for (const d of duplicates(ids(roles))) out.push(ref(PRD, `role ${d}`, `duplicate role id ${d}`));
    for (const d of duplicates(ids(requirements))) out.push(ref(PRD, d, `duplicate requirement id ${d}`, [d]));
    for (const d of duplicates(ids(stories))) out.push(ref(PRD, d, `duplicate story id ${d}`, [d]));
    const criteria = stories.flatMap((s) => ids(asArray<AcceptanceCriterion>(s.acceptance)));
    for (const d of duplicates(criteria)) out.push(ref(PRD, d, `two or more criteria have the id ${d}`, [d]));

    for (const s of stories) {
      const sid = String(s.id);
      if (typeof s.role === 'string' && !roleIds.has(s.role)) {
        out.push(ref(PRD, sid, `role ${s.role} unknown`, [sid]));
      }
      for (const r of asArray(s.requirements)) {
        if (typeof r === 'string' && !reqIds.has(r)) out.push(ref(PRD, sid, `requirement ${r} unknown`, [sid, r]));
      }
      for (const a of ids(asArray<AcceptanceCriterion>(s.acceptance))) {
        if (!a.startsWith(`${sid}-`)) {
          out.push(ref(PRD, sid, `acceptance criterion ${a} does not start with ${sid}-`, [sid, a]));
        }
      }
    }
  }

  // ---- entities.yaml
  const entities = new Map<string, EntityDef>();
  const model = isObject(record.entities) ? record.entities : undefined;
  if (model) {
    const defs = asArray<EntityDef>(model.entities).filter(isObject) as EntityDef[];
    for (const d of duplicates(ids(defs))) out.push(ref(ENTITIES, d, `duplicate entity id ${d}`));
    for (const e of defs) {
      if (typeof e.id !== 'string') continue;
      if (!entities.has(e.id)) entities.set(e.id, e);
      const lc = e.lifecycle;
      if (isObject(lc) && typeof lc.field === 'string' && isObject(e.fields) && !Object.hasOwn(e.fields, lc.field)) {
        out.push(ref(ENTITIES, e.id, `lifecycle field ${lc.field} is not a field of ${e.id}`));
      }
      // Transition actor → role (C7).
      if (prd && isObject(lc)) {
        for (const t of asArray<Record<string, unknown>>(lc.transitions)) {
          if (isObject(t) && typeof t.by === 'string' && !roleIds.has(t.by)) {
            out.push(ref(ENTITIES, e.id, `lifecycle transition ${String(t.from)} -> ${String(t.to)}: role ${t.by} unknown`));
          }
        }
      }
    }
  }

  // ---- flow.yaml
  const flow = isObject(record.flow) ? record.flow : undefined;
  const index = indexBoxes(record.flow);
  if (flow) {
    const lanes = asArray<Lane>(flow.lanes).filter(isObject) as Lane[];
    const laneRoles = new Set<string>();
    lanes.forEach((lane, i) => {
      if (typeof lane.role !== 'string') return;
      if (laneRoles.has(lane.role)) out.push(ref(FLOW, `lanes[${i}]`, `duplicate lane ${lane.role}`));
      laneRoles.add(lane.role);
      if (prd && !roleIds.has(lane.role)) {
        out.push(ref(FLOW, `lanes[${i}]`, `lane ${lane.role}: role ${lane.role} unknown (prd.yaml roles)`));
      }
    });
    if (prd && isObject(prd.epic) && typeof flow.epic === 'string' && flow.epic !== prd.epic.slug) {
      out.push(ref(FLOW, 'epic', `epic ${flow.epic} does not match prd.yaml epic.slug ${String(prd.epic.slug)}`));
    }
    checkDiagramIds(flow.root, '', out);
    const decisions = new Set(asArray<string>(record.decisions));

    for (const { box, path } of index.values()) {
      if (typeof box.lane === 'string' && !laneRoles.has(box.lane)) {
        out.push(ref(FLOW, path, `lane ${box.lane} unknown`));
      }
      if (prd) {
        for (const s of asArray(box.stories)) {
          if (typeof s === 'string' && !storyById.has(s)) out.push(ref(FLOW, path, `story ${s} unknown`, [s]));
        }
      }
      // A box names the decisions it rests on (T15). No decision log in docs/epics/: nothing to check against.
      if (decisions.size > 0) {
        for (const d of asArray(box.decisions)) {
          if (typeof d === 'string' && !decisions.has(d)) {
            out.push(ref(FLOW, path, `decision ${d} unknown (no brainstorm.md in docs/epics/ has it)`, [d]));
          }
        }
      }
      if (model) {
        for (const r of asArray(box.reads)) if (typeof r === 'string') checkAccess(r, 'reads', path, entities, out);
        for (const w of asArray(box.writes)) if (typeof w === 'string') checkAccess(w, 'writes', path, entities, out);
      }
    }
  }

  // ---- scenarios/*.yaml
  const scenarioSeen = new Map<string, string>();
  for (const sf of record.scenarioFiles) {
    const file = sf.file;
    const story = storyById.get(sf.story);
    if (prd && sf.story !== '' && !story) out.push(ref(file, 'story', `story ${sf.story} unknown`, [sf.story]));
    const criteria = new Set(ids(asArray<AcceptanceCriterion>(story?.acceptance)));
    for (const sc of sf.scenarios) {
      if (!isObject(sc) || typeof sc.id !== 'string') continue;
      const first = scenarioSeen.get(sc.id);
      if (first !== undefined) out.push(ref(file, sc.id, `duplicate scenario id ${sc.id} (first in ${first})`));
      else scenarioSeen.set(sc.id, file);

      const crit = isObject(sc.expect) ? sc.expect.criterion : undefined;
      if (story && typeof crit === 'string' && !criteria.has(crit)) {
        out.push(ref(file, sc.id, `criterion ${crit} is not an acceptance criterion of story ${sf.story}`, [crit, sf.story]));
      }
      if (!flow) continue;
      asArray(sc.steps).forEach((step, i) => {
        if (!isObject(step) || typeof step.name !== 'string') return;
        const at = `${sc.id}/step-${i + 1}`;
        const entry = index.get(step.name);
        if (!entry) {
          out.push(ref(file, at, `box path ${step.name} unknown`));
          return;
        }
        if (hasChildren(entry.box)) {
          out.push(ref(file, at, `box path ${step.name} has children: name a leaf box, not a parent (${leafHint(entry, index)})`));
        }
        const ex = step.example;
        if (isObject(ex) && typeof ex.box === 'string' && ex.box !== step.name) {
          out.push(ref(file, at, `example ${String(ex.id)} names box ${ex.box}, but the step names ${step.name}`));
        }
      });
    }
  }
  return out;
}

function leafHint(entry: BoxEntry, index: Map<string, BoxEntry>): string {
  const children = [...index.values()].filter((e) => e.parent === entry.path).map((e) => e.path);
  return children.join(', ');
}

function checkDiagramIds(diagram: unknown, prefix: string, out: Finding[]): void {
  if (!isObject(diagram)) return;
  const boxes = asArray<Box>(diagram.boxes).filter(isObject) as Box[];
  const boxIds = ids(boxes);
  for (const d of duplicates(boxIds)) out.push(ref(FLOW, prefix + d, `duplicate box id ${d}`));
  const known = new Set(boxIds);
  for (const e of asArray<Record<string, unknown>>(diagram.edges)) {
    if (!isObject(e)) continue;
    for (const end of ['from', 'to'] as const) {
      const id = e[end];
      if (typeof id === 'string' && !known.has(id)) {
        const at = typeof e.from === 'string' && known.has(e.from) ? prefix + e.from : prefix || '(root)';
        out.push(ref(FLOW, at, `edge ${String(e.from)} -> ${String(e.to)}: box ${id} unknown`));
      }
    }
  }
  for (const b of boxes) if (typeof b.id === 'string') checkDiagramIds(b.children, `${prefix}${b.id}/`, out);
}

/** `Entity.field`, `Entity.*` or `Entity.field:from->to` (`from` may be empty: the item is created). */
const ACCESS = /^([A-Z][A-Za-z0-9]*)\.(\*|[A-Za-z][A-Za-z0-9]*)(?::([a-z0-9-]*)->([a-z0-9-]+))?$/;

function checkAccess(
  access: string,
  verb: 'reads' | 'writes',
  path: string,
  entities: Map<string, EntityDef>,
  out: Finding[],
): void {
  const m = ACCESS.exec(access);
  if (!m) {
    out.push(ref(FLOW, path, `${verb} ${access}: use Entity.field, Entity.* or Entity.field:from->to`));
    return;
  }
  const [, entity, field, from, to] = m as unknown as [string, string, string, string | undefined, string | undefined];
  const def = entities.get(entity);
  if (!def) {
    out.push(ref(FLOW, path, `${verb} ${access}: entity ${entity} unknown`));
    return;
  }
  if (field === '*') {
    if (to !== undefined) out.push(ref(FLOW, path, `${verb} ${access}: a state change needs one field, not *`));
    return;
  }
  const type = isObject(def.fields) ? def.fields[field] : undefined;
  if (typeof type !== 'string') {
    out.push(ref(FLOW, path, `${verb} ${access}: field ${field} is not a field of ${entity}`));
    return;
  }
  if (to === undefined) return;
  if (verb === 'reads') {
    out.push(ref(FLOW, path, `reads ${access}: a read cannot change state; move it to writes`));
    return;
  }
  const values = enumValues(type);
  if (!values) {
    out.push(ref(FLOW, path, `writes ${access}: ${entity}.${field} is not an enum, so it has no states`));
    return;
  }
  for (const state of [from, to]) {
    if (state && !values.includes(state)) {
      out.push(ref(FLOW, path, `writes ${access}: ${state} is not a value of ${entity}.${field} (${values.join(', ')})`));
    }
  }
}

/** `enum[draft, signed]` → `['draft', 'signed']`. */
export function enumValues(type: string): string[] | undefined {
  const m = /^enum\[(.*)\]\??$/.exec(type.trim());
  if (!m) return undefined;
  return m[1]!
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}
