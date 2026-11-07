// Box `change-limits` (T62): the limits of a small change, and the rule that it only adds.
// A change has a one-sentence title, 1 to 3 new criteria and 5 scenarios or fewer. It adds new
// root boxes and new edges with a new box at one end. It cannot edit an existing story,
// criterion, scenario or box: an id that exists already is the error "edits an existing item".

import { RECORD_FILES, type AcceptanceCriterion, type Box, type Edge, type EpicRecord, type Finding, type Id, type Scenario, type Story } from '../types.js';
import { asArray, isObject } from '../util.js';
import { changeOf, isChangeFile, recordChanges } from './load.js';
import { MAX_CHANGE_CRITERIA, MAX_CHANGE_SCENARIOS, STORY_SCENARIO_NOTE } from './types.js';

/** Information that validate gives without a finding: the report stays OK. */
export interface ValidateNote {
  file: string;
  path: string;
  message: string;
  refs: string[];
}

const ids = (xs: unknown): string[] => asArray<{ id?: unknown }>(xs).flatMap((x) => (isObject(x) && typeof x.id === 'string' ? [x.id] : []));

/** True when a text has more than one sentence. */
function sentences(text: string): number {
  return text.trim().split(/[.!?](?:\s+|$)/).filter((s) => s.trim() !== '').length;
}

/** Findings for the change files of a record. */
export function checkChanges(record: EpicRecord): Finding[] {
  const out: Finding[] = [];
  const stories = asArray<Story>(isObject(record.raw[RECORD_FILES.prd]) ? (record.raw[RECORD_FILES.prd] as Record<string, unknown>).stories : []).filter(isObject);
  const flowRaw = record.raw[RECORD_FILES.flow];
  const rootBoxes = new Set(ids(isObject(flowRaw) && isObject(flowRaw.root) ? flowRaw.root.boxes : []));
  // Items that exist before a change: in prd.yaml, scenarios/ and flow.yaml, then each earlier change.
  const criteria = new Map<string, string>();
  for (const s of stories) for (const c of ids(s.acceptance)) criteria.set(c, RECORD_FILES.prd);
  const scenarios = new Map<string, string>();
  for (const sf of record.scenarioFiles) if (!isChangeFile(sf.file)) for (const id of ids(sf.scenarios)) if (!scenarios.has(id)) scenarios.set(id, sf.file);
  const boxes = new Map<string, string>([...rootBoxes].map((b) => [b, RECORD_FILES.flow]));
  const edits = (file: string, path: string, what: string, where: string, refs: string[] = []): void => {
    out.push({ kind: 'reference', file, path, message: `the change edits an existing item: ${what} is in ${where}; a change only adds new items`, refs });
  };

  for (const { file, doc } of recordChanges(record)) {
    const name = file.slice(file.lastIndexOf('/') + 1).replace(/\.ya?ml$/, '');
    if (doc.id !== name) out.push({ kind: 'reference', file, path: 'id', message: `id ${doc.id} does not match the file name ${name}`, refs: [] });
    const story = stories.find((s) => s.id === doc.story);
    if (!story) out.push({ kind: 'reference', file, path: 'story', message: `story ${doc.story} unknown`, refs: [doc.story] });
    if (typeof doc.title === 'string' && sentences(doc.title) > 1) {
      out.push({ kind: 'structure', file, path: 'title', message: 'the title has more than one sentence; write one sentence', refs: [doc.story] });
    }

    const crit = asArray<AcceptanceCriterion>(doc.criteria).filter(isObject);
    if (crit.length > MAX_CHANGE_CRITERIA) {
      out.push({ kind: 'structure', file, path: 'criteria', message: `the change has ${crit.length} criteria; a change has 1 to ${MAX_CHANGE_CRITERIA} new criteria`, refs: [doc.story] });
    }
    for (const c of crit) {
      if (typeof c.id !== 'string') continue;
      const where = criteria.get(c.id);
      if (where !== undefined) edits(file, c.id, `criterion ${c.id}`, where, [c.id]);
      else {
        criteria.set(c.id, file);
        if (!c.id.startsWith(`${doc.story}-`)) out.push({ kind: 'reference', file, path: c.id, message: `criterion ${c.id} must start with ${doc.story}-`, refs: [c.id] });
      }
    }

    const scen = asArray<Scenario>(doc.scenarios).filter(isObject);
    if (scen.length > MAX_CHANGE_SCENARIOS) {
      out.push({
        kind: 'structure',
        file,
        path: 'scenarios',
        message: `the change has ${scen.length} scenarios; a change has ${MAX_CHANGE_SCENARIOS} scenarios or fewer (the main path and its error exits); split it or write a new story`,
        refs: [doc.story],
      });
    }
    for (const s of scen) {
      if (typeof s.id !== 'string') continue;
      const where = scenarios.get(s.id);
      if (where !== undefined) edits(file, s.id, `scenario ${s.id}`, where);
      else scenarios.set(s.id, file);
    }

    const fresh = new Set<string>();
    for (const b of asArray<Box>(doc.boxes).filter(isObject)) {
      if (typeof b.id !== 'string') continue;
      const where = boxes.get(b.id);
      if (where !== undefined) {
        edits(file, b.id, `box ${b.id}`, where);
        continue;
      }
      boxes.set(b.id, file);
      fresh.add(b.id);
      if (isObject(b.children)) out.push({ kind: 'structure', file, path: b.id, message: 'a change box has no children; add root boxes only', refs: [] });
      const serves = asArray<string>(b.stories);
      if (b.stories !== undefined && (serves.length !== 1 || serves[0] !== doc.story)) {
        out.push({ kind: 'reference', file, path: b.id, message: `a change box serves only the story of its change (${doc.story})`, refs: [doc.story] });
      }
    }
    for (const e of asArray<Edge>(doc.edges).filter(isObject)) {
      const at = `edge ${String(e.from)} -> ${String(e.to)}`;
      if (!fresh.has(e.from) && !fresh.has(e.to)) {
        out.push({ kind: 'reference', file, path: at, message: `the change edits an existing item: ${at} joins two boxes that the change does not add; a new edge needs a new box of this change at one end`, refs: [] });
        continue;
      }
      for (const end of [e.from, e.to]) {
        if (!fresh.has(end) && !rootBoxes.has(end)) out.push({ kind: 'reference', file, path: at, message: `box ${String(end)} unknown (not a root box of flow.yaml and not a box of this change)`, refs: [] });
      }
    }
  }
  return out;
}

