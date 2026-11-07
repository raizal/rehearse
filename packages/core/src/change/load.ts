// Read the change files of a record and merge them into the loaded record (T62).
// The raw documents stay in `record.raw`: the hash rule 3 reads them from there.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AcceptanceCriterion, Box, Edge, EpicRecord, Id, Scenario, Story } from '../types.js';
import { asArray, isObject } from '../util.js';
import { CHANGES_DIR, type ChangeDoc, type LoadedChange } from './types.js';

const CHANGE_FILE = /^C([0-9]+)\.ya?ml$/;

/** True for a path such as `changes/C1.yaml`. */
export function isChangeFile(file: string): boolean {
  return file.startsWith(`${CHANGES_DIR}/`) && CHANGE_FILE.test(file.slice(CHANGES_DIR.length + 1));
}

/** The number of a change id or file (`C12` → 12), or Infinity. */
export function changeNumber(idOrFile: string): number {
  const m = /C([0-9]+)(\.ya?ml)?$/.exec(idOrFile);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

/** The change files of an EPIC folder, relative to it, in change number order. */
export function changeFileNames(dir: string): string[] {
  const cdir = join(dir, CHANGES_DIR);
  if (!existsSync(cdir) || !statSync(cdir).isDirectory()) return [];
  return readdirSync(cdir)
    .filter((n) => CHANGE_FILE.test(n) && statSync(join(cdir, n)).isFile())
    .sort((a, b) => changeNumber(a) - changeNumber(b) || (a < b ? -1 : 1))
    .map((n) => `${CHANGES_DIR}/${n}`);
}

/** The change files that parsed to an object with a string id and story, in change number order. */
export function recordChanges(record: EpicRecord): LoadedChange[] {
  return Object.keys(record.raw)
    .filter(isChangeFile)
    .sort((a, b) => changeNumber(a) - changeNumber(b) || (a < b ? -1 : 1))
    .flatMap((file) => {
      const doc = record.raw[file];
      return isObject(doc) && typeof doc.id === 'string' && typeof doc.story === 'string' ? [{ file, doc: doc as unknown as ChangeDoc }] : [];
    });
}

/** The changes of one story, in change number order. */
export function storyChanges(record: EpicRecord, storyId: Id): LoadedChange[] {
  return recordChanges(record).filter((c) => c.doc.story === storyId);
}

/** The change that added an item (a criterion, scenario or box of the loaded record), or undefined. */
export function changeOf(item: unknown): Id | undefined {
  return isObject(item) && typeof item.change === 'string' ? item.change : undefined;
}

/**
 * Merge each change into the loaded record: its criteria into the story's acceptance, its
 * scenarios as a scenario file, its boxes and edges into the root diagram. Each merged item
 * gets `change: <id>`. An item with the id of an existing item is not merged: validate reports it.
 */
export function mergeChanges(record: EpicRecord): void {
  const stories = asArray<Story>(record.prd?.stories).filter((s) => isObject(s) && typeof s.id === 'string');
  const root = isObject(record.flow) && isObject(record.flow.root) ? record.flow.root : undefined;
  for (const { file, doc: raw } of recordChanges(record)) {
    const doc = structuredClone(raw);
    const id = doc.id;
    const story = stories.find((s) => s.id === doc.story);
    if (story) {
      const acceptance = asArray<AcceptanceCriterion>(story.acceptance);
      const known = new Set(stories.flatMap((s) => asArray<AcceptanceCriterion>(s.acceptance).map((c) => (isObject(c) ? c.id : undefined))));
      const added = asArray<AcceptanceCriterion>(doc.criteria).filter((c) => isObject(c) && typeof c.id === 'string' && !known.has(c.id));
      story.acceptance = [...acceptance, ...added.map((c) => ({ ...c, change: id }))];
    }
    const scenarios = asArray<Scenario>(doc.scenarios).map((s) => (isObject(s) ? { ...s, story: doc.story, change: id } : s));
    record.scenarioFiles.push({ file, story: doc.story, scenarios });
    if (!root) continue;
    root.boxes = asArray<Box>(root.boxes);
    root.edges = asArray<Edge>(root.edges);
    const existing = new Set(root.boxes.filter(isObject).map((b) => b.id));
    const fresh = new Set<string>();
    for (const box of asArray<Box>(doc.boxes)) {
      if (!isObject(box) || typeof box.id !== 'string' || existing.has(box.id)) continue;
      fresh.add(box.id);
      existing.add(box.id);
      root.boxes.push({ ...box, stories: Array.isArray(box.stories) ? box.stories : [doc.story], path: box.id, change: id });
    }
    for (const edge of asArray<Edge>(doc.edges)) {
      // An edge with no new box at an end, or with an unknown end, stays out: validate reports it in the change file.
      if (isObject(edge) && (fresh.has(edge.from) || fresh.has(edge.to)) && existing.has(edge.from) && existing.has(edge.to)) root.edges.push({ ...edge });
    }
  }
}
