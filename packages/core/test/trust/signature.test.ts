// SSH signatures on approvals and sign-offs (D41, R13, R14), with throwaway keys only.

import { execFileSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  allowedSignersPath,
  approvalPayload,
  checkSignatures,
  gateEpic,
  gitSigner,
  loadEpic,
  parseKeyRef,
  reportToJson,
  simulateEpic,
  sign,
  signersToText,
  signOff,
  signOffPayload,
  sshVerifier,
  verify,
  type SshKeygen,
} from '../../src/index.js';
import { editYaml, ME, NOW, SIGNED, approvedEpic, signedEpic } from './helpers.js';
import { ALLOWED_SIGNERS, allowedLine, inRepo, KEY, KEYGEN, STRANGER, VERIFIER } from './keys.js';
import { makeEpic } from '../helpers.js';

const PAYLOAD = approvalPayload('e', 'S1-buy', { by: 'a@b.c', at: '2026-11-05T10:00:00Z', hash: 'sha256:00' });

describe('payloads', () => {
  it('R13 an approval signs epic, scenario, hash, by, threadId and at, as canonical JSON', () => {
    expect(PAYLOAD).toBe('{"at":"2026-11-05T10:00:00Z","by":"a@b.c","epic":"e","hash":"sha256:00","kind":"approval","scenario":"S1-buy"}');
    expect(approvalPayload('e', 'S1-buy', { by: 'a@b.c', threadId: 't', at: 'x', hash: 'h' })).toContain('"threadId":"t"');
  });

  it('R14 a sign-off signs epic, storyHashes, hashRule, by and at; a missing hashRule is rule 1', () => {
    expect(signOffPayload('e', { by: 'a@b.c', at: 'x', storyHashes: { S2: 'h2', S1: 'h1' } })).toBe(
      '{"at":"x","by":"a@b.c","epic":"e","hashRule":1,"kind":"sign-off","storyHashes":{"S1":"h1","S2":"h2"}}',
    );
  });
});

