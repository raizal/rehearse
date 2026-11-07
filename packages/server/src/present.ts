// `rehearse present` and `GET /api/present` (T52). Box gather-deck-facts: the facts of an EPIC as of
// HEAD (branch, short sha, commit date; Flow-Box commits reachable from HEAD; the e2e tests and,
// when Birdview has them, their results; the stories' design pictures, shrunk to ≤1600 px; the
// gate), refused with --committed-only when the EPIC folder has uncommitted changes. Box
// print-deck-pdf: Playwright's Chromium from the repo's e2e package prints the HTML; when it cannot
// launch, PrinterUnavailable says so and the HTML's own print still works. Read-only.

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
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
  simulateRecord,
  storyEffectiveDesign,
  type Deck,
  type DeckAssets,
  type DeckFacts,
  type EpicRecord,
  type Finding,
  type Id,
  type StoryFacts,
  type TestState,
  type Verifier,
} from '@rehearse/core';
import type { TestResult } from './birdview.js';
import { linkPicture } from './design-route.js';
import { epicGateItems, parseBranchLog, specTests, storyProgress, type GitCall } from './story-progress.js';

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
}

export interface BuiltDeck {
  deck: Deck;
  html: string;
  bytes: number;
  facts: DeckFacts;
  /** Shape findings of presentation.yaml: the deck is built without the bad parts. */
  inputFindings: Finding[];
}

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
export async function gatherDeckFacts(opts: DeckOptions): Promise<{ record: EpicRecord; facts: DeckFacts; assets: DeckAssets }> {
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
  let testResults = false;
  for (const story of Array.isArray(record.prd?.stories) ? record.prd.stories : []) {
    if (!story || typeof story.id !== 'string') continue;
    const results = opts.testResults ? await opts.testResults(story.id).catch(() => undefined) : undefined;
    if (results) testResults = true;
    const p = storyProgress({ record, storyId: story.id, commits, thread: null, tests, ...(results ? { results } : {}), gate: [] });
    const facts: StoryFacts = { built: p.counts.boxesWithCode, tests: Object.fromEntries(p.scenarios.map((s) => [s.id, STATE[s.state]!])) };
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
  const facts: DeckFacts = {
    commit: { branch, sha, date: uncommitted ? today : (commitDate ?? today) },
    uncommitted,
    ...(owner ? { owner } : {}),
    ...(idea ? { idea } : {}),
    stories,
    gate: { ok: report.ok && items.length === 0, items },
    testResults,
    ...(coverage !== undefined ? { coverage } : {}),
  };
  return { record, facts, assets };
}

/** Box build-deck + render-deck-html: the deck of an EPIC as one HTML file. */
export async function buildDeckHtml(opts: DeckOptions): Promise<BuiltDeck> {
  const { record, facts, assets } = await gatherDeckFacts(opts);
  const { inputs, findings } = readPresentation(record);
  const deck = presentationDeck(record, facts, inputs);
  const html = deckHtml(deck, assets);
  return { deck, html, bytes: Buffer.byteLength(html), facts, inputFindings: findings };
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
