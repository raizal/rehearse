// T13 feature 3, pure part: the story's tests as rows with status in words, and whether the
// Birdview player can be embedded (it runs and plays this EPIC's test project).

import { describe, expect, it } from 'vitest';
import type { BirdviewInfo, PlayerView } from '@rehearse/server';
import { embedUrl, playerNotice, setupCommands, testRows, testSummary } from '../src/model/tests.js';
import { reviewEpic } from './fixture.js';

const view = reviewEpic();
const S1 = view.scenarios.filter((s) => s.scenario.story === 'S1').map((s) => s.scenario);
const KEY = 'tests/S1.spec.ts:5';

function info(player: PlayerView, extra: Partial<BirdviewInfo> = {}): BirdviewInfo {
  return {
    port: 3298,
    playerUrl: 'http://127.0.0.1:3298/',
    projectDir: '/repo/e2e',
    playlistsDir: '/repo/e2e/birdview/playlists',
    storyId: 'S1',
    playlistId: 'S1',
    playlist: { name: 'S1 · to pay for my cart', tests: [{ file: 'tests/S1.spec.ts', line: 5, name: 'S1-buy', about: 'Buyer pays', steps: { 'cart: Buyer checks out': 'cart' } }] },
    player,
    ...extra,
  };
}
const ours = (p: Partial<Extract<PlayerView, { kind: 'ours' }>> = {}): PlayerView => ({ kind: 'ours', status: 'idle', results: {}, playlistsDir: '/repo/e2e/birdview/playlists', ...p });

describe('T13 3 tests tab: rows', () => {
  it('T13 3.11 a scenario without a test is "no test"; with a test and no player it is "not run"', () => {
    expect(testRows(S1, undefined).map((r) => r.words)).toEqual(['no test', 'no test']);
    const rows = testRows(S1, info({ kind: 'off', reason: 'ECONNREFUSED' }));
    expect(rows.map((r) => [r.scenarioId, r.words, r.key])).toEqual([
      ['S1-buy', 'not run', KEY],
      ['S1-empty', 'no test', undefined],
    ]);
    expect(testRows(S1, info({ kind: 'other', projectDir: '/elsewhere' }))[0]!.words).toBe('not run');
  });

  it('T13 3.12 from the player results: passed, failed at the box of the failed step, running, failed · held', () => {
    expect(testRows(S1, info(ours({ results: { [KEY]: { last: 'passed' } } })))[0]).toMatchObject({ status: 'passed', words: 'passed' });
    expect(testRows(S1, info(ours({ results: { [KEY]: { last: 'failed', failedStep: 'cart: Buyer checks out', reason: 'boom' } } })))[0]).toMatchObject({
      status: 'failed',
      words: 'failed at cart',
      failedBox: 'cart',
      reason: 'boom',
    });
    expect(testRows(S1, info(ours({ results: { [KEY]: { last: 'failed' } } })))[0]!.words).toBe('failed');
    expect(testRows(S1, info(ours({ status: 'running', current: KEY, results: { [KEY]: { last: 'passed' } } })))[0]).toMatchObject({ status: 'running', words: 'running' });
    expect(testRows(S1, info(ours({ status: 'held', current: KEY, results: { [KEY]: { last: 'failed', failedStep: 'cart: Buyer checks out' } } })))[0]).toMatchObject({
      status: 'failed',
      words: 'failed · held',
      failedBox: 'cart',
    });
    expect(testRows(S1, info(ours()))[0]!.words).toBe('not run');
  });

  it('T13 3.13 sums up in words', () => {
    expect(testSummary(testRows(S1, info(ours({ results: { [KEY]: { last: 'passed' } } }))))).toBe('1 of 1 tests pass, 1 scenario without a test');
    expect(testSummary(testRows(S1, undefined))).toBe('no e2e test yet');
  });
});

describe('T13 3 tests tab: the player', () => {
  it('T13 3.14 embeds the player only when it plays this test project', () => {
    expect(playerNotice(info(ours()))).toEqual({ embed: true, commands: [] });
    expect(embedUrl(info(ours()))).toBe('http://127.0.0.1:3298/?embed=1&view=active');
    const off = playerNotice(info({ kind: 'off', reason: 'x' }));
    expect(off.embed).toBe(false);
    expect(off.title).toBe('The Birdview player is not running on port 3298');
    const other = playerNotice(info({ kind: 'other', projectDir: '/elsewhere/eudr-fe' }));
    expect(other).toMatchObject({ embed: false, title: 'The Birdview player plays another project' });
    expect(other.text).toContain('/elsewhere/eudr-fe');
    expect(other.commands).toEqual(['bb plugin config birdview-e2e set projectDir /repo/e2e', 'bb plugin config birdview-e2e set playlistsDir /repo/e2e/birdview/playlists']);
  });

  it('T13 3.15 says when there is no test project, and when the player reads another playlists folder', () => {
    const none = playerNotice(info(ours(), { projectDir: undefined, playlistsDir: undefined }));
    expect(none).toMatchObject({ embed: false, title: 'This EPIC has no e2e test project', commands: [] });
    const dir = playerNotice(info(ours({ playlistsDir: '/x/playlists' })));
    expect(dir).toMatchObject({ embed: true, title: 'Birdview reads playlists from another folder', commands: ['bb plugin config birdview-e2e set playlistsDir /repo/e2e/birdview/playlists'] });
  });

  it('T13 3.16 quotes a path with spaces in the setup commands', () => {
    expect(setupCommands(info(ours(), { projectDir: "/my repo/e2e", playlistsDir: undefined }))).toEqual(["bb plugin config birdview-e2e set projectDir '/my repo/e2e'"]);
  });
});
