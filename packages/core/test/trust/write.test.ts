// Boxes `approve` and `sign-off`, core only (R13, R14, S6-A1, S9-A1, S9-A2), signed (D41).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  approvalPayload,
  approveScenarios,
  currentIdentity,
  detectStale,
  loadEpic,
  scenarioHash,
  SigningError,
  signOff,
  signOffPayload,
  validateEpic,
  verify,
  type SignedApproval,
} from '../../src/index.js';
import { makeEpic } from '../helpers.js';
import { approvedEpic, editYaml, ME, NOW, read, SIGNED, signedEpic } from './helpers.js';
import { ALLOWED_SIGNERS, KEYGEN, STRANGER, VERIFIER } from './keys.js';

const SIG = /^-----BEGIN SSH SIGNATURE-----\n[\s\S]+-----END SSH SIGNATURE-----\n$/;

describe('approveScenarios', () => {
  it('S6-A1 approving a draft scenario records by, at, the content hash and a valid signature', () => {
    const dir = makeEpic();
    writeFileSync(join(dir, 'scenarios/S2.yaml'), `# keep me\n${read(dir, 'scenarios/S2.yaml')}`);
    const result = approveScenarios(dir, ['S2-out-of-stock'], ME, { now: NOW, ...SIGNED });
    expect(result.ok).toBe(true);
    const s = loadEpic(dir).record.scenarioFiles[1]!.scenarios[0]!;
    expect(s.status).toBe('approved');
    expect(s.approval).toEqual({ by: 'a@b.c', threadId: 'thr_test', at: '2026-11-05T10:00:00Z', hash: scenarioHash(s), sig: expect.stringMatching(SIG) });
    const a = s.approval as SignedApproval;
    expect(verify(approvalPayload('2026-11-05-shop', s.id, a), a.sig, 'a@b.c', ALLOWED_SIGNERS, KEYGEN).status).toBe('valid');
    expect(read(dir, 'scenarios/S2.yaml')).toContain('sig: |');
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
    approveScenarios(dir, ['S2-out-of-stock'], ME, SIGNED);
    expect(detectStale(loadEpic(dir).record).staleScenarios).toEqual([]);
  });

  it('S6-A1 with no signing key, approve fails with a clear reason and writes nothing', () => {
    const dir = makeEpic();
    const before = read(dir, 'scenarios/S1.yaml');
    const result = approveScenarios(dir, ['S1-buy'], ME, { verifier: VERIFIER });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/^no signing key/);
    expect(!result.ok && result.findings[0]!.message).toMatch(/^cannot sign: no signing key/);
    expect(read(dir, 'scenarios/S1.yaml')).toBe(before);
  });

  it('S6-A1 a key that allowed_signers does not list for the email writes nothing', () => {
    const dir = makeEpic();
    const before = read(dir, 'scenarios/S1.yaml');
    const result = approveScenarios(dir, ['S1-buy', 'S1-empty'], ME, { signer: STRANGER.signer, verifier: VERIFIER });
    expect(!result.ok && result.reason).toBe(`key ${STRANGER.signer.keyFingerprint} is not in .rehearse/allowed_signers for a@b.c (see docs/signing.md)`);
    expect(read(dir, 'scenarios/S1.yaml')).toBe(before);
  });

  it('S6-A1 an ssh-keygen error is the reason, and no file changes', () => {
    const dir = makeEpic();
    const before = read(dir, 'scenarios/S1.yaml');
    const signer = { keyFingerprint: 'SHA256:x', sign: () => { throw new SigningError('ssh-keygen could not sign: agent refused'); } };
    const result = approveScenarios(dir, ['S1-buy'], ME, { signer, verifier: VERIFIER });
    expect(!result.ok && result.reason).toBe('ssh-keygen could not sign: agent refused');
    expect(read(dir, 'scenarios/S1.yaml')).toBe(before);
  });
});

describe('signOff', () => {
  it('S9-A2 when all gate checks pass, appends who, when and a rule-3 hash for each story (T62)', () => {
    const dir = approvedEpic();
    writeFileSync(join(dir, 'signoff.yaml'), '# Append only.\nsignOffs:\n  - { by: old@b.c, at: "2026-11-01T00:00:00Z", storyHashes: {} }\n');
    const result = signOff(dir, ['S2', 'S1'], ME, { now: NOW, ...SIGNED });
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
      hashRule: 3,
      storyHashes: { S1: expect.stringMatching(/^sha256:[0-9a-f]{64}$/), S2: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) },
      sig: expect.stringMatching(SIG),
    });
    expect(verify(signOffPayload('2026-11-05-shop', log.signOffs[1]), log.signOffs[1].sig, 'a@b.c', ALLOWED_SIGNERS, KEYGEN).status).toBe('valid');
    expect(validateEpic(dir).ok).toBe(true);
    expect(detectStale(loadEpic(dir).record)).toMatchObject({ epicStatus: 'signed', staleStories: [] });
  });

  it('S9-A1 with a simulator error left, the sign-off fails, lists the error and writes nothing', () => {
    const dir = approvedEpic();
    const error = { kind: 'contract' as const, file: 'flow.yaml', path: 'pay', message: 'orderId: string → number', refs: [] };
    const result = signOff(dir, ['S1'], ME, { ...SIGNED, simulate: () => ({ command: 'simulate', ok: false, findings: [error] }) });
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
    const result = signOff(dir, ['S1'], ME, { now: NOW, ...SIGNED });
    expect(result.ok && Object.keys(result.signOff.storyHashes)).toEqual(['S1']);
    expect(detectStale(loadEpic(dir).record)).toMatchObject({ staleStories: ['S2'], epicStatus: 'partly-stale' });
  });

  it('a stale scenario of the story blocks its sign-off', () => {
    const dir = approvedEpic();
    editYaml(dir, 'scenarios/S1.yaml', (doc) => doc.setIn(['scenarios', 1, 'title'], 'changed'));
    const result = signOff(dir, ['S1'], ME, SIGNED);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.findings.map((f) => f.path)).toEqual(['S1-empty']);
    expect(signOff(dir, ['S2'], ME, SIGNED).ok).toBe(true);
  });

  it('S9-A1 an approval without a valid signature blocks the sign-off of its story only', () => {
    const dir = approvedEpic();
    editYaml(dir, 'scenarios/S1.yaml', (doc) => doc.deleteIn(['scenarios', 0, 'approval', 'sig']));
    const result = signOff(dir, ['S1'], ME, SIGNED);
    expect(!result.ok && result.findings).toEqual([
      {
        kind: 'gate',
        file: 'scenarios/S1.yaml',
        path: 'S1-buy',
        message: 'approval of S1-buy by a@b.c is not evidence: sigStatus missing: no signature; approve it again in the UI',
        refs: ['S1'],
      },
    ]);
    expect(signOff(dir, ['S2'], ME, SIGNED).ok).toBe(true);
  });

  it('S9-A2 with no signing key, sign-off fails with a clear reason and writes nothing', () => {
    const dir = approvedEpic();
    const result = signOff(dir, ['S1', 'S2'], ME, { verifier: VERIFIER });
    expect(!result.ok && result.reason).toMatch(/^no signing key/);
    expect(() => read(dir, 'signoff.yaml')).toThrow();
  });

  it('fails on an unknown story and on a missing identity', () => {
    const dir = approvedEpic();
    const result = signOff(dir, ['S7'], { by: '' }, SIGNED);
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
