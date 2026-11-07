// Box `ste-validate` (T60): STE notes on the new plan text. Only draft text is checked: a story
// that no sign-off names, and a scenario with the status `draft`. Signed text is not checked,
// because a change to it makes the owner's approvals stale. The notes are information: they never
// make a finding, an error or a gate item.

import { steFindings, steFindingText } from '../present/plain.js';
import type { EpicRecord, Finding, Story } from '../types.js';
import { asArray, isObject } from '../util.js';

/** Is the story a draft: does no sign-off in signoff.yaml name it? */
export function isDraftStory(record: EpicRecord, story: Story): boolean {
  return !asArray<{ storyHashes?: Record<string, string> }>(record.signoff?.signOffs)
    .filter(isObject)
    .some((s) => isObject(s.storyHashes) && typeof s.storyHashes[story.id] === 'string');
}

function notes(text: unknown, file: string, path: string, refs: string[]): Finding[] {
  if (typeof text !== 'string') return [];
  return steFindings(text).map((f) => ({ kind: 'ste', file, path, message: steFindingText(f), refs }));
}

/** The STE notes on the draft stories and the draft scenarios of a record. */
export function steDraftNotes(record: EpicRecord): Finding[] {
  const out: Finding[] = [];
  for (const story of asArray<Story>(record.prd?.stories).filter(isObject)) {
    if (typeof story.id !== 'string' || !isDraftStory(record, story)) continue;
    out.push(...notes(story.want, 'prd.yaml', `${story.id}: want`, [story.id]));
    out.push(...notes(story.soThat, 'prd.yaml', `${story.id}: soThat`, [story.id]));
    for (const c of asArray<{ id?: string; given?: unknown; when?: unknown; then?: unknown }>(story.acceptance).filter(isObject)) {
      const id = typeof c.id === 'string' ? c.id : story.id;
      for (const key of ['given', 'when', 'then'] as const) out.push(...notes(c[key], 'prd.yaml', `${id}: ${key}`, [story.id, id]));
    }
  }
  for (const f of record.scenarioFiles) {
    for (const sc of f.scenarios.filter(isObject)) {
      if (sc.status !== 'draft') continue;
      out.push(...notes(sc.title, f.file, `${sc.id}: title`, typeof sc.story === 'string' ? [sc.story] : []));
    }
  }
  return out;
}
