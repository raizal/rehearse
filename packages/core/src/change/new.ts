// Box `change-new` (T62): `rehearse change new <epic> <story> --title "…"` writes the start file
// of a small change, `changes/C<n>.yaml`, with the next free number. The start file has one
// criterion and one draft scenario (a copy of the steps of the story's first scenario), so it
// validates. The planner then writes the change. Error exits: an unknown story, a story that has
// no scenario to copy, and an empty title. No file changes then.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify } from 'yaml';
import { loadEpic } from '../loader.js';
import type { AcceptanceCriterion, Scenario, ScenarioStep, Story } from '../types.js';
import { asArray, isObject } from '../util.js';
import { changeFileNames, changeNumber, isChangeFile } from './load.js';
import { CHANGES_DIR, MAX_CHANGE_CRITERIA, MAX_CHANGE_SCENARIOS, type ChangeDoc } from './types.js';

export type NewChangeResult =
  | { ok: true; id: string; file: string; path: string }
  | { ok: false; exit: 'unknown-story' | 'no-scenario' | 'empty-title'; message: string };

/** Write the start file of a new change to a story. */
export function newChange(epicDir: string, storyId: string, title: string): NewChangeResult {
  const dir = resolve(epicDir);
  if (title.trim() === '') return { ok: false, exit: 'empty-title', message: 'the title is empty; write one sentence with --title' };
  const { record } = loadEpic(dir);
  const story = asArray<Story>(record.prd?.stories).find((s) => isObject(s) && s.id === storyId);
  if (!story) return { ok: false, exit: 'unknown-story', message: `story ${storyId} unknown in prd.yaml; no file changed` };
  const first = record.scenarioFiles.filter((f) => !isChangeFile(f.file) && f.story === storyId).flatMap((f) => f.scenarios.filter(isObject))[0];
  if (!first) return { ok: false, exit: 'no-scenario', message: `story ${storyId} has no scenario to start from; a change adds to a story with scenarios; no file changed` };

  const n = Math.max(0, ...changeFileNames(dir).map(changeNumber)) + 1;
  const id = `C${n}`;
  const used = asArray<AcceptanceCriterion>(story.acceptance).map((c) => (isObject(c) ? Number(/-A([0-9]+)$/.exec(String(c.id))?.[1] ?? 0) : 0));
  const criterion = `${storyId}-A${Math.max(0, ...used) + 1}`;
  const steps = asArray<ScenarioStep>((first as Scenario).steps)
    .filter(isObject)
    .map((s) => (s.branch ? { name: s.name, branch: s.branch } : { name: s.name }));
  const doc: ChangeDoc = {
    id,
    story: storyId,
    title: title.trim(),
    why: 'Write why the owner asked for this change.',
    criteria: [{ id: criterion, given: 'Write the start state.', when: 'Write what the user does.', then: 'Write the result.' }],
    scenarios: [
      {
        id: `${storyId}-${id.toLowerCase()}-main`,
        title: 'Write the main path of the change.',
        status: 'draft',
        steps,
        expect: { criterion, state: {} },
      },
    ],
  };
  const header = [
    `# Small change ${id} to story ${storyId} (T62). It only adds items. It does not edit an item of the record.`,
    `# Limits: a one-sentence title, 1 to ${MAX_CHANGE_CRITERIA} new criteria, ${MAX_CHANGE_SCENARIOS} scenarios or fewer (the main path and its error exits).`,
    `# Optional: boxes (new root boxes) and edges (each with a new box at one end).`,
    `# The scenarios start as drafts. Only the owner approves them and signs off ${storyId} again.`,
    '',
  ].join('\n');
  const cdir = join(dir, CHANGES_DIR);
  if (!existsSync(cdir)) mkdirSync(cdir, { recursive: true });
  const file = `${CHANGES_DIR}/${id}.yaml`;
  const path = join(dir, file);
  writeFileSync(path, header + stringify(doc, { lineWidth: 0 }), { flag: 'wx' });
  return { ok: true, id, file, path };
}
