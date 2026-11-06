// Box `new-epic`: create docs/epics/<slug>/ with the smallest valid record (R1, S1).
// Error exits `epic-exists` and `bad-slug` end in box `rejected`: no file changes (S1-A2).
// On success it also adds `.rehearse/graph.db*` to the repo's .gitignore (code-graph G29).
// All checks run first. The files are then written to a staging folder next to the
// target and renamed into place, so a failed write leaves no half-made EPIC.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { stringify } from 'yaml';
import { RECORD_FILES, type EntityModel, type Flow, type Prd } from './types.js';

/** The entries of a new EPIC folder. `scenarios/` is an empty folder. */
export const EPIC_FILES = [
  'brainstorm.md',
  RECORD_FILES.prd,
  RECORD_FILES.entities,
  RECORD_FILES.flow,
  `${RECORD_FILES.scenariosDir}/`,
  'corrections.md',
] as const;

export type NewEpicExit = 'epic-exists' | 'bad-slug';

export type NewEpicResult =
  | { ok: true; epicDir: string }
  | { ok: false; exit: NewEpicExit; message: string };

const SLUG = /^(\d{4})-(\d{2})-(\d{2})-[a-z0-9]+(-[a-z0-9]+)*$/;

/** `YYYY-MM-DD-<kebab>` with a real calendar date. */
export function isEpicSlug(slug: string): boolean {
  const m = SLUG.exec(slug);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/**
 * Create `<root>/docs/epics/<slug>/`. The new record passes `validateEpic` with no findings.
 * Throws only for an empty title (a caller bug) or an I/O error.
 */
export function createEpic(root: string, slug: string, title: string): NewEpicResult {
  if (title.trim() === '') throw new TypeError('createEpic: title must not be empty');
  const epicsDir = join(resolve(root), 'docs', 'epics');
  const epicDir = join(epicsDir, slug);
  const shown = relative(resolve(root), epicDir) || epicDir;

  if (!isEpicSlug(slug)) {
    return { ok: false, exit: 'bad-slug', message: `bad slug ${JSON.stringify(slug)}: use YYYY-MM-DD-<kebab>, for example 2026-11-05-demo` };
  }
  if (existsSync(epicDir)) {
    return { ok: false, exit: 'epic-exists', message: `EPIC folder ${shown} exists; no file changed` };
  }

  const madeEpicsDir = !existsSync(epicsDir);
  mkdirSync(epicsDir, { recursive: true });
  const staging = mkdtempSync(join(epicsDir, `.${slug}.new-`));
  try {
    for (const [file, text] of Object.entries(recordFiles(slug, title))) writeFileSync(join(staging, file), text);
    mkdirSync(join(staging, RECORD_FILES.scenariosDir));
    renameSync(staging, epicDir);
  } catch (e) {
    rmSync(staging, { recursive: true, force: true });
    if (madeEpicsDir) rmdirSync(epicsDir, { recursive: false });
    const code = (e as NodeJS.ErrnoException).code;
    // Another process made the folder between the check and the rename.
    if (code === 'EEXIST' || code === 'ENOTEMPTY') {
      return { ok: false, exit: 'epic-exists', message: `EPIC folder ${shown} exists; no file changed` };
    }
    throw e;
  }
  ignoreGraphDb(resolve(root));
  return { ok: true, epicDir };
}

/** The code graph's store (code-graph EPIC, G29); not all of `.rehearse/`, which has `allowed_signers` (D41). */
export const GRAPH_DB_IGNORE = '.rehearse/graph.db*';

/** Add `.rehearse/graph.db*` to `<root>/.gitignore`, once. */
export function ignoreGraphDb(root: string): void {
  const file = join(root, '.gitignore');
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (text.split(/\r?\n/).some((line) => line.trim() === GRAPH_DB_IGNORE)) return;
  const sep = text === '' || text.endsWith('\n') ? '' : '\n';
  writeFileSync(file, `${text}${sep}${GRAPH_DB_IGNORE}\n`);
}

/**
 * The smallest valid record. The schemas need a goal, at least one lane (so one role)
 * and at least one box in the root diagram; the structure rules then need a start and an end.
 */
function recordFiles(slug: string, title: string): Record<string, string> {
  const prd: Prd = {
    epic: { slug, title, goal: 'Say what this change lets a user do, and why.' },
    roles: [{ id: 'builder', name: 'Builder', kind: 'human', about: 'The owner. Approves scenarios and signs off.' }],
    requirements: [],
    stories: [],
  };
  const entities: EntityModel = { entities: [] };
  const flow: Omit<Flow, 'root'> & { root: { boxes: object[]; edges: object[] } } = {
    version: 1,
    epic: slug,
    lanes: [{ role: 'builder', order: 1 }],
    root: {
      boxes: [
        { id: 'start', kind: 'start', lane: 'builder', title: 'Start' },
        { id: 'end', kind: 'end', lane: 'builder', title: 'End' },
      ],
      edges: [{ from: 'start', to: 'end' }],
    },
  };
  const yaml = (header: string, doc: unknown) => `# ${header}\n\n${stringify(doc)}`;
  return {
    'brainstorm.md': `# ${title} — brainstorm\n\nWhy this EPIC exists, the options, and each decision with an ID (D1, D2, …).\n`,
    [RECORD_FILES.prd]: yaml(`${slug} — EPIC (PRD). Status: draft.`, prd),
    [RECORD_FILES.entities]: yaml(`${slug} — entity model.`, entities),
    [RECORD_FILES.flow]: yaml(`${slug} — flow. Add boxes between start and end.`, flow),
    'corrections.md': `# Corrections — ${slug}\n\nEach entry has a tag: \`caught-in-simulation\` or \`caught-after-build\`.\n`,
  };
}
