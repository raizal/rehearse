// `rehearse gate check` (R14, R19), the dogfood gate run on the first EPIC, and S6-A2.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hashDir, liveAllowedSigners, makeEpic, PRESIGNOFF_EPIC, REAL_EPIC, unsignedRealEpic, waitingStories } from '../../core/test/helpers.js';
import { signedEpic } from '../../core/test/trust/helpers.js';
import { KEY } from '../../core/test/trust/keys.js';
import { run, USAGE } from '../src/index.js';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));

function cli(args: string[], cwd = REPO): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const code = run(args, { cwd, stdout: (t) => (out += t), stderr: (t) => (err += t) });
  return { code, out, err };
}

describe('rehearse gate check', () => {
  it('exit 0 on a signed, approved, valid record that simulates clean; it shows each signer key', () => {
    const dir = signedEpic();
    const { code, out } = cli(['gate', 'check', dir]);
    expect(code).toBe(0);
    expect(out).toBe(
      'gate: OK, no findings\n' +
        'signers (check each key; a change to .rehearse/allowed_signers needs human review):\n' +
        `  a@b.c ${KEY.signer.keyFingerprint}: 3 approvals, 1 sign-off\n`,
    );
    expect(JSON.parse(cli(['gate', 'check', dir, '--json']).out)).toEqual({
      command: 'gate',
      ok: true,
      findings: [],
      simulation: 'simulate',
      signers: [{ by: 'a@b.c', fingerprint: KEY.signer.keyFingerprint, approvals: ['S1-buy', 'S1-empty', 'S2-out-of-stock'], signOffs: [0] }],
    });
  });

  it('exit 1 with findings on a draft record', () => {
    const { code, out } = cli(['gate', 'check', makeEpic()]);
    expect(code).toBe(1);
    expect(out).toContain('prd.yaml: S1: gate: S1 has no approved scenario that is not stale');
  });

  it('exit 2 on a usage error', () => {
    expect(cli(['gate']).code).toBe(2);
    expect(cli(['gate', 'sign', REAL_EPIC]).code).toBe(2);
    expect(cli(['gate', 'check']).code).toBe(2);
    expect(cli(['gate', 'check', 'no-such-epic']).code).toBe(2);
  });

  it('dogfood: the first EPIC is not clean, each story must be signed again; nothing is written', () => {
    // A copy of the first EPIC with every signature removed, so the test does not depend on what the owner signed.
    const dir = unsignedRealEpic();
    const before = readFileSync(join(dir, 'signoff.yaml'), 'utf8');
    const { code, out } = cli(['gate', 'check', dir]);
    expect(code).toBe(1);
    // Each story is stale, signed under hash rule 1 (C11), or its latest sign-off has no valid signature (D41).
    const stories = [...readFileSync(join(dir, 'prd.yaml'), 'utf8').matchAll(/^ {2}- id: (S\d+)$/gm)].map((m) => m[1]!);
    expect(stories.length).toBeGreaterThan(0);
    // A new story that waits for the owner (T44's S11) was never signed off, so it is not signed again either.
    const waiting = waitingStories(dir);
    for (const s of stories) {
      const want = waiting.includes(s) ? `signoff\\.yaml: ${s}: gate: ${s} is not signed off` : `signoff\\.yaml: ${s}: gate: .*must be signed again`;
      expect(out, s).toMatch(new RegExp(want));
    }
    expect(out).toMatch(/gate: \d+ findings/);
    // D41: an approval without a signature is not evidence.
    expect(out.match(/is not evidence: sigStatus missing/g)?.length).toBeGreaterThan(0);
    expect(out).toContain('signers: none\n');
    const a = cli(['gate', 'check', dir, '--json']).out;
    expect(cli(['gate', 'check', dir, '--json']).out).toBe(a);
    expect(readFileSync(join(dir, 'signoff.yaml'), 'utf8')).toBe(before);
    // The first EPIC frozen before its sign-off: rule-1 sign-offs and stale stories; gate check writes nothing.
    const frozen = hashDir(PRESIGNOFF_EPIC);
    const old = cli(['gate', 'check', PRESIGNOFF_EPIC]);
    expect(old.code).toBe(1);
    expect(old.out).toMatch(/signoff\.yaml: S1: gate: story is stale: content changed since sign-off \(hash rule 1\); must be signed again/);
    expect(old.out).toMatch(/signoff\.yaml: S5: gate: signed under hash rule 1, which does not cover boxes and lane roles \(C11\); must be signed again/);
    expect(hashDir(PRESIGNOFF_EPIC)).toBe(frozen);
  });

  // The live record runs the gate and validate on 26 signed stories: this takes more than 5 s.
  it('dogfood: the live first EPIC passes the gate with the key list; nothing is written and validate passes', () => {
    const before = hashDir(REAL_EPIC);
    const { code, out } = cli(['gate', 'check', '2026-11-05-rehearse']);
    expect(hashDir(REAL_EPIC)).toBe(before);
    expect(cli(['validate', '2026-11-05-rehearse']).code).toBe(0);
    // A new story that waits for the owner (never signed, drafts only) has only its own findings; the rest is pinned.
    const waiting = waitingStories(REAL_EPIC);
    const json = JSON.parse(cli(['gate', 'check', '2026-11-05-rehearse', '--json']).out) as { findings: { kind: string; file: string; path: string; message: string; refs: string[] }[] };
    const ofWaiting = (f: { refs: string[] }) => f.refs.length > 0 && f.refs.every((r) => waiting.some((w) => r === w || r.startsWith(`${w}-`)));
    const others = json.findings.filter((f) => !ofWaiting(f)).map((f) => `${f.file}: ${f.path}: ${f.kind}: ${f.message}`);
    if (waiting.length > 0) expect(json.findings.some(ofWaiting)).toBe(true);
    // True without the key list: no story must be signed again for its content or hash rule, no approval lacks a signature.
    for (const f of others) expect(f).not.toMatch(/is stale: content changed|signed under hash rule 1|sigStatus missing|has no approved scenario/);
    if (liveAllowedSigners()) {
      // The owner's checkout: every signature is by a key that .rehearse/allowed_signers lists.
      expect(others, out).toEqual([]);
      expect(code, out).toBe(waiting.length > 0 ? 1 : 0);
      expect(out).toMatch(/\nsigners .*\n {2}\S+@\S+ SHA256:\S+: \d+ approvals, \d+ sign-offs\n/);
      if (waiting.length === 0) expect(out).toMatch(/^gate: OK, no findings\n/);
    } else {
      // No key list (a clean worktree): each finding is a good signature by a key not listed.
      expect(code).toBe(1);
      const findings = others.filter((l) => /: gate: /.test(l));
      expect(findings.length).toBeGreaterThan(0);
      for (const f of findings) expect(f).toMatch(/sigStatus unknown-signer/);
    }
  }, 30_000);
});

describe('story S6: the CLI cannot approve or sign off', () => {
  it('S6-A2 USAGE and the command dispatch have no approve and no sign-off command', () => {
    expect(USAGE).not.toMatch(/approve|sign-?off/i);
    for (const cmd of ['approve', 'sign-off', 'signoff', 'sign']) {
      const { code, err } = cli([cmd, REAL_EPIC]);
      expect(code, cmd).toBe(2);
      expect(err).toContain(`unknown command ${cmd}`);
    }
    for (const sub of ['approve', 'sign-off', 'sign']) expect(cli(['gate', sub, REAL_EPIC]).code, sub).toBe(2);
  });
});
