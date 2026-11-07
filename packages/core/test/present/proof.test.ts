// T53: what is done, what is not, and the proof (boxes story-done-state, build-recap, proof-lines,
// evidence-page).

import { describe, expect, it } from 'vitest';
import {
  DONE_RULE,
  deckHtml,
  loadEpic,
  NO_INPUTS,
  plainWordProblems,
  presentationDeck,
  RECAP_MAX,
  servingBoxes,
  solidPng,
  storyDoneState,
  TRUST_SENTENCE,
  type Deck,
  type DeckEvidence,
  type DeckFacts,
  type EpicRecord,
  type ProofRow,
  type RecapItem,
  type StoryFacts,
} from '../../src/index.js';
import { REAL_EPIC } from '../helpers.js';

const COMMIT = { branch: 'main', sha: 'abc1234', date: '2026-11-07' };
const real = loadEpic(REAL_EPIC).record;

function facts(over: Partial<DeckFacts> = {}): DeckFacts {
  return { commit: COMMIT, uncommitted: false, owner: 'Ada', stories: {}, gate: { ok: true, items: [] }, testResults: true, ...over };
}

/** The approved scenario ids of a story in the real record. */
function approvedOf(record: EpicRecord, story: string): string[] {
  return record.scenarioFiles.flatMap((f) => f.scenarios).filter((s) => s.story === story && s.approval).map((s) => s.id);
}

/** S1 done (1 part built, its 3 approved scenarios passed); S2 has a failing test. */
function doneS1(extra: Partial<StoryFacts> = {}): Record<string, StoryFacts> {
  const s1 = approvedOf(real, 'S1');
  const s2 = approvedOf(real, 'S2');
  return {
    S1: {
      built: 1,
      tests: Object.fromEntries(s1.map((id) => [id, 'passed' as const])),
      runs: Object.fromEntries(s1.map((id, i) => [id, { at: `2026-11-0${5 + (i % 2)}T10:00:00Z`, recorded: true, ...(i === 0 ? { video: 'deck-media/s1.mp4', picture: 'run-S1' } : {}) }])),
      commits: 3,
      unit: { tests: 4, passed: 4, failed: 0 },
      simulation: { problems: 0, uncovered: 0 },
      signature: 'valid',
      ...extra,
    },
    S2: {
      built: 2,
      tests: Object.fromEntries(s2.map((id, i) => [id, i === 0 ? ('failed' as const) : ('passed' as const)])),
      runs: { [s2[0]!]: { at: '2026-11-06T09:00:00Z', failedStep: 'check-flow: the error is shown' } },
    },
  };
}

const slide = (deck: Deck, key: string) => deck.slides.find((s) => s.key === key)!;
const recapOf = (deck: Deck) => {
  const b = slide(deck, 'recap').blocks.find((x) => x.type === 'recap');
  if (b?.type !== 'recap') throw new Error('no recap block');
  return b;
};
const proofOf = (deck: Deck, story: string): ProofRow[] => {
  const b = slide(deck, story).blocks.find((x) => x.type === 'proof');
  if (b?.type !== 'proof') throw new Error(`no proof block on ${story}`);
  return b.rows;
};
const row = (rows: ProofRow[], label: string) => rows.find((r) => r.label === label);

describe('the done rule (story-done-state)', () => {
  const base = { signedOff: true, signStatus: 'signed' as const, approved: 3, passed: 3, boxes: 2, built: 2 };
  it('done only when signed off, every approved test passed, and every part has code', () => {
    expect(storyDoneState(base)).toBe('done');
  });
  it('stale: changed after sign-off is not done', () => {
    expect(storyDoneState({ ...base, signedOff: false, signStatus: 'stale' })).toBe('in-progress');
  });
  it('a failing or missing test is not done', () => {
    expect(storyDoneState({ ...base, passed: 2 })).toBe('in-progress');
    expect(storyDoneState({ ...base, passed: 0 })).toBe('in-progress');
  });
  it('nothing approved proves nothing, and a part without code is not done', () => {
    expect(storyDoneState({ ...base, approved: 0, passed: 0 })).toBe('in-progress');
    expect(storyDoneState({ ...base, built: 1 })).toBe('in-progress');
    expect(storyDoneState({ ...base, boxes: 0, built: 0 })).toBe('in-progress');
  });
  it('not started: never signed off and no part has code', () => {
    expect(storyDoneState({ signedOff: false, approved: 0, passed: 0, boxes: 4, built: 0 })).toBe('not-started');
    expect(storyDoneState({ signedOff: false, signStatus: 'draft', approved: 0, passed: 0, boxes: 4, built: 0 })).toBe('not-started');
    expect(storyDoneState({ signedOff: false, signStatus: 'draft', approved: 0, passed: 0, boxes: 4, built: 1 })).toBe('in-progress');
  });
});

