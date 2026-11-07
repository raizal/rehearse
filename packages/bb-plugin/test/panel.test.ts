import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_EPICS, frameSrc, parseSubPath, RENEW_EVERY_MS, startServe, subPathForChoice, subPathOf, switcherOptions, type LeaseCalls } from '../src/panel.js';

describe('EPIC switcher', () => {
  it('lists every EPIC from the epics RPC, then "All EPICs…"', () => {
    expect(switcherOptions(['a', 'b', 'c'], 'b')).toEqual([
      { value: 'a', label: 'a' },
      { value: 'b', label: 'b' },
      { value: 'c', label: 'c' },
      { value: ALL_EPICS, label: 'All EPICs…' },
    ]);
  });
  it('keeps the open EPIC in the menu while the list loads or when it lacks it', () => {
    expect(switcherOptions(null, 'b').map((o) => o.value)).toEqual(['b', ALL_EPICS]);
    expect(switcherOptions(['a'], 'b').map((o) => o.value)).toEqual(['b', 'a', ALL_EPICS]);
  });
  it('picking an EPIC navigates to its slug', () => {
    expect(subPathForChoice('p1', 'c')).toBe('p1/c');
    expect(parseSubPath(subPathForChoice('p1', 'c'))).toEqual({ projectId: 'p1', slug: 'c' });
  });
  it('"All EPICs…" navigates to the picker (no slug)', () => {
    expect(subPathForChoice('p1', ALL_EPICS)).toBe('p1');
    expect(parseSubPath(subPathForChoice('p1', ALL_EPICS))).toEqual({ projectId: 'p1', slug: null });
  });
});

describe('startServe: the lease follows the open EPIC', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function fakeCalls() {
    const log: string[] = [];
    let next = 0;
    const calls: LeaseCalls = {
      open: async ({ slug }) => {
        const leaseId = `lease-${++next}-${slug}`;
        log.push(`open ${slug} -> ${leaseId}`);
        return { leaseId, url: null, localUrl: `http://127.0.0.1:1/${slug}`, remoteError: null, sshAgent: true };
      },
      renew: async ({ leaseId }) => {
        log.push(`renew ${leaseId}`);
        return { alive: true };
      },
      release: async ({ leaseId }) => {
        log.push(`release ${leaseId}`);
        return { stopped: true };
      },
    };
    return { calls, log };
  }
  const on = { session: () => undefined, error: () => undefined };

  it('releases the old EPIC lease when the slug changes, and renews only the new one', async () => {
    const { calls, log } = fakeCalls();
    const sessions: string[] = [];
    const stopA = startServe(calls, { projectId: 'p', slug: 'a', local: true }, { ...on, session: (s) => sessions.push(s.src ?? '') });
    await vi.advanceTimersByTimeAsync(0);
    expect(sessions).toEqual(['http://127.0.0.1:1/a']);

    // The panel switches EPIC: the effect cleanup stops a, then b starts.
    stopA();
    const stopB = startServe(calls, { projectId: 'p', slug: 'b', local: true }, on);
    await vi.advanceTimersByTimeAsync(RENEW_EVERY_MS);
    expect(log).toEqual(['open a -> lease-1-a', 'release lease-1-a', 'open b -> lease-2-b', 'renew lease-2-b']);

    stopB();
    await vi.advanceTimersByTimeAsync(0);
    expect(log.at(-1)).toBe('release lease-2-b');
  });

  it('releases a lease that arrives after the slug already changed', async () => {
    const { calls, log } = fakeCalls();
    const sessions: string[] = [];
    const stop = startServe(calls, { projectId: 'p', slug: 'a', local: true }, { ...on, session: (s) => sessions.push(s.leaseId) });
    stop(); // switched away before open answered
    await vi.advanceTimersByTimeAsync(RENEW_EVERY_MS);
    expect(log).toEqual(['open a -> lease-1-a', 'release lease-1-a']);
    expect(sessions).toEqual([]);
  });
});

describe('the Status page from the EPIC picker (T58)', () => {
  it('the route <project>/<slug>/status opens the EPIC on its Status page, and back', () => {
    expect(parseSubPath('p1/2026-11-05-shop/status')).toEqual({ projectId: 'p1', slug: '2026-11-05-shop', view: 'status' });
    expect(parseSubPath('p1/2026-11-05-shop/other')).toEqual({ projectId: 'p1', slug: '2026-11-05-shop' });
    expect(parseSubPath('p1')).toEqual({ projectId: 'p1', slug: null });
    expect(subPathOf({ projectId: 'p1', slug: '2026-11-05-shop', view: 'status' })).toBe('p1/2026-11-05-shop/status');
    expect(subPathOf({ projectId: 'p1', slug: '2026-11-05-shop' })).toBe('p1/2026-11-05-shop');
  });
  it('the serve frame opens on #/status, replacing any hash', () => {
    expect(frameSrc('http://127.0.0.1:4100/?t=1', 'status')).toBe('http://127.0.0.1:4100/?t=1#/status');
    expect(frameSrc('http://127.0.0.1:4100/#/prd', 'status')).toBe('http://127.0.0.1:4100/#/status');
    expect(frameSrc('http://127.0.0.1:4100/#/prd', undefined)).toBe('http://127.0.0.1:4100/#/prd');
  });
});
