// Fixture EPICs for tests: the small `shop` EPIC, changed per test, written to a temp folder.

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import { detectStale, loadEpic, validateEpic } from '../src/index.js';
import type { Finding, Report } from '../src/index.js';

export const SHOP = fileURLToPath(new URL('./fixtures/shop', import.meta.url));
export const REAL_EPIC = fileURLToPath(new URL('../../../docs/epics/2026-11-05-rehearse', import.meta.url));
/** The live code-graph EPIC. Its approvals and sign-offs change with what the owner signs. */
export const CODE_GRAPH_EPIC = fileURLToPath(new URL('../../../docs/epics/2026-11-05-code-graph', import.meta.url));
/** The code-graph EPIC as signed off before T35's corrections (fixtures/code-graph-signed/README.md). */
export const CODE_GRAPH_SIGNED_EPIC = fileURLToPath(new URL('./fixtures/code-graph-signed/docs/epics/2026-11-05-code-graph', import.meta.url));
/** The first EPIC frozen at its bootstrap sign-off. The live record changes; this copy does not. */
export const BOOTSTRAP_EPIC = fileURLToPath(new URL('./fixtures/bootstrap/2026-11-05-rehearse', import.meta.url));
/**
 * The first EPIC frozen just before the owner's signed approvals and sign-off (7f46920): rule-1
 * sign-offs, stale stories, approvals without a signature. It is never clean, whatever the owner signs.
 */
export const PRESIGNOFF_EPIC = fileURLToPath(new URL('./fixtures/presignoff/2026-11-05-rehearse', import.meta.url));

/**
 * `.rehearse/allowed_signers` of this checkout, the key list the gate checks the live EPIC with.
 * It is untracked: the owner's checkout has it, a clean worktree does not (undefined).
 */
export function liveAllowedSigners(): string | undefined {
  const file = join(REAL_EPIC, '..', '..', '..', '.rehearse', 'allowed_signers');
  return existsSync(file) ? file : undefined;
}

/**
 * The new stories of an EPIC that wait for the owner: never signed off, and every scenario of
 * theirs a draft (for example S11 of the first EPIC, added by T44). The live dogfood tests allow
 * their gate findings and pin everything else.
 */
export function waitingStories(epicDir: string): string[] {
  const { record } = loadEpic(epicDir);
  const scenarios = record.scenarioFiles.flatMap((f) => f.scenarios);
  return detectStale(record)
    .stories.filter((s) => s.status === 'draft' && s.signedHash === undefined)
    .map((s) => s.id)
    .filter((id) => scenarios.filter((sc) => sc.story === id).every((sc) => sc.status === 'draft'));
}

/** Hash of every file under `dir` (names and bytes), to show that a command wrote nothing. */
export function hashDir(dir: string): string {
  const h = createHash('sha256');
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else h.update(`${p}\n`).update(readFileSync(p));
    }
  };
  walk(dir);
  return h.digest('hex');
}

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

/**
 * A copy of the real EPIC (and docs/system/) in a temp repo, with every approval and sign-off
 * signature removed. Tests that need "nothing is signed" use it, so they stay true after the
 * owner signs approvals in the real record.
 */
export function unsignedRealEpic(): string {
  const root = mkdtempSync(join(tmpdir(), 'rehearse-unsigned-'));
  const dir = join(root, 'docs', 'epics', basename(REAL_EPIC));
  cpSync(REAL_EPIC, dir, { recursive: true });
  const system = join(REAL_EPIC, '..', '..', 'system');
  if (existsSync(system)) cpSync(system, join(root, 'docs', 'system'), { recursive: true });
  const strip = (file: string, list: (doc: any) => any[]): void => {
    const path = join(dir, file);
    if (!existsSync(path)) return;
    const doc = parse(readFileSync(path, 'utf8'));
    for (const item of list(doc)) if (item && typeof item === 'object') delete item.sig;
    writeFileSync(path, stringify(doc));
  };
  for (const f of readdirSync(join(dir, 'scenarios')).filter((n) => n.endsWith('.yaml'))) {
    strip(`scenarios/${f}`, (doc) => (doc?.scenarios ?? []).map((sc: any) => sc?.approval));
  }
  strip('signoff.yaml', (doc) => doc?.signOffs ?? []);
  return dir;
}

/** Scenario ids of an EPIC whose approval has no `sig`. */
export function unsignedApprovals(dir: string): string[] {
  return readdirSync(join(dir, 'scenarios'))
    .filter((f) => f.endsWith('.yaml'))
    .flatMap((f) => (parse(readFileSync(join(dir, 'scenarios', f), 'utf8'))?.scenarios ?? []) as { id: string; approval?: { sig?: string } }[])
    .filter((s) => s.approval && !s.approval.sig)
    .map((s) => s.id);
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
