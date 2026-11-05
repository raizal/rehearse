// Pure models behind the FigCraft frame of the PRD and Tech spec pages (T18, design pages 9, 10):
// the header legend, the colour of each "Open in" row, chip widths, the trace tree layout, the
// active contents row, and what the Tech spec says about a PRD id.

import { describe, expect, it } from 'vitest';
import { chipWidth, knownIds, legendSamples, LINK_KINDS, placeKind } from '../src/model/links.js';
import { activeSection, prdDoc, prdSummary, traceLayout, traceOf, TRACE } from '../src/model/prd.js';
import { boxContracts, isFirstRow, specLinks, TECH_SUMMARY, typePlain, writtenEntities } from '../src/model/techspec.js';
import { realEpic, reviewEpic } from './fixture.js';

describe('T18 feature 1: the page header', () => {
  it('T18 1 the legend has one sample per kind from the record, and a preferred id wins', () => {
    const known = knownIds(reviewEpic());
    expect(legendSamples(known).map((s) => [s.kind, s.sample])).toEqual([
      ['requirement', 'R1'],
      ['story', 'S1'],
      ['box', 'start'],
      ['scenario', 'S1-buy'],
      ['entity', 'Order'],
      ['decision', 'D1'],
    ]);
    expect(legendSamples(known, { box: 'pay', requirement: 'R2' }).find((s) => s.kind === 'box')?.sample).toBe('pay');
    expect(legendSamples(known, { requirement: 'R2' })[0]).toEqual({ kind: 'requirement', sample: 'R2', goes: 'Readiness row' });
  });

  it('T18 1 a kind with no id in the record has no sample chip, only where it goes', () => {
    const view = reviewEpic();
    view.decisions = [];
    expect(legendSamples(knownIds(view)).find((s) => s.kind === 'decision')).toEqual({ kind: 'decision', goes: 'Decision log' });
  });

  it('T18 1 legend box samples are root boxes, never inner ones', () => {
    for (const s of legendSamples(knownIds(realEpic()))) if (s.kind === 'box') expect(s.sample).not.toContain('/');
  });

  it('T18 1 the summary counts requirements, stories and roles, with plurals', () => {
    expect(prdSummary(prdDoc(reviewEpic()))).toBe('prd.yaml · 3 requirements · 2 stories · 2 roles. Every ID opens the place in rehearse where it lives.');
    expect(TECH_SUMMARY).toContain('Not prose (D20)');
  });
});

describe('T18 feature 2: open rows and chips', () => {
  it('T18 2 each place has the colour of the kind that lives there', () => {
    expect(placeKind({ view: 'readiness', requirement: 'R1' })).toBe('requirement');
    expect(placeKind({ view: 'story', story: 'S1' })).toBe('story');
    expect(placeKind({ view: 'storyboard', scenario: 'S1-buy' })).toBe('scenario');
    expect(placeKind({ view: 'flow', box: 'pay' })).toBe('box');
    expect(placeKind({ view: 'techspec', focus: 'entity:Order' })).toBe('entity');
    expect(placeKind({ view: 'techspec', focus: 'decision:D1' })).toBe('decision');
    expect(placeKind({ view: 'techspec', focus: 'correction:C1' })).toBe('decision');
    expect(placeKind({ view: 'techspec', focus: 'box:pay' })).toBe('box');
    expect(placeKind({ view: 'bigpicture' })).toBe('box');
    expect(LINK_KINDS).toContain(placeKind({ view: 'usecases' }));
  });

  it('T18 2 a chip is 6.7 px per character plus 16 px of padding', () => {
    expect(chipWidth('R1')).toBe(30);
    expect(chipWidth('S1-buy')).toBe(57);
    expect(chipWidth('')).toBe(16);
  });
});

