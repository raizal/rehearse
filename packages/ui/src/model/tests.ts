// The story Tests tab (T13, design page 14; T45): one row per scenario with its e2e test status in
// words, and the Birdview line above "Play in Birdview": which project and playlist the player
// shows, a notice when it plays another project (Play switches it), and where "Switch back" goes.
// Status comes from the player's results when it plays this EPIC's test project; otherwise every
// test is "not run".
//
// T47: a `no test` row of an approved scenario can go to an agent ("Write this test with an
// agent"); a draft or stale one says "approve this scenario first". Rows the story's test thread
// works on show the thread until the test is played; a test it wrote that has not run yet reads
// "test written, not run yet".

import type { Id, Scenario } from '@rehearse/core';
import type { BirdviewInfo, PlaylistTest, TestThreadView } from '@rehearse/server';

export type TestStatus = 'passed' | 'failed' | 'running' | 'not run' | 'no test';

export interface TestRow {
  scenarioId: Id;
  title: string;
  status: TestStatus;
  /** The status in words, e.g. "failed · held" or "failed at review/swimlanes". */
  words: string;
  /** `file:line`, when the scenario has a test. */
  key?: string;
  /** The box of the failed step, when the step names one. */
  failedBox?: string;
  failedStep?: string;
  reason?: string;
  /** The scenario is draft or stale: the owner approves it before an agent writes its test. */
  approveFirst?: boolean;
  /** The story's test thread has this scenario, and the test has not been played yet. */
  withThread?: boolean;
}

/** The scenario trust per id, and the story's test thread, for the T47 parts of the rows. */
export interface TestRowExtra {
  statuses?: Record<Id, 'approved' | 'draft' | 'stale'>;
  thread?: TestThreadView['thread'];
}

/** What the row of a scenario that is not approved says, instead of a button. */
export const APPROVE_FIRST = 'approve this scenario first';
export const WRITTEN_NOT_RUN = 'test written, not run yet';

const ACTIVE = new Set(['running', 'paused', 'held', 'waiting']);

/** One row per scenario of the story, in record order. */
export function testRows(scenarios: Scenario[], info: BirdviewInfo | undefined, extra: TestRowExtra = {}): TestRow[] {
  const mine = new Set(extra.thread?.scenarios ?? []);
  return baseRows(scenarios, info).map((r) => {
    const status = extra.statuses?.[r.scenarioId];
    if (r.status === 'no test' && status !== undefined && status !== 'approved') return { ...r, approveFirst: true };
    if (!mine.has(r.scenarioId)) return r;
    if (r.status === 'no test') return { ...r, withThread: true };
    if (r.status === 'not run') return { ...r, words: WRITTEN_NOT_RUN, withThread: true };
    return r;
  });
}

/** The approved scenarios without a test that the running test thread does not have yet. */
export function toSend(rows: TestRow[], view: TestThreadView | undefined): Id[] {
  const has = new Set(view?.thread?.scenarios ?? []);
  return (view?.missing ?? []).filter((id) => !has.has(id) && rows.some((r) => r.scenarioId === id && r.status === 'no test'));
}

/** "Write the 2 missing tests with an agent". */
export function writeMissingLabel(k: number): string {
  return k === 1 ? 'Write the missing test with an agent' : `Write the ${k} missing tests with an agent`;
}

