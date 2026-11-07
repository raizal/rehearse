// Birdview's saved test results, for the deck (T53). Box read-saved-test-results: when the running
// player does not have our test project, the deck reads what Birdview saved: projects.json,
// projects/<name>-<hash>/results.json (`{"file:line": {last, at, reason?, failedStep?}}`, the default
// project in results.json) and recordings/<stamp>-<slug>-<passed|failed>/ (about.json, the video,
// trace.zip). Our checkout's own project first, else the main checkout's; never another worktree.
// A saved `file:line` that moved is matched to our test by its title (the spec as it was when the
// test ran); what matches no test is dropped and counted, and of two runs of one test the newer counts. Box last-screen-picture: the last
// screencast frame of the run's trace, or the video's last frame with ffmpeg. Read-only on
// Birdview's folder.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join, relative, sep } from 'node:path';
import { readZip } from '@rehearse/core';
import type { TestResult } from './birdview.js';
import { parseSpec, type SpecTest } from './playlist.js';

/** Birdview's data folder was not found. */
export const NO_BIRDVIEW_DATA = 'Birdview data not found';

/** Where Birdview's data folder is, and how it was found. */
export interface BirdviewData {
  dir: string;
  how: string;
}

export interface FindDataOptions {
  /** `--birdview-data <dir>`. */
  explicit?: string;
  env?: Record<string, string | undefined>;
  /** `bb plugin config birdview-e2e --json`, read-only; undefined when bb cannot say. */
  pluginConfig?: () => string | undefined;
  home?: string;
}

const hasProjects = (dir: string) => existsSync(join(dir, 'projects.json')) || existsSync(join(dir, 'results.json'));

/** The data folder: the option, then REHEARSE_BIRDVIEW_DATA, then the plugin's setting, then the default place. */
export function findBirdviewData(o: FindDataOptions = {}): BirdviewData | undefined {
  if (o.explicit) return hasProjects(o.explicit) ? { dir: o.explicit, how: '--birdview-data' } : undefined;
  const env = o.env?.REHEARSE_BIRDVIEW_DATA;
  if (env) return hasProjects(env) ? { dir: env, how: 'REHEARSE_BIRDVIEW_DATA' } : undefined;
  const raw = o.pluginConfig?.();
  if (raw) {
    try {
      const dir = (JSON.parse(raw) as { values?: { dataDir?: unknown } }).values?.dataDir;
      if (typeof dir === 'string' && dir !== '' && hasProjects(dir)) return { dir, how: "the Birdview plugin's dataDir setting" };
    } catch {
      // not JSON: next
    }
  }
  const fallback = join(o.home ?? homedir(), '.bb', 'plugins', 'birdview-e2e');
  return hasProjects(fallback) ? { dir: fallback, how: 'the default place' } : undefined;
}

const real = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

/** Birdview's results file of a project: results.json for the default project, else projects/<name>-<hash>/. */
export function resultsFileOf(dataDir: string, projectDir: string, defaultDir?: string): string {
  if (defaultDir !== undefined && real(projectDir) === real(defaultDir)) return join(dataDir, 'results.json');
  const hash = createHash('sha1').update(real(projectDir)).digest('hex').slice(0, 8);
  const name = basename(projectDir).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  return join(dataDir, 'projects', `${name || 'project'}-${hash}`, 'results.json');
}

/** A test project to read, and why that one. */
export interface Candidate {
  dir: string;
  note: string;
}

/** A recording Birdview saved: its folder, about.json, and the files in it. */
export interface Recording {
  dir: string;
  name: string;
  key: string;
  status: 'passed' | 'failed';
  at: number;
  ms: number;
  video?: string;
  trace?: string;
}

/** Every recording in the data folder (all projects share the folder). */
export function readRecordings(dataDir: string): Recording[] {
  const root = join(dataDir, 'recordings');
  let names: string[];
  try {
    names = readdirSync(root).sort();
  } catch {
    return [];
  }
  const out: Recording[] = [];
  for (const name of names) {
    const dir = join(root, name);
    try {
      const about = JSON.parse(readFileSync(join(dir, 'about.json'), 'utf8')) as Record<string, unknown>;
      if (typeof about.file !== 'string' || (about.status !== 'passed' && about.status !== 'failed') || typeof about.at !== 'number') continue;
      const files = readdirSync(dir);
      const video = files.find((f) => f.endsWith('.mp4')) ?? files.find((f) => f.endsWith('.webm'));
      out.push({
        dir,
        name,
        key: about.file,
        status: about.status,
        at: about.at,
        ms: typeof about.ms === 'number' ? about.ms : 0,
        ...(video ? { video: join(dir, video) } : {}),
        ...(files.includes('trace.zip') ? { trace: join(dir, 'trace.zip') } : {}),
      });
    } catch {
      // not a recording
    }
  }
  return out;
}

/** Slack after the end of a recording for the result to be saved (the player waits for the last frame). */
const RECORDING_SLACK_MS = 120_000;

