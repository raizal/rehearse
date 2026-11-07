// T58 (S23, boxes status-table, whats-missing, status-sources): the Status page and `rehearse
// status`. One row per story from the deck's own story views and done rule, so the page and the
// deck never disagree; what is missing says who acts; the sources say where the facts come from.

import { describe, expect, it } from 'vitest';
import {
  filterRows,
  loadEpic,
  missingLine,
  NO_GRAPH,
  NO_INPUTS,
  presentationDeck,
  servingBoxes,
  statusSources,
  statusTable,
  statusText,
  type BoxEvidence,
  type DeckFacts,
  type EpicRecord,
  type StoryFacts,
} from '../../src/index.js';
import { REAL_EPIC } from '../helpers.js';

const COMMIT = { branch: 'main', sha: 'abc1234', date: '2026-11-07' };
const real = loadEpic(REAL_EPIC).record;
const ids = real.prd!.stories.map((s) => s.id);
const boxesOf = (record: EpicRecord, id: string) => servingBoxes(record.flow, id);

/** Every story fully built, its approved scenarios with no test written; `over` changes some. */
function facts(over: Record<string, Partial<StoryFacts>> = {}, rest: Partial<DeckFacts> = {}): DeckFacts {
  const stories = Object.fromEntries(ids.map((id) => [id, { built: boxesOf(real, id).length, tests: {}, ...over[id] }]));
  return { commit: COMMIT, uncommitted: false, owner: 'Ada', stories, gate: { ok: true, items: [] }, testResults: true, ...rest };
}

/** A story signed off and buildable in the real record, whatever the owner signed last. */
const table0 = statusTable(real, facts());
const DONE = table0.rows.find((r) => r.done.state === 'done')!.id;
const NOT_SIGNED = table0.rows.find((r) => r.signed.state === 'no')!.id;

/** DONE with its last box left unbuilt, with the box-evidence words of that box. */
function oneLeft(): { f: DeckFacts; left: string } {
  const paths = boxesOf(real, DONE);
  const left = paths.at(-1)!;
  const evidence: BoxEvidence[] = paths.map((path) =>
    path === left
      ? { path, title: path, kind: 'process', state: 'not-built', commits: [], code: [], text: 'not built: nothing' }
      : { path, title: path, kind: 'process', state: 'built', commits: [{ sha: 'a1', subject: 's', branch: 'main' }], code: [], text: 'built: 1 Flow-Box commit' },
  );
  return { f: facts({ [DONE]: { built: paths.length - 1, boxes: evidence } }), left };
}

describe('statusTable', () => {
  it('one row per story, and a header that adds up', () => {
    expect(table0.rows.map((r) => r.id).sort()).toEqual([...ids].sort());
    const { stories, done, seen, notDone } = table0.counts;
    expect(stories).toBe(ids.length);
    expect(done + notDone).toBe(stories);
    expect(table0.header).toBe(`${done} of ${stories} stories done · ${seen} seen working on the real screens · ${notDone} not done`);
  });

  it('puts the stories not done first, then done but not seen working, in record order within each', () => {
    const rank = (r: (typeof table0.rows)[number]) => (r.done.state !== 'done' ? 0 : r.seenWorking ? 2 : 1);
    const ranks = table0.rows.map(rank);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    const notDone = table0.rows.filter((r) => rank(r) === 0).map((r) => r.id);
    expect(notDone).toEqual(ids.filter((id) => notDone.includes(id)));
  });

  it('a story not signed off: not done, and you approve or sign off', () => {
    const row = table0.rows.find((r) => r.id === NOT_SIGNED)!;
    expect(row.done.state).not.toBe('done');
    expect(row.done.text).toBe('not done');
    expect(row.missing.some((m) => m.who === 'you' && /^(approve \d+ scenarios?|sign off)$/.test(m.text))).toBe(true);
  });

  it('a box left: Built says how many, and what is missing names the box for the builders', () => {
    const { f, left } = oneLeft();
    const row = statusTable(real, f).rows.find((r) => r.id === DONE)!;
    const n = boxesOf(real, DONE).length;
    expect(row.built.text).toBe(`${n - 1} of ${n} — 1 left`);
    expect(row.done.state).not.toBe('done');
    expect(row.missing.map(missingLine)).toContain(`1 box not built (${left}): builders`);
    expect(row.built.evidence.find((e) => e.path === left)?.text).toBe('not built: nothing');
  });

  it('done with no unit report read: the done text says so, and Automated says not run', () => {
    const row = table0.rows.find((r) => r.id === DONE)!;
    expect(row.unit.text).toBe('not run');
    expect(row.done.text).toBe('done · checked by automated tests (no unit report read)');
    const named = statusTable(real, facts({ [DONE]: { unit: { tests: 0, passed: 0, failed: 0 } } })).rows.find((r) => r.id === DONE)!;
    expect(named.unit.text).toBe('no test names it');
    expect(named.done.text).toBe('done · checked by automated tests (no unit test names it)');
    const passed = statusTable(real, facts({ [DONE]: { unit: { tests: 4, passed: 4, failed: 0 } } })).rows.find((r) => r.id === DONE)!;
    expect([passed.unit.text, passed.unit.tone, passed.done.text]).toEqual(['4 of 4 passed', 'good', 'done · checked by automated tests']);
  });

  it('a failing unit test: not done, and the builders act', () => {
    const row = statusTable(real, facts({ [DONE]: { unit: { tests: 3, passed: 2, failed: 1 } } })).rows.find((r) => r.id === DONE)!;
    expect(row.done.state).not.toBe('done');
    expect(row.unit).toMatchObject({ text: '1 failed, 2 of 3 passed', tone: 'bad' });
    expect(row.missing.map(missingLine)).toContain('an automated test fails: builders');
  });

  it('done but no real-screen test: the test thread acts, without blocking done', () => {
    const row = table0.rows.find((r) => r.id === DONE)!;
    expect(row.e2e.text).toBe('none yet');
    expect(row.missing).toContainEqual({ text: 'no real-screen test yet', who: 'test thread', blocking: false });
  });

  it('no Birdview results: the real-screens column says so', () => {
    const scenario = real.scenarioFiles.flatMap((f) => f.scenarios).find((s) => s.story === DONE && s.approval)!;
    const f = facts({ [DONE]: { tests: { [scenario.id]: 'not-run' } } }, { testResults: false, evidence: { e2e: { source: 'none', why: 'no saved results' }, unit: { why: 'no report' } } as DeckFacts['evidence'] });
    const row = statusTable(real, f).rows.find((r) => r.id === DONE)!;
    expect(row.e2e.text).toBe('Birdview results not found');
  });
});