/** The scenarios of each story that has changes, with its changes (base and change scenarios). */
export function changeNotes(record: EpicRecord): ValidateNote[] {
  const out: ValidateNote[] = [];
  const withChanges = new Map<Id, string[]>();
  for (const { doc } of recordChanges(record)) withChanges.set(doc.story, [...(withChanges.get(doc.story) ?? []), doc.id]);
  for (const [story, changes] of withChanges) {
    const n = record.scenarioFiles.filter((f) => f.story === story).reduce((sum, f) => sum + f.scenarios.filter(isObject).length, 0);
    if (n <= STORY_SCENARIO_NOTE) continue;
    out.push({
      file: RECORD_FILES.prd,
      path: story,
      message: `${story} has ${n} scenarios with its changes (${changes.join(', ')}); more than ${STORY_SCENARIO_NOTE}: think about a new story`,
      refs: [story],
    });
  }
  return out;
}

/**
 * A structure finding on a box that a change added names flow.yaml, but the box is in the
 * change file: move the finding to that file.
 */
export function moveChangeFindings(record: EpicRecord, findings: Finding[]): Finding[] {
  const owner = new Map<string, string>();
  for (const b of asArray<Box>(record.flow?.root?.boxes)) {
    const c = changeOf(b);
    if (c !== undefined && typeof b.id === 'string') owner.set(b.id, recordChanges(record).find((x) => x.doc.id === c)?.file ?? RECORD_FILES.flow);
  }
  if (owner.size === 0) return findings;
  return findings.map((f) => {
    if (f.file !== RECORD_FILES.flow) return f;
    const file = owner.get(f.path.split('/')[0]!);
    return file === undefined ? f : { ...f, file };
  });
}
