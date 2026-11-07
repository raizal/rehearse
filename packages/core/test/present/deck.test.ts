// T52, presentation mode: the deck of an EPIC for a supervisor (boxes build-deck, render-deck-html).

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  deckHtml,
  detectStale,
  downscalePng,
  gateEpic,
  GLOSSARY,
  loadEpic,
  NO_INPUTS,
  parsePresentation,
  plain,
  plainWordProblems,
  pngSize,
  presentationDeck,
  PROGRESS_STEPS,
  readPresentation,
  servingBoxes,
  simulateRecord,
  solidPng,
  storyHash,
  UNCOMMITTED_NOTICE,
  validateEpic,
  type Deck,
  type DeckFacts,
  type EpicRecord,
  type PresentationInputs,
} from '../../src/index.js';
import { makeEpic, REAL_EPIC } from '../helpers.js';

const COMMIT = { branch: 'main', sha: 'abc1234', date: '2026-11-07' };

function facts(record: EpicRecord, over: Partial<DeckFacts> = {}): DeckFacts {
  return { commit: COMMIT, uncommitted: false, owner: 'Ada', stories: {}, gate: { ok: true, items: [] }, testResults: true, ...over };
}

const inputs = (over: Partial<PresentationInputs> = {}): PresentationInputs => ({ ...NO_INPUTS, ...over });

const real = loadEpic(REAL_EPIC).record;
const shop = () => loadEpic(makeEpic()).record;

/** The text a reader sees: no style, script, corner ids or attributes. */
function visibleText(html: string): string {
  return html
    .replace(/<style>[\s\S]*?<\/style>/g, '')
    .replace(/<script>[\s\S]*?<\/script>/g, '')
    .replace(/<div class="ids">[\s\S]*?<\/div>/g, '')
    .replace(/<span class="id">[^<]*<\/span>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/g, ' ');
}

