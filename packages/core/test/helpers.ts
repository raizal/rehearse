// Fixture EPICs for tests: the small `shop` EPIC, changed per test, written to a temp folder.

import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import { validateEpic } from '../src/index.js';
import type { Finding, Report } from '../src/index.js';

export const SHOP = fileURLToPath(new URL('./fixtures/shop', import.meta.url));
export const REAL_EPIC = fileURLToPath(new URL('../../../docs/epics/2026-11-05-rehearse', import.meta.url));
/** The first EPIC frozen at its bootstrap sign-off. The live record changes; this copy does not. */
export const BOOTSTRAP_EPIC = fileURLToPath(new URL('./fixtures/bootstrap/2026-11-05-rehearse', import.meta.url));

/** The parsed YAML files of a fixture, keyed by path relative to the EPIC folder. */
export type Docs = Record<string, any>;

export interface FixtureOptions {
  /** Change the parsed documents. */
  edit?: (docs: Docs) => void;
  /** Replace a file with raw text (for YAML syntax errors). */
  rawFiles?: Record<string, string>;
}

/** Write a copy of the shop fixture, changed by `opts`, and return its folder. */
export function makeEpic(opts: FixtureOptions = {}): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'rehearse-')), '2026-11-05-shop');
  cpSync(SHOP, dir, { recursive: true });
  if (opts.edit) {
    const docs: Docs = {};
    const files = ['prd.yaml', 'entities.yaml', 'flow.yaml', ...readdirSync(join(dir, 'scenarios')).map((f) => `scenarios/${f}`)];
    for (const f of files) docs[f] = parse(readFileSync(join(dir, f), 'utf8'));
    opts.edit(docs);
    for (const [f, doc] of Object.entries(docs)) writeFileSync(join(dir, f), stringify(doc));
  }
  for (const [f, text] of Object.entries(opts.rawFiles ?? {})) writeFileSync(join(dir, f), text);
  return dir;
}

export function validateFixture(opts: FixtureOptions = {}): Report {
  return validateEpic(makeEpic(opts));
}

/** A root box of the fixture flow by id. */
export function box(docs: Docs, id: string): any {
  const b = docs['flow.yaml'].root.boxes.find((x: any) => x.id === id);
  if (!b) throw new Error(`no box ${id}`);
  return b;
}

/** A scenario of the fixture by id. */
export function scenario(docs: Docs, id: string): any {
  for (const [f, doc] of Object.entries(docs)) {
    if (!f.startsWith('scenarios/')) continue;
    const s = doc.scenarios.find((x: any) => x.id === id);
    if (s) return s;
  }
  throw new Error(`no scenario ${id}`);
}

/** Short form of findings for readable assertions. */
export function brief(findings: Finding[]): string[] {
  return findings.map((f) => `${f.kind} ${f.file} ${f.path}: ${f.message}`);
}
