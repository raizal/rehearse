// The sign-off preview (T39, box `sign-off`), `GET /api/sign-off/preview?stories=S4,S5`: per story
// the content that a sign-off fingerprints (story hash rule 2, and rule 3 for the small changes of
// T62, each item marked with its change), and what changed since the story's
// last sign-off. The sign-off record keeps only hashes, so the old content comes from git: the
// commit that added the story's last sign-off entry to signoff.yaml. "Now" is the working tree
// (it may hold approvals not committed yet). Read only; git runs with argument arrays, no shell.
// The diff never fails the request: when git cannot answer, the story says why and shows its content.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  allScenarios,
  detectStale,
  diffStoryContent,
  CHANGES_DIR,
  HASH_RULES,
  loadEpic,
  markChanges,
  parseYaml,
  previewContent,
  previewCounts,
  RECORD_FILES,
  storyChanges,
  storyContentV2,
  storyHash,
  type ContentChange,
  type EpicRecord,
  type HashRule,
  type Id,
  type PreviewCounts,
  type SignOffWithRule,
  type Story,
  type StoryPreviewContent,
} from '@rehearse/core';
import type { GitRunner } from './box-code.js';
import type { CommitRef } from './git-parse.js';

/** Most stories one preview request may name. */
export const MAX_PREVIEW_STORIES = 50;
/** Most commits of signoff.yaml the preview walks back to find a sign-off. */
export const MAX_SIGNOFF_COMMITS = 500;

/** What changed since the story's last sign-off. */
export type SinceSignOff =
  | { kind: 'first' }
  | { kind: 'unchanged'; at: string; by: string; hashRule: number }
  | {
      kind: 'changed';
      at: string;
      by: string;
      hashRule: number;
      /** The small changes that no sign-off covers; the rest of the story is as signed (T62). */
      newChanges?: Id[];
      /** The commit that added the sign-off entry: the "then" side of the changes. */
      commit: CommitRef;
      changes: ContentChange[];
      /** False when the files of that commit do not hash to the signed fingerprint (the record was committed apart from the sign-off). */
      exact: boolean;
    }
  | { kind: 'unavailable'; at: string; by: string; hashRule: number; reason: string; newChanges?: Id[] };

export interface StorySignOffPreview {
  id: Id;
  /** False when prd.yaml has no such story. */
  found: boolean;
  content?: StoryPreviewContent;
  counts?: PreviewCounts;
  since?: SinceSignOff;
}

export interface SignOffPreview {
  ok: true;
  stories: StorySignOffPreview[];
}

/** Global options of every git call: no quoted names. */
const GIT = ['-c', 'core.quotePath=false'];
const isObject = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const SCENARIO_FILE = new RegExp(`^${RECORD_FILES.scenariosDir}/[^/]+\\.ya?ml$`);
const CHANGE_FILE = new RegExp(`^${CHANGES_DIR}/C[0-9]+\\.ya?ml$`);

/** The preview of each named story, in the order named. */
export async function signOffPreview(git: GitRunner, epicDir: string, ids: Id[]): Promise<SignOffPreview> {
  const { record } = loadEpic(epicDir);
  const prd = record.prd;
  const stories = asArray<Story>(prd?.stories).filter((s) => isObject(s) && typeof s.id === 'string');
  const trust = new Map(detectStale(record).stories.map((s) => [s.id, s]));
  const scenarios = allScenarios(record);
  const signOffs = asArray<SignOffWithRule>(record.signoff?.signOffs).filter(isObject);
  const history = new SignOffHistory(git, epicDir);

  const out: StorySignOffPreview[] = [];
  for (const id of ids) {
    const story = stories.find((s) => s.id === id);
    if (!story || !prd) {
      out.push({ id, found: false });
      continue;
    }
    const current = storyContentV2(story, prd, record.flow, scenarios);
    const content = markChanges(previewContent(current), record, id);
    const entry: StorySignOffPreview = { id, found: true, content, counts: previewCounts(content) };
    const t = trust.get(id);
    const latest = [...signOffs].reverse().find((s) => isObject(s.storyHashes) && typeof s.storyHashes[id] === 'string');
    if (!latest || !t?.signedHash) entry.since = { kind: 'first' };
    else {
      const base = {
        at: String(latest.at),
        by: String(latest.by),
        hashRule: latest.hashRule ?? 1,
        ...(t.newChanges && t.newChanges.length > 0 ? { newChanges: t.newChanges } : {}),
      };
      if (t.status === 'signed') entry.since = { kind: 'unchanged', ...base };
      else {
        try {
          entry.since = await changedSince(history, id, current, latest, t.signedHash, base);
        } catch (e) {
          entry.since = { kind: 'unavailable', ...base, reason: `git could not be read (${e instanceof Error ? e.message : String(e)})` };
        }
      }
    }
    out.push(entry);
  }
  return { ok: true, stories: out };
}

