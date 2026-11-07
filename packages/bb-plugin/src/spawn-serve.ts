// Start one `rehearse serve <slug> --port N` process and wait until it listens.
//
// The process runs under a small watchdog: when the plugin's host worker dies
// without cleanup, the watchdog's stdin closes and it stops the serve process.
// So a crash leaves no orphan holding a port.

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { LOOPBACK } from './port.js';
import type { Invocation } from './resolve-bin.js';
import { PortInUseError, type ServeProcess, type ServeTarget } from './serve-manager.js';

/** CommonJS for `node -e`. argv: [node, command, ...args]. */
export const WATCHDOG = `
const { spawn } = require('node:child_process');
const [command, ...args] = process.argv.slice(1);
const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'] });
let stopping = false;
const stop = () => { if (stopping) return; stopping = true; try { child.kill('SIGTERM'); } catch {} setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 3000).unref(); };
process.stdin.on('end', stop);
process.stdin.on('close', stop);
process.stdin.on('error', stop);
process.stdin.resume();
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('SIGHUP', stop);
child.on('error', (e) => { process.stderr.write(String(e.message) + '\\n'); process.exit(127); });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
`;

export interface SpawnServeOptions {
  invocation: Invocation;
  /** Environment for the process. Must carry SSH_AUTH_SOCK for signed approvals (D41). */
  env: NodeJS.ProcessEnv;
  /** Node binary that runs the watchdog. */
  nodePath?: string;
  readyTimeoutMs?: number;
  stopTimeoutMs?: number;
}

/** `rehearse serve` exits 2 on EADDRINUSE and says "port in use". */
const PORT_IN_USE = /EADDRINUSE|port in use/i;

/** The story-thread settings as serve flags; nothing when unset, so bb's defaults apply (T44). */
export function threadArgs(target: ServeTarget): string[] {
  return [
    ...(target.threadModel ? ['--thread-model', target.threadModel] : []),
    ...(target.threadReasoning ? ['--thread-reasoning', target.threadReasoning] : []),
  ];
}

/** The serve environment: the panel's bb project as REHEARSE_BB_PROJECT, so serve need not guess it (T46). */
export function serveProcessEnv(target: ServeTarget, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return target.projectId ? { ...env, REHEARSE_BB_PROJECT: target.projectId } : env;
}

export function spawnServe(target: ServeTarget, port: number, opts: SpawnServeOptions): Promise<ServeProcess> {
  const { invocation } = opts;
  const args = ['-e', WATCHDOG, '--', invocation.command, ...invocation.prefix, 'serve', target.slug, '--port', String(port), ...threadArgs(target)];
  const child = spawn(opts.nodePath ?? process.execPath, args, {
    cwd: target.repoPath,
    env: serveProcessEnv(target, opts.env),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const url = `http://${LOOPBACK}:${port}/`;
  return new Promise<ServeProcess>((resolve, reject) => {
    let out = '';
    let err = '';
    let ready = false;
    const timer = setTimeout(() => {
      fail(new Error(`rehearse serve did not start within ${opts.readyTimeoutMs ?? 15000} ms`));
      void stopChild(child, opts.stopTimeoutMs);
    }, opts.readyTimeoutMs ?? 15000);
    const fail = (e: Error): void => {
      if (ready) return;
      ready = true;
      clearTimeout(timer);
      reject(e);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (ready) return;
      out = (out + chunk).slice(-8192);
      if (!out.includes(url)) return;
      ready = true;
      clearTimeout(timer);
      resolve(handle(child, port, url, opts.stopTimeoutMs));
    });
    child.stderr.on('data', (chunk: string) => {
      err = (err + chunk).slice(-8192);
    });
    child.on('error', (e) => fail(e));
    child.on('exit', (code) => {
      const detail = (err || out).trim();
      if (PORT_IN_USE.test(detail)) fail(new PortInUseError(port));
      else fail(new Error(`rehearse serve exited with code ${code}${detail ? `: ${detail}` : ''}`));
    });
  });
}

type Child = ChildProcessByStdio<Writable, Readable, Readable>;

function handle(child: Child, port: number, url: string, stopTimeoutMs?: number): ServeProcess {
  const listeners: Array<() => void> = [];
  let stopping = false;
  const exited = new Promise<void>((done) => {
    if (child.exitCode !== null || child.signalCode !== null) done();
    else child.once('exit', () => done());
  });
  void exited.then(() => {
    if (!stopping) for (const l of listeners) l();
  });
  // Keep reading so a chatty process never blocks on a full pipe.
  child.stdout.resume();
  child.stderr.resume();
  return {
    pid: child.pid,
    port,
    url,
    stop: () => {
      stopping = true;
      return stopChild(child, stopTimeoutMs).then(() => exited);
    },
    onExit: (l) => listeners.push(l),
  };
}

/** Close stdin (the watchdog stops serve), then SIGTERM, then SIGKILL after the timeout. */
async function stopChild(child: Child, timeoutMs = 5000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((done) => child.once('exit', () => done()));
  child.stdin.end();
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  await exited;
  clearTimeout(timer);
}
