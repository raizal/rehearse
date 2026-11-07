// T54: the executive summary, the default deck (boxes summary-deck, group-done-by-area,
// group-not-done-by-reason, how-we-know, full-deck-appendix). T61 (box done-seen): done needs the
// main path test passed; a story built and signed off without it is "built, not seen working yet".

import { describe, expect, it } from 'vitest';
import {
  deckHtml,
  detectStale,
  loadEpic,
  MAX_GROUPS,
  MAX_LINES,
  NO_EVIDENCE,
  NO_INPUTS,
  plainWordProblems,
  presentationDeck,
  servingBoxes,
  solidPng,
  TRUST_SENTENCE,
  type Block,
  type Deck,
  type DeckEvidence,
  type DeckFacts,
  type EpicRecord,
  type GroupCard,
  type PresentationInputs,
  type StoryFacts,
} from '../../src/index.js';
import { REAL_EPIC, withWaitingStory } from '../helpers.js';

const COMMIT = { branch: 'main', sha: 'abc1234', date: '2026-11-07' };
const real = loadEpic(REAL_EPIC).record;
/** The stories signed off in the live record, in record order: read from it, so a new sign-off changes nothing here. */
const signed = detectStale(real).stories.filter((s) => s.status === 'signed').map((s) => s.id);

function facts(over: Partial<DeckFacts> = {}): DeckFacts {
  return { commit: COMMIT, uncommitted: false, owner: 'Ada', stories: {}, gate: { ok: true, items: [] }, testResults: true, ...over };
}
const inputs = (over: Partial<PresentationInputs> = {}): PresentationInputs => ({ ...NO_INPUTS, ...over });

const approvedOf = (record: EpicRecord, story: string): string[] =>
  record.scenarioFiles.flatMap((f) => f.scenarios).filter((s) => s.story === story && s.approval).map((s) => s.id);

/** A story fully built; its approved e2e tests `passed` of them passed ('all', a number, or none). */
function built(story: string, passed: 'all' | 'none' | number = 'none', at = '2026-11-06T10:00:00Z'): StoryFacts {
  const ids = approvedOf(real, story);
  const n = passed === 'all' ? ids.length : passed === 'none' ? 0 : passed;
  return {
    built: servingBoxes(real.flow, story).length,
    tests: Object.fromEntries(ids.map((id, i) => [id, i < n ? ('passed' as const) : ('not-run' as const)])),
    runs: Object.fromEntries(ids.slice(0, n).map((id, i) => [id, { at, ...(i === 0 ? { picture: `run-${story}`, video: `media/${story}.mp4` } : {}) }])),
  };
}

const slide = (deck: Deck, key: string) => deck.slides.find((s) => s.key === key)!;
const groups = (deck: Deck, key: string): GroupCard[] => {
  const b = slide(deck, key).blocks.find((x) => x.type === 'groups');
  return b?.type === 'groups' ? b.items : [];
};
/** Every sentence a reader sees on a slide, ids left out (they go in the corner). */
function texts(blocks: Block[]): string[] {
  return blocks.flatMap((b): string[] => {
    switch (b.type) {
      case 'lead':
      case 'text':
      case 'notice':
        return [b.text];
      case 'list':
        return b.items.map((i) => i.text);
      case 'bar':
        return b.segments.map((s) => s.label);
      case 'groups':
        return b.items.flatMap((g) => [g.title, ...g.lines.flatMap((l) => [l.text, l.level ?? '']), g.takes ?? '', g.who ?? '']);
      case 'gallery':
        return b.items.map((i) => i.caption);
      default:
        return [];
    }
  });
}

/** S1 and S2 seen working, S3 on the main path only, S4 and S5 built but not seen working yet; S6 has a failing test. */
function mixed(): Record<string, StoryFacts> {
  const s3 = approvedOf(real, 'S3');
  const s6 = approvedOf(real, 'S6');
  return {
    S1: built('S1', 'all', '2026-11-05T10:00:00Z'),
    S2: built('S2', 'all', '2026-11-07T09:00:00Z'),
    S3: built('S3', s3.length - 1),
    S4: built('S4'),
    S5: built('S5'),
    S6: { ...built('S6', 'all'), tests: { ...built('S6', 'all').tests, [s6[0]!]: 'failed' }, runs: { [s6[0]!]: { at: '2026-11-06T09:00:00Z', failedStep: 'check-flow: the error is shown' } } },
  };
}

