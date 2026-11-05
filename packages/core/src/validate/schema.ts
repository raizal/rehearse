// Box `validate/schema`: check each record file against its JSON Schema (R2).
// A finding names the file, the path in the file, and the reason.

import { readFileSync } from 'node:fs';
import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import { RECORD_FILES, type EpicRecord, type Finding } from '../types.js';
import { asArray, isObject } from '../util.js';

export type SchemaName = 'prd' | 'entities' | 'flow' | 'scenario' | 'signoff' | 'architecture' | 'system';

/** Absolute URL of the JSON Schema file for one record file kind. */
export function schemaUrl(name: SchemaName): URL {
  // src/validate/ and dist/validate/ are both two levels below the package root.
  return new URL(`../../schemas/${name}.schema.json`, import.meta.url);
}

let validators: Map<SchemaName, ValidateFunction> | undefined;

function validator(name: SchemaName): ValidateFunction {
  if (!validators) {
    const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false });
    validators = new Map();
    for (const n of ['prd', 'entities', 'flow', 'scenario', 'signoff', 'architecture', 'system'] as const) {
      validators.set(n, ajv.compile(JSON.parse(readFileSync(schemaUrl(n), 'utf8'))));
    }
  }
  return validators.get(name)!;
}

/** The schema that applies to a record file, or undefined for files without one. */
export function schemaFor(file: string): SchemaName | undefined {
  if (file === RECORD_FILES.prd) return 'prd';
  if (file === RECORD_FILES.entities) return 'entities';
  if (file === RECORD_FILES.flow) return 'flow';
  if (file === RECORD_FILES.signoff) return 'signoff';
  if (file === RECORD_FILES.architecture) return 'architecture';
  if (file.startsWith(`${RECORD_FILES.scenariosDir}/`)) return 'scenario';
  return undefined;
}

/** Schema findings for every parsed file of the record. */
export function checkSchemas(record: EpicRecord): Finding[] {
  const out: Finding[] = [];
  for (const [file, doc] of Object.entries(record.raw)) {
    const name = schemaFor(file);
    if (name) out.push(...checkDoc(name, file, doc));
  }
  return out;
}

/** Schema findings for one parsed document. */
export function checkDoc(name: SchemaName, file: string, doc: unknown): Finding[] {
  const validate = validator(name);
  if (validate(doc)) return [];
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const err of validate.errors ?? []) {
    const f = toFinding(name, file, doc, err);
    if (!f) continue;
    const key = `${f.path}\u0000${f.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

function toFinding(name: SchemaName, file: string, doc: unknown, err: ErrorObject): Finding | undefined {
  // `if` errors only say that a `then` failed; the `then` error is reported itself.
  if (err.keyword === 'if') return undefined;
  const segments = pointerSegments(err.instancePath);
  const yamlPath = toYamlPath(segments);
  const reason = describe(err, segments);
  const idPath = idPathFor(name, doc, segments);
  if (idPath !== undefined) {
    return { kind: 'schema', file, path: idPath, message: `${reason} (at ${yamlPath || '(top)'})`, refs: [] };
  }
  return { kind: 'schema', file, path: yamlPath, message: reason, refs: [] };
}

function describe(err: ErrorObject, segments: string[]): string {
  const field = segments.at(-1);
  const subject = field === undefined || /^\d+$/.test(field) ? 'value' : `field ${field}`;
  const p = err.params as Record<string, any>;
  switch (err.keyword) {
    case 'required':
      return `missing field ${p.missingProperty}`;
    case 'additionalProperties':
      return `unknown field ${p.additionalProperty}`;
    case 'enum':
      return `${subject} must be one of: ${asArray(p.allowedValues).join(', ')}`;
    case 'const':
      return `${subject} must be ${JSON.stringify(p.allowedValue)}`;
    case 'type':
      return `${subject} must be ${p.type}`;
    case 'pattern':
      return `${subject} must match ${p.pattern}`;
    case 'minItems':
      return `${subject} must have at least ${p.limit} item(s)`;
    case 'minLength':
    case 'minProperties':
      return `${subject} must not be empty`;
    default:
      return `${subject} ${err.message ?? 'is not valid'}`;
  }
}

function pointerSegments(pointer: string): string[] {
  if (pointer === '') return [];
  return pointer
    .split('/')
    .slice(1)
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/** `["root","boxes","3","outputs"]` → `root.boxes[3].outputs`. */
export function toYamlPath(segments: string[]): string {
  let out = '';
  for (const s of segments) {
    if (/^\d+$/.test(s)) out += `[${s}]`;
    else if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(s)) out += out === '' ? s : `.${s}`;
    else out += `[${JSON.stringify(s)}]`;
  }
  return out;
}

/**
 * Id-based path for errors inside a flow box (`validate/parse`) or a scenario
 * (`S2-unknown-step` or `S2-unknown-step/step-3`). Undefined for other places.
 */
function idPathFor(name: SchemaName, doc: unknown, segments: string[]): string | undefined {
  if (name === 'flow') {
    const ids: string[] = [];
    let node: unknown = doc;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const next = isObject(node) || Array.isArray(node) ? (node as any)[seg] : undefined;
      if (seg === 'boxes' && Array.isArray(next) && segments[i + 1] !== undefined) {
        const idx = Number(segments[i + 1]);
        const box = next[idx];
        ids.push(isObject(box) && typeof box.id === 'string' ? box.id : `#${idx}`);
        node = box;
        i++;
        continue;
      }
      node = next;
    }
    return ids.length > 0 ? ids.join('/') : undefined;
  }
  if (name === 'scenario' && segments[0] === 'scenarios' && segments[1] !== undefined) {
    const idx = Number(segments[1]);
    const sc = isObject(doc) ? asArray(doc.scenarios)[idx] : undefined;
    const id = isObject(sc) && typeof sc.id === 'string' ? sc.id : `#${idx}`;
    if (segments[2] === 'steps' && segments[3] !== undefined) return `${id}/step-${Number(segments[3]) + 1}`;
    return id;
  }
  return undefined;
}
