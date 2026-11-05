// Story S1 on the CLI: `rehearse new <slug> --title "<title>"` (scenarios/S1.yaml).

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../src/index.js';
import { repoRoot } from '../src/commands/new.js';

function cli(args: string[], cwd: string): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const code = run(args, { cwd, stdout: (t) => (out += t), stderr: (t) => (err += t) });
  return { code, out, err };
}

function tempDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'rehearse-cli-new-')));
}

function gitRepo(): string {
  const dir = tempDir();
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

describe('story S1: rehearse new', () => {
  it('S1-A1 S1-new: creates the EPIC at the git top-level from a subfolder, and validate passes', () => {
    const repo = gitRepo();
    const sub = join(repo, 'packages', 'x');
    mkdirSync(sub, { recursive: true });
    const res = cli(['new', '2026-11-05-demo', '--title', 'Demo'], sub);
    expect(res).toEqual({ code: 0, out: `Created ${join('docs', 'epics', '2026-11-05-demo')}\n`, err: '' });
    expect(readdirSync(join(repo, 'docs', 'epics', '2026-11-05-demo')).sort()).toEqual(
      ['brainstorm.md', 'corrections.md', 'entities.yaml', 'flow.yaml', 'prd.yaml', 'scenarios'],
    );
    expect(cli(['validate', '2026-11-05-demo'], sub)).toMatchObject({ code: 0 });
  });

  it('S1-A1 S1-new: without git the root is cwd; --title=<title> works too', () => {
    const dir = tempDir();
    expect(repoRoot(dir)).toBe(dir);
    expect(cli(['new', '2026-11-05-demo', '--title=Demo'], dir).code).toBe(0);
    expect(readdirSync(join(dir, 'docs', 'epics'))).toEqual(['2026-11-05-demo']);
  });

  it('S1-A2 S1-exists: the second run fails, names the folder, and changes no file', () => {
    const dir = tempDir();
    expect(cli(['new', '2026-11-05-demo', '--title', 'Demo'], dir).code).toBe(0);
    const res = cli(['new', '2026-11-05-demo', '--title', 'Demo'], dir);
    expect(res.code).toBe(1);
    expect(res.out).toBe('');
    expect(res.err).toContain('epic-exists');
    expect(res.err).toContain(join('docs', 'epics', '2026-11-05-demo'));
    expect(readdirSync(join(dir, 'docs', 'epics'))).toEqual(['2026-11-05-demo']);
  });

  it('S1-bad-slug: a slug with no date fails with exit 2 and writes nothing', () => {
    const dir = tempDir();
    const res = cli(['new', 'Demo', '--title', 'Demo'], dir);
    expect(res.code).toBe(2);
    expect(res.err).toContain('bad-slug');
    expect(readdirSync(dir)).toEqual([]);
  });

  it.each([
    [['new']],
    [['new', '2026-11-05-demo']],
    [['new', '2026-11-05-demo', '--title']],
    [['new', '2026-11-05-demo', '--title', '  ']],
    [['new', 'a', 'b', '--title', 'Demo']],
    [['new', '2026-11-05-demo', '--title', 'Demo', '--force']],
  ])('usage errors exit 2 and write nothing: %j', (args) => {
    const dir = tempDir();
    const res = cli(args, dir);
    expect(res.code).toBe(2);
    expect(res.err).toContain('rehearse new <slug> --title');
    expect(readdirSync(dir)).toEqual([]);
  });
});
