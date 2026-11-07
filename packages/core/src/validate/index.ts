// Box `validate`: parse → schema → refs → report. No network, no LLM (R18).

import { checkArchitectureChange } from '../architecture/validate.js';
import { repoTopOf } from '../design/load.js';
import { designLinkFindings } from '../design/load-index.js';
import { loadEpic } from '../loader.js';
import { readPresentation } from '../present/inputs.js';
import { readReview } from '../review/main-path.js';
import type { LoadResult, Report } from '../types.js';
import { changeNotes, checkChanges, moveChangeFindings, type ValidateNote } from '../change/validate.js';
import { checkRefs } from './refs.js';
import { makeReport } from './report.js';
import { checkSchemas } from './schema.js';
import { checkSteps } from './steps.js';
import { checkStructure } from './structure.js';

/** A validate report. `notes` is information that is not a finding (T62); it is there only when there is a note. */
export interface ValidateReport extends Report {
  notes?: ValidateNote[];
}

/** Validate an already loaded record. */
export function validateRecord(loaded: LoadResult): ValidateReport {
  const { record, findings } = loaded;
  const report: ValidateReport = makeReport('validate', [
    ...findings,
    ...checkSchemas(record),
    ...moveChangeFindings(record, [...checkRefs(record), ...checkStructure(record)]),
    ...checkSteps(record),
    ...checkArchitectureChange(record),
    ...checkChanges(record),
  ]);
  const notes = changeNotes(record);
  if (notes.length > 0) report.notes = notes;
  return report;
}

/**
 * Load and validate one EPIC folder, with the repo's design links of its stories (T50) and the
 * shape of presentation.yaml (T52) and review.yaml (T57; neither is part of the signed record, so only here).
 */
export function validateEpic(dir: string): ValidateReport {
  const loaded = loadEpic(dir);
  const report = validateRecord(loaded);
  const extra = [...designLinkFindings(loaded.record, repoTopOf(dir)), ...readPresentation(loaded.record).findings, ...readReview(loaded.record).findings];
  if (extra.length === 0) return report;
  const out: ValidateReport = makeReport('validate', [...report.findings, ...extra]);
  if (report.notes) out.notes = report.notes;
  return out;
}