describe('the Status page and the deck agree', () => {
  it('the same done count and the same not-done stories', () => {
    const { f } = oneLeft();
    const t = statusTable(real, f);
    const deck = JSON.stringify(presentationDeck(real, f, NO_INPUTS));
    expect(deck).toContain(`${t.counts.done} of ${t.counts.stories} parts of the plan are done`);
    expect(deck).toContain(`${t.counts.notDone} are not done yet`);
    expect(t.rows.find((r) => r.id === DONE)!.done.state).not.toBe('done');
  });
});

describe('filterRows', () => {
  it('keeps not done, or done but not seen working', () => {
    const notDone = filterRows(table0.rows, 'not-done');
    expect(notDone.every((r) => r.done.state !== 'done')).toBe(true);
    expect(notDone).toHaveLength(table0.counts.notDone);
    const notSeen = filterRows(table0.rows, 'done-not-seen');
    expect(notSeen.every((r) => r.done.state === 'done' && !r.seenWorking)).toBe(true);
    expect(notSeen).toHaveLength(table0.counts.doneNotSeen);
    expect(filterRows(table0.rows, 'all')).toHaveLength(ids.length);
  });
});

describe('statusSources', () => {
  it('names the commit, the graph and its date, or that it is not built', () => {
    const ok = statusSources(facts({}, { codeGraph: { ok: true, at: '2026-11-07T10:30:00Z' }, uncommitted: true }));
    expect(ok.commit).toBe('main @ abc1234, 2026-11-07, with uncommitted changes in the EPIC folder');
    expect(ok.graph).toBe('the code graph, updated 2026-11-07 10:30, and Flow-Box commits');
    expect(statusSources(facts({}, { codeGraph: { ok: false, why: NO_GRAPH } })).graph).toBe(`code graph not built yet: "built" counts Flow-Box commits only (${NO_GRAPH})`);
  });
  it('names the Birdview results and the unit report with their dates, or why not', () => {
    const s = statusSources(facts({}, { evidence: { e2e: { source: 'saved', file: 'data/results.json', newest: '2026-11-06T09:00:00Z' }, unit: { file: '.rehearse/unit-report.json', date: '2026-11-07T08:00:00Z' } } as DeckFacts['evidence'] }));
    expect(s.e2e).toBe("Birdview's saved results (data/results.json), newest run 2026-11-06");
    expect(s.unit).toBe('.rehearse/unit-report.json, made 2026-11-07');
    const none = statusSources(facts({}, { evidence: { e2e: { source: 'none', why: 'no data folder' }, unit: { why: 'run pnpm test:report' } } as DeckFacts['evidence'] }));
    expect([none.e2e, none.unit]).toEqual(['Birdview results not found: no data folder', 'no unit report: run pnpm test:report']);
  });
});

describe('statusText', () => {
  it('prints the header, the columns, every row and the sources', () => {
    const text = statusText(table0);
    expect(text).toContain(table0.header);
    expect(text).toMatch(/Story\s+Signed\s+Built\s+Real screens\s+Automated\s+Done\s+What's missing — who acts/);
    for (const id of ids) expect(text).toMatch(new RegExp(`^${id}\\s`, 'm'));
    expect(text).toContain('Where the facts come from:');
    expect(text).toContain('  commit: main @ abc1234, 2026-11-07');
  });
  it('--not-done keeps the stories not done, and says so', () => {
    const text = statusText(table0, 'not-done');
    expect(text).toContain(`Showing the ${table0.counts.notDone === 1 ? '1 story' : `${table0.counts.notDone} stories`} not done.`);
    expect(text).not.toMatch(new RegExp(`^${DONE}\\s`, 'm'));
  });
});
