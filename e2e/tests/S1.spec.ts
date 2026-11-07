// One e2e test per scenario of story S1 ("to create an EPIC record with one command"), named
// after the scenario id. `rehearse new` has no UI: each test runs the CLI in a temp folder and
// shows the terminal in the page, so Birdview has something to show at each step.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from './serve.js';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const CLI = join(REPO, 'packages/cli/bin/rehearse.js');

type Run = { cmd: string; code: number | null; stdout: string; stderr: string };

/** Run `rehearse <args>` in `cwd`. */
function rehearse(cwd: string, args: string[]): Run {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  return { cmd: `rehearse ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`, code: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Every file and folder below `dir`, with its content and mtime: what "no file changed" compares. */
function snapshot(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      const key = relative(dir, p);
      const mtime = statSync(p).mtimeMs;
      if (e.isDirectory()) {
        files.set(`${key}/`, `dir@${mtime}`);
        walk(p);
      } else {
        files.set(key, `${mtime}:${readFileSync(p, 'base64')}`);
      }
    }
  };
  walk(dir);
  return files;
}

function changed(before: Map<string, string>, after: Map<string, string>): string[] {
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys].filter((k) => before.get(k) !== after.get(k)).sort();
}

/** Show the runs so far as a terminal, one block per run. */
async function terminal(page: Page, runs: Run[], note = ''): Promise<void> {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const blocks = runs
    .map((r) => `<div data-testid="run"><b>$ ${esc(r.cmd)}</b>\n${esc(r.stdout)}<span style="color:#f87171">${esc(r.stderr)}</span><i data-testid="exit">exit ${r.code}</i></div>`)
    .join('\n');
  await page.setContent(
    `<body style="margin:0;background:#111;color:#ddd;font:14px ui-monospace,monospace">` +
      `<pre data-testid="terminal" style="padding:16px;white-space:pre-wrap">${blocks}</pre>` +
      `<p data-testid="note" style="padding:0 16px;color:#9ca3af">${esc(note)}</p></body>`,
  );
}

test('S1-exists', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'rehearse-e2e-s1-'));
  const args = ['new', '2026-11-05-demo', '--title', 'Demo'];
  const runs: Run[] = [];
  try {
    let before = new Map<string, string>();
    await test.step('start: the EPIC 2026-11-05-demo exists', async () => {
      const first = rehearse(dir, args);
      runs.push(first);
      expect(first.code, first.stderr).toBe(0);
      expect(statSync(join(dir, 'docs/epics/2026-11-05-demo')).isDirectory()).toBe(true);
      before = snapshot(dir);
      await terminal(page, runs, `${before.size} files and folders in the repo`);
      await expect(page.getByTestId('run')).toHaveCount(1);
    });

    let again: Run | undefined;
    await test.step('new-epic: the builder runs the same command again, it exits epic-exists', async () => {
      again = rehearse(dir, args);
      runs.push(again);
      await terminal(page, runs);
      expect(again.code).not.toBe(0);
      expect(again.stdout).toBe('');
      expect(again.stderr).toContain('epic-exists');
      expect(again.stderr).toContain('docs/epics/2026-11-05-demo');
      await expect(page.getByTestId('run').nth(1)).toContainText('epic-exists');
      await expect(page.getByTestId('exit').nth(1)).not.toHaveText('exit 0');
    });

    await test.step('rejected: the command failed and changed no file', async () => {
      const filesChanged = changed(before, snapshot(dir));
      await terminal(page, runs, `filesChanged: ${filesChanged.length}`);
      expect(filesChanged).toEqual([]);
      await expect(page.getByTestId('note')).toHaveText('filesChanged: 0');
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
