// Box `review/readiness`, data only (R11, R16, S8-A1..A3): the chain
// requirement → stories → boxes → scenarios → status, requirements with no proof,
// boxes with no requirement, and the count of correction tags.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { indexBoxes } from '../flow-index.js';
import type { EpicRecord, Report, Story } from '../types.js';
import { asArray, isObject } from '../util.js';
import { findingStories } from './gate.js';
import { detectStale } from './stale.js';
import { servingBoxes } from './story-hash.js';
import type { CorrectionCounts, CorrectionEntry, Readiness, ReadinessRequirement, ReadinessStory } from './types.js';

export const CORRECTIONS_FILE = 'corrections.md';

/** Correction entries of corrections.md: each `**C<n>** \`<tag>\`` line, in file order. */
export function parseCorrections(text: string): CorrectionEntry[] {
  return [...text.matchAll(/\*\*(C\d+)\*\*\s+`([^`]*)`/g)].map((m) => ({ id: m[1]!, tag: m[2]! }));
}

/** Count of each correction tag (R16). */
export function countCorrectionTags(entries: CorrectionEntry[]): CorrectionCounts {
  const counts: CorrectionCounts = { 'caught-in-simulation': 0, 'caught-after-build': 0, invalid: [] };
  for (const e of entries) {
    if (e.tag === 'caught-in-simulation' || e.tag === 'caught-after-build') counts[e.tag] += 1;
    else counts.invalid.push(e);
  }
  return counts;
}

/** Box kinds that mark the flow, not a job. They need no requirement. */
const MARKER_KINDS = new Set(['start', 'end', 'decision']);

/**
 * Readiness data of a loaded record. `corrections` is the text of corrections.md; by default
 * it is read from the EPIC folder. With a gate report each story counts its gate findings.
 */
export function readiness(record: EpicRecord, gateReport?: Report, corrections?: string): Readiness {
  const stale = detectStale(record);
  const stories = asArray<Story>(record.prd?.stories).filter((s) => isObject(s) && typeof s.id === 'string');
  const storyView = (story: Story): ReadinessStory => {
    const trust = stale.stories.find((s) => s.id === story.id)!;
    const view: ReadinessStory = {
      id: story.id,
      status: trust.status,
      trusted: trust.trusted,
      boxes: servingBoxes(record.flow, story.id),
      scenarios: stale.scenarios.filter((s) => s.story === story.id).map((s) => ({ id: s.id, status: s.status })),
    };
    if (gateReport) view.gateFindings = gateReport.findings.filter((f) => findingStories(record, f).includes(story.id)).length;
    return view;
  };

  const requirements: ReadinessRequirement[] = [];
  for (const r of asArray<{ id?: string; text?: string }>(record.prd?.requirements)) {
    if (!isObject(r) || typeof r.id !== 'string') continue;
    const linked = stories.filter((s) => asArray(s.requirements).includes(r.id)).map(storyView);
    const row: ReadinessRequirement = { id: r.id, text: String(r.text ?? ''), stories: linked, proven: true };
    if (linked.length === 0) {
      Object.assign(row, { proven: false, reason: 'no-story', message: `no story links ${r.id}` });
    } else if (!linked.some((s) => s.scenarios.some((sc) => sc.status === 'approved'))) {
      const ids = linked.map((s) => s.id).join(', ');
      Object.assign(row, { proven: false, reason: 'no-approved-scenario', message: `no approved scenario that is not stale for ${ids}` });
    }
    requirements.push(row);
  }

  // A box serves a requirement when it or an ancestor serves a story that links a requirement.
  const index = indexBoxes(record.flow);
  const withReq = new Set(stories.filter((s) => asArray(s.requirements).length > 0).map((s) => s.id));
  const noRequirement: string[] = [];
  for (const entry of index.values()) {
    if (MARKER_KINDS.has(entry.box.kind)) continue;
    let served = false;
    for (let p: string | undefined = entry.path; p !== undefined && !served; p = index.get(p)?.parent) {
      served = asArray<string>(index.get(p)?.box.stories).some((s) => withReq.has(s));
    }
    if (!served) noRequirement.push(entry.path);
  }

  const file = join(record.dir, CORRECTIONS_FILE);
  const text = corrections ?? (existsSync(file) ? readFileSync(file, 'utf8') : '');
  const out: Readiness = {
    requirements,
    noProof: requirements.filter((r) => !r.proven).map((r) => ({ id: r.id, reason: r.reason!, message: r.message! })),
    noRequirement,
    corrections: countCorrectionTags(parseCorrections(text)),
    epicStatus: stale.epicStatus,
  };
  if (gateReport) out.gateOk = gateReport.ok;
  return out;
}
