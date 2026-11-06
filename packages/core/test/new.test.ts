// Story S1: scenarios/S1.yaml (S1-new, S1-exists, S1-bad-slug) on core `createEpic`.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createEpic, EPIC_FILES, GRAPH_DB_IGNORE, isEpicSlug, loadEpic, validateEpic } from '../src/index.js';

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'rehearse-new-'));
}

/** Every path below `dir` with its content, to prove that nothing changed. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string, rel: string): void => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      const r = rel ? `${rel}/${name}` : name;
      if (statSync(full).isDirectory()) {
        out[`${r}/`] = '';
        walk(full, r);
      } else out[r] = readFileSync(full, 'utf8');
    }
  };
  walk(dir, '');
  return out;
}

describe('story S1: create an EPIC record with one command', () => {
  it('S1-A1 S1-new: writes the six record entries, and validate passes with no findings', () => {
    const root = tempRoot();
    const res = createEpic(root, '2026-11-05-demo', 'Demo');
    expect(res).toEqual({ ok: true, epicDir: join(root, 'docs', 'epics', '2026-11-05-demo') });
    if (!res.ok) return;
    expect(readdirSync(res.epicDir).sort()).toEqual(
      ['brainstorm.md', 'corrections.md', 'entities.yaml', 'flow.yaml', 'prd.yaml', 'scenarios'].sort(),
    );
    expect([...EPIC_FILES].sort()).toEqual(
      ['brainstorm.md', 'corrections.md', 'entities.yaml', 'flow.yaml', 'prd.yaml', 'scenarios/'].sort(),
    );
    expect(statSync(join(res.epicDir, 'scenarios')).isDirectory()).toBe(true);
    expect(readdirSync(join(res.epicDir, 'scenarios'))).toEqual([]);

    const report = validateEpic(res.epicDir);
    expect(report.findings).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('S1-A1 S1-new: the record has the slug and title, and is a draft (no signoff.yaml)', () => {
    const root = tempRoot();
    const res = createEpic(root, '2026-11-05-demo', 'Demo: "quoted" # not a comment');
    if (!res.ok) throw new Error(res.message);
    const { record } = loadEpic(res.epicDir);
    expect(record.prd?.epic.slug).toBe('2026-11-05-demo');
    expect(record.prd?.epic.title).toBe('Demo: "quoted" # not a comment');
    expect(record.flow?.epic).toBe('2026-11-05-demo');
    expect(record.signoff).toBeUndefined();
    expect(record.scenarioFiles).toEqual([]);
    expect(readFileSync(join(res.epicDir, 'brainstorm.md'), 'utf8')).toContain('Demo: "quoted" # not a comment');
  });

  it('S1-A1 S1-new: creates docs/epics when the repo has none, and keeps other EPICs', () => {
    const root = tempRoot();
    mkdirSync(join(root, 'docs', 'epics', '2026-01-01-other'), { recursive: true });
    writeFileSync(join(root, 'docs', 'epics', '2026-01-01-other', 'prd.yaml'), 'x: 1\n');
    const res = createEpic(root, '2026-11-05-demo', 'Demo');
    expect(res.ok).toBe(true);
    expect(readdirSync(join(root, 'docs', 'epics')).sort()).toEqual(['2026-01-01-other', '2026-11-05-demo']);
    expect(readFileSync(join(root, 'docs', 'epics', '2026-01-01-other', 'prd.yaml'), 'utf8')).toBe('x: 1\n');
  });

  it('code-graph S5-A2 (G29): adds .rehearse/graph.db* to .gitignore once, and keeps the lines there', () => {
    const root = tempRoot();
    writeFileSync(join(root, '.gitignore'), 'node_modules/\n.rehearse/story-threads.json');
    expect(createEpic(root, '2026-11-05-demo', 'Demo').ok).toBe(true);
    expect(GRAPH_DB_IGNORE).toBe('.rehearse/graph.db*');
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe('node_modules/\n.rehearse/story-threads.json\n.rehearse/graph.db*\n');
    expect(createEpic(root, '2026-11-06-more', 'More').ok).toBe(true);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe('node_modules/\n.rehearse/story-threads.json\n.rehearse/graph.db*\n');
    const bare = tempRoot();
    expect(createEpic(bare, '2026-11-05-demo', 'Demo').ok).toBe(true);
    expect(readFileSync(join(bare, '.gitignore'), 'utf8')).toBe('.rehearse/graph.db*\n');
  });

  it('S1-A2 S1-exists: fails with epic-exists, names the folder, and changes no file', () => {
    const root = tempRoot();
    const first = createEpic(root, '2026-11-05-demo', 'Demo');
    if (!first.ok) throw new Error(first.message);
    writeFileSync(join(first.epicDir, 'prd.yaml'), 'edited: true\n');
    const before = snapshot(root);

    const again = createEpic(root, '2026-11-05-demo', 'Demo');
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.exit).toBe('epic-exists');
    expect(again.message).toContain(join('docs', 'epics', '2026-11-05-demo'));
    expect(snapshot(root)).toEqual(before);
  });

  it('S1-A2 S1-exists: a file (not a folder) with the EPIC name also fails with epic-exists', () => {
    const root = tempRoot();
    mkdirSync(join(root, 'docs', 'epics'), { recursive: true });
    writeFileSync(join(root, 'docs', 'epics', '2026-11-05-demo'), 'not a folder');
    const before = snapshot(root);
    const res = createEpic(root, '2026-11-05-demo', 'Demo');
    expect(res.ok ? undefined : res.exit).toBe('epic-exists');
    expect(snapshot(root)).toEqual(before);
  });

  it.each([
    'Demo',
    'demo',
    '2026-11-05',
    '2026-11-05-',
    '2026-11-05-Demo',
    '2026-11-05-de_mo',
    '2026-11-05-de--mo',
    '2026-13-05-demo',
    '2026-02-30-demo',
    '26-11-05-demo',
    '../2026-11-05-demo',
    '2026-11-05-demo/x',
  ])('S1-bad-slug: slug %j fails with bad-slug and writes nothing', (slug) => {
    const root = tempRoot();
    const res = createEpic(root, slug, 'Demo');
    expect(res.ok ? undefined : res.exit).toBe('bad-slug');
    if (!res.ok) expect(res.message).toContain('YYYY-MM-DD-<kebab>');
    expect(snapshot(root)).toEqual({});
  });

  it('S1-bad-slug: the slug check runs before the exists check', () => {
    const root = tempRoot();
    mkdirSync(join(root, 'docs', 'epics', 'Demo'), { recursive: true });
    const res = createEpic(root, 'Demo', 'Demo');
    expect(res.ok ? undefined : res.exit).toBe('bad-slug');
  });

  it('isEpicSlug accepts real dates with a kebab name only', () => {
    expect(isEpicSlug('2026-11-05-rehearse')).toBe(true);
    expect(isEpicSlug('2024-02-29-leap-day')).toBe(true);
    expect(isEpicSlug('2025-02-29-not-leap')).toBe(false);
  });
});