describe('presentationDeck: slide order', () => {
  it('title, why, requirements, big picture, progress, the stories, quality, risks, next, glossary', () => {
    const deck = presentationDeck(real, facts(real), NO_INPUTS);
    const keys = deck.slides.map((s) => s.key);
    expect(keys.slice(0, 5)).toEqual(['title', 'why', 'requirements', 'big-picture', 'progress']);
    expect(keys.slice(-4)).toEqual(['quality', 'risks', 'next', 'glossary']);
    const stories = real.prd!.stories.map((s) => s.id);
    const storyKeys = keys.slice(5, -4);
    // Every story in record order, each with its own slide first and its checks after it.
    expect(storyKeys.filter((k) => stories.includes(k))).toEqual(stories);
    for (const k of storyKeys) expect(k).toMatch(/^S\d+(-checks(-\d+)?)?$/);
    expect(keys).not.toContain('asks');
  });

  it('every slide has 1–3 sentences of narration', () => {
    const deck = presentationDeck(real, facts(real), NO_INPUTS);
    for (const s of deck.slides) {
      expect(s.narration.trim(), s.key).not.toBe('');
      const count = s.narration.split(/(?<=[.!?])\s+(?=[A-Z"])/).filter(Boolean).length;
      expect(count, `${s.key}: ${s.narration}`).toBeLessThanOrEqual(3);
    }
  });

  it('progress shows the five steps and a summary line', () => {
    const deck = presentationDeck(real, facts(real), NO_INPUTS);
    const progress = deck.slides.find((s) => s.key === 'progress')!;
    const rows = progress.blocks.find((b) => b.type === 'progress');
    expect(rows?.type === 'progress' && rows.rows.length).toBe(real.prd!.stories.length);
    expect(rows?.type === 'progress' && rows.rows.every((r) => r.steps.length === PROGRESS_STEPS.length)).toBe(true);
    expect(progress.blocks.some((b) => b.type === 'text' && /of \d+ stories finished/.test(b.text))).toBe(true);
  });

  it('a story has "As a…", its criteria, the swimlanes and what was checked', () => {
    const deck = presentationDeck(real, facts(real), NO_INPUTS);
    const s1 = deck.slides.find((s) => s.key === 'S1')!;
    expect(s1.blocks[0]).toMatchObject({ type: 'lead' });
    expect((s1.blocks[0] as { text: string }).text).toMatch(/^As an? .+, I want to .+, so that .+\.$/);
    const list = s1.blocks.find((b) => b.type === 'list');
    expect(list?.type === 'list' && list.items.length).toBe(real.prd!.stories[0]!.acceptance.length);
    const checks = deck.slides.find((s) => s.key === 'S1-checks')!;
    const flow = checks.blocks.find((b) => b.type === 'flow');
    expect(flow?.type === 'flow' && flow.svg).toMatch(/^<svg class="flow-svg"/);
    expect(checks.blocks.find((b) => b.type === 'checks')).toBeDefined();
  });

  it('the glossary explains scenario, sign-off, e2e test and gate', () => {
    const terms = GLOSSARY.map((g) => g.term.toLowerCase());
    for (const t of ['scenario', 'sign-off', 'e2e test', 'gate']) expect(terms).toContain(t);
  });
});

describe('plain words', () => {
  it('plain() drops code marks and ids', () => {
    expect(plain('the `rehearse gate` of story S3 (D12, C3), see S3-A1 and R4.')).toBe('the rehearse gate of another story, see a criterion and.');
    expect(plain('stories S1 and S2 wait')).toBe('other stories wait');
  });

  it('plainWordProblems finds ids, YAML keys, box paths and code marks', () => {
    expect(plainWordProblems('see S3, soThat: x, a/b and `c`', ['a/b'])).toEqual(['record ids: S3', 'YAML key soThat:', 'box path a/b', 'code marks (`)']);
    expect(plainWordProblems('- boxes: [a]')).toEqual(['YAML key boxes:']);
    // An English list after a colon is not YAML.
    expect(plainWordProblems('We checked 4 scenarios: 3 approved.')).toEqual([]);
    expect(plainWordProblems('A person reads this.')).toEqual([]);
  });

  it('the rendered deck of both EPICs has no ids, YAML keys, box paths or code marks outside the corner ids', () => {
    for (const dir of [REAL_EPIC, join(REAL_EPIC, '..', '2026-11-05-code-graph')]) {
      const record = loadEpic(dir).record;
      const paths = record.prd!.stories.flatMap((s) => servingBoxes(record.flow, s.id));
      const html = deckHtml(presentationDeck(record, facts(record), NO_INPUTS));
      expect(plainWordProblems(visibleText(html), paths), dir).toEqual([]);
    }
  });
});

describe('honesty', () => {
  it('unsigned stories, waiting approvals, missing tests and gate findings show', () => {
    const record = shop();
    const f = facts(record, {
      stories: { S1: { built: 0, tests: {} } },
      gate: { ok: false, items: [{ check: 'signed-off', message: 'S1 is not signed off', stories: ['S1'] }] },
    });
    const deck = presentationDeck(record, f, NO_INPUTS);
    const quality = deck.slides.find((s) => s.key === 'quality')!;
    expect(quality.blocks.some((b) => b.type === 'text' && /does not pass yet: 1 open item/.test(b.text))).toBe(true);
    expect(quality.blocks.some((b) => b.type === 'list' && b.items.some((i) => /not signed off yet/.test(i.text)))).toBe(true);
    const risks = deck.slides.find((s) => s.key === 'risks')!;
    const riskText = JSON.stringify(risks.blocks);
    expect(riskText).toMatch(/not signed off yet/);
    const title = deck.slides[0]!;
    expect(JSON.stringify(title.blocks)).toMatch(/0 of 2 stories signed off/);
    // Not signed off is "not yet" in progress, never "done".
    const rows = deck.slides.find((s) => s.key === 'progress')!.blocks.find((b) => b.type === 'progress');
    expect(rows?.type === 'progress' && rows.rows.every((r) => r.steps[4]!.state !== 'done')).toBe(true);
  });

  it('a failing test is an alarm in progress and a risk', () => {
    const record = loadEpic(REAL_EPIC).record;
    // The first approved scenario of the first EPIC, failing.
    const approved = record.scenarioFiles.flatMap((f) => f.scenarios).find((s) => s.approval);
    if (!approved) return;
    const deck = presentationDeck(record, facts(record, { stories: { [approved.story]: { built: 0, tests: { [approved.id]: 'failed' } } } }), NO_INPUTS);
    const html = deckHtml(deck);
    expect(JSON.stringify(deck.slides.find((s) => s.key === 'risks')!.blocks)).toMatch(/e2e test fails/);
    expect(html).toMatch(/failing/);
  });

  it('test results that were not read say so on the quality slide', () => {
    const deck = presentationDeck(real, facts(real, { testResults: false }), NO_INPUTS);
    expect(JSON.stringify(deck.slides.find((s) => s.key === 'quality')!.blocks)).toMatch(/Test results were not available/);
  });

  it('coverage is one number when the code graph has it', () => {
    const deck = presentationDeck(real, facts(real, { coverage: 71 }), NO_INPUTS);
    expect(JSON.stringify(deck.slides.find((s) => s.key === 'quality')!.blocks)).toMatch(/"71%"/);
  });
});

describe('owner inputs (presentation.yaml)', () => {
  it('asks make the "What I need from you" slide; none leaves it out', () => {
    const without = presentationDeck(real, facts(real), NO_INPUTS);
    expect(without.slides.some((s) => s.key === 'asks')).toBe(false);
    const withAsks = presentationDeck(real, facts(real), inputs({ asks: ['Approve the budget.'] }));
    const keys = withAsks.slides.map((s) => s.key);
    expect(keys.indexOf('asks')).toBe(keys.indexOf('risks') + 1);
    expect(keys.indexOf('next')).toBe(keys.indexOf('asks') + 1);
  });

  it("the owner's next steps, risks and narration replace or join the generated ones", () => {
    const deck = presentationDeck(real, facts(real), inputs({ next: ['Ship it.'], risks: ['A key person is away.'], narration: { title: 'Hello.', S1: 'The first story.' } }));
    expect(deck.slides.find((s) => s.key === 'title')!.narration).toBe('Hello.');
    expect(deck.slides.find((s) => s.key === 'S1')!.narration).toBe('The first story.');
    expect(JSON.stringify(deck.slides.find((s) => s.key === 'next')!.blocks)).toBe(JSON.stringify([{ type: 'list', items: [{ text: 'Ship it.' }] }]));
    expect(JSON.stringify(deck.slides.find((s) => s.key === 'risks')!.blocks)).toMatch(/A key person is away/);
  });

  it('hidden stories leave a note and no slides, and the counts still cover them', () => {
    const deck = presentationDeck(real, facts(real), inputs({ hide: ['S1', 'S2'] }));
    expect(deck.hiddenStories).toBe(2);
    expect(deck.slides.some((s) => s.key === 'S1' || s.key === 'S2-checks')).toBe(false);
    expect(JSON.stringify(deck.slides.find((s) => s.key === 'big-picture')!.blocks)).toMatch(/2 stories not shown in this deck/);
    expect(JSON.stringify(deck.slides.find((s) => s.key === 'progress')!.blocks)).toMatch(/2 stories not shown/);
    expect(JSON.stringify(deck.slides[0]!.blocks)).toMatch(new RegExp(`of ${real.prd!.stories.length} stories signed off`));
  });

  it('parsePresentation: unknown slide keys and story ids are findings; good parts are kept', () => {
    const { inputs: got, findings } = parsePresentation('asks: [Decide.]\nnarration: {title: Hi., nope: x, S1-checks: Checks.}\nhide: [S1, S99]\nextra: 1\n', real);
    expect(got.asks).toEqual(['Decide.']);
    expect(got.narration).toEqual({ title: 'Hi.', 'S1-checks': 'Checks.' });
    expect(got.hide).toEqual(['S1']);
    expect(findings.map((f) => f.message)).toEqual([
      expect.stringMatching(/unknown key extra/),
      expect.stringMatching(/unknown slide key nope/),
      expect.stringMatching(/unknown story S99 in hide/),
    ]);
    expect(findings.every((f) => f.kind === 'schema' && f.file === 'presentation.yaml')).toBe(true);
  });

  it('a missing presentation.yaml is no inputs and no findings', () => {
    expect(readPresentation(shop())).toEqual({ inputs: NO_INPUTS, findings: [] });
  });

  it('presentation.yaml is not part of the signed record: hashes, gate and simulate ignore it; validate checks its shape', () => {
    const dir = makeEpic();
    const before = loadEpic(dir).record;
    const hash = (r: EpicRecord) => r.prd!.stories.map((s) => storyHash(2, s, r.prd!, r.flow, r.scenarioFiles.flatMap((f) => f.scenarios)));
    const hashes = hash(before);
    const stale = detectStale(before);
    const gate = gateEpic(dir, simulateRecord);
    const sim = simulateRecord(before);
    writeFileSync(join(dir, 'presentation.yaml'), 'asks: [Decide.]\nhide: [S77]\nnarration: {S1: Changed words.}\n');
    const after = loadEpic(dir).record;
    expect(hash(after)).toEqual(hashes);
    expect(detectStale(after)).toEqual(stale);
    expect(gateEpic(dir, simulateRecord)).toEqual(gate);
    expect(simulateRecord(after)).toEqual(sim);
    const report = validateEpic(dir);
    expect(report.findings.filter((f) => f.file === 'presentation.yaml').map((f) => f.message)).toEqual([expect.stringMatching(/unknown story S77/)]);
  });
});

describe('footer and notice', () => {
  it('every slide carries "<title> · as of <branch> @ <sha>, <date>"', () => {
    const deck = presentationDeck(real, facts(real), NO_INPUTS);
    expect(deck.footer).toBe(`${deck.title} · as of main @ abc1234, 2026-11-07`);
    const html = deckHtml(deck);
    expect(html.split('<span class="foot">').length - 1).toBe(deck.slides.length);
  });

  it('uncommitted changes show a notice on the title slide and in the footer', () => {
    const deck = presentationDeck(real, facts(real, { uncommitted: true }), NO_INPUTS);
    expect(deck.footer).toMatch(/includes uncommitted changes$/);
    expect(deck.notice).toBe(UNCOMMITTED_NOTICE);
    expect(deck.slides[0]!.blocks).toContainEqual({ type: 'notice', text: UNCOMMITTED_NOTICE });
  });
});

describe('deckHtml', () => {
  const deck: Deck = presentationDeck(real, facts(real, { stories: { S1: { built: 0, tests: {}, design: { asset: 'design-S1', caption: 'Screen design' } } } }), NO_INPUTS);
  const png = solidPng(4, 3, [10, 20, 30, 255]);
  const html = deckHtml(deck, { 'design-S1': { mime: 'image/png', data: png, width: 4, height: 3 } });

  it('is self-contained: no http(s) src or href, no external CSS or JS', () => {
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).not.toMatch(/\b(?:src|href)\s*=\s*["']?(?:https?:)?\/\//i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/@import|url\(\s*["']?https?:/i);
    expect(html).toContain(`src="data:image/png;base64,${Buffer.from(png).toString('base64')}"`);
  });

  it('one section per slide, numbered, with keyboard navigation in an inline script', () => {
    expect(html.match(/<section class="slide/g)?.length).toBe(deck.slides.length);
    expect(html).toContain(`<span class="num">1 / ${deck.slides.length}</span>`);
    expect(html).toMatch(/<script>[\s\S]*ArrowRight[\s\S]*<\/script>/);
  });

  it('without script the slides read as one long page: navigation and one-at-a-time only under .js', () => {
    expect(html).toMatch(/\.js \.slide\{display:none/);
    expect(html).toMatch(/\.deck-nav\{display:none/);
  });

  it('prints one landscape slide per page', () => {
    expect(html).toMatch(/@page\{size:1280px 720px;margin:0\}/);
    expect(html).toMatch(/@media print\{[\s\S]*break-after:page/);
  });

  it('an image whose picture is missing leaves no empty box', () => {
    expect(deckHtml(deck)).not.toContain('<img');
  });

  it('escapes record text', () => {
    const d = presentationDeck(real, facts(real), inputs({ narration: { title: '<b>"bold"</b> & more' } }));
    expect(deckHtml(d)).toContain('&lt;b&gt;&quot;bold&quot;&lt;/b&gt; &amp; more');
  });
});

describe('design pictures', () => {
  it('a wide PNG is shrunk to 1600 px; a narrow one is kept', () => {
    const wide = solidPng(2000, 10, [200, 100, 50, 255]);
    const small = downscalePng(wide);
    expect(small.scaled).toBe(true);
    expect(pngSize(small.png)).toEqual({ width: 1600, height: 8 });
    const narrow = solidPng(10, 10, [0, 0, 0, 255]);
    expect(downscalePng(narrow)).toEqual({ png: narrow, width: 10, height: 10, scaled: false });
    expect(downscalePng(new Uint8Array([1, 2, 3])).scaled).toBe(false);
  });
});