describe('T18 feature 3: the trace tree', () => {
  it('T18 3 columns requirement | story | boxes | scenarios, each story a band, no overlaps', () => {
    const view = reviewEpic();
    const t = traceLayout(traceOf(view, { kind: 'requirement', id: 'R1' }));
    const byKind = (k: string) => t.nodes.filter((n) => n.kind === k);
    expect(byKind('requirement').map((n) => n.id)).toEqual(['R1']);
    expect(byKind('story').map((n) => n.id)).toEqual(['S1']);
    expect(byKind('box').map((n) => n.id)).toEqual(['cart', 'pay']);
    expect(byKind('scenario').map((n) => n.id)).toEqual(['S1-buy', 'S1-empty']);
    // Left to right by column.
    const x = (k: string) => byKind(k)[0]!.x;
    expect(x('requirement')).toBeLessThan(x('story'));
    expect(x('story')).toBeLessThan(x('box'));
    expect(x('box')).toBeLessThan(x('scenario'));
    // Boxes stack 40 apart, scenarios 46 apart; the requirement sits level with its one story.
    expect(byKind('box')[1]!.y - byKind('box')[0]!.y).toBe(TRACE.boxRow);
    expect(byKind('scenario')[1]!.y - byKind('scenario')[0]!.y).toBe(TRACE.scenarioRow);
    expect(byKind('requirement')[0]!.y).toBe(byKind('story')[0]!.y);
    expect(byKind('scenario').map((n) => n.state?.kind)).toEqual(['signed', 'draft']);
    // Everything fits inside the drawing: nothing is clipped.
    for (const n of t.nodes) {
      expect(n.x + chipWidth(n.id)).toBeLessThanOrEqual(t.width);
      expect(n.y + TRACE.chipH).toBeLessThanOrEqual(t.height);
    }
    expect(t.lines.length).toBeGreaterThan(0);
    expect(t.notes).toEqual([]);
  });

  it('T18 3 a requirement with no story says so instead of drawing an empty tree', () => {
    const view = reviewEpic();
    expect(traceLayout(traceOf(view, { kind: 'requirement', id: 'R3' })).notes.map((n) => n.text)).toEqual(['no story']);
  });

  it('T18 3 the real EPIC: every trace fits in its own drawing', () => {
    const view = realEpic();
    for (const r of view.prd!.requirements) {
      const t = traceLayout(traceOf(view, { kind: 'requirement', id: r.id }));
      for (const n of t.nodes) expect(n.y + TRACE.chipH).toBeLessThanOrEqual(t.height);
    }
  });
});

describe('T18 feature 4: the contents rail follows the scroll', () => {
  it('T18 4 the active section is the last one whose top is above the reading line', () => {
    const tops = [
      { id: 'a', top: 0 },
      { id: 'b', top: 300 },
      { id: 'c', top: 900 },
    ];
    expect(activeSection(tops, 0)).toBe('a');
    expect(activeSection(tops, 280)).toBe('b');
    expect(activeSection(tops, 899)).toBe('c');
    expect(activeSection(tops, 800, 0)).toBe('b');
    expect(activeSection([], 10)).toBeUndefined();
  });
});

describe('T18 feature 5: Tech spec rows and links', () => {
  it('T18 5 the first rows are the root jobs; decisions, start, end and inner boxes wait behind show more', () => {
    const rows = boxContracts(reviewEpic());
    expect(rows.filter(isFirstRow).map((r) => r.path)).toEqual(['cart', 'pay', 'ship', 'notify']);
    expect(rows.filter((r) => !isFirstRow(r)).map((r) => r.path)).toContain('start');
  });

  it('T18 5 the entities a box writes, once each', () => {
    const pay = boxContracts(reviewEpic()).find((r) => r.path === 'pay')!;
    expect(writtenEntities(pay)).toEqual(['Order']);
  });

  it('T18 5 what the Tech spec says about a requirement: its boxes, the entities they write, their decisions', () => {
    const view = reviewEpic();
    const links = specLinks(view, { kind: 'requirement', id: 'R1' });
    expect(links.boxes).toEqual(['cart', 'pay']);
    expect(links.entities).toEqual(['Order']);
    expect(specLinks(view, { kind: 'requirement', id: 'R3' })).toEqual({ boxes: [], entities: [], decisions: [] });
    expect(specLinks(view, { kind: 'story', id: 'S2-A1' }).boxes).toEqual(['ship']);
  });

  it('T18 5 a field type without the entities it names; optional in words', () => {
    expect(typePlain('list ref Story', ['Story'])).toBe('list');
    expect(typePlain('ref Approval?', ['Approval'])).toBe('optional');
    expect(typePlain('list ref Order?', ['Order'])).toBe('list, optional');
    expect(typePlain('string', [])).toBe('string');
  });
});
