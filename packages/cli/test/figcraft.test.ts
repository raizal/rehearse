// `rehearse figcraft fetch` (T50, box figcraft-host): a fake fetcher serves a release made in the
// test; no network. Exit 0 when the SHA-256 matches, 1 on a mismatch or a network error, 2 on bad arguments.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fakeFetcher, fakeRelease } from '../../server/test/zip.js';
import { runFigcraft, type FigcraftDeps } from '../src/commands/figcraft.js';
import { main, USAGE } from '../src/index.js';

/** A git repo; cwd is a folder inside it, so the build goes to the git top. */
function repo(): { top: string; cwd: string } {
  const top = mkdtempSync(join(tmpdir(), 'rehearse-fc-cli-'));
  execFileSync('git', ['init', '-q'], { cwd: top });
  const cwd = join(top, 'docs');
  mkdirSync(cwd);
  return { top, cwd };
}

async function figcraft(args: string[], cwd: string, deps: FigcraftDeps): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await runFigcraft(args, { cwd, stdout: (t) => (out += t), stderr: (t) => (err += t) }, deps);
  return { code, out, err };
}

const noApp = async () => undefined;

describe('rehearse figcraft fetch', () => {
  it('exit 0: the build is unpacked at the git top, SHA-256 checked', async () => {
    const { top, cwd } = repo();
    const r = await figcraft(['fetch', '--version', '0.16.0'], cwd, { fetcher: fakeFetcher('0.16.0', fakeRelease('0.16.0')).fetcher, appVersion: noApp });
    expect(r).toEqual({ code: 0, err: '', out: "FigCraft web 0.16.0 is ready in .rehearse/figcraft-web/0.16.0/ (SHA-256 checked). Open a story's Design tab in rehearse serve.\n" });
    expect(readFileSync(join(top, '.rehearse', 'figcraft-web', '0.16.0', 'index.html'), 'utf8')).toContain('FigCraft');
  });

  it('no --version: the desktop app version, else the latest release; --json', async () => {
    const { top, cwd } = repo();
    const app = await figcraft(['fetch'], cwd, { fetcher: fakeFetcher('0.15.0', fakeRelease('0.15.0')).fetcher, appVersion: async () => '0.15.0' });
    expect(app.code).toBe(0);
    const latest = await figcraft(['fetch', '--json'], cwd, { fetcher: fakeFetcher('0.16.0', fakeRelease('0.16.0')).fetcher, appVersion: noApp });
    expect(latest.code).toBe(0);
    expect(JSON.parse(latest.out)).toMatchObject({ ok: true, version: '0.16.0', dir: '.rehearse/figcraft-web/0.16.0/' });
    expect(readdirSync(join(top, '.rehearse', 'figcraft-web')).sort()).toEqual(['0.15.0', '0.16.0']);
  });

  it('exit 1 on a hash mismatch or a network error; nothing changed', async () => {
    const { top, cwd } = repo();
    const bad = await figcraft(['fetch', '--version', '0.16.0'], cwd, { fetcher: fakeFetcher('0.16.0', fakeRelease('0.16.0', { hash: 'a'.repeat(64) })).fetcher });
    expect(bad.code).toBe(1);
    expect(bad.err).toMatch(/^rehearse figcraft: figcraft-web-0\.16\.0\.zip has SHA-256 [0-9a-f]{64}, but SHA256SUMS\.txt says a{64}\. Nothing changed\.\n$/);
    const json = await figcraft(['fetch', '--version', '0.16.0', '--json'], cwd, { fetcher: fakeFetcher('0.16.0', fakeRelease('0.16.0', { hash: 'a'.repeat(64) })).fetcher });
    expect(json.code).toBe(1);
    expect(JSON.parse(json.out)).toMatchObject({ ok: false, reason: 'hash mismatch' });
    const down = await figcraft(['fetch', '--version', '0.16.0'], cwd, { fetcher: async () => Promise.reject(new Error('offline')) });
    expect(down.code).toBe(1);
    expect(down.err).toBe('rehearse figcraft: could not download https://github.com/storytold/figcraft/releases/download/v0.16.0/SHA256SUMS.txt: offline Nothing changed.\n');
    expect(existsSync(join(top, '.rehearse'))).toBe(false);
  });

  it('exit 2 on bad arguments', async () => {
    const { cwd } = repo();
    const deps = { fetcher: async () => Promise.reject(new Error('must not fetch')) };
    for (const args of [[], ['pull'], ['fetch', '--version'], ['fetch', '--version', '../x'], ['fetch', '--nope'], ['fetch', 'extra']]) {
      const r = await figcraft(args, cwd, deps);
      expect(r.code, args.join(' ')).toBe(2);
      expect(r.err, args.join(' ')).toContain('rehearse figcraft: expected fetch [--version <v>] [--json]');
    }
    expect(USAGE).toContain('figcraft fetch [--version <v>] [--json]');
    // main routes `figcraft`: a usage error needs no network.
    expect(await main(['figcraft'], { cwd, stdout: () => undefined, stderr: () => undefined })).toBe(2);
  });
});
