import { describe, expect, it } from 'vitest';
import { canonicalJson, loadEpic, scenarioHash, storyHashV1 } from '../src/index.js';
import { REAL_EPIC } from './helpers.js';

describe('canonicalJson', () => {
  it('sorts keys, drops spaces and escapes non-ASCII like Python json.dumps', () => {
    expect(canonicalJson({ b: 1, a: ['→', null, true] })).toBe('{"a":["\\u2192",null,true],"b":1}');
  });

  it('omits undefined members', () => {
    expect(canonicalJson({ a: undefined, b: 2 })).toBe('{"b":2}');
  });
});

describe('bootstrap hashes of the first EPIC', () => {
  const { record } = loadEpic(REAL_EPIC);
  const scenarios = record.scenarioFiles.flatMap((f) => f.scenarios);

  it('reproduces every scenario approval hash', () => {
    expect(scenarios.length).toBeGreaterThan(0);
    for (const s of scenarios) expect(scenarioHash(s), s.id).toBe(s.approval?.hash);
  });

  it('reproduces every story hash of the bootstrap sign-off (rule 1)', () => {
    const signOff = record.signoff!.signOffs[0]!;
    for (const story of record.prd!.stories) {
      expect(storyHashV1(story, record.prd!, scenarios), story.id).toBe(signOff.storyHashes[story.id]);
    }
  });
});
