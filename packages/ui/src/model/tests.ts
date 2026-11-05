// The story Tests tab (T13, design page 14): one row per scenario with its e2e test status in
// words, and whether the Birdview player can be shown here. Status comes from the player's
// results when it plays this EPIC's test project; otherwise every test is "not run".

import type { Id, Scenario } from '@rehearse/core';
import type { BirdviewInfo, PlaylistTest } from '@rehearse/server';

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
}

const ACTIVE = new Set(['running', 'paused', 'held', 'waiting']);

/** One row per scenario of the story, in record order. */
export function testRows(scenarios: Scenario[], info: BirdviewInfo | undefined): TestRow[] {
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

/** Shell-quote a path for a copyable command. */
function q(path: string): string {
  return /^[\w@%+=:,./-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`;
}

/** The commands that point Birdview at this EPIC's test project and its story playlists. */
export function setupCommands(info: BirdviewInfo): string[] {
  if (!info.projectDir) return [];
  const out = [`bb plugin config birdview-e2e set projectDir ${q(info.projectDir)}`];
  if (info.playlistsDir) out.push(`bb plugin config birdview-e2e set playlistsDir ${q(info.playlistsDir)}`);
  return out;
}

export interface PlayerNotice {
  /** Embed the player: it runs and plays this EPIC's test project. */
  embed: boolean;
  /** What is wrong, in words; empty when all is well. */
  title?: string;
  text?: string;
  /** Commands to run by hand, in order. */
  commands: string[];
}

/** Whether to embed the player, and the steps to set it up when not. */
export function playerNotice(info: BirdviewInfo): PlayerNotice {
  const commands = setupCommands(info);
  if (!info.projectDir) {
    return {
      embed: false,
      title: 'This EPIC has no e2e test project',
      text: 'rehearse looks for an e2e/ folder with a playwright.config.ts above the EPIC folder. Add one, name each test after its scenario id, then run rehearse playlists.',
      commands: [],
    };
  }
  const p = info.player;
  if (p.kind === 'off') {
    return {
      embed: false,
      title: `The Birdview player is not running on port ${info.port}`,
      text: 'Install the birdview-e2e plugin in bb and open Birdview from the sidebar, then point it at this test project:',
      commands,
    };
  }
  if (p.kind === 'other') {
    return {
      embed: false,
      title: 'The Birdview player plays another project',
      text: `It plays ${p.projectDir || 'no project'}, not ${info.projectDir}. To play these tests, point it at this test project (this changes Birdview for every project):`,
      commands,
    };
  }
  if (info.playlistsDir && p.playlistsDir && p.playlistsDir !== info.playlistsDir) {
    return {
      embed: true,
      title: 'Birdview reads playlists from another folder',
      text: `It reads ${p.playlistsDir}; the story playlists are in ${info.playlistsDir}.`,
      commands: commands.slice(1),
    };
  }
  return { embed: true, commands: [] };
}

/** The player page, embedded: no chat, the active view. */
export function embedUrl(info: BirdviewInfo): string {
  return `${info.playerUrl}?embed=1&view=active`;
}