describe('sign and verify (ssh-keygen -Y, namespace rehearse)', () => {
  const sig = sign(PAYLOAD, { file: KEY.file }, KEYGEN);

  it('R13 a signature by a listed key is valid and gives the key fingerprint', () => {
    expect(sig.startsWith('-----BEGIN SSH SIGNATURE-----\n')).toBe(true);
    expect(verify(PAYLOAD, sig, 'a@b.c', ALLOWED_SIGNERS, KEYGEN)).toEqual({ status: 'valid', fingerprint: KEY.signer.keyFingerprint });
    expect(KEY.signer.keyFingerprint).toMatch(/^SHA256:/);
  });

  it('R13 no signature is missing', () => {
    expect(verify(PAYLOAD, undefined, 'a@b.c', ALLOWED_SIGNERS, KEYGEN)).toEqual({ status: 'missing' });
    expect(verify(PAYLOAD, '', 'a@b.c', ALLOWED_SIGNERS, KEYGEN)).toEqual({ status: 'missing' });
  });

  it('R13 a changed payload or a garbled signature is invalid', () => {
    expect(verify(PAYLOAD.replace('S1-buy', 'S1-empty'), sig, 'a@b.c', ALLOWED_SIGNERS, KEYGEN).status).toBe('invalid');
    expect(verify(PAYLOAD, '-----BEGIN SSH SIGNATURE-----\nAAAA\n-----END SSH SIGNATURE-----\n', 'a@b.c', ALLOWED_SIGNERS, KEYGEN).status).toBe('invalid');
  });

  it('R13 a good signature by an unlisted key, or for another email, is unknown-signer', () => {
    const other = sign(PAYLOAD, { file: STRANGER.file }, KEYGEN);
    expect(verify(PAYLOAD, other, 'a@b.c', ALLOWED_SIGNERS, KEYGEN)).toEqual({ status: 'unknown-signer', fingerprint: STRANGER.signer.keyFingerprint });
    expect(verify(PAYLOAD, sig, 'x@y.z', ALLOWED_SIGNERS, KEYGEN).status).toBe('unknown-signer');
    expect(verify(PAYLOAD, sig, 'a@b.c', join(tmpdir(), 'no-such-allowed-signers'), KEYGEN).status).toBe('unknown-signer');
    expect(verify(PAYLOAD, sig, 'a@b.c', undefined, KEYGEN).status).toBe('unknown-signer');
  });

  it('R13 a signature in another namespace (a git commit signature) is invalid', () => {
    const git = execFileSync('ssh-keygen', ['-Y', 'sign', '-n', 'git', '-f', KEY.file], { input: PAYLOAD, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    expect(verify(PAYLOAD, git, 'a@b.c', ALLOWED_SIGNERS, KEYGEN).status).toBe('invalid');
  });

  it('signs with a .pub path when the private key is next to it', () => {
    const s = sign(PAYLOAD, { file: `${KEY.file}.pub` }, KEYGEN);
    expect(verify(PAYLOAD, s, 'a@b.c', ALLOWED_SIGNERS, KEYGEN).status).toBe('valid');
  });

  it('a literal key signs through the ssh-agent (-U), like git', () => {
    const calls: string[][] = [];
    const fake: SshKeygen = { run: (args) => (calls.push(args), { status: 0, stdout: '-----BEGIN SSH SIGNATURE-----\nx\n-----END SSH SIGNATURE-----\n', stderr: '' }) };
    sign(PAYLOAD, parseKeyRef(`key::${KEY.pub}`), fake);
    expect(calls[0]!.slice(0, 4)).toEqual(['-Y', 'sign', '-n', 'rehearse']);
    expect(calls[0]!.at(-1)).toBe('-U');
  });

  it('a signing error from ssh-keygen is a SigningError with its reason', () => {
    const fake: SshKeygen = { run: () => ({ status: 255, stdout: '', stderr: 'Signing data on standard input\nagent refused operation\n' }) };
    expect(() => sign(PAYLOAD, { file: KEY.file }, fake)).toThrow('ssh-keygen could not sign: agent refused operation');
  });
});

describe('signing key from git config', () => {
  it('parses user.signingkey as git does: key:: literal, bare ssh- literal, ~ path, file', () => {
    expect(parseKeyRef('key::ssh-ed25519 AAAA c')).toEqual({ literal: 'ssh-ed25519 AAAA c' });
    expect(parseKeyRef('ssh-ed25519 AAAA c')).toEqual({ literal: 'ssh-ed25519 AAAA c' });
    expect(parseKeyRef('~/.ssh/id.pub')).toEqual({ file: join(homedir(), '.ssh/id.pub') });
    expect(parseKeyRef('/k/id')).toEqual({ file: '/k/id' });
  });

  function repo(config: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'rehearse-git-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    for (const [k, v] of Object.entries(config)) execFileSync('git', ['config', k, v], { cwd: dir });
    return dir;
  }

  it('R13 gpg.format ssh and user.signingkey give a signer with the key fingerprint', () => {
    const r = gitSigner(repo({ 'gpg.format': 'ssh', 'user.signingkey': KEY.file }), KEYGEN);
    expect(r.ok && r.signer.keyFingerprint).toBe(KEY.signer.keyFingerprint);
    const lit = gitSigner(repo({ 'gpg.format': 'ssh', 'user.signingkey': `key::${KEY.pub}` }), KEYGEN);
    expect(lit.ok && lit.signer.keyFingerprint).toBe(KEY.signer.keyFingerprint);
  });

  it('R13 no key, another gpg.format or a missing key file is not usable, with a reason', () => {
    expect(gitSigner(repo({ 'gpg.format': 'ssh', 'user.signingkey': '' }), KEYGEN)).toEqual({ ok: false, reason: 'git user.signingkey is not set (see docs/signing.md)' });
    expect(gitSigner(repo({ 'gpg.format': 'openpgp', 'user.signingkey': KEY.file }), KEYGEN)).toEqual({ ok: false, reason: 'git gpg.format is not ssh (see docs/signing.md)' });
    const missing = gitSigner(repo({ 'gpg.format': 'ssh', 'user.signingkey': '/no/such/key' }), KEYGEN);
    expect(missing).toEqual({ ok: false, reason: 'signing key file /no/such/key does not exist' });
  });

  it('allowed_signers is <git top-level>/.rehearse/allowed_signers; none outside a repo', () => {
    const dir = inRepo(makeEpic());
    expect(allowedSignersPath(dir)).toMatch(/\/\.rehearse\/allowed_signers$/);
    expect(allowedSignersPath(mkdtempSync(join(tmpdir(), 'rehearse-norepo-')))).toBeUndefined();
  });
});

describe('gate: only signed evidence counts (D41)', () => {
  it('S6-A3 an approval with no valid signature is not evidence: a gate finding names the scenario and the status', () => {
    const dir = approvedEpic();
    editYaml(dir, 'scenarios/S1.yaml', (doc) => doc.setIn(['scenarios', 1, 'approval', 'at'], '2026-11-06T00:00:00Z'));
    editYaml(dir, 'scenarios/S2.yaml', (doc) => doc.deleteIn(['scenarios', 0, 'approval', 'sig']));
    const report = gateEpic(dir);
    expect(report.ok).toBe(false);
    expect(report.findings.map((f) => `${f.kind} ${f.file} ${f.path}: ${f.message}`)).toEqual([
      'gate scenarios/S1.yaml S1-empty: approval of S1-empty by a@b.c is not evidence: sigStatus invalid: the signature does not match; approve it again in the UI',
      'gate scenarios/S2.yaml S2-out-of-stock: approval of S2-out-of-stock by a@b.c is not evidence: sigStatus missing: no signature; approve it again in the UI',
    ]);
  });

  it('S6-A3 an approval signed by a key that allowed_signers does not list is unknown-signer, with its key', () => {
    const dir = approvedEpic();
    // A key an agent added for another email does not vouch for a@b.c.
    writeFileSync(join(dir, '..', '.rehearse', 'allowed_signers'), allowedLine('agent@x.y', KEY));
    const f = gateEpic(dir).findings[0]!;
    expect(f.message).toBe(`approval of S1-buy by a@b.c is not evidence: sigStatus unknown-signer: the key is not in .rehearse/allowed_signers for this email (key ${KEY.signer.keyFingerprint}); approve it again in the UI`);
  });

  it('S9-A2 a sign-off counts only with a valid signature; a new signed sign-off clears it', () => {
    const dir = signedEpic();
    expect(gateEpic(dir).ok).toBe(true);
    editYaml(dir, 'signoff.yaml', (doc) => doc.deleteIn(['signOffs', 0, 'sig']));
    const report = gateEpic(dir);
    expect(report.findings.map((f) => `${f.file} ${f.path}: ${f.message}`)).toEqual([
      'signoff.yaml S1: sign-off 0 by a@b.c is not trusted: sigStatus missing: no signature; must be signed again',
      'signoff.yaml S2: sign-off 0 by a@b.c is not trusted: sigStatus missing: no signature; must be signed again',
    ]);
    expect(signOff(dir, ['S1', 'S2'], ME, { now: NOW, ...SIGNED }).ok).toBe(true);
    expect(gateEpic(dir).ok).toBe(true);
  });

  it('the gate report lists each signer with its key fingerprint', () => {
    const dir = signedEpic();
    const report = gateEpic(dir);
    expect(report.signers).toEqual([
      { by: 'a@b.c', fingerprint: KEY.signer.keyFingerprint, approvals: ['S1-buy', 'S1-empty', 'S2-out-of-stock'], signOffs: [0] },
    ]);
    expect(signersToText(report.signers)).toContain(`  a@b.c ${KEY.signer.keyFingerprint}: 3 approvals, 1 sign-off`);
    expect(signersToText([])).toBe('signers: none\n');
  });

  it('checkSignatures gives the status and signer of every approval and sign-off', () => {
    const dir = signedEpic();
    const sigs = checkSignatures(loadEpic(dir).record, VERIFIER);
    expect(sigs.approvals.map((a) => [a.scenario, a.sigStatus, a.signer])).toEqual([
      ['S1-buy', 'valid', KEY.signer.keyFingerprint],
      ['S1-empty', 'valid', KEY.signer.keyFingerprint],
      ['S2-out-of-stock', 'valid', KEY.signer.keyFingerprint],
    ]);
    expect(sigs.signOffs).toEqual([{ index: 0, by: 'a@b.c', at: '2026-11-05T10:00:00Z', stories: ['S1', 'S2'], sigStatus: 'valid', signer: KEY.signer.keyFingerprint }]);
    const strangers = checkSignatures(loadEpic(dir).record, sshVerifier(join(tmpdir(), 'none'), KEYGEN));
    expect(new Set(strangers.approvals.map((a) => a.sigStatus))).toEqual(new Set(['unknown-signer']));
  });

  it('simulate is unchanged: an unsigned approval still simulates (design, not trust)', () => {
    const dir = approvedEpic();
    const signed = reportToJson(simulateEpic(dir));
    editYaml(dir, 'scenarios/S2.yaml', (doc) => doc.deleteIn(['scenarios', 0, 'approval', 'sig']));
    expect(reportToJson(simulateEpic(dir))).toBe(signed);
    expect(simulateEpic(dir).stale).toEqual([]);
  });
});
