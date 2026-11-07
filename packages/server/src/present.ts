// `rehearse present` and `GET /api/present` (T52). Box gather-deck-facts: the facts of an EPIC as of
// HEAD (branch, short sha, commit date; Flow-Box commits reachable from HEAD; the e2e tests and,
// when Birdview has them, their results; the stories' design pictures, shrunk to ≤1600 px; the
// gate), refused with --committed-only when the EPIC folder has uncommitted changes. T53 adds the
// proof: Birdview's saved results when the player does not have our project (saved-results.ts),
// the still of each recorded run's last screen, the videos to copy next to the deck, the unit
// report's counts, the simulation and the signature per story, and where each came from. Box
// print-deck-pdf: Playwright's Chromium from the repo's e2e package prints the HTML; when it cannot
// launch, PrinterUnavailable says so and the HTML's own print still works. Read-only.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { extname, join, relative } from 'node:path';
import {
  allScenarios,
  defaultVerifier,
  deckHtml,
  downscalePng,
  findingStories,
  gateEpic,
  loadEpic,
  presentationDeck,
  readDesignState,
  readFigcraftThumbnail,
  readPresentation,
  repoTopOf,
  servingBoxes,
  signOffPayload,
  simulateRecord,
  storyEffectiveDesign,
  type Deck,
  type DeckAssets,
  type DeckEvidence,
  type DeckFacts,
  type EpicRecord,
  type Finding,
  type Id,
  type SignatureState,
  type SignedSignOff,
  type StoryFacts,
  type TestRun,
  type TestState,
  type Verifier,
} from '@rehearse/core';
import type { TestResult } from './birdview.js';
import type { GitRunner } from './box-code.js';
import { linkPicture } from './design-route.js';
import { findBirdviewData, gitSpecAt, lastScreen, mainCheckoutProject, NO_BIRDVIEW_DATA, processFfmpeg, readSavedResults, type BirdviewData, type Ffmpeg, type Recording, type SavedResults, type SpecAt } from './saved-results.js';
import { epicGateItems, parseBranchLog, specTests, storyProgress, type GitCall } from './story-progress.js';
import { readUnitReport, unitCount, UnitReportError, type UnitReport } from './unit-report.js';

/** The record has uncommitted changes and the caller asked for a committed deck only. */
export class UncommittedError extends Error {}

/** Chromium cannot print the PDF here. The message is for the owner. */
export class PrinterUnavailable extends Error {}

export const NO_CHROMIUM =
  'Chromium is not available here, so rehearse cannot make the PDF. Open the HTML deck in a browser and print it to PDF (one landscape slide per page), or install the e2e browsers with `pnpm --filter @rehearse/e2e exec playwright install chromium`.';

/** Prints an HTML document to PDF bytes. */
export type Printer = (html: string) => Promise<Uint8Array>;

export interface DeckOptions {
  epicDir: string;
  /** Default: the git top above the EPIC folder. */
  repoTop?: string;
  git: GitCall;
  /** The e2e test project (`*.spec.ts`). */
  testProject?: string;
  /** The last results of a story's e2e tests (Birdview), when known. */
  testResults?: (storyId: Id) => Promise<Record<string, TestResult> | undefined>;
  /** Lines covered by unit tests in whole percent, when the code graph has it. */
  coverage?: () => Promise<number | undefined>;
  /** Signature checks for the gate. Default: the repo's allowed_signers. */
  verifier?: Verifier;
  committedOnly?: boolean;
  /** Today, for a deck with uncommitted changes. */
  now?: () => Date;
  /** Birdview's data folder, read when the player has no results of our project (T53); null: not found. */
  birdviewData?: BirdviewData | null;
  /** The main checkout's copy of the test project, when this is a linked worktree. */
  mainTestProject?: string;
  /** A spec file as it was when a saved result ran (git), to match moved lines by title. */
  specAt?: SpecAt;
  /** A vitest JSON report: unit tests per story. */
  unitReport?: string;
  /** Link the videos of the runs from `<folder>/` next to the deck; the caller copies `videos` there. */
  media?: { folder?: string };
  /** For the video's last frame when a run has no trace. */
  ffmpeg?: Ffmpeg;
  /** Most bytes of last-screen stills in one deck. */
  maxStillBytes?: number;
}

