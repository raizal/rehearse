// Box `simulate`: load → contracts → coverage → lifecycles → acceptance → permissions → report.
// Plain code: no network, no LLM (R18). A record with validation findings is not simulated.

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
import type { SimulationReport } from './types.js';

/**
 * Simulate an already loaded record. Takes a `LoadResult` (like `validateRecord`) or an
 * `EpicRecord`. When validate gives findings, the report has those findings only.
 */
export function simulateRecord(input: LoadResult | EpicRecord): SimulationReport {
  const loaded: LoadResult = 'record' in input && 'findings' in input ? input : { record: input, findings: [] };
  const validation = validateRecord(loaded);
  if (!validation.ok) return makeSimulationReport(validation.findings, {}, {}, []);

  const { record } = loaded;
  const index = indexBoxes(record.flow);
  const { approved, stale } = loadScenarios(record);
  const lifecycles = checkLifecycles(record.entities, index, approved);
  const { matrix, boxes } = buildPermissions(index);
  return makeSimulationReport(
    [
      ...checkContracts(index, approved),
      ...checkCoverage(record.flow!, index, approved),
      ...lifecycles.findings,
      ...checkAcceptance(record.prd, approved, lifecycles.endStates),
    ],
    matrix,
    boxes,
    stale,
  );
}

/** Load and simulate one EPIC folder. */
export function simulateEpic(dir: string): SimulationReport {
  return simulateRecord(loadEpic(dir));
}
