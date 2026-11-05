// Box `content-changed` and story hash rule 2 (C11, R15, S6-A3, S9-A3).

import { describe, expect, it } from 'vitest';
import { allScenarios, detectStale, gateEpic, loadEpic, storyHashV1, storyHashV2, validateEpic } from '../../src/index.js';
import { BOOTSTRAP_EPIC, makeEpic, REAL_EPIC } from '../helpers.js';
import { approvedEpic, editYaml, read, signedEpic } from './helpers.js';

describe('story hash rule 2 (C11)', () => {
  const hashes = (dir: string) => {
    const { record } = loadEpic(dir);
    const sc = allScenarios(record);
    return Object.fromEntries(
      record.prd!.stories.map((s) => [s.id, { v1: storyHashV1(s, record.prd!, sc), v2: storyHashV2(s, record.prd!, record.flow, sc) }]),
    );
  };
  const base = hashes(makeEpic());

  it('covers a box that serves the story, and only that story', () => {
    const changed = hashes(makeEpic({ edit: (d) => (d['flow.yaml'].root.boxes[2].title = 'Charge again') })); // pay serves S1
    expect(changed.S1!.v2).not.toBe(base.S1!.v2);
    expect(changed.S1!.v1).toBe(base.S1!.v1); // rule 1 cannot see box changes
    expect(changed.S2!.v2).toBe(base.S2!.v2);
  });

  it('covers the children of a serving box', () => {
    const changed = hashes(makeEpic({ edit: (d) => (d['flow.yaml'].root.boxes[4].children.boxes[0].title = 'Pack well') })); // ship/pack, ship serves S2
    expect(changed.S2!.v2).not.toBe(base.S2!.v2);
    expect(changed.S1!.v2).toBe(base.S1!.v2);
  });

  it('covers the ancestors of a serving child box', () => {
    const edit = (title: string) =>
      makeEpic({
        edit: (d) => {
          const ship = d['flow.yaml'].root.boxes[4];
          delete ship.stories;
          ship.children.boxes[1].stories = ['S2'];
          ship.title = title;
        },
      });
    expect(hashes(edit('Ship it')).S2!.v2).not.toBe(hashes(edit('Ship the order')).S2!.v2);
  });

  it('covers the roles of the lanes of its boxes', () => {
    const changed = hashes(makeEpic({ edit: (d) => (d['prd.yaml'].roles[1].about = 'The shop system') })); // lane shop
    expect(changed.S1!.v2).not.toBe(base.S1!.v2);
    expect(changed.S2!.v2).not.toBe(base.S2!.v2);
  });

  it('rule 1 still matches the bootstrap sign-off, so no story of the frozen first EPIC is stale', () => {
    const result = detectStale(loadEpic(BOOTSTRAP_EPIC).record);
    expect(result.staleStories).toEqual([]);
    expect(result.stories.every((s) => s.status === 'signed' && s.hashRule === 1)).toBe(true);
  });

  it('never treats a rule-1 sign-off as fully trusted', () => {
    for (const dir of [BOOTSTRAP_EPIC, REAL_EPIC]) {
      const result = detectStale(loadEpic(dir).record);
      expect(result.stories.map((s) => s.trusted)).toEqual(result.stories.map(() => false));
    }
  });

  it('S9-A3 dogfood: the live first EPIC is stale only for stories whose rule-1 content changed after sign-off (C17–C24)', () => {
    const result = detectStale(loadEpic(REAL_EPIC).record);
    expect(result.staleStories).toEqual(['S1', 'S2', 'S3', 'S8']);
  });
});

describe('stale detection (content-changed)', () => {
  it('S6-A3 an approved scenario whose content changes becomes stale and stops counting as evidence', () => {
    const dir = approvedEpic();
    editYaml(dir, 'scenarios/S2.yaml', (doc) => doc.setIn(['scenarios', 0, 'title'], 'Out of stock, changed'));
    const result = detectStale(loadEpic(dir).record);
    expect(result.staleScenarios).toEqual(['S2-out-of-stock']);
    expect(result.scenarios.find((s) => s.id === 'S2-out-of-stock')).toMatchObject({ status: 'stale', reason: 'content changed since approval' });
    const gate = gateEpic(dir);
    expect(gate.findings).toContainEqual({
      kind: 'gate',
      file: 'scenarios/S2.yaml',
      path: 'S2-out-of-stock',
      message: 'scenario is stale: content changed since approval; approve it again',
      refs: ['S2'],
    });
    // S2 has no other scenario, so it is no longer traced to approved evidence.
    expect(gate.findings.map((f) => `${f.path}: ${f.message}`)).toContain('S2: S2 has no approved scenario that is not stale');
  });

  it('S9-A3 a changed requirement text makes only the stories linked to it stale', () => {
    const dir = signedEpic();
    expect(detectStale(loadEpic(dir).record)).toMatchObject({ staleStories: [], epicStatus: 'signed' });
    editYaml(dir, 'prd.yaml', (doc) => doc.setIn(['requirements', 0, 'text'], 'The buyer pays for an order by card.')); // R1 → S1
    const result = detectStale(loadEpic(dir).record);
    expect(result.staleStories).toEqual(['S1']);
    expect(result.stories.find((s) => s.id === 'S2')).toMatchObject({ status: 'signed', trusted: true });
    expect(result.epicStatus).toBe('partly-stale');
    expect(gateEpic(dir).findings).toEqual([
      {
        kind: 'gate',
        file: 'signoff.yaml',
        path: 'S1',
        message: 'story is stale: content changed since sign-off (hash rule 2); must be signed again',
        refs: ['S1'],
      },
    ]);
  });

  it('a changed box makes the stories it serves stale (C11)', () => {
    const dir = signedEpic();
    editYaml(dir, 'flow.yaml', (doc) => doc.setIn(['root', 'boxes', 4, 'children', 'boxes', 1, 'title'], 'Send by post'));
    expect(detectStale(loadEpic(dir).record).staleStories).toEqual(['S2']);
  });

  it('derives the Epic status: draft before any sign-off', () => {
    expect(detectStale(loadEpic(approvedEpic()).record).epicStatus).toBe('draft');
  });

  it('a sign-off with an unknown hash rule makes its stories stale', () => {
    const dir = signedEpic();
    editYaml(dir, 'signoff.yaml', (doc) => doc.setIn(['signOffs', 0, 'hashRule'], 9));
    const { record } = loadEpic(dir);
    expect(detectStale(record).staleStories).toEqual(['S1', 'S2']);
    expect(validateEpic(dir).findings.map((f) => `${f.kind} ${f.file}`)).toEqual(['schema signoff.yaml']);
  });

  it('signoff.yaml accepts hashRule 1 and 2 and quotes times and hashes', () => {
    const dir = signedEpic();
    expect(validateEpic(dir).ok).toBe(true);
    expect(read(dir, 'signoff.yaml')).toContain("at: '2026-11-05T10:00:00Z'");
  });
});
