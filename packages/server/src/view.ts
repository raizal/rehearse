// The read model that `GET /api/epic` returns: the loaded record, its validate
// report and the review status of each scenario. The UI only reads this.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEpic, scenarioHash, validateRecord } from '@rehearse/core';
import type { EntityModel, Flow, Hash, Prd, Report, Scenario, ScenarioStatus, SignOffLog } from '@rehearse/core';
import { parseCorrectionLog, parseDecisions, type Correction, type Decision } from './record-docs.js';

/** One scenario with the status the UI shows. */
export interface ScenarioView {
  scenario: Scenario;
  /** File relative to the EPIC folder, e.g. `scenarios/S5.yaml`. */
  file: string;
  /** Hash of the scenario content now (`scenarioHash`). */
  hash: Hash;
  /**
   * `stale` when the file says `approved` but the approval hash does not match
   * the content (S6-A3), or when the file says `stale`. Else the file status.
   */
  status: ScenarioStatus;
}

export interface EpicView {
  /** EPIC folder name. */
  slug: string;
  prd?: Prd;
  entities?: EntityModel;
  flow?: Flow;
  signoff?: SignOffLog;
  /** In file order, then scenario order. */
  scenarios: ScenarioView[];
  /** Validate report of the record as it is on disk now. */
  report: Report;
  /** The decision log of brainstorm.md; empty when the file is missing. Optional: an older server does not send it. */
  decisions?: Decision[];
  /** The entries of corrections.md; empty when the file is missing. */
  corrections?: Correction[];
}

/** Status of a scenario after the stale check. */
export function scenarioStatus(scenario: Scenario, hash: Hash = scenarioHash(scenario)): ScenarioStatus {
  if (scenario.status === 'approved') return scenario.approval?.hash === hash ? 'approved' : 'stale';
  return scenario.status === 'stale' ? 'stale' : 'draft';
}

/** Load the EPIC folder from disk and build its view. */
export function buildEpicView(dir: string): EpicView {
  const loaded = loadEpic(dir);
  const { record } = loaded;
  const scenarios: ScenarioView[] = [];
  for (const file of record.scenarioFiles) {
    for (const scenario of Array.isArray(file.scenarios) ? file.scenarios : []) {
      if (!scenario || typeof scenario !== 'object') continue;
      const hash = scenarioHash(scenario);
      scenarios.push({ scenario, file: file.file, hash, status: scenarioStatus(scenario, hash) });
    }
  }
  const view: EpicView = {
    slug: record.slug,
    scenarios,
    report: validateRecord(loaded),
    decisions: parseDecisions(readText(join(dir, 'brainstorm.md'))),
    corrections: parseCorrectionLog(readText(join(dir, 'corrections.md'))),
  };
  if (record.prd) view.prd = record.prd;
  if (record.entities) view.entities = record.entities;
  if (record.flow) view.flow = record.flow;
  if (record.signoff) view.signoff = record.signoff;
  return view;
}

function readText(file: string): string {
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}
