// Box `validate/parse`: parse all record files of one EPIC folder.
// A YAML syntax error gives a finding (error exit `yaml-syntax`); it never throws.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { LineCounter, parseDocument, visit } from 'yaml';
import {
  RECORD_FILES,
  type Box,
  type Diagram,
  type EntityModel,
  type EpicRecord,
  type Finding,
  type Flow,
  type LoadResult,
  type Prd,
  type Scenario,
  type ScenarioFile,
  type SignOffLog,
} from './types.js';
import { asArray, isObject } from './util.js';

const REQUIRED_FILES = [RECORD_FILES.prd, RECORD_FILES.entities, RECORD_FILES.flow] as const;

/** Parse YAML text. Returns the value, or a `yaml-syntax` finding for `file`. */
export function parseYaml(text: string, file: string): { value?: unknown; finding?: Finding } {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { prettyErrors: false, uniqueKeys: true, lineCounter });
  const err = doc.errors[0];
  if (err) {
    const pos = lineCounter.linePos(err.pos[0]);
    const where = ` (line ${pos.line}, column ${pos.col})`;
    const reason = err.message.split('\n')[0] ?? err.message;
    return {
      finding: {
        kind: 'schema',
        file,
        path: `line ${pos.line}`,
        message: `yaml-syntax: ${reason}${where}`,
        refs: [],
      },
    };
  }
  // An alias can make a cycle or share one object between two places. Record files do not need them.
  let alias: string | undefined;
  let aliasAt = 0;
  visit(doc, {
    Alias(_key, node) {
      alias = node.source;
      aliasAt = node.range?.[0] ?? 0;
      return visit.BREAK;
    },
  });
  if (alias !== undefined) {
    const pos = lineCounter.linePos(aliasAt);
    return {
      finding: {
        kind: 'schema',
        file,
        path: `line ${pos.line}`,
        message: `yaml-syntax: alias *${alias} is not allowed in record files (line ${pos.line}, column ${pos.col})`,
        refs: [],
      },
    };
  }
  return { value: doc.toJS() };
}

/** Load every record file of one EPIC folder. */
export function loadEpic(dir: string): LoadResult {
  const abs = resolve(dir);
  const findings: Finding[] = [];
  const raw: Record<string, unknown> = {};

  const read = (file: string, required: boolean): unknown => {
    const full = join(abs, file);
    if (!existsSync(full)) {
      if (required) findings.push({ kind: 'schema', file, path: '', message: 'file missing', refs: [] });
      return undefined;
    }
    let text: string;
    try {
      text = readFileSync(full, 'utf8');
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? 'error';
      findings.push({ kind: 'schema', file, path: '', message: `cannot read file (${code})`, refs: [] });
      return undefined;
    }
    const { value, finding } = parseYaml(text, file);
    if (finding) {
      findings.push(finding);
      return undefined;
    }
    raw[file] = value;
    return value;
  };

  for (const f of REQUIRED_FILES) read(f, true);
  read(RECORD_FILES.signoff, false);

  const scenarioNames: string[] = [];
  const sdir = join(abs, RECORD_FILES.scenariosDir);
  if (existsSync(sdir) && statSync(sdir).isDirectory()) {
    for (const name of readdirSync(sdir).sort()) {
      if (!name.endsWith('.yaml') && !name.endsWith('.yml')) continue;
      if (statSync(join(sdir, name)).isFile()) scenarioNames.push(`${RECORD_FILES.scenariosDir}/${name}`);
    }
  }
  for (const f of scenarioNames) read(f, false);

  const record: EpicRecord = {
    dir: abs,
    slug: basename(abs),
    scenarioFiles: [],
    raw,
  };
  if (raw[RECORD_FILES.prd] !== undefined) record.prd = clone(raw[RECORD_FILES.prd]) as Prd;
  if (raw[RECORD_FILES.entities] !== undefined) record.entities = clone(raw[RECORD_FILES.entities]) as EntityModel;
  if (raw[RECORD_FILES.signoff] !== undefined) record.signoff = clone(raw[RECORD_FILES.signoff]) as SignOffLog;
  if (raw[RECORD_FILES.flow] !== undefined) {
    const flow = clone(raw[RECORD_FILES.flow]) as Flow;
    if (isObject(flow) && isObject(flow.root)) addPaths(flow.root, '');
    record.flow = flow;
  }
  for (const file of scenarioNames) {
    const value = raw[file];
    if (value === undefined) continue;
    const doc = clone(value) as Omit<ScenarioFile, 'file'>;
    const story = isObject(doc) && typeof doc.story === 'string' ? doc.story : '';
    const scenarios = (isObject(doc) ? asArray<Scenario>(doc.scenarios) : []).map((s) =>
      isObject(s) ? { ...s, story } : s,
    );
    record.scenarioFiles.push({ file, story, scenarios });
  }
  return { record, findings };
}

function addPaths(diagram: Diagram, prefix: string): void {
  for (const box of asArray<Box>(diagram.boxes)) {
    if (!isObject(box)) continue;
    const path = prefix + String(box.id);
    box.path = path;
    if (isObject(box.children)) addPaths(box.children, `${path}/`);
  }
}

function clone<T>(v: T): T {
  return structuredClone(v);
}
