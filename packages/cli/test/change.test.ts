// Box `change-new` (T62): `rehearse change new <epic> <story> --title "…"` writes the start file
// of a small change. The start file validates. Its error exits change no file.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseYaml } from '@rehearse/core';
import { makeEpic } from '../../core/test/helpers.js';
import { run } from '../src/index.js';

function cli(args: string[], cwd: string): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const code = run(args, { cwd, stdout: (t) => (out += t), stderr: (t) => (err += t) });
  return { code, out, err };
}

describe('rehearse change new (T62, box change-new)', () => {
  it('writes changes/C1.yaml with one criterion and one draft scenario; the EPIC still validates', () => {
    const dir = makeEpic();
    const r = cli(['change', 'new', dir, 'S1', '--title', 'The buyer sees the total before payment.'], dir);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Created changes/C1.yaml (change C1 to story S1).');
    const doc = parseYaml(readFileSync(join(dir, 'changes/C1.yaml'), 'utf8'), 'C1.yaml').value as any;
    expect(doc).toMatchObject({ id: 'C1', story: 'S1', title: 'The buyer sees the total before payment.' });
    expect(doc.criteria).toHaveLength(1);
    expect(doc.scenarios).toHaveLength(1);
    expect(doc.scenarios[0].status).toBe('draft');
    expect(cli(['validate', dir], dir).code).toBe(0);
  });

  it('gives the next number: a second change is C2', () => {
    const dir = makeEpic();
    expect(cli(['change', 'new', dir, 'S1', '--title', 'First change.'], dir).code).toBe(0);
    const r = cli(['change', 'new', dir, 'S1', '--title', 'Second change.'], dir);
    expect(r.code).toBe(0);
    expect(existsSync(join(dir, 'changes/C2.yaml'))).toBe(true);
  });

  it('an unknown story is a finding (exit 1) and writes no file', () => {
    const dir = makeEpic();
    const r = cli(['change', 'new', dir, 'S9', '--title', 'A change.'], dir);
    expect(r.code).toBe(1);
    expect(r.err).toContain('unknown-story');
    expect(existsSync(join(dir, 'changes'))).toBe(false);
  });

  it('no title or no story is a usage error (exit 2)', () => {
    const dir = makeEpic();
    expect(cli(['change', 'new', dir, 'S1'], dir).code).toBe(2);
    expect(cli(['change', 'new', dir, '--title', 'A change.'], dir).code).toBe(2);
    expect(cli(['change', 'edit', dir, 'S1', '--title', 'A change.'], dir).code).toBe(2);
  });
});