async function changedSince(
  history: SignOffHistory,
  id: Id,
  current: Record<string, unknown>,
  latest: SignOffWithRule,
  signedHash: string,
  base: { at: string; by: string; hashRule: number; newChanges?: Id[] },
): Promise<SinceSignOff> {
  const found = await history.commitOf(id, String(latest.at), signedHash);
  if ('reason' in found) return { kind: 'unavailable', ...base, reason: found.reason };
  const old = await history.recordAt(found.commit.sha);
  if (!old) return { kind: 'unavailable', ...base, reason: `the record files at commit ${found.commit.short} cannot be read` };
  const oldStory = asArray<Story>(old.prd?.stories).find((s) => isObject(s) && s.id === id);
  if (!oldStory || !old.prd) return { kind: 'unavailable', ...base, reason: `prd.yaml at commit ${found.commit.short} has no story ${id}` };
  const oldScenarios = allScenarios(old);
  const before = storyContentV2(oldStory, old.prd, old.flow, oldScenarios);
  const rule = base.hashRule;
  const oldChanges = storyChanges(old, id).map((c) => c.doc);
  const exact = (HASH_RULES as readonly number[]).includes(rule) && storyHash(rule as HashRule, oldStory, old.prd, old.flow, oldScenarios, oldChanges) === signedHash;
  return { kind: 'changed', ...base, commit: found.commit, changes: diffStoryContent(before, current), exact };
}

/** Reads signoff.yaml and the record files at past commits, once each per request. */
class SignOffHistory {
  private prefix?: Promise<string | undefined>;
  private log?: Promise<CommitRef[] | undefined>;
  private readonly entries = new Map<string, Promise<SignOffWithRule[] | undefined>>();
  private readonly records = new Map<string, Promise<EpicRecord | undefined>>();

  constructor(
    private readonly git: GitRunner,
    private readonly epicDir: string,
  ) {}

  private run(args: string[]) {
    return this.git([...GIT, ...args], this.epicDir);
  }

  /** The EPIC folder relative to the top of its repo, with a trailing `/` (empty at the top). Undefined outside a repo. */
  private repoPrefix(): Promise<string | undefined> {
    this.prefix ??= this.run(['rev-parse', '--show-prefix']).then((r) => (r.ok ? r.stdout.trim() : undefined));
    return this.prefix;
  }

  /** Commits that changed signoff.yaml, newest first. */
  private commits(): Promise<CommitRef[] | undefined> {
    this.log ??= this.run(['log', `--max-count=${MAX_SIGNOFF_COMMITS}`, '--format=%H%x1f%h%x1f%s%x1f%cI', '--', RECORD_FILES.signoff]).then((r) => {
      if (!r.ok) return undefined;
      return r.stdout
        .split('\n')
        .map((line) => line.split('\x1f'))
        .filter((f) => f.length >= 4 && /^[0-9a-f]{40}$/.test(f[0]!))
        .map(([sha, short, subject, date]) => ({ sha: sha!, short: short!, subject: subject!, date: date! }));
    });
    return this.log;
  }

  private async show(sha: string, file: string): Promise<string | undefined> {
    const prefix = await this.repoPrefix();
    if (prefix === undefined) return undefined;
    const r = await this.run(['show', `${sha}:${prefix}${file}`]);
    return r.ok ? r.stdout : undefined;
  }

  private signOffsAt(sha: string): Promise<SignOffWithRule[] | undefined> {
    let p = this.entries.get(sha);
    if (!p) {
      p = this.show(sha, RECORD_FILES.signoff).then((text) => {
        if (text === undefined) return undefined;
        const { value } = parseYaml(text, RECORD_FILES.signoff);
        return isObject(value) ? asArray<SignOffWithRule>(value.signOffs).filter(isObject) : [];
      });
      this.entries.set(sha, p);
    }
    return p;
  }

  /**
   * The commit that added the sign-off entry (by `at` and the story's hash). signoff.yaml is
   * append only, so walk back from the newest commit while the entry is still there.
   */
  async commitOf(id: Id, at: string, hash: string): Promise<{ commit: CommitRef } | { reason: string }> {
    if ((await this.repoPrefix()) === undefined) return { reason: 'the EPIC folder is not in a git repo, so the signed content cannot be read' };
    const commits = await this.commits();
    if (commits === undefined) return { reason: 'git log of signoff.yaml failed' };
    let found: CommitRef | undefined;
    for (const c of commits) {
      const entries = await this.signOffsAt(c.sha);
      if (!entries?.some((e) => String(e.at) === at && isObject(e.storyHashes) && e.storyHashes[id] === hash)) break;
      found = c;
    }
    if (found) return { commit: found };
    return { reason: `the sign-off of ${at} is not in a commit yet, so the signed content cannot be read from git` };
  }

  /** The record of the EPIC folder at a commit (prd, entities, flow, scenarios, changes), loaded from a temp copy. */
  recordAt(sha: string): Promise<EpicRecord | undefined> {
    let p = this.records.get(sha);
    if (!p) {
      p = this.loadAt(sha);
      this.records.set(sha, p);
    }
    return p;
  }

  private async loadAt(sha: string): Promise<EpicRecord | undefined> {
    const prefix = await this.repoPrefix();
    if (prefix === undefined) return undefined;
    const tree = await this.run(['ls-tree', '--full-tree', '-r', '-z', '--name-only', `${sha}:${prefix}`]);
    if (!tree.ok) return undefined;
    const top = new Set<string>([RECORD_FILES.prd, RECORD_FILES.entities, RECORD_FILES.flow]);
    const names = tree.stdout.split('\0').filter((n) => top.has(n) || SCENARIO_FILE.test(n) || CHANGE_FILE.test(n));
    if (!names.includes(RECORD_FILES.prd)) return undefined;
    const dir = mkdtempSync(join(tmpdir(), 'rehearse-signed-'));
    try {
      for (const name of names) {
        const text = await this.show(sha, name);
        if (text === undefined) return undefined;
        mkdirSync(dirname(join(dir, name)), { recursive: true });
        writeFileSync(join(dir, name), text);
      }
      return loadEpic(dir).record;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
