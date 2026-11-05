// Box `simulate/lifecycles` (R6, S3-A3).
// Along each scenario, apply the `writes` `Entity.field:from->to` of each box (and of each parent
// box when a step enters it). A step that leaves by an error exit changes nothing (the box failed).
// The state before a write is the state the scenario reached, or `from` when it is not known yet.
// Example `given` and `stateAfter` keys `Entity.field` set the state too.
// Findings: a transition the lifecycle does not permit (scenario, box, transition), a box that
// declares such a transition, and a lifecycle state that no box can reach.

import type { BoxEntry } from '../flow-index.js';
import { enumValues } from '../validate/refs.js';
import { RECORD_FILES, type Box, type EntityDef, type EntityModel, type Finding, type Lifecycle } from '../types.js';
import { asArray, cmp, isObject } from '../util.js';
import { parseAccess, type Access } from './access.js';
import type { LoadedScenario } from './types.js';
import { walkScenario } from './walk.js';

/** `Entity.field` → state. The end state of each scenario, used by acceptance. */
export type EndStates = Map<string, Record<string, unknown>>;

interface Machine {
  entity: string;
  lifecycle: Lifecycle;
}

export function checkLifecycles(
  entities: EntityModel | undefined,
  index: Map<string, BoxEntry>,
  scenarios: LoadedScenario[],
): { findings: Finding[]; endStates: EndStates } {
  const machines = new Map<string, Machine>(); // `Entity.field` → lifecycle
  for (const e of asArray<EntityDef>(entities?.entities)) {
    if (isObject(e) && isObject(e.lifecycle) && typeof e.lifecycle.field === 'string') {
      machines.set(`${e.id}.${e.lifecycle.field}`, { entity: e.id, lifecycle: e.lifecycle });
    }
  }
  const out: Finding[] = [];
  const endStates: EndStates = new Map();

  // Declared transitions, per box.
  for (const { box, path } of index.values()) {
    for (const w of transitions(box)) {
      const m = machines.get(`${w.entity}.${w.field}`);
      if (m && !permitted(m.lifecycle, w.from!, w.to!)) {
        out.push({
          kind: 'lifecycle',
          file: RECORD_FILES.flow,
          path,
          message: `writes ${show(w)}: the ${m.entity} lifecycle does not permit ${arrow(w.from!, w.to!)}${permittedHint(m.lifecycle, w.from!)}`,
          refs: stories(box),
        });
      }
    }
  }

  // Along each scenario.
  for (const { file, scenario } of scenarios) {
    const state: Record<string, unknown> = {};
    for (const step of walkScenario(index, scenario)) {
      setState(state, step.example?.given);
      if (!step.error) {
        for (const boxPath of [...step.entered, step.path]) {
          const box = index.get(boxPath)?.box;
          if (!box) continue;
          for (const [key, writes] of groupByField(transitions(box))) {
            const m = machines.get(key);
            const cur = typeof state[key] === 'string' ? (state[key] as string) : undefined;
            const match = cur === undefined ? undefined : (writes.find((w) => w.from === cur) ?? writes.find((w) => w.from === ''));
            if (cur !== undefined && !match) {
              const w = writes[0]!;
              out.push(stepFinding(file, step.at, scenario.story, `${scenario.id}: box ${boxPath} writes ${writes.map(show).join(', ')}, but ${key} is ${cur} here, so the step changes ${key} ${arrow(cur, w.to!)}${m && !permitted(m.lifecycle, cur, w.to!) ? `, which the ${m.entity} lifecycle does not permit${permittedHint(m.lifecycle, cur)}` : ''}`));
              state[key] = w.to;
              continue;
            }
            // The matching transition, or each declared one when the state is not known yet.
            for (const w of match ? [match] : writes) {
              if (m && !permitted(m.lifecycle, w.from!, w.to!)) {
                out.push(stepFinding(file, step.at, scenario.story, `${scenario.id}: box ${boxPath} changes ${key} ${arrow(w.from!, w.to!)}, which the ${m.entity} lifecycle does not permit${permittedHint(m.lifecycle, w.from!)}`));
              }
            }
            const tos = new Set((match ? [match] : writes).map((w) => w.to));
            if (tos.size === 1) state[key] = [...tos][0];
            else delete state[key];
          }
        }
        setState(state, step.example?.stateAfter);
      }
    }
    endStates.set(scenario.id, state);
  }

  // States that no box can reach: start at `initial`, follow the declared transitions.
  for (const [key, m] of [...machines].sort((a, b) => cmp(a[0], b[0]))) {
    const def = asArray<EntityDef>(entities?.entities).find((e) => isObject(e) && e.id === m.entity);
    const type = isObject(def?.fields) ? def.fields[m.lifecycle.field] : undefined;
    const states = typeof type === 'string' ? (enumValues(type) ?? []) : [];
    const writes = [...index.values()].flatMap(({ box }) => transitions(box)).filter((w) => `${w.entity}.${w.field}` === key);
    const reached = new Set<string>([m.lifecycle.initial]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const w of writes) {
        if ((w.from === '' || reached.has(w.from!)) && !reached.has(w.to!)) {
          reached.add(w.to!);
          grew = true;
        }
      }
    }
    for (const s of states) {
      if (!reached.has(s)) {
        out.push({
          kind: 'lifecycle',
          file: RECORD_FILES.entities,
          path: m.entity,
          message: `${key} state ${s}: no box can reach it (no box writes a transition into it from a reachable state)`,
          refs: [],
        });
      }
    }
  }
  return { findings: out, endStates };
}

function transitions(box: Box): Access[] {
  return asArray(box.writes)
    .map(parseAccess)
    .filter((a): a is Access => a !== undefined && a.to !== undefined);
}

function groupByField(writes: Access[]): Map<string, Access[]> {
  const out = new Map<string, Access[]>();
  for (const w of writes) {
    const key = `${w.entity}.${w.field}`;
    out.set(key, [...(out.get(key) ?? []), w]);
  }
  return out;
}

/** `''` → `to` is permitted when `to` is the initial state (the item is created). */
function permitted(lc: Lifecycle, from: string, to: string): boolean {
  if (from === '') return to === lc.initial;
  return asArray<Record<string, unknown>>(lc.transitions).some((t) => isObject(t) && t.from === from && t.to === to);
}

function permittedHint(lc: Lifecycle, from: string): string {
  if (from === '') return ` (a new item starts at ${lc.initial})`;
  const tos = asArray<Record<string, unknown>>(lc.transitions)
    .filter((t) => isObject(t) && t.from === from)
    .map((t) => String(t.to));
  return tos.length ? ` (from ${from} it permits: ${tos.join(', ')})` : ` (no transition from ${from})`;
}

function arrow(from: string, to: string): string {
  return `${from === '' ? '(new)' : from} -> ${to}`;
}

function show(w: Access): string {
  return `${w.entity}.${w.field}:${w.from}->${w.to}`;
}

function stories(box: Box): string[] {
  return [...new Set(asArray<string>(box.stories).filter((s) => typeof s === 'string'))].sort(cmp);
}

function stepFinding(file: string, at: string, story: string, message: string): Finding {
  return { kind: 'lifecycle', file, path: at, message, refs: [story] };
}

/** Copy `Entity.field` keys (a capitalised entity, a dot, a field) into the state. */
function setState(state: Record<string, unknown>, values: unknown): void {
  if (!isObject(values)) return;
  for (const [k, v] of Object.entries(values)) if (/^[A-Z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$/.test(k)) state[k] = v;
}