/** A video to copy next to the deck: from `src` to `<media folder>/<name>`. */
export interface DeckVideo {
  src: string;
  name: string;
}

/** Default cap of the stills in one deck. */
export const MAX_STILL_BYTES = 3 * 1024 * 1024;

export interface BuiltDeck {
  deck: Deck;
  html: string;
  bytes: number;
  facts: DeckFacts;
  /** Shape findings of presentation.yaml: the deck is built without the bad parts. */
  inputFindings: Finding[];
  /** The videos the deck links, to copy into `mediaFolder` next to it. */
  videos: DeckVideo[];
  mediaFolder?: string;
  /** Sources that were asked for and could not be read: said, and the deck is made anyway. */
  warnings: string[];
}

/** What the simulation says about a story: problems, and paths only drafts (or nothing) walk. */
const UNCOVERED = /no approved scenario|only by drafts|not covered|covered only/;

/** The signature of each story's latest sign-off; checked and valid count stories, not sign-offs. */
function signatures(record: EpicRecord, verifier: Verifier): { byStory: Map<Id, SignatureState>; checked: number; valid: number } {
  const byStory = new Map<Id, SignatureState>();
  const list = Array.isArray(record.signoff?.signOffs) ? (record.signoff.signOffs as SignedSignOff[]) : [];
  for (const s of list) {
    if (!s || typeof s !== 'object') continue;
    const check = verifier.verify(signOffPayload(record.slug, s), s.sig, String(s.by ?? ''));
    for (const id of s.storyHashes && typeof s.storyHashes === 'object' ? Object.keys(s.storyHashes) : []) byStory.set(id, check.status);
  }
  return { byStory, checked: byStory.size, valid: [...byStory.values()].filter((v) => v === 'valid').length };
}

/** A path under the home folder as ~/…, so the deck does not show the user's home path. */
const tilde = (p: string) => (p.startsWith(`${homedir()}/`) ? `~${p.slice(homedir().length)}` : p);

const iso = (ms: number | undefined) => (ms === undefined ? undefined : new Date(ms).toISOString());

const MAX_COMMITS = 5000;

async function gitLine(git: GitCall, args: string[]): Promise<string | undefined> {
  const r = await git(args);
  const line = r.stdout.trim();
  return r.ok && line !== '' ? line : undefined;
}

/** The "## Idea" section of the EPIC's brainstorm.md, up to its first list or "Goals:" line. */
export function brainstormIdea(markdown: string): string | undefined {
  const m = /^## Idea[ \t]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(markdown);
  if (!m) return undefined;
  const lines: string[] = [];
  for (const line of m[1]!.split('\n')) {
    if (/^\s*([-*]|\d+\.)\s/.test(line) || /^\s*[A-Z][\w ]*:\s*$/.test(line)) break;
    lines.push(line);
  }
  const text = lines.join(' ').replace(/\s+/g, ' ').trim();
  return text === '' ? undefined : text;
}

const STATE: Record<string, TestState> = { passing: 'passed', failing: 'failed', 'not-run': 'not-run', missing: 'not-written' };

