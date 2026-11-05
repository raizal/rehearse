// T13 feature 2: a Birdview playlist per story, built from the record and the spec files.

import { describe, expect, it } from 'vitest';
import type { Prd, Scenario } from '@rehearse/core';
import { buildPlaylist, parsePlaylist, parseSpec, playlistJson, stepBox, storiesWithTests } from '../src/index.js';

const SPEC = `import { test, expect } from '@playwright/test';

test.describe('S4', () => {
  test('S4-swimlanes', async ({ page }) => {
    await test.step('simulate/report: rehearse loads the record', async () => {});
    await test.step("review/swimlanes: Builder sees one lane per role", async () => {});
  });

  test('S4-drill', async ({ page }) => {
    await test.step('review/swimlanes: Builder opens a box with children', async () => {});
    await test.step('nope/box: not a step of S4-drill', async () => {});
  });
});
`;

const scenario = (id: string, story: string, steps: string[]): Scenario => ({ id, story, title: `title of ${id}`, status: 'draft', steps: steps.map((name) => ({ name })) });

const PRD = { stories: [{ id: 'S3', want: 'x' }, { id: 'S4', want: 'to review the design in a panel' }] } as unknown as Prd;
const SCENARIOS = [
  scenario('S4-swimlanes', 'S4', ['simulate/report', 'design-errors', 'review/swimlanes']),
  scenario('S4-browser', 'S4', ['review/swimlanes']),
  scenario('S4-drill', 'S4', ['review/swimlanes']),
  scenario('S3-other', 'S3', ['a']),
];

describe('T13 2 playlists: parse a spec file', () => {
  it('T13 2.1 finds each test with the line of its test( call and its step titles', () => {
    const tests = parseSpec('tests/S4.spec.ts', SPEC);
    expect(tests).toEqual([
      { file: 'tests/S4.spec.ts', line: 4, name: 'S4-swimlanes', steps: ['simulate/report: rehearse loads the record', 'review/swimlanes: Builder sees one lane per role'] },
      { file: 'tests/S4.spec.ts', line: 9, name: 'S4-drill', steps: ['review/swimlanes: Builder opens a box with children', 'nope/box: not a step of S4-drill'] },
    ]);
  });

  it('T13 2.2 a step title names its box before the first ": "', () => {
    expect(stepBox('review/swimlanes: Builder sees: lanes')).toBe('review/swimlanes');
    expect(stepBox('no box here')).toBe('no box here');
  });
});

describe('T13 2 playlists: build one per story', () => {
  it('T13 2.3 "<story> · <want>", one test per scenario in record order, steps → boxes, and a problem per unknown box', () => {
    const { playlist, problems } = buildPlaylist('S4', PRD, SCENARIOS, parseSpec('tests/S4.spec.ts', SPEC));
    expect(playlist.name).toBe('S4 · to review the design in a panel');
    expect(playlist.tests).toEqual([
      {
        file: 'tests/S4.spec.ts',
        line: 4,
        name: 'S4-swimlanes',
        about: 'title of S4-swimlanes',
        steps: { 'simulate/report: rehearse loads the record': 'simulate/report', 'review/swimlanes: Builder sees one lane per role': 'review/swimlanes' },
      },
      {
        file: 'tests/S4.spec.ts',
        line: 9,
        name: 'S4-drill',
        about: 'title of S4-drill',
        steps: { 'review/swimlanes: Builder opens a box with children': 'review/swimlanes', 'nope/box: not a step of S4-drill': 'nope/box' },
      },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('tests/S4.spec.ts:9 S4-drill: step "nope/box: not a step of S4-drill" names nope/box');
  });

  it('T13 2.4 lists the stories that have a test, in prd order', () => {
    expect(storiesWithTests(PRD, SCENARIOS, parseSpec('a.spec.ts', "test('S3-other', () => {});\ntest('S4-drill', () => {});"))).toEqual(['S3', 'S4']);
    expect(storiesWithTests(PRD, SCENARIOS, [])).toEqual([]);
  });

  it('T13 2.5 the JSON round-trips, and a file that is not a playlist reads as undefined', () => {
    const { playlist } = buildPlaylist('S4', PRD, SCENARIOS, parseSpec('tests/S4.spec.ts', SPEC));
    expect(parsePlaylist(playlistJson(playlist))).toEqual(playlist);
    expect(parsePlaylist('{nope')).toBeUndefined();
    expect(parsePlaylist('{"name":"x"}')).toBeUndefined();
  });
});