function baseRows(scenarios: Scenario[], info: BirdviewInfo | undefined): TestRow[] {
  const tests = new Map<Id, PlaylistTest>((info?.playlist?.tests ?? []).map((t) => [t.name, t]));
  const player = info?.player;
  return scenarios.map((sc) => {
    const base = { scenarioId: sc.id, title: sc.title };
    const t = tests.get(sc.id);
    if (!t) return { ...base, status: 'no test', words: 'no test' };
    const key = `${t.file}:${t.line}`;
    if (player?.kind !== 'ours') return { ...base, key, status: 'not run', words: 'not run' };
    if (player.current === key && ACTIVE.has(player.status)) {
      if (player.status === 'held') {
        const r = player.results[key];
        return { ...base, key, status: 'failed', words: 'failed · held', failedStep: r?.failedStep, failedBox: r?.failedStep ? t.steps[r.failedStep] : undefined, reason: r?.reason };
      }
      return { ...base, key, status: 'running', words: player.status === 'paused' ? 'running · paused' : 'running' };
    }
    const r = player.results[key];
    if (r?.last === 'passed') return { ...base, key, status: 'passed', words: 'passed' };
    if (r?.last === 'failed') {
      const failedBox = r.failedStep ? t.steps[r.failedStep] : undefined;
      return { ...base, key, status: 'failed', words: failedBox ? `failed at ${failedBox}` : 'failed', failedStep: r.failedStep, failedBox, reason: r.reason };
    }
    return { ...base, key, status: 'not run', words: 'not run' };
  });
}

/** "2 of 3 tests pass", for the tab and its header. */
export function testSummary(rows: TestRow[]): string {
  const withTest = rows.filter((r) => r.status !== 'no test');
  if (withTest.length === 0) return 'no e2e test yet';
  const passed = withTest.filter((r) => r.status === 'passed').length;
  const missing = rows.length - withTest.length;
  return `${passed} of ${withTest.length} tests pass${missing > 0 ? `, ${missing} scenario${missing === 1 ? '' : 's'} without a test` : ''}`;
}

/** The words of the server when the player does not answer (birdview-play.ts). */
export const NOT_RUNNING = 'Birdview is not running; open it from the bb sidebar.';

/** A project folder in a few words: `<repo>/e2e` for a test project folder named e2e, else its name. */
export function projectName(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean);
  const last = parts[parts.length - 1] ?? path;
  return last === 'e2e' && parts.length > 1 ? `${parts[parts.length - 2]}/e2e` : last;
}

const samePath = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

export interface BirdviewStatus {
  /** "Birdview: <project> · playlist <name>", or why there is no player. */
  line: string;
  /** When the player plays another project: "Birdview is on <it>. Play will switch it to this repo." */
  other?: string;
  /** "Switch back" to the player's default project, when it plays another one now. */
  switchBack?: { label: string; projectDir: string };
  /** Embed the player: it plays this repo's test project. */
  embed: boolean;
  /** Why "Play in Birdview" cannot be pressed; undefined when it can. */
  blocked?: string;
}

/** The Birdview line of the Tests tab, the notices under it, and whether Play can be pressed. */
export function birdviewStatus(info: BirdviewInfo): BirdviewStatus {
  const p = info.player;
  const noTests = !info.playlist || info.playlist.tests.length === 0;
  if (!info.projectDir) {
    const blocked = 'This EPIC has no e2e test project: rehearse looks for an e2e/ folder with a playwright.config.ts above the EPIC folder.';
    return { line: blocked, embed: false, blocked };
  }
  if (p.kind === 'off') return { line: NOT_RUNNING, embed: false, blocked: NOT_RUNNING };
  const playing = info.active?.projectDir ?? (p.kind === 'other' ? p.projectDir : info.projectDir);
  const line = `Birdview: ${playing ? projectName(playing) : 'no project'} · playlist ${info.active?.playlist?.name ?? 'none'}`;
  const def = info.defaultProject;
  const switchBack = def && playing && !samePath(def.projectDir, playing) ? { label: `Switch back to ${projectName(def.projectDir)}`, projectDir: def.projectDir } : undefined;
  return {
    line,
    ...(p.kind === 'other' ? { other: `Birdview is on ${playing ? projectName(playing) : 'no project'}. Play will switch it to this repo.` } : {}),
    ...(switchBack ? { switchBack } : {}),
    embed: p.kind === 'ours',
    ...(noTests ? { blocked: 'No e2e test of this story yet: name a Playwright test after one of its scenario ids.' } : {}),
  };
}

/** The player page, embedded: no chat, the active view. */
export function embedUrl(info: BirdviewInfo): string {
  return `${info.playerUrl}?embed=1&view=active`;
}
