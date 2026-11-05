// R19 / box `ci-run`: the built binary runs headless, as CI runs it.
// Each test starts packages/cli/bin/rehearse.js as a child process with no bb
// environment variables, and checks the exit code and the --json report.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { generateBenchEpic } from '../../core/test/bench/generate.js';
import { box, makeEpic } from '../../core/test/helpers.js';

const BIN = fileURLToPath(new URL('../bin/rehearse.js', import.meta.url));
const PACKAGES = fileURLToPath(new URL('../..', import.meta.url));

/** The parent environment without any bb variable (BB_*), as on a CI runner. */
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('BB_')));

function bin(args: string[], cwd = tmp()): { code: number | null; out: string; err: string } {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, env: ENV, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function tmp(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'rehearse-ci-')));
}

beforeAll(() => {
  // The binary loads dist/. Build it when a plain `pnpm test` runs before `pnpm build`.
  for (const pkg of ['core', 'cli']) {
    if (!existsSync(join(PACKAGES, pkg, 'dist', 'index.js'))) {
      execFileSync(process.execPath, [join(PACKAGES, '..', 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.build.json'], {
        cwd: join(PACKAGES, pkg),
      });
    }
  }
}, 60_000);

describe('R19: rehearse runs headless with exit codes and a --json report, without bb', () => {
  it('the child process has no bb environment variable', () => {
    expect(Object.keys(ENV).filter((k) => k.startsWith('BB_'))).toEqual([]);
  });

  it('R19 an OK record exits 0; the --json report is ok and byte-identical on each run', () => {
    const dir = makeEpic();
    const a = bin(['validate', dir, '--json']);
    expect(a.err).toBe('');
    expect(a.code).toBe(0);
    expect(JSON.parse(a.out)).toMatchObject({ command: 'validate', ok: true, findings: [] });
    expect(bin(['validate', dir, '--json']).out).toBe(a.out);
  });

  it('R19 a broken record exits 1; the --json report lists the finding', () => {
    const dir = makeEpic({ edit: (d) => (box(d, 'pay').stories = ['S9']) });
    const r = bin(['validate', dir, '--json']);
    expect(r.code).toBe(1);
    const json = JSON.parse(r.out);
    expect(json.ok).toBe(false);
    expect(json.findings).toEqual([
      { kind: 'reference', file: 'flow.yaml', path: 'pay', message: 'story S9 unknown', refs: ['S9'] },
    ]);
  });

  it('R19 a broken YAML file exits 1, not 3: a record error is not an internal error', () => {
    const dir = makeEpic({ rawFiles: { 'flow.yaml': 'root: [\n' } });
    const r = bin(['validate', dir, '--json']);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out).findings[0]).toMatchObject({ kind: 'schema', file: 'flow.yaml' });
  });

  it('R19 usage errors exit 2', () => {
    expect(bin([]).code).toBe(2);
    expect(bin(['validate']).code).toBe(2);
    expect(bin(['validate', join(tmp(), 'missing')]).code).toBe(2);
    expect(bin(['approve']).code).toBe(2);
  });

  it('S1-A1 rehearse new, then validate, both headless', () => {
    const root = tmp();
    expect(bin(['new', '2026-11-05-demo', '--title', 'Demo'], root).code).toBe(0);
    const r = bin(['validate', '2026-11-05-demo', '--json'], root);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ ok: true, findings: [] });
    expect(bin(['new', '2026-11-05-demo', '--title', 'Demo'], root).code).toBe(1);
  });

  it('S10-A2 the binary validates 200 boxes and 100 scenarios in less than 2 s, node start included', () => {
    const bench = generateBenchEpic();
    const t0 = performance.now();
    const r = bin(['validate', bench.dir, '--json']);
    const ms = performance.now() - t0;
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ ok: true, findings: [] });
    expect(ms).toBeLessThan(2000);
  });

  it('S10-A2 the binary simulates 200 boxes and 100 scenarios in less than 2 s, node start included', () => {
    const bench = generateBenchEpic();
    const t0 = performance.now();
    const r = bin(['simulate', bench.dir, '--json']);
    const ms = performance.now() - t0;
    expect(r.code === 0 || r.code === 1).toBe(true);
    expect(JSON.parse(r.out)).toMatchObject({ command: 'simulate' });
    expect(ms).toBeLessThan(2000);
  });
});