describe('the summary (summary-deck)', () => {
  const deck = presentationDeck(real, facts({ stories: mixed() }), NO_INPUTS);

  it('is the default: where we are, done, not done and why, how we know, next — at most six slides without asks', () => {
    expect(deck.kind).toBe('summary');
    expect(deck.slides.map((s) => s.key)).toEqual(['title', 'done', 'not-done', 'how-we-know', 'next']);
    expect(deck.slides.length).toBeLessThanOrEqual(6);
    expect(deck.slides.map((s) => s.title)).toEqual([deck.title, "What's done", "What's not done yet, and why", 'How we know', "What's next"]);
  });

  it('with asks: "What I need from you" before "What\'s next", six slides', () => {
    const withAsks = presentationDeck(real, facts({ stories: mixed() }), inputs({ asks: ['Approve the budget.'] }));
    expect(withAsks.slides.map((s) => s.key)).toEqual(['title', 'done', 'not-done', 'how-we-know', 'asks', 'next']);
  });

  it('where we are: the goal, one status sentence and a done / not-yet bar', () => {
    const title = slide(deck, 'title');
    const total = real.prd!.stories.length;
    expect(title.blocks[0]!.type).toBe('lead');
    expect(JSON.stringify(title.blocks)).toContain(`3 of ${total} parts of the plan are done; 2 of them are seen working on the real screens, 1 on the main path only. ${total - 3} are not done yet; 2 of them are built, not seen working yet.`);
    const bar = title.blocks.find((b) => b.type === 'bar');
    expect(bar?.type === 'bar' && bar.segments.map((s) => [s.label, s.count])).toEqual([
      ['done, seen working (1 on the main path only)', 3],
      ['built, not seen working yet', 2],
      ['not done yet', total - 5],
    ]);
  });

  it('titles joined in one line start small after the first, an acronym stays', () => {
    const many = presentationDeck(real, facts({ stories: Object.fromEntries(signed.map((id) => [id, built(id, 'all')])) }), inputs());
    const lines = groups(many, 'done').flatMap((g) => g.lines.map((l) => l.text));
    expect(lines.some((l) => / and \d+ more$/.test(l))).toBe(true);
    expect(lines.join(' | ')).not.toMatch(/, [A-Z][a-z]| and [A-Z][a-z]/);
  });

  it('the real-screens line is not ticked while some approved checks have no run yet', () => {
    const evidence: DeckEvidence = { ...NO_EVIDENCE, e2e: { source: 'saved', newest: '2026-11-06T10:00:00Z', used: 1, dropped: 0 } };
    const some = presentationDeck(real, facts({ stories: { S1: built('S1', 'all') }, evidence }), inputs());
    const first = slide(some, 'how-we-know').blocks.find((b) => b.type === 'list');
    expect(first?.type === 'list' && first.items[0]!.mark).toBe('not-yet');
    expect(first?.type === 'list' && first.items[0]!.text).toMatch(/; \d+ have no run on the real screens yet\.$/);
    const none = presentationDeck(real, facts({ stories: { S1: built('S1') }, evidence }), inputs());
    const list = slide(none, 'how-we-know').blocks.find((b) => b.type === 'list');
    expect(list?.type === 'list' && list.items[0]!.text).toMatch(/^Tests on the real screens: none of the \d+ approved checks has run on the real screens yet/);
  });

  it('a failing test leaves a story not done, even built and signed off', () => {
    const lines = groups(deck, 'done').flatMap((g) => g.lines.flatMap((l) => l.ids ?? []));
    expect(lines).not.toContain('S6');
    const fails = groups(deck, 'not-done')[0]!;
    expect(fails.title).toBe('A test fails: the error is shown');
    expect(fails.tone).toBe('bad');
    expect(fails.who).toBe('the builders');
  });

  it('every done line ends with its proof level, with the date when it was seen working', () => {
    const levels = groups(deck, 'done').flatMap((g) => g.lines.map((l) => l.level));
    expect(levels).toContain('seen working, 7 Nov');
    expect(levels.some((l) => /^main path seen working \(\d+ of \d+\), 6 Nov$/.test(l ?? ''))).toBe(true);
    expect(levels).not.toContain('checked by automated tests');
  });

  it('a stale sign-off reads "changed after it was signed off; needs a new sign-off"', () => {
    const r = structuredClone(real);
    // Change S1's story text after its sign-off.
    r.prd!.stories[0]!.want = `${r.prd!.stories[0]!.want} (changed)`;
    const d = presentationDeck(r, facts({ stories: { S1: built('S1', 'all') } }), NO_INPUTS);
    const stale = groups(d, 'not-done').find((g) => g.lines.some((l) => l.ids?.includes('S1')));
    expect(stale?.title).toBe('Changed after it was signed off; needs a new sign-off');
    expect(stale?.who).toBe('me');
  });

  it('the asks slide is left out when there are none; next is the top 3 generated steps, or the owner\'s', () => {
    expect(deck.slides.some((s) => s.key === 'asks')).toBe(false);
    const next = slide(deck, 'next').blocks[0]!;
    expect(next.type === 'list' && next.items.length).toBeLessThanOrEqual(3);
    expect(next.type === 'list' && next.items[0]!.text).toMatch(/^The builders fix the test that fails in /);
    const own = presentationDeck(real, facts(), inputs({ next: ['Ship it.'] }));
    expect(slide(own, 'next').blocks).toEqual([{ type: 'list', items: [{ text: 'Ship it.' }] }]);
  });

  it('nothing done yet says so plainly', () => {
    const none = presentationDeck(real, facts(), NO_INPUTS);
    expect(JSON.stringify(slide(none, 'title').blocks)).toContain(`None of the ${real.prd!.stories.length} parts of the plan is done yet.`);
    expect(slide(none, 'done').blocks).toEqual([{ type: 'text', text: 'Nothing is done yet: no part of the plan is built, signed off and seen working on the main path.', tone: 'warn' }]);
  });
});