describe('the recap (build-recap)', () => {
  const deck = presentationDeck(real, facts({ stories: doneS1() }), NO_INPUTS);

  it('comes right after the title, with the standing sentence the title uses too', () => {
    expect(deck.slides.map((s) => s.key).slice(0, 2)).toEqual(['title', 'recap']);
    const total = real.prd!.stories.length;
    const sentence = `1 of ${total} stories is done.`;
    const recap = slide(deck, 'recap');
    expect(JSON.stringify(recap.blocks[0])).toContain(sentence);
    expect(JSON.stringify(deck.slides[0]!.blocks)).toContain(sentence);
    expect(recap.blocks.some((b) => b.type === 'text' && b.text === DONE_RULE && b.tone === 'small')).toBe(true);
  });

  it('a done story says when and by whom it was signed off, how many checks pass, and links its recording', () => {
    const r = recapOf(deck);
    expect(r.done.map((i) => i.id)).toEqual(['S1']);
    expect(r.done[0]!.text).toMatch(/— signed off 6 Nov by raizal\.pregnanta · 3 of 3 checks pass$/);
    expect(r.done[0]!.links).toEqual([{ href: 'deck-media/s1.mp4', text: '▶ recording' }]);
  });

  it('not done: failing stories first, then in progress, then not started; the most important missing thing, then "+N more"', () => {
    const r = recapOf(deck);
    expect(r.notDone[0]!.id).toBe('S2');
    expect(r.notDone[0]!.text).toMatch(/— a test fails: the error is shown$/);
    expect(r.notDone[0]!.mark).toBe('failed');
    const states = r.notDone.map((i: RecapItem) => i.state);
    expect(states.lastIndexOf('in-progress')).toBeLessThan(states.indexOf('not-started'));
    expect(r.notDone.find((i) => i.id === 'S19')!.text).toMatch(/— waiting for my approval \(\d+ scenarios\) · \d+ parts not built$/);
    expect(r.doneTotal + r.notDoneTotal).toBe(real.prd!.stories.length);
  });

  it('many stories: compact, still one slide; split only past the limit', () => {
    expect(recapOf(deck).compact).toBe(real.prd!.stories.length > 10);
    expect(deck.slides.filter((s) => s.key.startsWith('recap'))).toHaveLength(1);
    // A record with more stories than fit: the recap splits into "(1/2)" and "(2/2)".
    const big = structuredClone(real);
    const extra = RECAP_MAX + 5 - big.prd!.stories.length;
    for (let i = 0; i < extra; i++) big.prd!.stories.push({ ...big.prd!.stories[0]!, id: `S${100 + i}` });
    const split = presentationDeck(big, facts(), NO_INPUTS);
    const recaps = split.slides.filter((s) => s.key.startsWith('recap'));
    expect(recaps.map((s) => s.key)).toEqual(['recap', 'recap-2']);
    expect(recaps.map((s) => s.title)).toEqual(['What is done, what is not (1/2)', 'What is done, what is not (2/2)']);
  });

  it('the progress table has the same Done / In progress / Not started column', () => {
    const b = slide(deck, 'progress').blocks.find((x) => x.type === 'progress');
    if (b?.type !== 'progress') throw new Error('no progress');
    expect(b.rows.find((r) => r.id === 'S1')!.state).toBe('done');
    expect(b.rows.find((r) => r.id === 'S2')!.state).toBe('in-progress');
    expect(b.rows.find((r) => r.id === 'S19')!.state).toBe('not-started');
    expect(deckHtml(deck)).toContain('<th>Done / In progress / Not started</th>');
  });
});