/** The recording of a saved result: same test key and outcome, the result saved while it ran. */
export function recordingOf(recordings: Recording[], key: string, r: TestResult): Recording | undefined {
  if (r.at === undefined || !r.last) return undefined;
  const at = r.at;
  return recordings.filter((x) => x.key === key && x.status === r.last && x.at <= at && at <= x.at + x.ms + RECORDING_SLACK_MS).sort((a, b) => b.at - a.at)[0];
}

/** One of our tests with its last saved run. */
export interface SavedRun {
  result: TestResult;
  /** The key Birdview saved it under (it moves when lines move). */
  savedKey: string;
  recording?: Recording;
}

export interface SavedResults {
  /** By our current `file:line` key. */
  runs: Record<string, SavedRun>;
  file: string;
  project: string;
  note: string;
  used: number;
  /** Saved results that match no test now. */
  dropped: number;
  /** Older runs of a test that also has a newer saved run (its line moved between them). */
  older: number;
  oldest?: number;
  newest?: number;
  recordings: number;
}

/** The spec file's text as it was at a time (ms), when git knows it; undefined otherwise. */
export type SpecAt = (projectDir: string, file: string, atMs: number) => Promise<string | undefined>;

export interface ReadSavedOptions {
  data: BirdviewData;
  /** Our test project and its tests now. */
  testProject: string;
  tests: SpecTest[];
  /** The main checkout's copy of our test project, when we are in a linked worktree. */
  mainProject?: string;
  specAt?: SpecAt;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/** The title of the test a saved key named when it ran: the file as it is if unchanged since, else git's copy. */
async function titleAt(projectDir: string, key: string, atMs: number | undefined, specAt: SpecAt | undefined, cache: Map<string, SpecTest[] | undefined>): Promise<string | undefined> {
  const m = /^(.*):(\d+)$/.exec(key);
  if (!m) return undefined;
  const [, file, line] = m as unknown as [string, string, string];
  const path = join(projectDir, file);
  const stamp = `${file}@${atMs ?? 'now'}`;
  if (!cache.has(stamp)) {
    let text: string | undefined;
    try {
      if (atMs === undefined || statSync(path).mtimeMs <= atMs) text = readFileSync(path, 'utf8');
    } catch {
      text = undefined;
    }
    if (text === undefined && atMs !== undefined && specAt) text = await specAt(projectDir, file, atMs).catch(() => undefined);
    cache.set(stamp, text === undefined ? undefined : parseSpec(file, text));
  }
  return cache.get(stamp)?.find((t) => t.line === Number(line))?.name;
}

/**
 * The saved results of our test project: our own project's file, else the main checkout's. Each
 * saved key is matched to one of our tests: same `file:line` and same title, or the same title
 * where the line moved. Two saved runs of one test: the newer counts. Undefined when there is no
 * saved file for either project.
 */
export async function readSavedResults(o: ReadSavedOptions): Promise<SavedResults | undefined> {
  const projects = readJson(join(o.data.dir, 'projects.json')) as { defaultDir?: unknown } | undefined;
  const defaultDir = typeof projects?.defaultDir === 'string' ? projects.defaultDir : undefined;
  const candidates: Candidate[] = [{ dir: o.testProject, note: "this checkout's own test project" }];
  if (o.mainProject && real(o.mainProject) !== real(o.testProject)) candidates.push({ dir: o.mainProject, note: "the main checkout's test project; this checkout has no saved results of its own" });
  for (const c of candidates) {
    const file = resultsFileOf(o.data.dir, c.dir, defaultDir);
    const saved = readJson(file);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) continue;
    const ours = new Map(o.tests.map((t) => [`${t.file}:${t.line}`, t]));
    const byName = new Map<string, SpecTest[]>();
    for (const t of o.tests) byName.set(t.name, [...(byName.get(t.name) ?? []), t]);
    const recordings = readRecordings(o.data.dir);
    const cache = new Map<string, SpecTest[] | undefined>();
    const runs: Record<string, SavedRun> = {};
    let dropped = 0;
    let older = 0;
    for (const [savedKey, value] of Object.entries(saved as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') {
        dropped++;
        continue;
      }
      const v = value as Record<string, unknown>;
      const result: TestResult = {
        ...(v.last === 'passed' || v.last === 'failed' ? { last: v.last } : {}),
        ...(typeof v.at === 'number' ? { at: v.at } : {}),
        ...(typeof v.reason === 'string' ? { reason: v.reason } : {}),
        ...(typeof v.failedStep === 'string' ? { failedStep: v.failedStep } : {}),
      };
      if (!result.last) {
        dropped++;
        continue;
      }
      const title = await titleAt(c.dir, savedKey, result.at, o.specAt, cache);
      const file = savedKey.replace(/:\d+$/, '');
      let target: SpecTest | undefined;
      const same = ours.get(savedKey);
      if (title !== undefined) {
        if (same && same.name === title) target = same;
        else {
          const named = byName.get(title) ?? [];
          target = named.find((t) => t.file === file) ?? named[0];
        }
      }
      if (!target) {
        dropped++;
        continue;
      }
      const key = `${target.file}:${target.line}`;
      const prev = runs[key];
      if (prev && (prev.result.at ?? 0) >= (result.at ?? 0)) {
        older++;
        continue;
      }
      if (prev) older++;
      const recording = recordingOf(recordings, savedKey, result);
      runs[key] = { result, savedKey, ...(recording ? { recording } : {}) };
    }
    const ats = Object.values(runs).flatMap((r) => (r.result.at !== undefined ? [r.result.at] : []));
    return {
      runs,
      file,
      project: c.dir,
      note: c.note,
      used: Object.keys(runs).length,
      dropped,
      older,
      ...(ats.length > 0 ? { oldest: Math.min(...ats), newest: Math.max(...ats) } : {}),
      recordings: Object.values(runs).filter((r) => r.recording).length,
    };
  }
  return undefined;
}

