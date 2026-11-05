// Lifecycle of the `rehearse serve` processes behind the bb panel.
//
// One process per (repo, EPIC): `rehearse serve` serves one EPIC folder. Each open
// panel holds a lease and renews it. When the last lease of a process is
// released or expires (the tab closed without saying so), the process stops.

import { randomUUID } from 'node:crypto';

export interface ServeProcess {
  pid: number | undefined;
  port: number;
  /** `http://127.0.0.1:<port>/` */
  url: string;
  /** Resolves when the process has exited. Safe to call more than once. */
  stop(): Promise<void>;
  /** Called once if the process exits on its own (crash, killed). */
  onExit(listener: () => void): void;
}

export interface ServeTarget {
  /** Absolute path of the repo checkout; `rehearse serve` runs there. */
  repoPath: string;
  slug: string;
  /** The `rehearseCommand` setting used to start the process. Not part of the process identity. */
  command?: string;
}

export type StartServe = (target: ServeTarget, port: number) => Promise<ServeProcess>;

export interface ServeManagerOptions {
  start: StartServe;
  pickPort: () => Promise<number>;
  /** A lease not renewed for this long expires. */
  leaseTtlMs: number;
  now?: () => number;
  /** Start attempts per open, each on a new port (another program may take the port first). */
  attempts?: number;
  /** Called after a process starts or stops, with the number still running. */
  onCountChange?: (running: number) => void;
}

export interface Opened {
  leaseId: string;
  port: number;
  url: string;
  reused: boolean;
}

export interface ServeStatus {
  repoPath: string;
  slug: string;
  pid: number | undefined;
  port: number;
  leases: number;
}

interface Entry {
  target: ServeTarget;
  pending: Promise<ServeProcess>;
  process: ServeProcess | undefined;
  leases: Map<string, number>;
}

export class ServeManager {
  private readonly entries = new Map<string, Entry>();
  private readonly leaseKeys = new Map<string, string>();
  private readonly now: () => number;

  constructor(private readonly opts: ServeManagerOptions) {
    this.now = opts.now ?? Date.now;
  }

  /** Start the process for the target, or reuse the running one, and take a lease on it. */
  async open(target: ServeTarget): Promise<Opened> {
    const key = keyOf(target);
    let entry = this.entries.get(key);
    const reused = entry !== undefined;
    if (!entry) {
      entry = { target, pending: this.startWithRetry(target), process: undefined, leases: new Map() };
      this.entries.set(key, entry);
      const created = entry;
      created.pending.then(
        (proc) => {
          created.process = proc;
          proc.onExit(() => this.forget(key, created));
          this.countChanged();
        },
        () => this.forget(key, created),
      );
    }
    const leaseId = randomUUID();
    entry.leases.set(leaseId, this.now());
    this.leaseKeys.set(leaseId, key);
    let proc: ServeProcess;
    try {
      proc = await entry.pending;
    } catch (e) {
      entry.leases.delete(leaseId);
      this.leaseKeys.delete(leaseId);
      throw e;
    }
    return { leaseId, port: proc.port, url: proc.url, reused };
  }

  /** Keep a lease alive. False when the lease or its process is gone: open again. */
  renew(leaseId: string): boolean {
    const entry = this.entryOf(leaseId);
    if (!entry) return false;
    entry.leases.set(leaseId, this.now());
    return true;
  }

  /** Drop a lease. Stops the process when it was the last one. True when a process stopped. */
  async release(leaseId: string): Promise<boolean> {
    const key = this.leaseKeys.get(leaseId);
    const entry = key === undefined ? undefined : this.entries.get(key);
    this.leaseKeys.delete(leaseId);
    if (key === undefined || !entry) return false;
    entry.leases.delete(leaseId);
    return this.stopIfUnused(key, entry);
  }

  /** Expire leases older than the TTL and stop processes left without a lease. */
  async sweep(): Promise<number> {
    const cutoff = this.now() - this.opts.leaseTtlMs;
    let stopped = 0;
    for (const [key, entry] of [...this.entries]) {
      for (const [leaseId, renewedAt] of [...entry.leases]) {
        if (renewedAt < cutoff) {
          entry.leases.delete(leaseId);
          this.leaseKeys.delete(leaseId);
        }
      }
      if (await this.stopIfUnused(key, entry)) stopped++;
    }
    return stopped;
  }

  /** Stop every process (plugin reload, disable, shutdown). */
  async stopAll(): Promise<void> {
    const entries = [...this.entries.values()];
    this.entries.clear();
    this.leaseKeys.clear();
    await Promise.all(entries.map((e) => e.pending.then((p) => p.stop(), () => undefined)));
    this.countChanged();
  }

  status(): ServeStatus[] {
    return [...this.entries.values()]
      .filter((e) => e.process !== undefined)
      .map((e) => ({ repoPath: e.target.repoPath, slug: e.target.slug, pid: e.process!.pid, port: e.process!.port, leases: e.leases.size }))
      .sort((a, b) => (a.repoPath + a.slug).localeCompare(b.repoPath + b.slug));
  }

  /** Processes started or starting. */
  get size(): number {
    return this.entries.size;
  }

  private entryOf(leaseId: string): Entry | undefined {
    const key = this.leaseKeys.get(leaseId);
    const entry = key === undefined ? undefined : this.entries.get(key);
    return entry?.leases.has(leaseId) ? entry : undefined;
  }

  private async stopIfUnused(key: string, entry: Entry): Promise<boolean> {
    if (entry.leases.size > 0 || this.entries.get(key) !== entry) return false;
    this.entries.delete(key);
    const proc = await entry.pending.catch(() => undefined);
    await proc?.stop();
    this.countChanged();
    return proc !== undefined;
  }

  private forget(key: string, entry: Entry): void {
    if (this.entries.get(key) !== entry) return;
    this.entries.delete(key);
    for (const leaseId of entry.leases.keys()) this.leaseKeys.delete(leaseId);
    this.countChanged();
  }

  private async startWithRetry(target: ServeTarget): Promise<ServeProcess> {
    const attempts = Math.max(1, this.opts.attempts ?? 3);
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      const port = await this.opts.pickPort();
      try {
        return await this.opts.start(target, port);
      } catch (e) {
        last = e;
        if (!(e instanceof PortInUseError)) break;
      }
    }
    throw last;
  }

  private countChanged(): void {
    this.opts.onCountChange?.(this.entries.size);
  }
}

/** `start` throws this when the port was taken between the pick and the listen. */
export class PortInUseError extends Error {
  constructor(port: number) {
    super(`port ${port} is in use`);
    this.name = 'PortInUseError';
  }
}

function keyOf(target: ServeTarget): string {
  return `${target.repoPath}\0${target.slug}`;
}
