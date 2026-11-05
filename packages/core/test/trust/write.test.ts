// Boxes `approve` and `sign-off`, core only (R13, R14, S6-A1, S9-A1, S9-A2).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { approveScenarios, currentIdentity, detectStale, loadEpic, scenarioHash, signOff, validateEpic } from '../../src/index.js';
import { makeEpic } from '../helpers.js';
import { approvedEpic, editYaml, ME, NOW, read, signedEpic } from './helpers.js';

describe('approveScenarios', () => {
  it('S6-A1 approving a draft scenario records by, at and the content hash', () => {
    const dir = makeEpic();
    writeFileSync(join(dir, 'scenarios/S2.yaml'), `# keep me\n${read(dir, 'scenarios/S2.yaml')}`);
    const result = approveScenarios(dir, ['S2-out-of-stock'], ME, { now: NOW });
    expect(result.ok).toBe(true);
    const s = loadEpic(dir).record.scenarioFiles[1]!.scenarios[0]!;
    expect(s.status).toBe('approved');
    expect(s.approval).toEqual({ by: 'a@b.c', threadId: 'thr_test', at: '2026-11-05T10:00:00Z', hash: scenarioHash(s) });
    expect(read(dir, 'scenarios/S2.yaml').startsWith('# keep me\n')).toBe(true);
    // The other file is untouched.
    expect(loadEpic(dir).record.scenarioFiles[0]!.scenarios.every((x) => x.status === 'draft')).toBe(true);
    expect(validateEpic(dir).ok).toBe(true);
  });

  it('fails on an unknown id and writes nothing', () => {
    const dir = makeEpic();
    const before = read(dir, 'scenarios/S1.yaml');
    const result = approveScenarios(dir, ['S1-buy', 'nope'], ME);
    expect(result).toEqual({ ok: false, findings: [{ kind: 'reference', file: 'scenarios', path: 'nope', message: 'scenario nope unknown', refs: [] }] });
    expect(read(dir, 'scenarios/S1.yaml')).toBe(before);
  });

  it('re-approving a stale scenario makes it approved again', () => {
    const dir = approvedEpic();
    editYaml(dir, 'scenarios/S2.yaml', (doc) => doc.setIn(['scenarios', 0, 'title'], 'changed'));
    expect(detectStale(loadEpic(dir).record).staleScenarios).toEqual(['S2-out-of-stock']);
    approveScenarios(dir, ['S2-out-of-stock'], ME);
    expect(detectStale(loadEpic(dir).record).staleScenarios).toEqual([]);
  });
});

describe('signOff', () => {
  it('S9-A2 when all gate checks pass, appends who, when and a rule-2 hash for each story', () => {
    const dir = approvedEpic();
    writeFileSync(join(dir, 'signoff.yaml'), '# Append only.\nsignOffs:\n  - { by: old@b.c, at: "2026-11-01T00:00:00Z", storyHashes: {} }\n');
    const result = signOff(dir, ['S2', 'S1'], ME, { now: NOW });
    expect(result.ok).toBe(true);
    const text = read(dir, 'signoff.yaml');
    expect(text.startsWith('# Append only.\n')).toBe(true);
    const log = parse(text);
    expect(log.signOffs).toHaveLength(2);
    expect(log.signOffs[0].by).toBe('old@b.c');
    expect(log.signOffs[1]).toEqual({
      by: 'a@b.c',
      threadId: 'thr_test',
      at: '2026-11-05T10:00:00Z',
      hashRule: 2,
      storyHashes: { S1: expect.stringMatching(/^sha256:[0-9a-f]{64}$/), S2: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) },
    });
    expect(validateEpic(dir).ok).toBe(true);
    expect(detectStale(loadEpic(dir).record)).toMatchObject({ epicStatus: 'signed', staleStories: [] });
  });

  it('S9-A1 with a simulator error left, the sign-off fails, lists the error and writes nothing', () => {
    const dir = approvedEpic();
    const error = { kind: 'contract' as const, file: 'flow.yaml', path: 'pay', message: 'orderId: string → number', refs: [] };
    const result = signOff(dir, ['S1'], ME, { simulate: () => ({ command: 'simulate', ok: false, findings: [error] }) });
    expect(result).toEqual({ ok: false, findings: [error] });
    expect(() => read(dir, 'signoff.yaml')).toThrow();
  });

  it('signs again only the affected stories; another stale story does not block (R15)', () => {
    const dir = signedEpic();
    editYaml(dir, 'prd.yaml', (doc) => {
      doc.setIn(['requirements', 0, 'text'], 'R1 changed');
      doc.setIn(['requirements', 1, 'text'], 'R2 changed');
    });
    expect(detectStale(loadEpic(dir).record).staleStories).toEqual(['S1', 'S2']);
    const result = signOff(dir, ['S1'], ME, { now: NOW });
    expect(result.ok && Object.keys(result.signOff.storyHashes)).toEqual(['S1']);
    expect(detectStale(loadEpic(dir).record)).toMatchObject({ staleStories: ['S2'], epicStatus: 'partly-stale' });
  });

  it('a stale scenario of the story blocks its sign-off', () => {
    const dir = approvedEpic();
    editYaml(dir, 'scenarios/S1.yaml', (doc) => doc.setIn(['scenarios', 1, 'title'], 'changed'));
    const result = signOff(dir, ['S1'], ME);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.findings.map((f) => f.path)).toEqual(['S1-empty']);
    expect(signOff(dir, ['S2'], ME).ok).toBe(true);
  });

  it('fails on an unknown story and on a missing identity', () => {
    const dir = approvedEpic();
    const result = signOff(dir, ['S7'], { by: '' });
    expect(!result.ok && result.findings.map((f) => f.message)).toEqual(['identity has no git user.email', 'story S7 unknown']);
  });
});

describe('currentIdentity', () => {
  it('is git user.email plus BB_THREAD_ID when it is set (R13)', () => {
    const repo = mkdtempSync(join(tmpdir(), 'rehearse-git-'));
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'me@x.y'], { cwd: repo });
    expect(currentIdentity(repo, { BB_THREAD_ID: 'thr_1' })).toEqual({ by: 'me@x.y', threadId: 'thr_1' });
    expect(currentIdentity(repo, {})).toEqual({ by: 'me@x.y' });
  });
});
