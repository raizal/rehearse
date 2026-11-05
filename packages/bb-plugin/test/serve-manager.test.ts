import { describe, expect, it } from 'vitest';
import { PortInUseError, ServeManager, type ServeProcess, type ServeTarget } from '../src/serve-manager.js';

interface Fake extends ServeProcess {
  stopped: boolean;
  crash(): void;
}

function setup(opts: { failPorts?: number[]; fail?: Error; ttl?: number } = {}) {
  let clock = 0;
  let nextPort = 5000;
  const started: Array<{ target: ServeTarget; port: number; proc: Fake }> = [];
  const counts: number[] = [];
  const manager = new ServeManager({
    pickPort: async () => nextPort++,
    leaseTtlMs: opts.ttl ?? 1000,
    now: () => clock,
    onCountChange: (n) => counts.push(n),
    start: async (target, port) => {
      if (opts.fail) throw opts.fail;
      if (opts.failPorts?.includes(port)) throw new PortInUseError(port);
      const listeners: Array<() => void> = [];
      const proc: Fake = {
        pid: 100 + started.length,
        port,
        url: `http://127.0.0.1:${port}/`,
        stopped: false,
        stop: async () => {
          proc.stopped = true;
        },
        onExit: (l) => listeners.push(l),
        crash: () => listeners.forEach((l) => l()),
      };
      started.push({ target, port, proc });
      return proc;
    },
  });
  return { manager, started, counts, tick: (ms: number) => (clock += ms) };
}

const target = { repoPath: '/repo', slug: 'epic', command: '' };

describe('ServeManager: process lifecycle', () => {
  it('starts one process and reuses it for the same repo and EPIC', async () => {
    const { manager, started } = setup();
    const a = await manager.open(target);
    const b = await manager.open({ ...target, command: 'other' });
    expect(started).toHaveLength(1);
    expect(a).toMatchObject({ port: 5000, url: 'http://127.0.0.1:5000/', reused: false });
    expect(b).toMatchObject({ port: 5000, reused: true });
    expect(a.leaseId).not.toBe(b.leaseId);
  });

  it('shares one start between concurrent opens', async () => {
    const { manager, started } = setup();
    const [a, b] = await Promise.all([manager.open(target), manager.open(target)]);
    expect(started).toHaveLength(1);
    expect(a.port).toBe(b.port);
  });

  it('starts one process per EPIC and per repo', async () => {
    const { manager, started } = setup();
    await manager.open(target);
    await manager.open({ ...target, slug: 'other' });
    await manager.open({ ...target, repoPath: '/repo2' });
    expect(started.map((s) => s.port)).toEqual([5000, 5001, 5002]);
  });

  it('stops the process when the last panel releases it', async () => {
    const { manager, started, counts } = setup();
    const a = await manager.open(target);
    const b = await manager.open(target);
    expect(await manager.release(a.leaseId)).toBe(false);
    expect(started[0]!.proc.stopped).toBe(false);
    expect(await manager.release(b.leaseId)).toBe(true);
    expect(started[0]!.proc.stopped).toBe(true);
    expect(manager.size).toBe(0);
    expect(counts.at(-1)).toBe(0);
    expect(await manager.release(b.leaseId)).toBe(false);
  });

  it('stops a process whose panels stopped renewing (closed tab, closed project)', async () => {
    const { manager, started, tick } = setup({ ttl: 1000 });
    const kept = await manager.open(target);
    const dropped = await manager.open({ ...target, slug: 'other' });
    tick(600);
    expect(manager.renew(kept.leaseId)).toBe(true);
    tick(600);
    expect(await manager.sweep()).toBe(1);
    expect(started[0]!.proc.stopped).toBe(false);
    expect(started[1]!.proc.stopped).toBe(true);
    expect(manager.renew(dropped.leaseId)).toBe(false);
    expect(manager.renew(kept.leaseId)).toBe(true);
  });

  it('forgets a process that exits on its own, so the next open starts a new one', async () => {
    const { manager, started } = setup();
    const a = await manager.open(target);
    started[0]!.proc.crash();
    expect(manager.renew(a.leaseId)).toBe(false);
    expect(manager.size).toBe(0);
    const b = await manager.open(target);
    expect(b.reused).toBe(false);
    expect(started).toHaveLength(2);
  });

  it('stops every process on stopAll (plugin reload or disable)', async () => {
    const { manager, started } = setup();
    await manager.open(target);
    await manager.open({ ...target, slug: 'other' });
    await manager.stopAll();
    expect(started.every((s) => s.proc.stopped)).toBe(true);
    expect(manager.status()).toEqual([]);
  });

  it('reports the running processes', async () => {
    const { manager } = setup();
    await manager.open(target);
    await manager.open(target);
    expect(manager.status()).toEqual([{ repoPath: '/repo', slug: 'epic', pid: 100, port: 5000, leases: 2 }]);
  });
});

describe('ServeManager: port choice', () => {
  it('tries a new port when the picked one was taken before serve listened', async () => {
    const { manager, started } = setup({ failPorts: [5000, 5001] });
    const opened = await manager.open(target);
    expect(opened.port).toBe(5002);
    expect(started).toHaveLength(1);
  });

  it('gives up after three taken ports', async () => {
    const { manager } = setup({ failPorts: [5000, 5001, 5002] });
    await expect(manager.open(target)).rejects.toBeInstanceOf(PortInUseError);
    expect(manager.size).toBe(0);
  });

  it('does not retry other start errors, and keeps no lease', async () => {
    const { manager } = setup({ fail: new Error('no rehearse') });
    await expect(manager.open(target)).rejects.toThrow('no rehearse');
    expect(manager.size).toBe(0);
    expect(manager.status()).toEqual([]);
  });
});
