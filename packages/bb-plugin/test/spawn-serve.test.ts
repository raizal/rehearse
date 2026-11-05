import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { findFreePort } from '../src/port.js';
import { PortInUseError, type ServeProcess } from '../src/serve-manager.js';
import { spawnServe, WATCHDOG } from '../src/spawn-serve.js';
import { fakeInvocation, listening, tempRepo, until } from './helpers.js';

const running: ServeProcess[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((p) => p.stop()));
});

async function start(slug = 'epic') {
  const repo = tempRepo(slug);
  const port = await findFreePort();
  const proc = await spawnServe({ repoPath: repo, slug }, port, { invocation: fakeInvocation, env: process.env });
  running.push(proc);
  return { proc, port };
}

describe('spawnServe: process lifecycle', () => {
  it('resolves once serve prints its URL on 127.0.0.1', async () => {
    const { proc, port } = await start();
    expect(proc.url).toBe(`http://127.0.0.1:${port}/`);
    expect(proc.pid).toBeGreaterThan(0);
    const page = await (await fetch(proc.url)).text();
    expect(page).toContain('data-slug="epic"');
  });

  it('stop() stops serve and frees the port', async () => {
    const { proc, port } = await start();
    let exitedOnItsOwn = false;
    proc.onExit(() => (exitedOnItsOwn = true));
    await proc.stop();
    expect(await listening(port)).toBe(false);
    expect(exitedOnItsOwn).toBe(false);
    await proc.stop();
  });

  it('calls onExit when serve dies on its own', async () => {
    const { proc, port } = await start();
    let exited = false;
    proc.onExit(() => (exited = true));
    const page = await (await fetch(proc.url)).text();
    const servePid = Number(/data-pid="(\d+)"/.exec(page)![1]);
    process.kill(servePid, 'SIGKILL');
    await until(() => exited);
    expect(await listening(port)).toBe(false);
  });

  it('rejects with PortInUseError when the port is taken', async () => {
    const blocker = createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', () => r()));
    const port = (blocker.address() as { port: number }).port;
    try {
      await expect(spawnServe({ repoPath: tempRepo('epic'), slug: 'epic' }, port, { invocation: fakeInvocation, env: process.env })).rejects.toBeInstanceOf(
        PortInUseError,
      );
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()));
    }
  });

  it('rejects with the output when rehearse cannot start', async () => {
    const port = await findFreePort();
    await expect(
      spawnServe({ repoPath: tempRepo(), slug: 'epic' }, port, { invocation: { command: '/nonexistent/rehearse', prefix: [] }, env: process.env }),
    ).rejects.toThrow(/exited with code 127/);
  });

  it('rejects when serve does not print its URL in time, and stops it', async () => {
    const port = await findFreePort();
    const sleeper = { command: process.execPath, prefix: [fakeInvocation.prefix[0]!, 'sleep'] };
    // `sleep serve epic --port N`: the fake ignores the rest and never prints a URL.
    await expect(spawnServe({ repoPath: tempRepo(), slug: 'epic' }, port, { invocation: sleeper, env: process.env, readyTimeoutMs: 500 })).rejects.toThrow(
      /did not start within 500 ms/,
    );
  });
});

describe('the watchdog', () => {
  it('stops serve when the host worker dies (its stdin closes) without a signal', async () => {
    const port = await findFreePort();
    const watchdog = spawn(process.execPath, ['-e', WATCHDOG, '--', process.execPath, fakeInvocation.prefix[0]!, 'serve', 'epic', '--port', String(port)], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    const exited = new Promise<number | null>((r) => watchdog.once('exit', (code) => r(code)));
    await new Promise<void>((r) => watchdog.stdout.on('data', (b: Buffer) => b.toString().includes(`:${port}/`) && r()));
    expect(await listening(port)).toBe(true);
    watchdog.stdin.end();
    await exited;
    await until(async () => !(await listening(port)));
  });
});
