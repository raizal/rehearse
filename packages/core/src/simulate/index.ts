// Box `simulate`: load → contracts → coverage → lifecycles → acceptance → permissions → report.
// Plain code: no network, no LLM (R18). A record with validation findings is not simulated.
// Drafts mode (T22) runs the same checks with drafts and stale scenarios counted: findings only,
// never evidence. It writes nothing, and the gate never calls it.

import { indexBoxes } from '../flow-index.js';
import { loadEpic } from '../loader.js';
import type { EpicRecord, LoadResult } from '../types.js';
import { validateRecord } from '../validate/index.js';
import { checkAcceptance } from './acceptance.js';
import { checkContracts } from './contracts.js';
import { checkCoverage } from './coverage.js';
import { checkLifecycles } from './lifecycles.js';
import { loadScenarios } from './load.js';
import { buildPermissions } from './permissions.js';
import { makeSimulationReport } from './report.js';
import type { Finding } from '../types.js';
import { cmp } from '../util.js';
import type { SimulateOptions, SimulationReport } from './types.js';

/**
 * Simulate an already loaded record. Takes a `LoadResult` (like `validateRecord`) or an
 * `EpicRecord`. When validate gives findings, the report has those findings only.
 */
export function simulateRecord(input: LoadResult | EpicRecord, opts: SimulateOptions = {}): SimulationReport {
  const loaded: LoadResult = 'record' in input && 'findings' in input ? input : { record: input, findings: [] };
  const validation = validateRecord(loaded);
  const drafts = opts.drafts ? { draftOnly: [] as Finding[], counted: [] } : undefined;
  if (!validation.ok) return makeSimulationReport(validation.findings, {}, {}, [], drafts);

  const { record } = loaded;
  const index = indexBoxes(record.flow);
  const { approved, stale } = loadScenarios(record, opts);
  const lifecycles = checkLifecycles(record.entities, index, approved);
  const { matrix, boxes } = buildPermissions(index);
  const counted = drafts
    ? approved
        .map((s) => ({ file: s.file, scenario: s.scenario.id, story: s.scenario.story, status: s.status! }))
        .sort((a, b) => cmp(a.file, b.file) || cmp(a.scenario, b.scenario))
    : [];
  return makeSimulationReport(
    [
      ...checkContracts(index, approved, record.flow?.context),
      ...checkCoverage(record.flow!, index, approved, drafts?.draftOnly),
      ...lifecycles.findings,
      ...checkAcceptance(record.prd, approved, lifecycles.endStates, drafts?.draftOnly),
    ],
    matrix,
    boxes,
    stale,
    drafts && { draftOnly: drafts.draftOnly, counted },
  );
}

/** Load and simulate one EPIC folder. */
export function simulateEpic(dir: string, opts: SimulateOptions = {}): SimulationReport {
  return simulateRecord(loadEpic(dir), opts);
}
