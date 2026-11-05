import { describe, expect, it } from 'vitest';
import { isLoopbackHost, parseSubPath, subPathOf } from '../src/panel.js';
import { cliTarget, projectRepo, sharedPortUrl } from '../src/targets.js';

describe('projectRepo', () => {
  it('uses the default source, else the first', () => {
    const a = { hostId: 'h1', path: '/a', isDefault: false };
    const b = { hostId: 'h2', path: '/b', isDefault: true };
    expect(projectRepo([a, b])).toEqual({ hostId: 'h2', path: '/b' });
    expect(projectRepo([a])).toEqual({ hostId: 'h1', path: '/a' });
    expect(projectRepo([])).toBeUndefined();
  });
});

describe('cliTarget', () => {
  const checkout = { hostId: 'h', path: '/w/repo' };
  it('runs in the caller cwd when it is inside the checkout', () => {
    expect(cliTarget(checkout, '/w/repo/docs')).toEqual({ hostId: 'h', path: '/w/repo/docs' });
    expect(cliTarget(checkout, '/w/repo')).toEqual(checkout);
  });
  it('runs at the checkout root otherwise', () => {
    expect(cliTarget(checkout, '/w/repo-other')).toEqual(checkout);
    expect(cliTarget(checkout, '/tmp')).toEqual(checkout);
    expect(cliTarget(checkout, undefined)).toEqual(checkout);
  });
});

describe('panel route', () => {
  it('reads and writes <projectId>/<slug>', () => {
    expect(parseSubPath('')).toEqual({ projectId: null, slug: null });
    expect(parseSubPath('p1')).toEqual({ projectId: 'p1', slug: null });
    expect(parseSubPath('p1/2026-11-05-x/')).toEqual({ projectId: 'p1', slug: '2026-11-05-x' });
    expect(subPathOf({ projectId: 'p1', slug: 's' })).toBe('p1/s');
    expect(subPathOf({ projectId: 'p1', slug: null })).toBe('p1');
    expect(subPathOf({ projectId: null, slug: 's' })).toBe('');
  });
});

describe('panel URL', () => {
  it('opens 127.0.0.1 directly only for a browser on the same machine', () => {
    for (const h of ['localhost', '127.0.0.1', '[::1]']) expect(isLoopbackHost(h)).toBe(true);
    expect(isLoopbackHost('raizal-se.getbb.app')).toBe(false);
  });
  it('builds the bb connect address of the serve port for a remote browser', () => {
    expect(sharedPortUrl({ label: 'raizal-se', baseDomain: 'getbb.app' }, 41234)).toBe('https://raizal-se--41234.getbb.app/');
  });
});