describe('what is done, by area (group-done-by-area)', () => {
  it('without areas: grouped by role, at most three lines a card', () => {
    const deck = presentationDeck(real, facts({ stories: mixed() }), NO_INPUTS);
    const g = groups(deck, 'done');
    const roleOf = (id: string) => real.prd!.roles.find((r) => r.id === real.prd!.stories.find((s) => s.id === id)!.role)!.name.toLowerCase();
    const roles = [...new Set(['S1', 'S2', 'S3'].map(roleOf))];
    expect(g.map((c) => c.title)).toEqual(roles.map((r) => `What the ${r} can now do`));
    for (const c of g) {
      expect(c.lines.length).toBeLessThanOrEqual(MAX_LINES);
      for (const l of c.lines) for (const id of l.ids ?? []) expect(c.title).toBe(`What the ${roleOf(id)} can now do`);
    }
  });

  it('a card of more than three stories has one line per proof level, not one per story', () => {
    const areas = [{ title: 'Making a record', stories: ['S1', 'S2', 'S3', 'S4', 'S5'] }];
    const g = groups(presentationDeck(real, facts({ stories: mixed() }), inputs({ areas })), 'done');
    expect(g.map((c) => c.title)).toEqual(['Making a record']);
    const all = presentationDeck(real, facts({ stories: { ...mixed(), S4: built('S4', 'all'), S5: built('S5', 'all') } }), inputs({ areas }));
    const g2 = groups(all, 'done');
    expect(g2[0]!.lines.map((l) => l.ids)).toEqual([['S1', 'S2', 'S4', 'S5'], ['S3']]);
    expect(g2[0]!.lines.map((l) => l.level)).toEqual(['seen working, 7 Nov', expect.stringMatching(/^main path seen working \(\d+ of \d+\), 6 Nov$/)]);
    // Three done stories or fewer: one line per story.
    expect(g[0]!.lines.map((l) => l.ids)).toEqual([['S1'], ['S2'], ['S3']]);
  });

  it("the owner's areas, then the rest; at most six cards, the rest under \"And more\"", () => {
    const stories = Object.fromEntries(signed.map((id) => [id, built(id, 'all')]));
    const areas = signed.slice(0, 8).map((id, i) => ({ title: `Area ${i + 1}`, stories: [id] }));
    const deck = presentationDeck(real, facts({ stories }), inputs({ areas }));
    const g = groups(deck, 'done');
    expect(g.length).toBe(MAX_GROUPS);
    expect(g.slice(0, 5).map((c) => c.title)).toEqual(['Area 1', 'Area 2', 'Area 3', 'Area 4', 'Area 5']);
    expect(g[5]!.title).toBe('And more');
    expect(g.flatMap((c) => c.lines.flatMap((l) => l.ids ?? [])).sort()).toEqual([...signed].sort());
    for (const c of g) expect(c.lines.length).toBeLessThanOrEqual(MAX_LINES);
  });

  it('a story in no area goes under "Other things now done"', () => {
    const deck = presentationDeck(real, facts({ stories: mixed() }), inputs({ areas: [{ title: 'Making a record', stories: ['S1', 'S2'] }] }));
    expect(groups(deck, 'done').map((c) => c.title)).toEqual(['Making a record', 'Other things now done']);
  });
});

