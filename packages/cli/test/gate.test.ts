// `rehearse gate check` (R14, R19), the dogfood gate run on the first EPIC, and S6-A2.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { makeEpic, REAL_EPIC } from '../../core/test/helpers.js';
import { approvedEpic } from '../../core/test/trust/helpers.js';
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
    const dir = approvedEpic();
    const { code, out } = cli(['gate', 'check', dir]);
    expect(code).toBe(0);
    expect(out).toBe(
      'gate: OK, no findings\n' +
        'signers (check each key; a change to .rehearse/allowed_signers needs human review):\n' +
        `  a@b.c ${KEY.signer.keyFingerprint}: 3 approvals, 0 sign-offs\n`,
    );
    expect(JSON.parse(cli(['gate', 'check', dir, '--json']).out)).toEqual({
      command: 'gate',
      ok: true,
      findings: [],
      simulation: 'simulate',
      signers: [{ by: 'a@b.c', fingerprint: KEY.signer.keyFingerprint, approvals: ['S1-buy', 'S1-empty', 'S2-out-of-stock'], signOffs: [] }],
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

  it('dogfood: the first EPIC is not clean, the rule-1 bootstrap must be signed again; nothing is written', () => {
    const before = readFileSync(join(REAL_EPIC, 'signoff.yaml'), 'utf8');
    const { code, out } = cli(['gate', 'check', '2026-11-05-rehearse']);
    expect(code).toBe(1);
    // Each story is either stale (its rule-1 content changed) or still signed under rule 1 (C11).
    expect(out).toMatch(/signoff\.yaml: S\d+: gate: signed under hash rule 1, which does not cover boxes and lane roles \(C11\); must be signed again/);
    expect(out).toMatch(/gate: \d+ findings/);
    // D41: no bootstrap approval carries a signature, so none is evidence yet.
    expect(out.match(/is not evidence: sigStatus missing/g)?.length).toBeGreaterThan(0);
    expect(out).toContain('signers: none\n');
    const a = cli(['gate', 'check', '2026-11-05-rehearse', '--json']).out;
    expect(cli(['gate', 'check', '2026-11-05-rehearse', '--json']).out).toBe(a);
    expect(readFileSync(join(REAL_EPIC, 'signoff.yaml'), 'utf8')).toBe(before);
    expect(cli(['validate', '2026-11-05-rehearse']).code).toBe(0);
  });
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
