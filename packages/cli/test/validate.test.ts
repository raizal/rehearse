// Story S2: approved scenarios of docs/epics/2026-11-05-rehearse/scenarios/S2.yaml,
// plus the dogfood run on the real record (D24) and the determinism check (R18).

import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { box, makeEpic, REAL_EPIC, scenario } from '../../core/test/helpers.js';
import { run, USAGE } from '../src/index.js';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));

function cli(args: string[], cwd = REPO): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const code = run(args, { cwd, stdout: (t) => (out += t), stderr: (t) => (err += t) });
  return { code, out, err };
}

describe('story S2: validate tells the agent exactly what is wrong', () => {
  it('S2-missing-outputs (S2-A1): a box with no outputs names flow.yaml, the box path and the field', () => {
    const dir = makeEpic({ edit: (d) => delete box(d, 'pay').outputs });
    const { code, out } = cli(['validate', dir]);
    expect(code).toBe(1);
    expect(out).toContain('flow.yaml: pay: schema: missing field outputs');

    const json = JSON.parse(cli(['validate', dir, '--json']).out);
    expect(json.command).toBe('validate');
    expect(json.ok).toBe(false);
    expect(json.findings).toEqual([
      { kind: 'schema', file: 'flow.yaml', path: 'pay', message: 'missing field outputs (at root.boxes[2])', refs: [] },
    ]);
  });

  it('S2-unknown-story (S2-A2): a box that points to story S9 names the box path and S9', () => {
    const dir = makeEpic({ edit: (d) => (box(d, 'pay').stories = ['S9']) });
    const { code, out } = cli(['validate', dir]);
    expect(code).toBe(1);
    expect(out).toContain('flow.yaml: pay: reference: story S9 unknown');
    const json = JSON.parse(cli(['validate', dir, '--json']).out);
    expect(json.findings).toEqual([
      { kind: 'reference', file: 'flow.yaml', path: 'pay', message: 'story S9 unknown', refs: ['S9'] },
    ]);
  });

  it('S2-unknown-step (S2-A3): a step with an unknown box path names the scenario, the step and the path', () => {
    const dir = makeEpic({ edit: (d) => (scenario(d, 'S2-out-of-stock').steps[1].name = 'pay/nope') });
    const { code, out } = cli(['validate', dir]);
    expect(code).toBe(1);
    expect(out).toContain('scenarios/S2.yaml: S2-out-of-stock/step-2: reference: box path pay/nope unknown');
    const json = JSON.parse(cli(['validate', dir, '--json']).out);
    expect(json.findings).toEqual([
      {
        kind: 'reference',
        file: 'scenarios/S2.yaml',
        path: 'S2-out-of-stock/step-2',
        message: 'box path pay/nope unknown',
        refs: [],
      },
    ]);
  });

  it('S2-yaml-syntax: a record file that is not valid YAML gives a finding and exit code 1, not a crash', () => {
    const dir = makeEpic({ rawFiles: { 'flow.yaml': 'version: 1\nroot: { boxes: [ {id: a}\n' } });
    const { code, out, err } = cli(['validate', dir]);
    expect(code).toBe(1);
    expect(err).toBe('');
    expect(out).toMatch(/^flow\.yaml: line \d+: schema: yaml-syntax: /m);
  });
});

/** The report is OK: no findings, and each other line is an STE note on draft text (T60). */
function validateOk(out: string): boolean {
  const lines = out.trimEnd().split('\n');
  const last = lines.pop()!;
  return /^validate: OK, no findings( \(\d+ STE notes on draft text: information only\))?$/.test(last) && lines.every((l) => l.includes(': information: STE '));
}

describe('dogfood (D24)', () => {
  it('rehearse validate docs/epics/2026-11-05-rehearse exits 0 on the real record', () => {
    const { code, out } = cli(['validate', 'docs/epics/2026-11-05-rehearse']);
    expect(validateOk(out)).toBe(true);
    expect(code).toBe(0);
  });

  it('a slug resolves to docs/epics/<slug>, also from a subfolder', () => {
    const { code } = cli(['validate', '2026-11-05-rehearse', '--json'], `${REPO}/packages/cli`);
    expect(code).toBe(0);
    expect(REAL_EPIC.endsWith('docs/epics/2026-11-05-rehearse')).toBe(true);
  });
});

describe('report determinism (R18)', () => {
  it('two runs give byte-identical --json output', () => {
    const dir = makeEpic({
      edit: (d) => {
        delete box(d, 'pay').outputs;
        box(d, 'cart').stories = ['S9', 'S8'];
        scenario(d, 'S1-buy').steps[2].name = 'nope';
        d['flow.yaml'].root.edges.push({ from: 'done', to: 'pay' });
      },
    });
    const a = cli(['validate', dir, '--json']);
    const b = cli(['validate', dir, '--json']);
    expect(a.code).toBe(1);
    expect(JSON.parse(a.out).findings.length).toBeGreaterThan(3);
    expect(Buffer.from(a.out).equals(Buffer.from(b.out))).toBe(true);
  });

  it('the real record gives byte-identical --json output', () => {
    expect(cli(['validate', REAL_EPIC, '--json']).out).toBe(cli(['validate', REAL_EPIC, '--json']).out);
  });
});

describe('cli', () => {
  it('has no approve or sign-off command (R13, R14)', () => {
    expect(USAGE).not.toMatch(/approve|sign-?off/i);
    expect(cli(['approve', REAL_EPIC]).code).toBe(2);
    expect(cli(['sign-off', REAL_EPIC]).code).toBe(2);
  });

  it('gives exit code 2 for usage errors', () => {
    expect(cli([]).code).toBe(2);
    expect(cli(['validate']).code).toBe(2);
    expect(cli(['validate', 'no-such-epic']).err).toContain('no EPIC folder no-such-epic');
    expect(cli(['validate', REAL_EPIC, '--yaml']).code).toBe(2);
  });
});
