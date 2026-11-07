// Read docs/system/ (the system as built) and the decision ids of the brainstorm logs.
// Every file is optional; a YAML syntax error gives a finding, never a throw.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { EntityModel, Finding, Flow } from '../types.js';
import { parseYaml } from '../yaml.js';
import { parseDecisionTexts } from '../trust/build-brief.js';
import { SYSTEM_DIR_NAME, SYSTEM_FILES, type SystemArchitecture, type SystemLoadResult, type SystemRecord } from './types.js';

/** docs/system/ of the repo that holds `docs/epics/<slug>/`. */
export function systemDirFor(epicDir: string): string {
  return resolve(epicDir, '..', '..', 'system');
}

/** The name a finding gives a file of docs/system/. */
export function systemFile(file: string): string {
  return `${SYSTEM_DIR_NAME}/${file}`;
}

/** Load docs/system/. A missing folder or file is not a finding: the system has no as-is yet. */
export function loadSystem(dir: string): SystemLoadResult {
  const abs = resolve(dir);
  const findings: Finding[] = [];
  const raw: Record<string, unknown> = {};
  const exists = existsSync(abs) && statSync(abs).isDirectory();
  const system: SystemRecord = { dir: abs, exists, raw };
  if (!exists) return { system, findings };
  for (const file of Object.values(SYSTEM_FILES)) {
    const full = join(abs, file);
    if (!existsSync(full)) continue;
    let text: string;
    try {
      text = readFileSync(full, 'utf8');
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? 'error';
      findings.push({ kind: 'schema', file: systemFile(file), path: '', message: `cannot read file (${code})`, refs: [] });
      continue;
    }
    const { value, finding } = parseYaml(text, systemFile(file));
    if (finding) findings.push(finding);
    else raw[file] = value;
  }
  if (raw[SYSTEM_FILES.architecture] !== undefined) system.architecture = structuredClone(raw[SYSTEM_FILES.architecture]) as SystemArchitecture;
  if (raw[SYSTEM_FILES.flow] !== undefined) system.flow = structuredClone(raw[SYSTEM_FILES.flow]) as Flow;
  if (raw[SYSTEM_FILES.entities] !== undefined) system.entities = structuredClone(raw[SYSTEM_FILES.entities]) as EntityModel;
  return { system, findings };
}

/** Ids of the decisions in a brainstorm log: each `- **D4 Title**`, `- **G2 Title**` or `- **D2/D6 Title**` line. */
export function parseDecisionIds(markdown: string): string[] {
  const out = new Set<string>();
  for (const m of markdown.matchAll(/^\s*[-*]\s+\*\*([A-Z]+[0-9]+(?:\/[A-Z]+[0-9]+)*)\b/gm)) for (const id of m[1]!.split('/')) out.add(id);
  return [...out].sort();
}

/**
 * Decision ids of every brainstorm.md in docs/epics/: an EPIC's change may cite a decision of
 * an earlier EPIC (the code graph cites D19 of rehearse).
 */
export function decisionIds(epicDir: string): string[] {
  const epics = resolve(epicDir, '..');
  const out = new Set<string>();
  let names: string[] = [];
  try {
    names = readdirSync(epics).sort();
  } catch {
    return [];
  }
  for (const name of names) {
    const file = join(epics, name, 'brainstorm.md');
    if (!existsSync(file)) continue;
    try {
      for (const id of parseDecisionIds(readFileSync(file, 'utf8'))) out.add(id);
    } catch {
      // An unreadable log gives no ids; the why check then reports the ids as unknown.
    }
  }
  return [...out].sort();
}

/** Decision id → text, from every brainstorm.md in docs/epics/ (the build brief, T44). The first EPIC that defines an id wins. */
export function decisionTexts(epicDir: string): Record<string, string> {
  const epics = resolve(epicDir, '..');
  const out: Record<string, string> = {};
  let names: string[] = [];
  try {
    names = readdirSync(epics).sort();
  } catch {
    return out;
  }
  for (const name of names) {
    const file = join(epics, name, 'brainstorm.md');
    if (!existsSync(file)) continue;
    try {
      for (const [id, text] of Object.entries(parseDecisionTexts(readFileSync(file, 'utf8')))) if (!(id in out)) out[id] = text;
    } catch {
      // An unreadable log gives no texts; the brief then lists the ids alone.
    }
  }
  return out;
}
