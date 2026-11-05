// The read model that `GET /api/epic` returns: the loaded record, its validate
// report and the review status of each scenario. The UI only reads this.

import { checkSystem, compareSystem, loadEpic, loadSystem, makeReport, scenarioHash, systemDirFor, validateRecord } from '@rehearse/core';
import type {
  ArchitectureChange,
  EntityModel,
  Flow,
  Hash,
  Prd,
  Report,
  Scenario,
  ScenarioStatus,
  SignOffLog,
  SystemArchitecture,
  SystemCompare,
} from '@rehearse/core';

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
  /** The EPIC's change to the system (architecture.yaml), when it has one. */
  architecture?: ArchitectureChange;
  /** docs/system/: the system as built, when the repo has the folder. */
  system?: SystemView;
  /** As-is + change → to-be, when there is an as-is architecture or a change. */
  compare?: SystemCompare;
}

/** docs/system/ as the UI reads it. */
export interface SystemView {
  /** Repo path of the folder, `docs/system`. */
  dir: string;
  architecture?: SystemArchitecture;
  flow?: Flow;
  entities?: EntityModel;
  /** Findings of docs/system/ itself. */
  report: Report;
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
  const view: EpicView = { slug: record.slug, scenarios, report: validateRecord(loaded) };
  if (record.prd) view.prd = record.prd;
  if (record.entities) view.entities = record.entities;
  if (record.flow) view.flow = record.flow;
  if (record.signoff) view.signoff = record.signoff;
  if (record.architecture) view.architecture = record.architecture;
  // The views read docs/system/ even when the EPIC has no change (page 8 draws the as-is).
  const loadedSystem = loadSystem(systemDirFor(dir));
  const system = loadedSystem.system;
  if (system.exists) {
    view.system = { dir: 'docs/system', report: makeReport('validate', [...loadedSystem.findings, ...checkSystem(system)]) };
    if (system.architecture) view.system.architecture = system.architecture;
    if (system.flow) view.system.flow = system.flow;
    if (system.entities) view.system.entities = system.entities;
  }
  if (system.architecture || record.architecture) view.compare = compareSystem(system, record);
  return view;
}
