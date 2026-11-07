// T13 feature 3 and T45, pure part: the story's tests as rows with status in words, the Birdview
// line, the other-project notice, Switch back, whether Play can be pressed and whether the player
// can be embedded (it runs and plays this EPIC's test project).

import { describe, expect, it } from 'vitest';
import type { BirdviewInfo, PlayerView } from '@rehearse/server';
import { birdviewStatus, embedUrl, NOT_RUNNING, projectName, testRows, testSummary } from '../src/model/tests.js';
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

describe('T13 3 / T45 tests tab: the player', () => {
  it('T13 3.14 embeds the player only when it plays this test project', () => {
    expect(birdviewStatus(info(ours())).embed).toBe(true);
    expect(embedUrl(info(ours()))).toBe('http://127.0.0.1:3298/?embed=1&view=active');
    expect(birdviewStatus(info({ kind: 'off', reason: 'x' }))).toEqual({ line: NOT_RUNNING, embed: false, blocked: NOT_RUNNING });
    expect(birdviewStatus(info({ kind: 'other', projectDir: '/elsewhere/eudr-fe' })).embed).toBe(false);
  });

  it('T13 3.15 says when there is no test project, and Play cannot be pressed', () => {
    const none = birdviewStatus(info(ours(), { projectDir: undefined, playlistsDir: undefined }));
    expect(none.embed).toBe(false);
    expect(none.blocked).toContain('This EPIC has no e2e test project');
  });

  it('T13 3.16 names a project in a few words: <repo>/e2e, or the folder name', () => {
    expect(projectName('/Users/me/product-development-tools/e2e')).toBe('product-development-tools/e2e');
    expect(projectName('/Users/me/eudr-fe/')).toBe('eudr-fe');
    expect(projectName('e2e')).toBe('e2e');
  });

  it('T45 model 1 the Birdview line: the project and playlist it shows', () => {
    const s = birdviewStatus(info(ours(), { active: { projectDir: '/repo/e2e', playlist: { id: 's1', name: 'S1 · to pay for my cart' } } }));
    expect(s.line).toBe('Birdview: repo/e2e · playlist S1 · to pay for my cart');
    expect(s.other).toBeUndefined();
    expect(s.blocked).toBeUndefined();
    expect(birdviewStatus(info(ours())).line).toBe('Birdview: repo/e2e · playlist none');
  });

  it('T45 model 2 another project: the notice, and Switch back to the default when it is not the one on screen', () => {
    const s = birdviewStatus(info({ kind: 'other', projectDir: '/w/shop/e2e' }, { active: { projectDir: '/w/shop/e2e' }, defaultProject: { projectDir: '/w/eudr-fe' } }));
    expect(s.other).toBe('Birdview is on shop/e2e. Play will switch it to this repo.');
    expect(s.switchBack).toEqual({ label: 'Switch back to eudr-fe', projectDir: '/w/eudr-fe' });
    expect(s.blocked).toBeUndefined();
    const onDefault = birdviewStatus(info({ kind: 'other', projectDir: '/w/eudr-fe' }, { active: { projectDir: '/w/eudr-fe/' }, defaultProject: { projectDir: '/w/eudr-fe' } }));
    expect(onDefault.other).toBe('Birdview is on eudr-fe. Play will switch it to this repo.');
    expect(onDefault.switchBack).toBeUndefined();
    expect(birdviewStatus(info(ours(), { defaultProject: { projectDir: '/w/eudr-fe' } })).switchBack?.label).toBe('Switch back to eudr-fe');
  });

  it('T45 model 3 no test of the story: Play is blocked, in words', () => {
    expect(birdviewStatus(info(ours(), { playlist: { name: 'S1', tests: [] } })).blocked).toBe('No e2e test of this story yet: name a Playwright test after one of its scenario ids.');
    expect(birdviewStatus(info(ours(), { playlist: undefined })).blocked).toBeDefined();
  });
});
