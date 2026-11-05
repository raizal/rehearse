// `rehearse serve`: argument handling, the printed URL, and the served app and API (R12, R20, S4-A3).

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunningServer } from '@rehearse/server';
import { REAL_EPIC, SHOP } from '../../core/test/helpers.js';
import { DEFAULT_PORT, parseServeArgs, startServe, uiDistDir } from '../src/commands/serve.js';
import { run, USAGE } from '../src/index.js';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));

function io(cwd = REPO) {
  const out = { stdout: '', stderr: '' };
  return { out, io: { cwd, stdout: (t: string) => (out.stdout += t), stderr: (t: string) => (out.stderr += t) } };
}

// No global or system git config, so no test reads the user's real signing key.
const NO_GIT_CONFIG = join(mkdtempSync(join(tmpdir(), 'rehearse-gitconfig-')), 'config');
writeFileSync(NO_GIT_CONFIG, '');
beforeEach(() => {
  vi.stubEnv('GIT_CONFIG_GLOBAL', NO_GIT_CONFIG);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
});

let running: RunningServer | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  await running?.close();
  running = undefined;
});

async function serve(args: string[]): Promise<{ server: RunningServer; stdout: string }> {
  const t = io();
  const r = await startServe(args, t.io);
  if ('code' in r) throw new Error(`exit ${r.code}: ${t.out.stderr}`);
  running = r;
  return { server: r, stdout: t.out.stdout };
}

describe('rehearse serve', () => {
  it('R20: listens on 127.0.0.1 and prints that URL', async () => {
    const { server, stdout } = await serve([SHOP, '--port', '0']);
    expect(server.server.address()).toMatchObject({ address: '127.0.0.1' });
    expect(stdout).toContain(`http://127.0.0.1:${server.port}/`);
    expect(stdout).toContain(`bb connect expose ${server.port}`);
    // No signing key in this test's git config: the UI cannot write, and the reason is printed.
    expect(stdout).toMatch(/Approve and sign-off are off: git user\.(email|signingkey) is not set/);
  });

  it('S4-A3: the URL returns the app page, and /api/epic returns the record as JSON', async () => {
    const { server } = await serve(['2026-11-05-rehearse', '--port', '0']);
    const page = await fetch(server.url);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('<div id="root">');
    const api = await fetch(new URL('api/epic', server.url));
    expect(api.headers.get('content-type')).toContain('application/json');
    const body = await api.json();
    expect(body.slug).toBe('2026-11-05-rehearse');
    expect(body.report.ok).toBe(true);
    expect(body.flow.lanes.map((l: { role: string }) => l.role)).toEqual(['builder', 'agent', 'rehearse', 'ci']);
  });

  it('serves the built UI from @rehearse/ui', () => {
    expect(uiDistDir()).toBe(join(REPO, 'packages', 'ui', 'dist'));
  });

  it('parses the EPIC and the port; without an EPIC it uses the folder, or the only EPIC in docs/epics', () => {
    expect(parseServeArgs([SHOP], REPO)).toEqual({ epicDir: SHOP, port: DEFAULT_PORT });
    expect(parseServeArgs(['--port', '8123', SHOP], REPO)).toEqual({ epicDir: SHOP, port: 8123 });
    expect(parseServeArgs([], SHOP)).toEqual({ epicDir: SHOP, port: DEFAULT_PORT });
    const one = mkdtempSync(join(tmpdir(), 'rehearse-one-'));
    mkdirSync(join(one, 'docs', 'epics', 'a'), { recursive: true });
    expect(parseServeArgs([], one)).toEqual({ epicDir: join(one, 'docs', 'epics', 'a'), port: DEFAULT_PORT });
    const two = mkdtempSync(join(tmpdir(), 'rehearse-two-'));
    mkdirSync(join(two, 'docs', 'epics', 'a'), { recursive: true });
    mkdirSync(join(two, 'docs', 'epics', 'b'), { recursive: true });
    expect(parseServeArgs([], two)).toBe('name the EPIC to serve: a, b');
  });

  it('usage errors exit 2 without starting a server', () => {
    for (const args of [['--port'], ['--port', 'x'], ['--port', '70000'], ['--host', '0.0.0.0'], [SHOP, SHOP], ['no-such-epic']]) {
      const t = io();
      expect(run(['serve', ...args], t.io)).toBe(2);
      expect(t.out.stderr).toContain('rehearse serve:');
    }
  });

  it('a port in use is reported with a hint and exit code 2', async () => {
    const { server } = await serve([SHOP, '--port', '0']);
    const t = io();
    const r = await startServe([SHOP, '--port', String(server.port)], t.io);
    expect(r).toEqual({ code: 2 });
    expect(t.out.stderr).toContain('port in use');
  });

  it('USAGE lists serve, and still no approve or sign-off command (R13, R14)', () => {
    expect(USAGE).toContain('serve [epic-dir-or-slug] [--port N]');
    expect(USAGE).not.toMatch(/approve|sign-?off/i);
  });
});
