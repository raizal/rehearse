// One e2e test per scenario of story S1 ("to create an EPIC record with one command"), named
// after the scenario id. Each step title starts with its flow box, "<box>: <words>", so the
// Birdview playlist maps steps to boxes (`rehearse playlists`).

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import type { Page } from '@playwright/test';
import { CLI, expect, serve, stop, test } from './serve.js';

const SLUG = '2026-11-05-demo';
const EPIC_DIR = `docs/epics/${SLUG}`;

/** Run the rehearse CLI in `cwd`. */
function rehearse(cwd: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...args], { cwd, encoding: 'utf8' });
}

test('S1-new', async ({ page }) => {
  const tmp = mkdtempSync(join(tmpdir(), 'rehearse-e2e-s1-'));
  const repo = join(tmp, 'repo');
  const clone = join(tmp, 'clone');
  try {
    await test.step('start: the builder has an idea, in a repo with no EPIC named 2026-11-05-demo', async () => {
      git(tmp, 'init', '-q', repo);
      expect(existsSync(join(repo, EPIC_DIR))).toBe(false);
    });

    await test.step('new-epic: rehearse new 2026-11-05-demo --title "Demo" creates docs/epics/2026-11-05-demo', async () => {
      const r = rehearse(repo, 'new', SLUG, '--title', 'Demo');
      expect(r.err).toBe('');
      expect(r.code).toBe(0);
      expect(r.out).toContain(`Created ${EPIC_DIR}`);
      expect(existsSync(join(repo, EPIC_DIR))).toBe(true);
    });

    await test.step('draft-record: the record has its files and an empty scenarios/, validate passes, the EPIC is a draft', async () => {
      const dir = join(repo, EPIC_DIR);
      const entries = readdirSync(dir, { withFileTypes: true }).map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
      expect(entries.sort()).toEqual(['brainstorm.md', 'prd.yaml', 'entities.yaml', 'flow.yaml', 'scenarios/', 'corrections.md'].sort());
      expect(readdirSync(join(dir, 'scenarios'))).toEqual([]);
      const local = rehearse(repo, 'validate', EPIC_DIR);
      expect(local.code, local.out + local.err).toBe(0);

      // git does not keep the empty scenarios/ folder: a clone has none, and validate still passes.
      git(repo, 'add', '-A');
      git(repo, 'commit', '-q', '-m', 'new EPIC');
      git(tmp, 'clone', '-q', repo, clone);
      expect(existsSync(join(clone, EPIC_DIR, 'scenarios'))).toBe(false);
      const cloned = rehearse(clone, 'validate', EPIC_DIR);
      expect(cloned.code, cloned.out + cloned.err).toBe(0);

      // The builder opens the new record: title Demo, validate OK, EPIC status draft.
      const { child, url } = await serve(join(clone, EPIC_DIR));
      try {
        await page.goto(url);
        await expect(page.getByTestId('epic-title')).toHaveText('Demo');
        await expect(page.getByTestId('epic-slug')).toContainText(SLUG);
        await expect(page.getByTestId('report-status')).toHaveText(/validate: OK/);
        await page.getByTestId('nav-readiness').click();
        await expect(page.getByTestId('readiness-summary')).toContainText('EPIC status: draft');
      } finally {
        await stop(child);
      }
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

/** Every file and folder below `dir` with its mtime and content: what "no file changed" compares. */
function snapshot(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      const key = relative(dir, p);
      if (key === '.git' || key.startsWith(`.git${sep}`)) continue;
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

/** Show the commands so far as a terminal, so Birdview has something to show for a CLI step. */
async function terminal(page: Page, runs: { cmd: string; code: number | null; out: string; err: string }[], note = '') {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const blocks = runs
    .map((r) => `<div data-testid="run"><b>$ ${esc(r.cmd)}</b>\n${esc(r.out)}<span style="color:#f87171">${esc(r.err)}</span><i data-testid="exit">exit ${r.code}</i></div>`)
    .join('\n');
  await page.setContent(
    `<body style="margin:0;background:#111;color:#ddd;font:14px ui-monospace,monospace">` +
      `<pre data-testid="terminal" style="padding:16px;white-space:pre-wrap">${blocks}</pre>` +
      `<p data-testid="note" style="padding:0 16px;color:#9ca3af">${esc(note)}</p></body>`,
  );
}

test('S1-exists', async ({ page }) => {
  const repo = mkdtempSync(join(tmpdir(), 'rehearse-e2e-s1-'));
  const cmd = `rehearse new ${SLUG} --title Demo`;
  const runs: { cmd: string; code: number | null; out: string; err: string }[] = [];
  try {
    let before = new Map<string, string>();
    await test.step('start: the EPIC 2026-11-05-demo exists', async () => {
      git(repo, 'init', '-q');
      const first = { cmd, ...rehearse(repo, 'new', SLUG, '--title', 'Demo') };
      runs.push(first);
      expect(first.code, first.err).toBe(0);
      expect(existsSync(join(repo, EPIC_DIR))).toBe(true);
      before = snapshot(repo);
      await terminal(page, runs, `${before.size} files and folders in the repo`);
      await expect(page.getByTestId('run')).toHaveCount(1);
    });

    await test.step('new-epic: the builder runs the same command again, it exits epic-exists and names the folder', async () => {
      const again = { cmd, ...rehearse(repo, 'new', SLUG, '--title', 'Demo') };
      runs.push(again);
      await terminal(page, runs);
      expect(again.code).not.toBe(0);
      expect(again.out).toBe('');
      expect(again.err).toContain('epic-exists');
      expect(again.err).toContain(EPIC_DIR);
      await expect(page.getByTestId('run').nth(1)).toContainText('epic-exists');
      await expect(page.getByTestId('exit').nth(1)).not.toHaveText('exit 0');
    });

    await test.step('rejected: the command failed and changed no file', async () => {
      const after = snapshot(repo);
      const keys = new Set([...before.keys(), ...after.keys()]);
      const filesChanged = [...keys].filter((k) => before.get(k) !== after.get(k)).sort();
      await terminal(page, runs, `filesChanged: ${filesChanged.length}`);
      expect(filesChanged).toEqual([]);
      await expect(page.getByTestId('note')).toHaveText('filesChanged: 0');
    });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
