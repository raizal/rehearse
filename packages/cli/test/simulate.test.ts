// `rehearse simulate`: exit codes, text and --json output (S3, S7, S10-A1).

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { box, makeEpic } from '../../core/test/helpers.js';
import { makeApprovedEpic } from '../../core/test/simulate-helpers.js';
import { run, USAGE } from '../src/index.js';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));

/** Hash of every file under `dir` (names and bytes). */
function hashDir(dir: string): string {
  const h = createHash('sha256');
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else h.update(`${p}\n`).update(readFileSync(p));
    }
  };
  walk(dir);
  return h.digest('hex');
}

function cli(args: string[], cwd = REPO): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const code = run(args, { cwd, stdout: (t) => (out += t), stderr: (t) => (err += t) });
  return { code, out, err };
}

describe('rehearse simulate', () => {
  it('a clean record gives exit 0 and OK', () => {
    const { code, out } = cli(['simulate', makeApprovedEpic()]);
    expect(code).toBe(0);
    expect(out).toBe('simulate: OK, no findings\n');
  });

  it('S3-A1 the text report names a → b and the field, exit 1', () => {
    const { code, out } = cli(['simulate', makeApprovedEpic((d) => (box(d, 'pay').inputs = { orderId: 'number' }))]);
    expect(code).toBe(1);
    expect(out).toContain('flow.yaml: cart: contract: cart → pay: field orderId: cart gives string, pay needs number');
    expect(out).toMatch(/simulate: 2 findings\n$/);
  });

  it('S10-A1 with one simulator error, --json gives exit 1 and lists the error', () => {
    const dir = makeApprovedEpic(undefined, (d) => (d['scenarios/S2.yaml'].scenarios[0].status = 'draft'));
    const { code, out } = cli(['simulate', dir, '--json']);
    expect(code).toBe(1);
    const json = JSON.parse(out);
    expect(json.command).toBe('simulate');
    expect(json.ok).toBe(false);
    expect(json.findings.filter((f: any) => f.kind === 'coverage')).toEqual([
      {
        kind: 'coverage',
        file: 'flow.yaml',
        path: 'in-stock',
        message: 'branch no of decision in-stock (to failed): no approved scenario takes it',
        refs: [],
      },
    ]);
  });

  it('S3-A5 --json is byte-identical on two runs', () => {
    const dir = makeApprovedEpic((d) => (box(d, 'pay').inputs = { orderId: 'number' }));
    expect(cli(['simulate', dir, '--json']).out).toBe(cli(['simulate', dir, '--json']).out);
  });

  it('S7-A1 --json has the permission matrix and the box of each cell', () => {
    const json = JSON.parse(cli(['simulate', makeApprovedEpic(), '--json']).out);
    expect(json.permissionMatrix.buyer.Order).toContain('write');
    expect(json.permissionBoxes.buyer.Order.write).toEqual(['cart']);
  });

  it('S6-A3 a stale scenario is shown as information, not as a finding', () => {
    const dir = makeApprovedEpic(undefined, (d) => (d['scenarios/S1.yaml'].scenarios[1].title = 'Edited'));
    const { code, out } = cli(['simulate', dir]);
    expect(code).toBe(1); // the empty-cart exit is no longer covered
    expect(out).toContain('scenarios/S1.yaml: S1-empty: stale, not evidence: content changed after approval');
    expect(out).toContain('(1 stale scenario not used)');
  });

  it('a record with validation findings is not simulated: exit 1 with the validation findings', () => {
    const { code, out } = cli(['simulate', makeApprovedEpic((d) => (box(d, 'pay').stories = ['S9'])), '--json']);
    expect(code).toBe(1);
    expect(JSON.parse(out).findings).toEqual([
      { kind: 'reference', file: 'flow.yaml', path: 'pay', message: 'story S9 unknown', refs: ['S9'] },
    ]);
  });

  it('usage errors give exit 2', () => {
    expect(cli(['simulate']).code).toBe(2);
    expect(cli(['simulate', 'a', 'b']).code).toBe(2);
    expect(cli(['simulate', makeApprovedEpic(), '--yaml']).code).toBe(2);
    expect(cli(['simulate', 'no-such-epic']).code).toBe(2);
    expect(USAGE).toContain('simulate <epic-dir-or-slug> [--drafts] [--json]');
  });

  it('dogfood: the slug of the real record resolves and simulates', () => {
    const { code, out } = cli(['simulate', '2026-11-05-rehearse']);
    expect([0, 1]).toContain(code);
    expect(out).toMatch(/simulate: /);
    expect(cli(['validate', '2026-11-05-rehearse']).out).toBe('validate: OK, no findings\n');
  });
});

describe('rehearse simulate --drafts (T22)', () => {
  it('a draft with a contract error: a finding with --drafts (exit 1), none in plain simulate', () => {
    const dir = makeEpic({ edit: (d) => (box(d, 'pay').inputs = { orderId: 'number' }) });
    expect(cli(['simulate', dir]).out).not.toContain('contract');
    const { code, out } = cli(['simulate', dir, '--drafts']);
    expect(code).toBe(1);
    expect(out.split('\n')[0]).toBe('simulate --drafts: drafts counted for checks only; this is not evidence');
    expect(out).toContain('flow.yaml: cart: contract: cart → pay: field orderId: cart gives string, pay needs number in scenario S1-buy (draft)');
  });

  it('only drafts covering the flow is information: exit 0, while plain simulate gives exit 1', () => {
    const dir = makeEpic();
    expect(cli(['simulate', dir]).code).toBe(1);
    const { code, out } = cli(['simulate', dir, '--drafts']);
    expect(code).toBe(0);
    expect(out).toContain('criterion S2-A1: covered only by drafts (S2-out-of-stock: draft)');
    expect(out).not.toContain('no approved scenario');
  });

  it('--json has mode "drafts" and the notice; plain --json has no mode', () => {
    const dir = makeEpic();
    const json = JSON.parse(cli(['simulate', dir, '--drafts', '--json']).out);
    expect(json.mode).toBe('drafts');
    expect(json.notice).toBe('drafts counted for checks only; this is not evidence');
    expect(json.draftOnly).toHaveLength(5);
    expect(JSON.parse(cli(['simulate', dir, '--json']).out).mode).toBeUndefined();
  });

  it('never changes a file or the gate result', () => {
    const dir = makeEpic({ edit: (d) => (box(d, 'pay').inputs = { orderId: 'number' }) });
    const before = hashDir(dir);
    const gate = cli(['gate', 'check', dir, '--json']);
    cli(['simulate', dir, '--drafts']);
    cli(['simulate', dir, '--drafts', '--json']);
    expect(hashDir(dir)).toBe(before);
    expect(cli(['gate', 'check', dir, '--json'])).toEqual(gate);
  });

  it('help lists the flag', () => {
    expect(USAGE).toContain('simulate <epic-dir-or-slug> [--drafts] [--json]');
    expect(USAGE).toContain('--drafts');
    expect(cli(['simulate', makeEpic(), '--draft']).code).toBe(2);
  });
});