/** The facts of a deck, its pictures, and the record they were read from. */
export async function gatherDeckFacts(opts: DeckOptions): Promise<{ record: EpicRecord; facts: DeckFacts; assets: DeckAssets; videos: DeckVideo[]; mediaFolder?: string; warnings: string[] }> {
  const { epicDir, git } = opts;
  const top = opts.repoTop ?? repoTopOf(epicDir);
  const status = await git(['status', '--porcelain', '--', '.']);
  const uncommitted = status.ok && status.stdout.trim() !== '';
  if (uncommitted && opts.committedOnly)
    throw new UncommittedError(`the EPIC folder has uncommitted changes, so the deck would not match a commit. Commit them first, or leave out --committed-only to make the deck with a notice.\n${status.stdout.trimEnd()}`);
  const sha = (await gitLine(git, ['rev-parse', '--short=7', 'HEAD'])) ?? 'no commit';
  const branch = (await gitLine(git, ['rev-parse', '--abbrev-ref', 'HEAD'])) ?? 'no branch';
  const commitDate = await gitLine(git, ['log', '-1', '--format=%cs', 'HEAD']);
  const today = (opts.now ?? (() => new Date()))().toISOString().slice(0, 10);
  const owner = (await gitLine(git, ['config', 'user.name'])) ?? (await gitLine(git, ['config', 'user.email']));
  const log = await git(['log', 'HEAD', '-n', String(MAX_COMMITS), '--grep=^Flow-Box:', '--format=%H%x1f%S%x1f%s%x1f%B%x1e']);
  const commits = log.ok ? parseBranchLog(log.stdout) : [];

  const { record, gate } = epicGateItems(epicDir);
  const report = gateEpic(epicDir, simulateRecord, opts.verifier ? { verifier: opts.verifier } : {});
  const items: DeckFacts["gate"]["items"] = gate.map((g) => ({ check: g.check, message: g.finding.message, stories: g.stories }));
  const known = new Set(gate.map((g) => g.finding.message));
  // Signature findings are the gate's too: they are not in the hash-only items.
  for (const f of report.findings) if (!known.has(f.message)) items.push({ check: 'signature', message: f.message, stories: findingStories(record, f) });

  const tests = specTests(opts.testProject);
  const designState = readDesignState(top, record);
  const assets: DeckAssets = {};
  const stories: Record<Id, StoryFacts> = {};
  const warnings: string[] = [];
  const videos: DeckVideo[] = [];
  const commitInfo = { branch, sha, date: uncommitted ? today : (commitDate ?? today) };
  const mediaFolder = opts.media ? (opts.media.folder ?? `${deckFileName(record.slug, { commit: commitInfo } as DeckFacts)}-media`) : undefined;

  // E2E results: the player when it has our project, else Birdview's saved files.
  const evidence: DeckEvidence = {
    e2e: { source: 'none', used: 0, dropped: 0 },
    recordings: { found: 0, pictures: 0, picturesLeftOut: 0, picturesBytes: 0, ...(mediaFolder ? { copied: mediaFolder } : {}) },
    unit: {},
    signatures: { file: '.rehearse/allowed_signers', checked: 0, valid: 0 },
  };
  const live = new Map<Id, Record<string, TestResult>>();
  for (const story of Array.isArray(record.prd?.stories) ? record.prd.stories : []) {
    if (!story || typeof story.id !== 'string' || !opts.testResults) continue;
    const r = await opts.testResults(story.id).catch(() => undefined);
    if (r) live.set(story.id, r);
  }
  let saved: SavedResults | undefined;
  if (live.size === 0 && opts.testProject && opts.birdviewData) {
    saved = await readSavedResults({ data: opts.birdviewData, testProject: opts.testProject, tests, ...(opts.mainTestProject ? { mainProject: opts.mainTestProject } : {}), ...(opts.specAt ? { specAt: opts.specAt } : {}) }).catch(() => undefined);
    if (!saved) evidence.e2e.why = `Birdview has no saved results of the test project ${opts.testProject}`;
  } else if (live.size === 0) {
    evidence.e2e.why = !opts.testProject ? 'no e2e test project was found' : opts.birdviewData === null ? `${NO_BIRDVIEW_DATA}, and the player does not have this project` : 'the Birdview player does not have this project';
    if (opts.birdviewData === null) warnings.push(`${NO_BIRDVIEW_DATA}: the deck shows written tests as "not run"`);
  }
  const savedResults: Record<string, TestResult> | undefined = saved ? Object.fromEntries(Object.entries(saved.runs).map(([k, r]) => [k, r.result])) : undefined;
  if (saved) {
    evidence.e2e = {
      source: 'saved',
      file: tilde(saved.file),
      project: tilde(saved.project),
      note: saved.note,
      used: 0,
      dropped: saved.dropped,
      ...(saved.older > 0 ? { older: saved.older } : {}),
      ...(saved.oldest !== undefined ? { oldest: iso(saved.oldest)! } : {}),
      ...(saved.newest !== undefined ? { newest: iso(saved.newest)! } : {}),
    };
    if (saved.dropped > 0) warnings.push(`${saved.dropped} saved Birdview result${saved.dropped === 1 ? '' : 's'} left out: result does not match a test`);
  } else if (live.size > 0) evidence.e2e = { source: 'player', ...(opts.testProject ? { project: tilde(opts.testProject) } : {}), used: 0, dropped: 0 };
  const testResults = live.size > 0 || saved !== undefined;

  // Unit tests.
  let unit: UnitReport | undefined;
  if (opts.unitReport) {
    try {
      unit = readUnitReport(opts.unitReport);
      const rel = relative(top, unit.file);
      evidence.unit = { file: rel.startsWith('..') ? unit.file : rel, date: unit.date, tests: unit.tests.length, passed: unit.tests.filter((t) => t.status === 'passed').length, failed: unit.tests.filter((t) => t.status === 'failed').length };
    } catch (e) {
      const why = e instanceof UnitReportError ? e.message : String(e);
      evidence.unit = { why };
      warnings.push(why);
    }
  } else evidence.unit = { why: 'no unit report was given; pnpm test:report makes one' };

  // Signatures of the sign-offs.
  const sigs = signatures(record, opts.verifier ?? defaultVerifier(epicDir));
  evidence.signatures = { file: '.rehearse/allowed_signers', checked: sigs.checked, valid: sigs.valid };

  // The simulation per story, from the gate's sim-clean items.
  const sim = new Map<Id, { problems: number; uncovered: number }>();
  for (const g of gate) {
    if (g.check !== 'sim-clean') continue;
    for (const id of g.stories) {
      const v = sim.get(id) ?? { problems: 0, uncovered: 0 };
      if (UNCOVERED.test(g.finding.message)) v.uncovered++;
      else v.problems++;
      sim.set(id, v);
    }
  }

  const stillCap = opts.maxStillBytes ?? MAX_STILL_BYTES;
  const scenarios = allScenarios(record);
  let used = 0;
  const usedAt: number[] = [];
  for (const story of Array.isArray(record.prd?.stories) ? record.prd.stories : []) {
    if (!story || typeof story.id !== 'string') continue;
    const results = live.get(story.id) ?? savedResults;
    const p = storyProgress({ record, storyId: story.id, commits, thread: null, tests, ...(results ? { results } : {}), gate: [] });
    const facts: StoryFacts = { built: p.counts.boxesWithCode, tests: Object.fromEntries(p.scenarios.map((s) => [s.id, STATE[s.state]!])) };
    // The runs: when, the failing step, and the recording (a still, and a video to copy).
    const runs: Record<Id, TestRun> = {};
    for (const s of p.scenarios) {
      const result = s.test ? results?.[s.test] : undefined;
      if (!s.test || !result?.last) continue;
      used++;
      if (result.at !== undefined) usedAt.push(result.at);
      const run: TestRun = { ...(result.at !== undefined ? { at: iso(result.at)! } : {}), ...(result.last === 'failed' && result.failedStep ? { failedStep: result.failedStep } : {}) };
      const rec: Recording | undefined = saved?.runs[s.test]?.recording;
      if (rec) {
        run.recorded = true;
        evidence.recordings.found++;
        if (mediaFolder && rec.video) {
          const name = `${rec.name}${extname(rec.video)}`;
          if (!videos.some((v) => v.name === name)) videos.push({ src: rec.video, name });
          run.video = `${mediaFolder}/${name}`;
        }
        const still = await lastScreen(rec, opts.ffmpeg).catch(() => undefined);
        if (still && evidence.recordings.picturesBytes + still.data.length <= stillCap) {
          const key = `run-${s.id}`;
          assets[key] = { mime: still.mime, data: still.data };
          run.picture = key;
          evidence.recordings.pictures++;
          evidence.recordings.picturesBytes += still.data.length;
        } else if (still) evidence.recordings.picturesLeftOut++;
      }
      runs[s.id] = run;
    }
    if (Object.keys(runs).length > 0) facts.runs = runs;
    const paths = servingBoxes(record.flow, story.id);
    facts.commits = commits.filter((c) => c.boxes.some((b) => paths.some((path) => b === path || b.startsWith(`${path}/`)))).length;
    if (unit) {
      const ids = [...scenarios.filter((s) => s.story === story.id).map((s) => s.id), ...(Array.isArray(story.acceptance) ? story.acceptance.flatMap((a) => (a && typeof a.id === 'string' ? [a.id] : [])) : [])];
      facts.unit = unitCount(unit, ids);
    }
    facts.simulation = sim.get(story.id) ?? { problems: 0, uncovered: 0 };
    const sig = sigs.byStory.get(story.id);
    if (sig) facts.signature = sig;
    const link = storyEffectiveDesign(designState, record.slug, story.id).story?.link;
    const pic = link ? linkPicture(top, designState, link) : undefined;
    let png: Uint8Array | undefined;
    try {
      if (pic && pic.kind !== 'file thumbnail') png = readFileSync(join(top, pic.png));
      else if (pic) png = readFigcraftThumbnail(top, pic.file);
    } catch {
      png = undefined;
    }
    if (png) {
      const small = downscalePng(png);
      const key = `design-${story.id}`;
      assets[key] = { mime: 'image/png', data: small.png, ...(small.width ? { width: small.width, height: small.height } : {}) };
      facts.design = { asset: key, caption: link?.frame !== undefined ? `Screen design: ${link.frame}` : 'Screen design of this story' };
    }
    stories[story.id] = facts;
  }

  let idea: string | undefined;
  const brainstorm = join(epicDir, 'brainstorm.md');
  if (existsSync(brainstorm)) idea = brainstormIdea(readFileSync(brainstorm, 'utf8'));
  const coverage = opts.coverage ? await opts.coverage().catch(() => undefined) : undefined;
  evidence.e2e.used = used;
  if (usedAt.length > 0 && evidence.e2e.source === 'player') {
    evidence.e2e.oldest = iso(Math.min(...usedAt))!;
    evidence.e2e.newest = iso(Math.max(...usedAt))!;
  }
  const facts: DeckFacts = {
    commit: commitInfo,
    uncommitted,
    ...(owner ? { owner } : {}),
    ...(idea ? { idea } : {}),
    stories,
    gate: { ok: report.ok && items.length === 0, items },
    testResults,
    ...(coverage !== undefined ? { coverage } : {}),
    evidence,
  };
  return { record, facts, assets, videos, ...(mediaFolder ? { mediaFolder } : {}), warnings };
}