/** The main checkout's copy of a test project inside a linked worktree, from git's common dir. */
export async function mainCheckoutProject(testProject: string, repoTop: string, git: (args: string[]) => Promise<{ ok: boolean; stdout: string }>): Promise<string | undefined> {
  const r = await git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const common = r.stdout.trim();
  if (!r.ok || common === '' || basename(common) !== '.git') return undefined;
  const mainTop = join(common, '..');
  const rel = relative(repoTop, testProject);
  if (rel.startsWith('..')) return undefined;
  const dir = join(mainTop, rel);
  return existsSync(dir) ? dir : undefined;
}

/** A SpecAt from git: the file as of the last commit before the run, in the project's own repo. */
export function gitSpecAt(git: (args: string[], cwd: string) => Promise<{ ok: boolean; stdout: string }>): SpecAt {
  return async (projectDir, file, atMs) => {
    const before = new Date(atMs).toISOString();
    const log = await git(['log', '-1', '--format=%H', `--before=${before}`, 'HEAD', '--', file], projectDir);
    const sha = log.stdout.trim();
    if (!log.ok || sha === '') return undefined;
    const top = await git(['rev-parse', '--show-prefix'], projectDir);
    const prefix = top.ok ? top.stdout.trim() : '';
    const show = await git(['show', `${sha}:${prefix}${file.split(sep).join('/')}`], projectDir);
    return show.ok ? show.stdout : undefined;
  };
}

// ---------------------------------------------------------------- last-screen-picture

/** A still of a run's last screen. */
export interface Still {
  mime: 'image/jpeg' | 'image/png';
  data: Uint8Array;
}

const FRAME_RE = /^resources\/page@[^/]*-(\d+)\.jpe?g$/;
const MAX_TRACE_FRAME = 2 * 1024 * 1024;

/** The last screencast frame of a Playwright trace: the frame with the highest time stamp. */
export function lastTraceFrame(traceZip: Buffer): Still | undefined {
  let best: { name: string; t: number } | undefined;
  try {
    readZip(traceZip, {
      maxBytes: 0,
      only: (name) => {
        const m = FRAME_RE.exec(name);
        if (m && (!best || Number(m[1]) >= best.t)) best = { name, t: Number(m[1]) };
        return false;
      },
    });
    if (!best) return undefined;
    const pick = best.name;
    const [frame] = readZip(traceZip, { maxBytes: MAX_TRACE_FRAME, only: (name) => name === pick });
    return frame ? { mime: 'image/jpeg', data: frame.data } : undefined;
  } catch {
    return undefined;
  }
}

/** Runs ffmpeg; the bytes it wrote to its output file, or undefined when it cannot. */
export type Ffmpeg = (args: string[], out: string) => Promise<Uint8Array | undefined>;

export const processFfmpeg: Ffmpeg = (args, out) =>
  new Promise((done) => {
    execFile('ffmpeg', ['-y', '-loglevel', 'error', ...args, out], { timeout: 20_000 }, (err) => {
      if (err) return done(undefined);
      try {
        done(readFileSync(out));
      } catch {
        done(undefined);
      }
    });
  });

/** Widest still in the deck. */
export const STILL_WIDTH = 800;

/** The still of a recording: the trace's last frame, else the video's last frame (ffmpeg), at most 800 px wide. */
export async function lastScreen(rec: Recording, ffmpeg?: Ffmpeg): Promise<Still | undefined> {
  if (rec.trace) {
    try {
      const frame = lastTraceFrame(readFileSync(rec.trace));
      if (frame) return frame;
    } catch {
      // next
    }
  }
  if (!rec.video || !ffmpeg) return undefined;
  const out = join(tmpdir(), `rehearse-still-${createHash('sha1').update(rec.dir).digest('hex').slice(0, 12)}.jpg`);
  const data = await ffmpeg(['-sseof', '-1', '-i', rec.video, '-frames:v', '1', '-vf', `scale='min(${STILL_WIDTH},iw)':-2`, '-q:v', '5'], out);
  return data && data.length > 0 ? { mime: 'image/jpeg', data } : undefined;
}
