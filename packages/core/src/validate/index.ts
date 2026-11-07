// Box `validate`: parse → schema → refs → report. No network, no LLM (R18).

import { checkArchitectureChange } from '../architecture/validate.js';
import { repoTopOf } from '../design/load.js';
import { designLinkFindings } from '../design/load-index.js';
import { loadEpic } from '../loader.js';
import { readPresentation } from '../present/inputs.js';
import { readReview } from '../review/main-path.js';
import type { LoadResult, Report } from '../types.js';
import { checkRefs } from './refs.js';
import { makeReport, sortFindings } from './report.js';
import { checkSchemas } from './schema.js';
import { steDraftNotes } from './ste.js';
import { checkSteps } from './steps.js';
import { checkStructure } from './structure.js';

/** Validate an already loaded record. */
export function validateRecord(loaded: LoadResult): Report {
  const { record, findings } = loaded;
  return makeReport('validate', [
    ...findings,
    ...checkSchemas(record),
    ...checkRefs(record),
    ...checkStructure(record),
    ...checkSteps(record),
    ...checkArchitectureChange(record),
  ]);
}

/**
 * Load and validate one EPIC folder, with the repo's design links of its stories (T50) and the
 * shape of presentation.yaml (T52) and review.yaml (T57; neither is part of the signed record, so only here),
 * and the STE notes on draft stories and scenarios as information (T60).
 */
export function validateEpic(dir: string): Report {
  const loaded = loadEpic(dir);
  const report = validateRecord(loaded);
  const extra = [...designLinkFindings(loaded.record, repoTopOf(dir)), ...readPresentation(loaded.record).findings, ...readReview(loaded.record).findings];
  const out = extra.length === 0 ? report : makeReport('validate', [...report.findings, ...extra]);
  // T60: STE notes on draft text are information only; `ok` stays as the findings say.
  const information = steDraftNotes(loaded.record);
  return information.length === 0 ? out : { ...out, information: sortFindings(information) };
}
