import { describe, expect, it } from 'vitest';
import { isSlug, parseBbRehearse } from '../src/cli-args.js';

describe('parseBbRehearse: open', () => {
  it('opens the panel with no arguments', () => {
    expect(parseBbRehearse([])).toEqual({ kind: 'open', slug: null });
  });
  it('opens the panel for a slug', () => {
    expect(parseBbRehearse(['open', '2026-11-05-rehearse'])).toEqual({ kind: 'open', slug: '2026-11-05-rehearse' });
    expect(parseBbRehearse(['2026-11-05-rehearse'])).toEqual({ kind: 'open', slug: '2026-11-05-rehearse' });
  });
  it('rejects a path as slug', () => {
    expect(parseBbRehearse(['open', '../etc']).kind).toBe('usage');
    expect(parseBbRehearse(['open', 'a', 'b']).kind).toBe('usage');
  });
  it('shows help', () => {
    for (const h of ['--help', '-h', 'help']) expect(parseBbRehearse([h])).toEqual({ kind: 'help' });
  });
});

describe('parseBbRehearse: pass-through', () => {
  it.each([
    [['validate', 'docs/epics/x']],
    [['validate', 'x', '--json']],
    [['simulate', 'x', '--json']],
    [['gate', 'check', 'x']],
    [['new', 'x', '--title', 'X']],
    [['brief', 'x', 'S1']],
    [['brief', 'x', 'S1', '--json']],
    [['progress', 'x', 'S1', '--json']],
    [['status', 'x']],
    [['status', 'x', '--json', '--not-done']],
  ])('passes %j to the rehearse CLI unchanged', (argv) => {
    expect(parseBbRehearse(argv)).toEqual({ kind: 'pass', args: argv });
  });
  it('only passes gate check', () => {
    expect(parseBbRehearse(['gate', 'sign-off', 'x']).kind).toBe('usage');
    expect(parseBbRehearse(['gate']).kind).toBe('usage');
  });
});

describe('parseBbRehearse: no approve and no sign-off (R13, R14)', () => {
  it.each(['approve', 'sign-off', 'signoff', 'serve'])('refuses %s with exit 2', (command) => {
    const parsed = parseBbRehearse([command, 'x']);
    expect(parsed.kind).toBe('usage');
  });
  it('refuses unknown commands', () => {
    expect(parseBbRehearse(['frobnicate'])).toEqual({ kind: 'usage', message: 'bb rehearse: unknown command frobnicate' });
    expect(parseBbRehearse(['--json']).kind).toBe('usage');
  });
});

describe('isSlug', () => {
  it('accepts folder names and refuses paths and dot names', () => {
    expect(isSlug('2026-11-05-rehearse')).toBe(true);
    expect(isSlug('a.b_c')).toBe(true);
    for (const bad of ['', '.', '..', '.hidden', 'a/b', 'a\\b', 'x'.repeat(201)]) expect(isSlug(bad)).toBe(false);
  });
});
