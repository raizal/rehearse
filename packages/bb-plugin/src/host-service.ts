// What the host worker does, without the bb host wiring (host.ts), so it can be tested.

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { listEpics } from './epics.js';
import { findFreePort } from './port.js';
import { resolveRehearse } from './resolve-bin.js';
import { runCli, type CliResult } from './run-cli.js';
import { ServeManager, type Opened, type ServeStatus, type ServeTarget, type StartServe } from './serve-manager.js';
import { spawnServe } from './spawn-serve.js';
import { findSshAgent, serveEnv, type SshAgent } from './ssh-agent.js';

/** Panels renew every 15 s; three missed renewals end the lease. */
export const LEASE_TTL_MS = 45_000;
export const SWEEP_EVERY_MS = 10_000;

export interface HostServiceOptions {
  env?: NodeJS.ProcessEnv;
  findAgent?: (env: NodeJS.ProcessEnv) => SshAgent;
  /** Replaces the real spawn (tests). */
  start?: StartServe;
  pickPort?: () => Promise<number>;
  leaseTtlMs?: number;
  now?: () => number;
  /** Called with the number of running processes after each change (keeps the worker alive). */
  onCountChange?: (running: number) => void;
}

/** The model and reasoning level of story threads started from the panel (T44). */
export type ThreadSettings = Pick<ServeTarget, 'threadModel' | 'threadReasoning'>;

export interface HostService {
  listEpics(repoPath: string): string[];
  open(repoPath: string, slug: string, command: string, thread?: ThreadSettings): Promise<Opened & { sshAgent: { available: boolean; source: SshAgent['source'] } }>;
  renew(leaseId: string): boolean;
  release(leaseId: string): Promise<boolean>;
  runCli(cwd: string, args: string[], command: string): Promise<CliResult>;
  status(): { sshAgent: { available: boolean; source: SshAgent['source'] }; processes: ServeStatus[] };
  sweep(): Promise<number>;
  stopAll(): Promise<void>;
}

export function createHostService(opts: HostServiceOptions = {}): HostService {
  const env = opts.env ?? process.env;
  const agent = (): SshAgent => (opts.findAgent ?? findSshAgent)(env);
  const agentInfo = (a: SshAgent) => ({ available: a.socket !== null, source: a.source });
  const start: StartServe =
    opts.start ??
    ((target, port) =>
      spawnServe(target, port, { invocation: resolveRehearse(target.repoPath, target.command ?? ''), env: serveEnv(env, agent()) }));
  const manager = new ServeManager({
    start,
    pickPort: opts.pickPort ?? findFreePort,
    leaseTtlMs: opts.leaseTtlMs ?? LEASE_TTL_MS,
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.onCountChange ? { onCountChange: opts.onCountChange } : {}),
  });
  return {
    listEpics,
    async open(repoPath, slug, command, thread = {}) {
      if (!isDir(join(repoPath, 'docs', 'epics', slug))) {
        throw new Error(`no EPIC folder docs/epics/${slug} in ${repoPath}`);
      }
      const opened = await manager.open({ repoPath, slug, command, ...thread });
      return { ...opened, sshAgent: agentInfo(agent()) };
    },
    renew: (leaseId) => manager.renew(leaseId),
    release: (leaseId) => manager.release(leaseId),
    runCli: (cwd, args, command) => runCli(resolveRehearse(cwd, command), args, cwd, serveEnv(env, agent())),
    status: () => ({ sshAgent: agentInfo(agent()), processes: manager.status() }),
    sweep: () => manager.sweep(),
    stopAll: () => manager.stopAll(),
  };
}

function isDir(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}
