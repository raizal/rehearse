import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  briefSignState,
  decisionTexts,
  HOW_TO_WORK,
  howToWorkMarkdown,
  loadEpic,
  parseDecisionTexts,
  storyBuildBrief,
  storyChangeMessage,
} from '../../src/index.js';
import { CODE_GRAPH_EPIC, makeEpic, REAL_EPIC } from '../helpers.js';
import { editYaml, signedEpic } from './helpers.js';

/** About 6k tokens at four characters a token. */
const MAX_BRIEF_CHARS = 24_000;
const SKILL = fileURLToPath(new URL('../../../bb-plugin/skills/rehearse/SKILL.md', import.meta.url));

describe('storyBuildBrief (T44, box build-brief)', () => {
  it('holds every section of a signed story, in order', () => {
    const dir = signedEpic();
    const r = storyBuildBrief(loadEpic(dir).record, 'S1', { decisions: { D1: 'Pay first: the shop never ships before payment.' } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const md = r.markdown;
    const heads = md.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3));
    expect(heads[0]).toBe('Story');
    expect(heads).toContain('Approved scenarios');
    expect(heads).toContain('Boxes');
    expect(heads.at(-1)).toBe('How to work in this repo');
    expect(md).toContain('# Build brief: story S1 of the EPIC 2026-11-05-shop');
    expect(md).toContain('Signed off by a@b.c on 2026-11-05T10:00:00');
    expect(md).toContain('(rule 2)');
    expect(md).toContain('This brief matches the signed story.');
    expect(md).toContain('As Buyer, I want to pay for my cart, so that I get my items.');
    expect(md).toContain('- R1 (functional): The buyer pays for an order.');
    expect(md).toContain('- S1-A1: given a cart with items; when the buyer pays; then the order is shipped.');
    expect(md).toMatch(/### S1-buy: /);
    expect(md).toContain('Expect (what the e2e test checks)');
    expect(md).toContain('Flow-Box: <path>');
    expect(md).toContain(howToWorkMarkdown());
    expect(r.hash).toBe(r.sign.currentHash);
    expect(r.sign).toMatchObject({ status: 'signed', buildable: true, by: 'a@b.c', hashRule: 2 });
  });

  it('lists the serving boxes with contracts, their edges, decisions and entities', () => {
    const { record } = loadEpic(REAL_EPIC);
    const r = storyBuildBrief(record, 'S9', { allowUnsigned: true, decisions: decisionTexts(REAL_EPIC) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.markdown).toMatch(/### `[^`]+` \((input|process|decision|output)[^)]*, lane [^,]+, package [^)]+\)/);
    expect(r.markdown).toContain('### Edges');
    expect(r.markdown).toMatch(/## Decisions\n\n- D\d+: \S/);
    expect(r.markdown).toContain('## Entities the boxes read or write');
  });

  it('lists draft scenarios apart, as not to build to', () => {
    const dir = signedEpic();
    editYaml(dir, 'scenarios/S1.yaml', (doc) => {
      const items = doc.getIn(['scenarios']) as { items: unknown[] };
      const copy = doc.createNode({ id: 'S1-later', title: 'Pays later', status: 'draft', steps: [{ name: 'pay' }], expect: { criterion: 'S1-A1', state: {} } });
      items.items.push(copy);
    });
    const r = storyBuildBrief(loadEpic(dir).record, 'S1', { allowUnsigned: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const drafts = r.markdown.split('### Not approved, do not build to them')[1] ?? '';
    expect(drafts).toContain('S1-later');
    expect(r.markdown.split('### Not approved')[0]).not.toContain('S1-later');
  });

  it('refuses an unsigned story, and makes it with allowUnsigned, saying so on top', () => {
    const dir = makeEpic();
    const { record } = loadEpic(dir);
    const r = storyBuildBrief(record, 'S1');
    expect(r).toMatchObject({ ok: false, storyId: 'S1', sign: { status: 'draft', buildable: false } });
    if (r.ok) return;
    expect(r.reason).toContain('not signed off');
    const allowed = storyBuildBrief(record, 'S1', { allowUnsigned: true });
    expect(allowed.ok).toBe(true);
    if (allowed.ok) expect(allowed.markdown).toContain('**The story is not signed off.**');
  });

  it('refuses a stale story and names when it was signed', () => {
    const dir = signedEpic();
    editYaml(dir, 'prd.yaml', (doc) => doc.setIn(['requirements', 0, 'text'], 'The buyer pays for an order by card.'));
    const { record } = loadEpic(dir);
    const r = storyBuildBrief(record, 'S1');
    expect(r).toMatchObject({ ok: false, sign: { status: 'stale', buildable: false } });
    if (!r.ok) expect(r.reason).toContain('changed since it was signed off on 2026-11-05T10:00:00');
    const allowed = storyBuildBrief(record, 'S1', { allowUnsigned: true });
    if (allowed.ok) expect(allowed.markdown).toContain('**The story changed since it was signed.**');
    expect(storyBuildBrief(record, 'S2').ok).toBe(true);
  });

  it('answers an unknown story', () => {
    expect(storyBuildBrief(loadEpic(makeEpic()).record, 'S99')).toEqual({ ok: false, storyId: 'S99', reason: 'no story S99 in prd.yaml' });
    expect(briefSignState(loadEpic(makeEpic()).record, 'S99')).toBeUndefined();
  });

  it('stays compact: every story of both EPICs is under about 6k tokens', () => {
    for (const dir of [REAL_EPIC, CODE_GRAPH_EPIC]) {
      const { record } = loadEpic(dir);
      const decisions = decisionTexts(dir);
      for (const s of record.prd!.stories) {
        const r = storyBuildBrief(record, s.id, { allowUnsigned: true, decisions });
        expect(r.ok, `${record.slug} ${s.id}`).toBe(true);
        if (r.ok) expect(r.markdown.length, `${record.slug} ${s.id}`).toBeLessThan(MAX_BRIEF_CHARS);
      }
    }
  });
});

describe('storyChangeMessage (T44, box watch-build)', () => {
  it('lists what changed with before and now, and says the new plan is not signed', () => {
    const dir = signedEpic();
    const before = storyBuildBrief(loadEpic(dir).record, 'S1');
    if (!before.ok) throw new Error(before.reason);
    editYaml(dir, 'prd.yaml', (doc) => doc.setIn(['requirements', 0, 'text'], 'The buyer pays for an order by card.'));
    const { record } = loadEpic(dir);
    const after = storyBuildBrief(record, 'S1', { allowUnsigned: true });
    if (!after.ok) throw new Error(after.reason);
    const msg = storyChangeMessage('2026-11-05-shop', 'S1', before.content, after.content, after.sign);
    expect(msg?.changes.length).toBeGreaterThan(0);
    expect(msg?.text).toContain('The plan of story S1 changed since this thread started');
    expect(msg?.text).toContain('before: The buyer pays for an order.');
    expect(msg?.text).toContain('now: The buyer pays for an order by card.');
    expect(msg?.text).toContain('The new plan is not signed off yet');
    expect(msg?.text).toContain('`rehearse brief 2026-11-05-shop S1`');
  });

  it('is undefined when nothing changed', () => {
    const r = storyBuildBrief(loadEpic(signedEpic()).record, 'S1');
    if (!r.ok) throw new Error(r.reason);
    expect(storyChangeMessage('shop', 'S1', r.content, r.content, r.sign)).toBeUndefined();
  });
});

describe('decision texts', () => {
  it('parses decision log lines, the first of an id wins', () => {
    const md = ['- **D41 Signed approvals**: SSH signatures.', '* **G3/G4 One db**: graph.db.', '- **D41 Again**: later.', 'plain line'].join('\n');
    expect(parseDecisionTexts(md)).toEqual({ D41: 'Signed approvals: SSH signatures.', G3: 'One db: graph.db.', G4: 'One db: graph.db.' });
  });

  it('reads the decisions of every EPIC in the repo', () => {
    const all = decisionTexts(REAL_EPIC);
    expect(all.D41).toBeTruthy();
    expect(Object.keys(all).some((id) => id.startsWith('G'))).toBe(true);
  });
});

describe('how to work, one text for the brief and the skill', () => {
  it('the bb plugin skill holds the same lines in "Working on a story"', () => {
    const skill = readFileSync(SKILL, 'utf8');
    const section = skill.split('## Working on a story')[1]?.split(/\n## /)[0] ?? '';
    for (const line of HOW_TO_WORK) expect(section).toContain(`- ${line}`);
    expect(skill).toContain('rehearse brief');
    expect(skill).toContain('rehearse progress');
  });
});
