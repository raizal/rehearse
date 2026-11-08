// Box `draft-record` (S2, C16): the agent drafts or fixes the record files. When `rehearse validate`
// finds problems, the text report ends with these lines: how to fix the files, and which fields an
// agent writes. The --json report does not get them, so a program reads only the findings.

import type { Report } from '@rehearse/core';

/** The fields that an agent drafts (the `writes` of box `draft-record`). The owner and rehearse write the other fields. */
export const AGENT_WRITES = [
  'Requirement.*',
  'Story.role',
  'Story.want',
  'Story.soThat',
  'Story.requirements',
  'Story.acceptance',
  'Box.*',
  'Example.*',
  'Scenario.status: draft',
] as const;

/** The fields that only the owner (in the rehearse UI) and rehearse write (C16). */
export const NOT_AGENT_WRITES = ['Story.status', 'Story.signedHash', 'Scenario.approval'] as const;

/** The lines after a validate report with findings; empty when the report is OK. */
export function draftRecordHint(report: Pick<Report, 'ok'>, epic: string): string {
  if (report.ok) return '';
  return [
    '',
    `To fix the record: edit each file at the path that a finding names, then run \`rehearse validate ${epic}\` again.`,
    `An agent writes only these fields: ${AGENT_WRITES.join(', ')} (C16).`,
    `Do not write ${NOT_AGENT_WRITES.join(', ')}: the owner and rehearse write them.`,
    '',
  ].join('\n');
}
