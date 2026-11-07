// T57 (S22, box pick-main-path): review.yaml holds the owner's pick of each story's main path. It is
// not part of the signed record: hashes, stale checks, the gate and simulate ignore it. validate
// checks its shape: an unknown story or scenario is a finding.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectStale, gateEpic, loadEpic, NO_REVIEW, parseReview, readReview, setMainPath, simulateRecord, storyHash, validateEpic, type EpicRecord } from '../../src/index.js';
import { makeEpic } from '../helpers.js';

describe('review.yaml (T57)', () => {
  it('parses the picks and reports an unknown key, story or scenario, and a scenario of another story', () => {
    const record = loadEpic(makeEpic()).record;
    const { inputs, findings } = parseReview('mainPath:\n  S1: S1-empty\n  S2: S1-buy\n  S9: S9-x\nextra: 1\n', record);
    expect(inputs).toEqual({ mainPath: { S1: 'S1-empty' } });
    expect(findings.map((f) => f.message)).toEqual([
      'unknown key extra; review.yaml has mainPath',
      'mainPath.S2 names S1-buy, which is not a scenario of S2',
      'mainPath names S9, which is not a story of this EPIC',
    ]);
    expect(findings.every((f) => f.kind === 'schema' && f.file === 'review.yaml')).toBe(true);
    expect(parseReview('mainPath: [S1]\n', record).findings.map((f) => f.message)).toEqual(['mainPath must be a map of story id → scenario id']);
  });

  it('a missing review.yaml is no pick and no findings', () => {
    expect(readReview(loadEpic(makeEpic()).record)).toEqual({ inputs: NO_REVIEW, findings: [] });
  });

  it('setMainPath keeps every comment and entry, and makes the file when there is none', () => {
    const text = '# Mine.\nmainPath:\n  S2: S2-out-of-stock # by hand\n';
    expect(setMainPath(text, 'S1', 'S1-buy')).toBe('# Mine.\nmainPath:\n  S2: S2-out-of-stock # by hand\n  S1: S1-buy\n');
    expect(setMainPath(text, 'S2', 'S2-x')).toBe('# Mine.\nmainPath:\n  S2: S2-x # by hand\n');
    expect(setMainPath(undefined, 'S1', 'S1-buy')).toMatch(/^# The owner's review choices \(T57\)[^]*\nmainPath:\n {2}S1: S1-buy\n$/);
    expect(() => setMainPath('mainPath: [1]\n', 'S1', 'S1-buy')).toThrow(/must be a map/);
  });

  it('is not part of the signed record: hashes, stale checks, gate and simulate ignore it; validate checks its shape', () => {
    const dir = makeEpic();
    const before = loadEpic(dir).record;
    const hash = (r: EpicRecord) => r.prd!.stories.map((s) => storyHash(2, s, r.prd!, r.flow, r.scenarioFiles.flatMap((f) => f.scenarios)));
    const hashes = hash(before);
    const stale = detectStale(before);
    const gate = gateEpic(dir, simulateRecord);
    const sim = simulateRecord(before);
    writeFileSync(join(dir, 'review.yaml'), 'mainPath:\n  S1: S1-empty\n  S2: S2-nope\n');
    const after = loadEpic(dir).record;
    expect(hash(after)).toEqual(hashes);
    expect(detectStale(after)).toEqual(stale);
    expect(gateEpic(dir, simulateRecord)).toEqual(gate);
    expect(simulateRecord(after)).toEqual(sim);
    expect(validateEpic(dir).findings.filter((f) => f.file === 'review.yaml').map((f) => f.message)).toEqual(['mainPath.S2 names S2-nope, which is not a scenario of S2']);
  });
});
