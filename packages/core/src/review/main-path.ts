// The owner's pick of each story's main path (S22, T57, box `pick-main-path`):
// docs/epics/<slug>/review.yaml, `mainPath: { <story id>: <scenario id> }`. Like presentation.yaml
// it is not part of the signed record: the loader, validate's record checks, simulate, the gate and
// every hash leave it alone. `validate` checks only its shape: an unknown key, story or scenario,
// or a scenario of another story, is a finding. A missing file is no pick: the main path is derived.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMap, isScalar, parseDocument, YAMLMap } from 'yaml';
import type { EpicRecord, Finding, Id, ScenarioFile } from '../types.js';
import { asArray, isObject } from '../util.js';
import { parseYaml } from '../yaml.js';

export const REVIEW_FILE = 'review.yaml';

export interface ReviewInputs {
  /** Story id → the scenario the owner picked as its main path. Only valid picks. */
  mainPath: Record<Id, Id>;
}

export const NO_REVIEW: ReviewInputs = { mainPath: {} };

const KEYS = ['mainPath'] as const;

/** The top of a review.yaml that does not exist yet. */
export const NEW_REVIEW_HEADER = `# The owner's review choices (T57). Not part of the signed record: no hash, gate or simulate reads it.
# mainPath: story id → the scenario shown as the story's main path; the others are its branches.
mainPath: {}
`;

const finding = (path: string, message: string, refs: string[] = []): Finding => ({ kind: 'schema', file: REVIEW_FILE, path, message, refs });

/** Story id → its scenario ids, from the record's scenario files. */
function scenariosByStory(record: EpicRecord): Map<Id, Set<Id>> {
  const out = new Map<Id, Set<Id>>();
  for (const s of asArray<{ id?: unknown }>(record.prd?.stories)) if (isObject(s) && typeof s.id === 'string') out.set(s.id, new Set());
  for (const f of asArray<ScenarioFile>(record.scenarioFiles)) {
    for (const sc of asArray<unknown>(f?.scenarios)) {
      if (!isObject(sc) || typeof sc.id !== 'string') continue;
      const story = typeof sc.story === 'string' ? sc.story : f.story;
      if (typeof story === 'string') out.get(story)?.add(sc.id);
    }
  }
  return out;
}

/** Parse review.yaml text against the record: the valid picks, and its shape findings. */
export function parseReview(text: string, record: EpicRecord): { inputs: ReviewInputs; findings: Finding[] } {
  const parsed = parseYaml(text, REVIEW_FILE);
  if (parsed.finding) return { inputs: NO_REVIEW, findings: [parsed.finding] };
  const doc = parsed.value;
  if (doc === null || doc === undefined) return { inputs: NO_REVIEW, findings: [] };
  if (!isObject(doc)) return { inputs: NO_REVIEW, findings: [finding('', `${REVIEW_FILE} must be a map with ${KEYS.join(', ')}`)] };
  const findings: Finding[] = [];
  const inputs: ReviewInputs = { mainPath: {} };
  for (const key of Object.keys(doc)) if (!(KEYS as readonly string[]).includes(key)) findings.push(finding(key, `unknown key ${key}; ${REVIEW_FILE} has ${KEYS.join(', ')}`));
  const mp = doc.mainPath;
  if (mp !== undefined && mp !== null) {
    if (!isObject(mp)) findings.push(finding('mainPath', 'mainPath must be a map of story id → scenario id'));
    else {
      const stories = scenariosByStory(record);
      for (const [story, scenario] of Object.entries(mp)) {
        const path = `mainPath.${story}`;
        const own = stories.get(story);
        if (!own) findings.push(finding(path, `mainPath names ${story}, which is not a story of this EPIC`, [story]));
        else if (typeof scenario !== 'string' || scenario.trim() === '') findings.push(finding(path, `mainPath.${story} must be a scenario id`, [story]));
        else if (!own.has(scenario)) findings.push(finding(path, `mainPath.${story} names ${scenario}, which is not a scenario of ${story}`, [story, scenario]));
        else inputs.mainPath[story] = scenario;
      }
    }
  }
  return { inputs, findings };
}

/** review.yaml of the record's EPIC folder; a missing file is no pick. */
export function readReview(record: EpicRecord): { inputs: ReviewInputs; findings: Finding[] } {
  const file = join(record.dir, REVIEW_FILE);
  if (!existsSync(file)) return { inputs: NO_REVIEW, findings: [] };
  return parseReview(readFileSync(file, 'utf8'), record);
}

/**
 * The new text of review.yaml with `scenario` as the story's main path. `text` undefined: the file
 * does not exist yet. Every comment and every other entry stays as it is. Throws when the text is
 * not valid YAML or `mainPath` is not a map (the caller refuses before: validate says what is wrong).
 */
export function setMainPath(text: string | undefined, storyId: Id, scenarioId: Id): string {
  const doc = parseDocument(text ?? NEW_REVIEW_HEADER);
  if (doc.errors.length > 0) throw new Error(`${REVIEW_FILE} is not valid YAML: ${doc.errors[0]!.message.split('\n')[0]}`);
  if (!isMap(doc.contents)) {
    if (doc.contents !== null && !(isScalar(doc.contents) && doc.contents.value === null)) throw new Error(`${REVIEW_FILE} must be a map with mainPath`);
    doc.contents = new YAMLMap(doc.schema) as never;
  }
  const root = doc.contents as YAMLMap;
  const node: unknown = root.get('mainPath', true);
  if (node !== undefined && !isMap(node) && !(isScalar(node) && node.value === null)) throw new Error(`mainPath in ${REVIEW_FILE} must be a map`);
  let map: YAMLMap;
  if (isMap(node)) map = node;
  else {
    map = new YAMLMap(doc.schema);
    root.set('mainPath', map);
  }
  if (map.flow && map.items.length === 0) map.flow = false;
  map.set(storyId, scenarioId);
  return doc.toString({ lineWidth: 0 });
}
