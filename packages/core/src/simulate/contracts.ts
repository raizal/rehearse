// Box `simulate/contracts` (R4, S3-A1): chain the boxes of each scenario and check data shapes.
// For each step a → b, the fields that a gives must fit the inputs of b:
// - a gives its declared outputs and the fields of its example `then` (except `branch` and `exit`).
//   A decision box routes and does not transform, so it also passes its inputs on.
// - Each required input of b (type without `?`) must be given. A declared output type must fit
//   the input type, and an example value must fit the input type.
// Skipped: a step that leaves by an error exit (the box contract has no shape for error data),
// a start box (a trigger gives no data), and an input box b (its role gives its inputs).
// A declared mismatch is a flow defect: one finding on the box in flow.yaml, with the scenarios
// that show it. An example value mismatch is one finding on the scenario step.
// Flow context (C14): every context field is given on every edge, so an input that is a context
// field is never missing. A box input whose type does not fit the context type is one finding on
// the box, whether or not a scenario passes through it.
// Drafts mode (T22): each finding from a scenario names it with its status, `S1-buy (draft)`.

import { enumValues } from '../validate/refs.js';
import { RECORD_FILES, type Finding } from '../types.js';
import { asArray, cmp, isObject } from '../util.js';
import type { BoxEntry } from '../flow-index.js';
import { fromNote, named } from './load.js';
import type { LoadedScenario } from './types.js';
import { walkScenario } from './walk.js';

const SPECIAL = new Set(['branch', 'exit']);

export function checkContracts(index: Map<string, BoxEntry>, scenarios: LoadedScenario[], context: unknown = {}): Finding[] {
  const out: Finding[] = [];
  const ctx = stringMap(context);
  for (const { box, path } of index.values()) {
    for (const [field, inType] of Object.entries(stringMap(box.inputs))) {
      const ctxType = ctx[field];
      if (ctxType !== undefined && !typeFits(ctxType, inType)) {
        out.push({
          kind: 'contract',
          file: RECORD_FILES.flow,
          path,
          message: `field ${field}: the flow context gives ${ctxType}, ${path} needs ${inType}`,
          refs: [...new Set(asArray<string>(box.stories).filter((s) => typeof s === 'string'))].sort(cmp),
        });
      }
    }
  }
  // key → aggregated flow finding
  const flowFindings = new Map<string, { path: string; message: string; scenarios: Set<string>; stories: Set<string> }>();
  const addFlow = (path: string, message: string, scenario: string, story: string): void => {
    const key = `${path}\n${message}`;
    let f = flowFindings.get(key);
    if (!f) flowFindings.set(key, (f = { path, message, scenarios: new Set(), stories: new Set() }));
    f.scenarios.add(scenario);
    f.stories.add(story);
  };

  for (const loaded of scenarios) {
    const { file, scenario } = loaded;
    for (const step of walkScenario(index, scenario)) {
      if (step.next === undefined || step.error) continue;
      const a = step.entry.box;
      const b = index.get(step.next)!.box;
      if (a.kind === 'start' || b.kind === 'input') continue;
      const arrow = `${step.path} → ${step.next}`;
      const outputs: Record<string, string> = { ...(a.kind === 'decision' ? stringMap(a.inputs) : {}), ...stringMap(a.outputs) };
      const then = isObject(step.example?.then) ? step.example.then : {};
      const given = new Set([...Object.keys(ctx), ...Object.keys(outputs), ...Object.keys(then).filter((k) => !SPECIAL.has(k))]);

      for (const [field, inType] of Object.entries(stringMap(b.inputs))) {
        if (!given.has(field)) {
          if (!isOptional(inType)) {
            const gives = Object.keys(outputs).sort(cmp).join(', ') || 'nothing';
            addFlow(step.path, `${arrow}: missing field ${field} (${step.next} needs ${field}: ${inType}; ${step.path} gives ${gives})`, named(loaded), scenario.story);
          }
          continue;
        }
        const outType = outputs[field];
        if (outType !== undefined && !typeFits(outType, inType)) {
          addFlow(step.path, `${arrow}: field ${field}: ${step.path} gives ${outType}, ${step.next} needs ${inType}`, named(loaded), scenario.story);
        }
        if (Object.hasOwn(then, field) && !valueFits(then[field], inType)) {
          out.push({
            kind: 'contract',
            file,
            path: step.at,
            message: `${arrow}: field ${field}: example ${String(step.example?.id)} gives ${JSON.stringify(then[field])}, ${step.next} needs ${inType}${fromNote(loaded)}`,
            refs: [scenario.story],
          });
        }
      }
    }
  }
  for (const f of flowFindings.values()) {
    out.push({
      kind: 'contract',
      file: RECORD_FILES.flow,
      path: f.path,
      message: `${f.message} in scenario${f.scenarios.size === 1 ? '' : 's'} ${[...f.scenarios].sort(cmp).join(', ')}`,
      refs: [...f.stories].sort(cmp),
    });
  }
  return out;
}

function stringMap(v: unknown): Record<string, string> {
  if (!isObject(v)) return {};
  return Object.fromEntries(Object.entries(v).filter(([, t]) => typeof t === 'string')) as Record<string, string>;
}

function isOptional(type: string): boolean {
  return type.trim().endsWith('?');
}

/** `list ref Finding?` → `list Finding`. */
export function normalizeType(type: string): string {
  return type
    .trim()
    .replace(/\?$/, '')
    .replace(/\bref\s+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .trim();
}

/** Does a value of declared type `out` fit an input of type `input`? */
export function typeFits(out: string, input: string): boolean {
  const o = normalizeType(out);
  const i = normalizeType(input);
  if (o === i) return true;
  const oEnum = enumValues(o);
  if (oEnum) {
    if (i === 'string') return true;
    const iEnum = enumValues(i);
    return iEnum !== undefined && oEnum.every((v) => iEnum.includes(v));
  }
  for (const wrap of ['list', 'map']) {
    if (o.startsWith(`${wrap} `) && i === wrap) return true;
    if (i.startsWith(`${wrap} `) && o === wrap) return true;
    if (o.startsWith(`${wrap} `) && i.startsWith(`${wrap} `)) return typeFits(o.slice(wrap.length + 1), i.slice(wrap.length + 1));
  }
  return false;
}

/** Does an example value fit an input type? Entity types accept an object or an id string. */
export function valueFits(value: unknown, type: string): boolean {
  if (value === null || value === undefined) return isOptional(type);
  const t = normalizeType(type);
  const values = enumValues(t);
  if (values) return typeof value === 'string' && values.includes(value);
  if (t === 'string' || t === 'datetime' || t === 'hash') return typeof value === 'string';
  if (t === 'number') return typeof value === 'number';
  if (t === 'boolean') return typeof value === 'boolean';
  if (t === 'list') return Array.isArray(value);
  if (t.startsWith('list ')) return Array.isArray(value) && value.every((v) => valueFits(v, t.slice(5)));
  if (t === 'map' || t.startsWith('map ')) return isObject(value);
  // An entity (Report, Scenario, Finding, …): an object, or the id of one.
  if (/^[A-Z]/.test(t)) return isObject(value) || typeof value === 'string';
  return true;
}
