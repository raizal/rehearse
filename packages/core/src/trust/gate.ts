// Box `gate`: traced → sim-clean → no-stale → report (R14, S9-A1).
// Simulation findings come in as a parameter, so the gate does not depend on the simulator.

import { indexBoxes } from '../flow-index.js';
import { loadEpic } from '../loader.js';
import { validateRecord } from '../validate/index.js';
import { makeReport } from '../validate/report.js';
import { RECORD_FILES, type EpicRecord, type Finding, type Id, type LoadResult, type Report, type Story } from '../types.js';
import { asArray, isObject } from '../util.js';
import { detectStale } from './stale.js';
import { CURRENT_HASH_RULE, HASH_RULES, type GateReport } from './types.js';

export type GateCheck = 'traced' | 'sim-clean' | 'no-stale';

/** One gate finding with the stories it is about. */
export interface GateItem {
  check: GateCheck;
  finding: Finding;
  /** Stories the finding is about. Empty means the whole EPIC. */
  stories: Id[];
  /** A new sign-off of this story clears the finding (stale story, or an old hash rule). */
  resignStory?: Id;
}

/** A simulator that gives a report for a loaded record. */
export type Simulate = (loaded: LoadResult) => Report;

function stories(record: EpicRecord): Story[] {
  return asArray<Story>(record.prd?.stories).filter((s) => isObject(s) && typeof s.id === 'string');
}

/** Stories that a finding is about, from its refs, its scenario file, or its box path. */
export function findingStories(record: EpicRecord, finding: Finding): Id[] {
  const out = new Set<Id>();
  for (const story of stories(record)) {
    const reqs = asArray<string>(story.requirements);
    const criteria = asArray<{ id?: string }>(story.acceptance).map((a) => (isObject(a) ? a.id : undefined));
    if (finding.refs.some((r) => r === story.id || reqs.includes(r) || criteria.includes(r))) out.add(story.id);
  }
  const file = record.scenarioFiles.find((f) => f.file === finding.file);
  if (file && file.story) out.add(file.story);
  if (finding.file === RECORD_FILES.flow) {
    const index = indexBoxes(record.flow);
    for (let path: string | undefined = finding.path; path !== undefined; path = index.get(path)?.parent) {
      for (const s of asArray<string>(index.get(path)?.box.stories)) out.add(s);
    }
  }
  return [...out].sort();
}

/** The gate findings of a loaded record, with the stories each one is about. */
export function gateItems(record: EpicRecord, simulationFindings: Finding[]): GateItem[] {
  const items: GateItem[] = [];
  const all = stories(record);
  const stale = detectStale(record);

  // traced: each requirement has a story, each story has an approved, non-stale scenario.
  asArray<{ id?: string }>(record.prd?.requirements).forEach((r, i) => {
    if (!isObject(r) || typeof r.id !== 'string') return;
    if (all.some((s) => asArray(s.requirements).includes(r.id))) return;
    items.push({
      check: 'traced',
      stories: [],
      finding: { kind: 'gate', file: RECORD_FILES.prd, path: `requirements[${i}]`, message: `${r.id} has no story`, refs: [r.id] },
    });
  });
  for (const story of all) {
    if (stale.scenarios.some((s) => s.story === story.id && s.status === 'approved')) continue;
    items.push({
      check: 'traced',
      stories: [story.id],
      finding: { kind: 'gate', file: RECORD_FILES.prd, path: story.id, message: `${story.id} has no approved scenario that is not stale`, refs: [story.id] },
    });
  }

  // sim-clean: every simulation finding blocks the gate.
  for (const f of simulationFindings) items.push({ check: 'sim-clean', stories: findingStories(record, f), finding: f });

  // no-stale: stale scenarios, stale stories, and sign-offs under an old hash rule (C11).
  for (const s of stale.scenarios) {
    if (s.status !== 'stale') continue;
    items.push({
      check: 'no-stale',
      stories: [s.story],
      finding: { kind: 'gate', file: s.file, path: s.id, message: `scenario is stale: ${s.reason}; approve it again`, refs: [s.story] },
    });
  }
  for (const s of stale.stories) {
    let message: string | undefined;
    if (s.hashRule !== undefined && !(HASH_RULES as readonly number[]).includes(s.hashRule)) {
      message = `signed under unknown hash rule ${s.hashRule}; must be signed again`;
    } else if (s.status === 'stale') {
      message = `story is stale: content changed since sign-off (hash rule ${s.hashRule}); must be signed again`;
    } else if (s.status === 'signed' && s.hashRule !== CURRENT_HASH_RULE) {
      message = `signed under hash rule ${s.hashRule}, which does not cover boxes and lane roles (C11); must be signed again`;
    }
    if (message === undefined) continue;
    items.push({
      check: 'no-stale',
      stories: [s.id],
      resignStory: s.id,
      finding: { kind: 'gate', file: RECORD_FILES.signoff, path: s.id, message, refs: [s.id] },
    });
  }
  return items;
}

/** Gate report of a loaded record and the findings of its simulation. */
export function gateRecord(record: EpicRecord, simulationFindings: Finding[]): Report {
  return makeReport('gate', gateItems(record, simulationFindings).map((i) => i.finding));
}

/** Findings that sim-clean checks: validate, plus simulate when given. Simulate runs only on a schema-valid record. */
export function simulationFindings(loaded: LoadResult, simulate?: Simulate): Finding[] {
  const validation = validateRecord(loaded).findings;
  if (!simulate || validation.some((f) => f.kind === 'schema')) return validation;
  return [...validation, ...simulate(loaded).findings];
}

/**
 * Load an EPIC folder and run the gate. Without `simulate`, sim-clean uses validate findings only,
 * and the report says so (`simulation: 'validate-only'`).
 */
export function gateEpic(dir: string, simulate?: Simulate): GateReport {
  const loaded = loadEpic(dir);
  const sim = simulationFindings(loaded, simulate);
  // The typed record is only safe after a schema-clean validate; then the trust checks can run.
  const report = sim.some((f) => f.kind === 'schema') ? makeReport('gate', sim) : gateRecord(loaded.record, sim);
  return { command: 'gate', ok: report.ok, findings: report.findings, simulation: simulate ? 'simulate' : 'validate-only' };
}
