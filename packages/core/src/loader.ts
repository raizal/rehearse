// Box `validate/parse`: parse all record files of one EPIC folder.
// A YAML syntax error gives a finding (error exit `yaml-syntax`); it never throws.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
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
import { indexBoxes } from './flow-index.js';
import { asArray, isObject } from './util.js';
import { parseYaml } from './yaml.js';
import { decisionIds, loadSystem, systemDirFor } from './architecture/load.js';
import type { ArchitectureChange } from './architecture/types.js';

export { parseYaml };

const REQUIRED_FILES = [RECORD_FILES.prd, RECORD_FILES.entities, RECORD_FILES.flow] as const;

/** Load every record file of one EPIC folder. */
export function loadEpic(dir: string): LoadResult {
  const abs = resolve(dir);
  const findings: Finding[] = [];
  const raw: Record<string, unknown> = {};

  const read = (file: string, required: boolean): unknown => {
    const full = join(abs, file);
    if (!existsSync(full)) {
      if (required) findings.push({ kind: 'schema', file, path: '', message: 'file not found', refs: [] });
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
  read(RECORD_FILES.architecture, false);

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
  if (raw[RECORD_FILES.architecture] !== undefined) {
    // The change needs the as-is to check its ids. Only an EPIC with a change reads docs/system/.
    record.architecture = clone(raw[RECORD_FILES.architecture]) as ArchitectureChange;
    record.system = loadSystem(systemDirFor(abs)).system;
    record.decisions = decisionIds(abs);
  }
  if (raw[RECORD_FILES.flow] !== undefined) {
    const flow = clone(raw[RECORD_FILES.flow]) as Flow;
    if (isObject(flow) && isObject(flow.root)) addPaths(flow.root, '');
    record.flow = flow;
    // validate checks the decisions that boxes name, so it needs the decision log too.
    if (record.decisions === undefined && [...indexBoxes(flow).values()].some((e) => asArray(e.box.decisions).length > 0)) {
      record.decisions = decisionIds(abs);
    }
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