describe('what is not done, by reason (group-not-done-by-reason)', () => {
  it('grouped by reason, failures first, each with what it takes and who acts', () => {
    // The last story waits for my approval, whatever the owner signed in the live record.
    const record = withWaitingStory(real, real.prd!.stories.at(-1)!.id);
    const deck = presentationDeck(record, facts({ stories: mixed() }), NO_INPUTS);
    const g = groups(deck, 'not-done');
    expect(g.map((c) => c.title.replace(/: .*/, ''))).toEqual(['A test fails', 'Waiting for my approval', 'Being built', 'Built, not seen working yet']);
    expect(g.length).toBeLessThanOrEqual(MAX_GROUPS);
    for (const c of g) {
      expect(c.takes).toMatch(/\S/);
      expect(c.who).toMatch(/^(me|the builders|the test thread)/);
      expect(c.lines.length).toBeLessThanOrEqual(MAX_LINES);
    }
    const waiting = g.find((c) => c.title.startsWith('Waiting for my approval'))!;
    expect(waiting.title).toMatch(/^Waiting for my approval: \d+ checks$/);
    expect(waiting.who).toBe('me');
    const building = g.find((c) => c.title.startsWith('Being built'))!;
    expect(building.title).toMatch(/^Being built: \d+ pieces not built yet$/);
    expect(building.who).toBe('the builders (AI agents)');
    // Past three, the last line counts the rest; every story not done is in a card.
    expect(building.lines[MAX_LINES - 1]!.text).toMatch(/^and \d+ more parts of the plan$/);
    const ids = g.flatMap((c) => c.lines.flatMap((l) => l.ids ?? []));
    expect(ids.sort()).toEqual(real.prd!.stories.map((s) => s.id).filter((id) => !['S1', 'S2', 'S3'].includes(id)).sort());
    const notSeen = g.find((c) => c.title === 'Built, not seen working yet')!;
    expect([notSeen.who, notSeen.lines.flatMap((l) => l.ids ?? [])]).toEqual(['the test thread', ['S4', 'S5']]);
    expect(notSeen.lines[0]!.level).toBe('main path test not run yet');
  });

  it('everything done: the not-done slide says nothing is left', () => {
    const stories = Object.fromEntries(real.prd!.stories.map((s) => [s.id, built(s.id, 'all')]));
    const r = structuredClone(real);
    r.prd!.stories = r.prd!.stories.filter((s) => signed.includes(s.id));
    const deck = presentationDeck(r, facts({ stories }), NO_INPUTS);
    expect(slide(deck, 'not-done').blocks).toEqual([{ type: 'text', text: 'Nothing: every part of the plan is done.', tone: 'good' }]);
  });
});