/** Where the unit report of `pnpm test:report` goes, from the repo top. */
export const UNIT_REPORT_FILE = '.rehearse/unit-report.json';

/** The proof sources of a deck that `rehearse present` and `rehearse serve` find on their own. */
export type DeckSources = Pick<DeckOptions, 'birdviewData' | 'mainTestProject' | 'specAt' | 'unitReport' | 'ffmpeg'>;

export interface DeckSourceOptions {
  repoTop: string;
  testProject?: string;
  git: GitRunner;
  /** `--birdview-data <dir>`. */
  birdviewData?: string;
  /** `--unit-report <file>`; default: .rehearse/unit-report.json when it is there. */
  unitReport?: string;
  env?: Record<string, string | undefined>;
  /** `bb plugin config birdview-e2e --json` (read-only). Default: run bb, 5 s at most. */
  pluginConfig?: () => string | undefined;
  home?: string;
}

/** Birdview's plugin settings from bb, read-only; undefined when bb is not there or says nothing. */
export function bbBirdviewConfig(): string | undefined {
  try {
    return execFileSync('bb', ['plugin', 'config', 'birdview-e2e', '--json'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return undefined;
  }
}

/** Finds Birdview's data folder, the main checkout's test project, and the unit report. */
export async function deckSources(o: DeckSourceOptions): Promise<DeckSources> {
  const data = findBirdviewData({ ...(o.birdviewData ? { explicit: o.birdviewData } : {}), env: o.env ?? process.env, pluginConfig: o.pluginConfig ?? bbBirdviewConfig, ...(o.home ? { home: o.home } : {}) });
  const main = o.testProject ? await mainCheckoutProject(o.testProject, o.repoTop, (args) => o.git(args, o.repoTop)) : undefined;
  const fallbackReport = join(o.repoTop, UNIT_REPORT_FILE);
  const unitReport = o.unitReport ?? (existsSync(fallbackReport) ? fallbackReport : undefined);
  return { birdviewData: data ?? null, ...(main ? { mainTestProject: main } : {}), specAt: gitSpecAt(o.git), ...(unitReport ? { unitReport } : {}), ffmpeg: processFfmpeg };
}

/** Box build-deck + render-deck-html: the deck of an EPIC as one HTML file. */
export async function buildDeckHtml(opts: DeckOptions): Promise<BuiltDeck> {
  const { record, facts, assets, videos, mediaFolder, warnings } = await gatherDeckFacts(opts);
  const { inputs, findings } = readPresentation(record);
  const deck = presentationDeck(record, facts, inputs);
  const html = deckHtml(deck, assets);
  return { deck, html, bytes: Buffer.byteLength(html), facts, inputFindings: findings, videos, ...(mediaFolder ? { mediaFolder } : {}), warnings };
}

/** The record as loaded, for callers that only need the slug. */
export function epicSlugOf(epicDir: string): string {
  return loadEpic(epicDir).record.slug;
}

interface PlaywrightLike {
  chromium: {
    launch: (o?: Record<string, unknown>) => Promise<{
      newPage: (o?: Record<string, unknown>) => Promise<{
        setContent: (html: string, o?: Record<string, unknown>) => Promise<void>;
        pdf: (o?: Record<string, unknown>) => Promise<Uint8Array>;
      }>;
      close: () => Promise<void>;
    }>;
  };
}

/** The Playwright of the repo's e2e package, when it is installed. */
function loadPlaywright(repoTop: string): PlaywrightLike {
  const req = createRequire(join(repoTop, 'e2e', 'package.json'));
  for (const name of ['@playwright/test', 'playwright', 'playwright-core']) {
    try {
      return req(name) as PlaywrightLike;
    } catch {
      // next
    }
  }
  throw new PrinterUnavailable(NO_CHROMIUM);
}

/** Box print-deck-pdf: Chromium (Playwright, from e2e/) prints the deck, one slide per page. */
export function chromiumPrinter(repoTop: string): Printer {
  return async (html) => {
    let pw: PlaywrightLike;
    try {
      pw = loadPlaywright(repoTop);
    } catch {
      throw new PrinterUnavailable(NO_CHROMIUM);
    }
    let browser: Awaited<ReturnType<PlaywrightLike['chromium']['launch']>>;
    try {
      browser = await pw.chromium.launch();
    } catch (e) {
      throw new PrinterUnavailable(`${NO_CHROMIUM}\n(${e instanceof Error ? e.message.split('\n')[0] : String(e)})`);
    }
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 772 } });
      await page.setContent(html, { waitUntil: 'load' });
      return await page.pdf({ preferCSSPageSize: true, printBackground: true });
    } finally {
      await browser.close();
    }
  };
}

/** `<slug>-<date>-<sha>`: the file name of a deck, without the extension. */
export function deckFileName(slug: string, facts: DeckFacts): string {
  return `${slug}-${facts.commit.date}-${facts.commit.sha.replace(/[^0-9a-z]/gi, '') || 'nocommit'}`;
}
