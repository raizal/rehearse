// One e2e test per scenario of story S1 ("to create an EPIC record with one command"), named
// after the scenario id. Each step title starts with its flow box, "<box>: <words>", so the
// Birdview playlist maps steps to boxes (`rehearse playlists`).

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