describe('how we know (how-we-know)', () => {
  const evidence: DeckEvidence = {
    e2e: { source: 'saved', oldest: '2026-11-05T10:00:00Z', newest: '2026-11-07T09:00:00Z', used: 9, dropped: 0, older: 0 },
    recordings: { found: 3, pictures: 2, picturesLeftOut: 0, picturesBytes: 1000 },
    unit: { file: '.rehearse/unit-report.json', date: '2026-11-07T08:00:00Z', tests: 1200, passed: 1200, failed: 0 },
    signatures: { file: '.rehearse/allowed_signers', checked: 15, valid: 15 },
  };
  const png = solidPng(4, 3, [10, 20, 30, 255]);
  const assets = { 'run-S1': { mime: 'image/png', data: png }, 'run-S2': { mime: 'image/png', data: png } };

  it('with pictures: up to four last screens of passed runs, newest first, with the date and the recording', () => {
    const deck = presentationDeck(real, facts({ stories: mixed(), evidence }), NO_INPUTS, { hasPicture: (a) => a in assets });
    const how = slide(deck, 'how-we-know');
    expect(how.layout).toBe('split');
    const gallery = how.blocks[0]!;
    expect(gallery.type).toBe('gallery');
    if (gallery.type !== 'gallery') return;
    expect(gallery.items.length).toBeLessThanOrEqual(4);
    expect(gallery.items.map((i) => i.asset)).toEqual(['run-S2', 'run-S1']);
    expect(gallery.items[0]!.caption).toMatch(/ — passed, 7 Nov$/);
    expect(gallery.items[0]!.links).toEqual([{ href: 'media/S2.mp4', text: '▶ recording' }]);
    const html = deckHtml(deck, assets);
    expect(html).toMatch(/<div class="gallery"><figure><img src="data:image\/png;base64,/);
  });

  it('without pictures: says so, no empty picture box', () => {
    const none = { ...evidence, recordings: { found: 0, pictures: 0, picturesLeftOut: 0, picturesBytes: 0 } };
    const deck = presentationDeck(real, facts({ stories: mixed(), evidence: none }), NO_INPUTS);
    const how = slide(deck, 'how-we-know');
    expect(how.layout).toBeUndefined();
    expect(how.blocks.some((b) => b.type === 'gallery')).toBe(false);
    expect(JSON.stringify(how.blocks)).toContain('No picture of a test run: Birdview kept no recording of these tests.');
    expect(deckHtml(deck)).not.toContain('class="gallery"');
  });

  it('what done means, the numbers with their dates, the sources and the trust sentence', () => {
    const deck = presentationDeck(real, facts({ stories: mixed(), evidence }), NO_INPUTS);
    const all = texts(slide(deck, 'how-we-know').blocks).join('\n');
    expect(all).toMatch(/^Done means: every part is built and the owner signed it off. The main path test passed on the real screens in its last run, and no test of it fails\./);
    expect(all).toMatch(/Tests on the real screens: \d+ of \d+ approved checks passed, 1 failed in their last run \(Birdview, runs from 5 Nov to 7 Nov\); \d+ have no run on the real screens yet\./);
    expect(slide(deck, 'how-we-know').blocks.some((b) => b.type === 'list' && b.items[0]!.mark === 'failed')).toBe(true);
    expect(all).toContain('Automated tests: 1200 of 1200 passed (run 7 Nov).');
    expect(all).toContain("Every sign-off is signed with Ada's key, and every signature checks out (15 of 15).");
    expect(all).toContain('Where it comes from: the plan as committed at abc1234 on main, 7 Nov; Birdview test results of 7 Nov.');
    expect(all).toContain(TRUST_SENTENCE);
  });

  it('without the unit report: the automated tests are not counted', () => {
    const deck = presentationDeck(real, facts({ stories: mixed() }), NO_INPUTS);
    expect(texts(slide(deck, 'how-we-know').blocks)).toContain('Automated tests: not counted for this deck (no unit report was given).');
  });
});

describe('plain words and one file', () => {
  it('every summary slide reads in plain words: no record ids, YAML keys, box paths or code marks', () => {
    const boxPaths = real.prd!.stories.flatMap((s) => servingBoxes(real.flow, s.id));
    for (const f of [facts(), facts({ stories: mixed() })]) {
      const deck = presentationDeck(real, f, NO_INPUTS);
      for (const s of deck.slides) {
        for (const t of [s.title, s.narration, ...texts(s.blocks)]) expect(plainWordProblems(t, boxPaths), `${s.key}: ${t}`).toEqual([]);
        expect(s.ids, s.key).toEqual([]);
      }
    }
  });

  it('the summary is one self-contained file: no http(s) src or href, no external CSS or JS', () => {
    const html = deckHtml(presentationDeck(real, facts({ stories: mixed() }), NO_INPUTS));
    expect(html).not.toMatch(/(src|href)="https?:/);
    expect(html).not.toMatch(/<(link|script)[^>]+(src|href)=/);
    expect(html.split('<section class="slide').length - 1).toBe(5);
  });

  it('the full deck: the same summary, then "Details, story by story" and every story (full-deck-appendix)', () => {
    const summary = presentationDeck(real, facts({ stories: mixed() }), NO_INPUTS);
    const full = presentationDeck(real, facts({ stories: mixed() }), NO_INPUTS, { full: true });
    expect(full.slides.slice(0, summary.slides.length)).toEqual(summary.slides);
    expect(full.slides[summary.slides.length]!.title).toBe('Details, story by story');
    for (const s of real.prd!.stories) expect(full.slides.some((x) => x.key === s.id)).toBe(true);
    expect(deckHtml(full)).toContain('class="slide divider-slide"');
  });

  it('the owner can narrate the new slides', () => {
    const deck = presentationDeck(real, facts(), inputs({ narration: { done: 'Here is what works.', 'not-done': 'And what does not.', 'how-we-know': 'Why to believe it.', details: 'Now the detail.' } }), { full: true });
    expect(['done', 'not-done', 'how-we-know', 'details'].map((k) => slide(deck, k).narration)).toEqual(['Here is what works.', 'And what does not.', 'Why to believe it.', 'Now the detail.']);
  });
});
