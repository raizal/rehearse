// POST /api/review/main-path (T57, box `pick-main-path`): the owner picks which scenario is a
// story's main path. It writes docs/epics/<slug>/review.yaml, keeping every comment. It is not part
// of the signed record, so no approval, sign-off or gate changes. An owner action: the session
// token and the same Origin are checked before this runs; agents never call it.

import { existsSync, lstatSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { loadEpic, REVIEW_FILE, setMainPath } from '@rehearse/core';

const STORY = /^S\d+$/;

export type MainPathResult = [200, { ok: true; story: string; scenario: string; reviewFile: string }] | [number, { ok: false; reason: string; error: string }];

const refuse = (status: number, reason: string, error: string): [number, { ok: false; reason: string; error: string }] => [status, { ok: false, reason, error }];

export function pickMainPath(epicDir: string, body: Record<string, unknown>): MainPathResult {
  const { epic, story, scenario } = body;
  if (typeof epic !== 'string' || typeof story !== 'string' || !STORY.test(story) || typeof scenario !== 'string' || scenario === '') {
    return refuse(400, 'bad body', 'body must be { "epic", "story", "scenario" }');
  }
  const { record } = loadEpic(epicDir);
  if (epic !== record.slug) return refuse(400, 'other epic', `this server serves the EPIC ${record.slug}, not ${epic}`);
  if (!record.prd?.stories?.some((s) => s.id === story)) return refuse(404, 'unknown story', `no story ${story} in prd.yaml`);
  const own = record.scenarioFiles.flatMap((f) => (Array.isArray(f.scenarios) ? f.scenarios : []).filter((s) => s && (s.story ?? f.story) === story));
  if (!own.some((s) => s.id === scenario)) return refuse(404, 'unknown scenario', `no scenario ${scenario} of ${story}`);
  const file = join(epicDir, REVIEW_FILE);
  let text: string | undefined;
  if (existsSync(file)) {
    if (lstatSync(file).isSymbolicLink()) return refuse(403, 'symlink', `${REVIEW_FILE} is a symlink; not written`);
    text = readFileSync(file, 'utf8');
  }
  let next: string;
  try {
    next = setMainPath(text, story, scenario);
  } catch (e) {
    return refuse(409, 'review.yaml invalid', `${e instanceof Error ? e.message : String(e)}; fix it first (rehearse validate says what is wrong)`);
  }
  if (next !== text) {
    const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    writeFileSync(tmp, next);
    renameSync(tmp, file);
  }
  return [200, { ok: true, story, scenario, reviewFile: REVIEW_FILE }];
}