describe('the proof on every story slide (proof-lines)', () => {
  it('with every source: e2e with dates, recording, unit tests, simulation, built, signed', () => {
    const deck = presentationDeck(real, facts({ stories: doneS1() }), NO_INPUTS);
    const rows = proofOf(deck, 'S1');
    expect(rows.map((r) => r.label)).toEqual(['E2E tests', 'Recording', 'Unit tests', 'Simulation', 'Built', 'Signed']);
    expect(row(rows, 'E2E tests')!.text).toBe('3 of 3 passed · runs from 5 Nov to 6 Nov');
    expect(row(rows, 'Recording')!.links).toEqual([{ href: 'deck-media/s1.mp4', text: expect.stringMatching(/^▶ /) }]);
    expect(row(rows, 'Unit tests')!.text).toBe("4 automated tests name this story's scenarios: all pass");
    expect(row(rows, 'Simulation')!.text).toBe('the plan simulates clean');
    expect(row(rows, 'Built')!.text).toBe('1 of 1 part has code (3 commits)');
    expect(row(rows, 'Signed')!.text).toBe('signed off by raizal.pregnanta on 6 Nov, signature checked');
    expect(JSON.stringify(slide(deck, 'S1').blocks)).toMatch(/Done: built, every check passes, signed off\./);
  });

  it('without the sources: each one says it is missing, and nothing is called done', () => {
    const notRun = Object.fromEntries(approvedOf(real, 'S1').map((id) => [id, 'not-run' as const]));
    const deck = presentationDeck(real, facts({ stories: { S1: { built: 1, tests: notRun } }, testResults: false }), NO_INPUTS);
    const rows = proofOf(deck, 'S1');
    expect(row(rows, 'E2E tests')!.text).toMatch(/3 not run \(no test results found\)/);
    expect(row(rows, 'Recording')!.text).toBe('Birdview kept no recording of these tests');
    expect(row(rows, 'Unit tests')!.text).toBe('not counted for this deck');
    expect(row(rows, 'Simulation')!.text).toBe('not run for this deck');
    expect(row(rows, 'Signed')!.text).toMatch(/signature not checked$/);
    expect(recapOf(deck).done).toEqual([]);
    expect(deckHtml(deck)).toContain('No story is done yet.');
  });

  it('a recorded run that was not copied is "kept by" the owner; a failing step is named', () => {
    const s = doneS1();
    const s1 = approvedOf(real, 'S1');
    s.S1!.runs = Object.fromEntries(s1.map((id) => [id, { at: '2026-11-06T10:00:00Z', recorded: true }]));
    const deck = presentationDeck(real, facts({ stories: s }), NO_INPUTS);
    expect(row(proofOf(deck, 'S1'), 'Recording')!.text).toBe('3 recordings kept by Ada');
    expect(recapOf(deck).done[0]!.text).toMatch(/· recording kept by Ada$/);
    expect(row(proofOf(deck, 'S2'), 'E2E tests')!.text).toMatch(/1 failed at "the error is shown"/);
    expect(row(proofOf(deck, 'S2'), 'E2E tests')!.tone).toBe('bad');
  });

  it('stale, a signature that does not match, unit failures and plan problems are said plainly', () => {
    const deck = presentationDeck(real, facts({ stories: doneS1({ signature: 'invalid', unit: { tests: 2, passed: 1, failed: 1 }, simulation: { problems: 2, uncovered: 0 } }) }), NO_INPUTS);
    const rows = proofOf(deck, 'S1');
    expect(row(rows, 'Signed')!.text).toMatch(/but the signature does not match$/);
    expect(row(rows, 'Unit tests')!.text).toMatch(/1 pass, 1 fail$/);
    expect(row(rows, 'Simulation')!.text).toBe('2 problems found in the plan');
    const s18 = proofOf(deck, 'S18');
    expect(row(s18, 'E2E tests')!.text).toBe('no approved scenario yet, so no test counts');
    expect(row(s18, 'Signed')!.text).toBe('not signed off yet');
  });

  it('a check row shows when it ran, the still of its last screen and the recording link', () => {
    const png = solidPng(4, 3, [10, 20, 30, 255]);
    const deck = presentationDeck(real, facts({ stories: doneS1() }), NO_INPUTS);
    const html = deckHtml(deck, { 'run-S1': { mime: 'image/png', data: png, width: 4, height: 3 } });
    expect(html).toMatch(/<a class="media" href="deck-media\/s1\.mp4">▶ recording<\/a>/);
    expect(html).toMatch(/alt="Last screen of the test/);
    // No still when there is no recording: no empty picture box.
    const none = deckHtml(presentationDeck(real, facts({ stories: { S1: { built: 1, tests: {} } } }), NO_INPUTS));
    expect(none).not.toMatch(/class="pic"/);
  });
});

describe('the evidence page (evidence-page)', () => {
  const evidence: DeckEvidence = {
    e2e: { source: 'saved', file: '~/birdview/data/projects/e2e-353e1aa5/results.json', project: '/repo/e2e', note: "the main checkout's own", oldest: '2026-11-05T10:00:00Z', newest: '2026-11-07T09:00:00Z', used: 9, dropped: 2, older: 1 },
    recordings: { found: 3, copied: 'deck-media', pictures: 2, picturesLeftOut: 1, picturesBytes: 300_000 },
    unit: { file: '.rehearse/unit-report.json', date: '2026-11-07T08:00:00Z', tests: 1200, passed: 1199, failed: 1 },
    signatures: { file: '.rehearse/allowed_signers', checked: 15, valid: 15 },
  };

  it('comes before the glossary and names every source, with the trust sentence', () => {
    const deck = presentationDeck(real, facts({ evidence, stories: doneS1() }), NO_INPUTS);
    expect(deck.slides.map((s) => s.key).slice(-2)).toEqual(['evidence', 'glossary']);
    const text = JSON.stringify(slide(deck, 'evidence').blocks);
    expect(text).toContain('abc1234');
    expect(text).toContain('e2e-353e1aa5/results.json');
    expect(text).toMatch(/run between 5 Nov and 7 Nov/);
    expect(text).toMatch(/2 saved results were left out because they no longer match a test/);
    expect(text).toMatch(/1 older run of a test was replaced by its newer run/);
    expect(text).toContain('.rehearse/unit-report.json');
    expect(text).toContain('allowed_signers');
    expect(text).toContain(TRUST_SENTENCE);
  });

  it('missing sources say so', () => {
    const deck = presentationDeck(real, facts(), NO_INPUTS);
    const text = JSON.stringify(slide(deck, 'evidence').blocks);
    expect(text).toMatch(/E2E test results: none were found/);
    expect(text).toMatch(/Unit tests: not used for this deck/);
    expect(text).toMatch(/Recordings: Birdview kept no recording of the test runs used, so this deck has no videos/);
  });

  it('the owner can narrate the recap and the evidence page', () => {
    const deck = presentationDeck(real, facts(), { ...NO_INPUTS, narration: { recap: 'Here is where we stand.', evidence: 'All from the record.' } });
    expect(slide(deck, 'recap').narration).toBe('Here is where we stand.');
    expect(slide(deck, 'evidence').narration).toBe('All from the record.');
  });
});

describe('plain words and one file', () => {
  it('the recap, proof and evidence use no record ids, YAML keys or code marks', () => {
    const deck = presentationDeck(real, facts({ stories: doneS1() }), NO_INPUTS);
    const boxPaths = real.prd!.stories.flatMap((s) => servingBoxes(real.flow, s.id));
    const recap = slide(deck, 'recap');
    const texts = [
      ...recap.blocks.flatMap((b) => (b.type === 'recap' ? [...b.done, ...b.notDone].map((i) => i.text.replace(/^.*? — /, '')) : b.type === 'text' ? [b.text] : [])),
      ...proofOf(deck, 'S1').map((r) => r.text),
      ...proofOf(deck, 'S2').map((r) => r.text),
      ...slide(deck, 'evidence').blocks.flatMap((b) => (b.type === 'list' ? b.items.map((i) => i.text) : b.type === 'text' ? [b.text] : [])),
    ];
    for (const t of texts) expect(plainWordProblems(t, boxPaths), t).toEqual([]);
  });

  it('the HTML is self-contained: media links are relative, nothing is fetched', () => {
    const html = deckHtml(presentationDeck(real, facts({ stories: doneS1() }), NO_INPUTS));
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const h of hrefs) expect(h).not.toMatch(/^(https?:|\/|file:)/);
    expect(html).not.toMatch(/<(link|script)[^>]+(src|href)=/);
  });
});
