// S5 and S10: an update makes again only the ref edges a change may touch, and skips the files whose
// mtime and size are as recorded. The graph it leaves must be the one a cold index makes of the same
// files. On the bench repo (G24), small, with the wave-1 readers and with the exact resolvers. An
// update confirms Python sites with basedpyright and a cold index with scip-python, so edges are
// compared without their source (as in update.test.ts).

import { appendFileSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeBenchRepo, type BenchRepo } from '../src/bench/generate.js';
import { benchResolvers } from '../src/bench/resolvers.js';
import { openGraph, type Graph } from '../src/index.js';

const open: Graph[] = [];
afterEach(() => {
  for (const g of open.splice(0)) g.close();
});

function benchGraph(set: string): { root: string; repo: BenchRepo; graph: Graph } {
  const root = join(mkdtempSync(join(tmpdir(), 'rehearse-update-cold-')), 'repo');
  const repo = writeBenchRepo(root, { files: 40, seed: 1 });
  const graph = openGraph(root, { resolvers: benchResolvers(set) });
  open.push(graph);
  return { root, repo, graph };
}

const dump = (g: Graph) => JSON.stringify([g.store.allNodes(), g.store.edgesWhere('1').map(({ source: _, ...e }) => e)]);

/** Update after `edit`, then a cold index of the same files: both graphs must be the same. */
async function expectUpdateIsCold(graph: Graph, edit: () => void): Promise<void> {
  edit();
  const run = await graph.update();
  expect(run.mode).toBe('update');
  const updated = dump(graph);
  await graph.update(true);
  expect(dump(graph)).toBe(updated);
}

/** The file that defines `export function <name>(`. */
function definingFile(repo: BenchRepo, name: string): string {
  return [...repo.files].find(([, text]) => text.includes(`export function ${name}(`))![0];
}

describe.each(['wave1', 'exact'])('S5 S10 an update equals a cold index on the bench repo (resolvers %s)', (set) => {
  it('S5 S10 after a one-file edit in each language', async () => {
    const { root, repo, graph } = benchGraph(set);
    await graph.update();
    await expectUpdateIsCold(graph, () => appendFileSync(join(root, repo.probes.update.typescript), '\nexport function benchEdit(id: string): string {\n  return id;\n}\n'));
    await expectUpdateIsCold(graph, () => appendFileSync(join(root, repo.probes.update.python), '\n\ndef bench_edit(row_id: str) -> str:\n    return row_id\n'));
  }, 180_000);

  it('S5 S10 after renaming a function that other files import and call, and renaming it back', async () => {
    const { root, repo, graph } = benchGraph(set);
    await graph.update();
    const name = repo.probes.path[1];
    const file = join(root, definingFile(repo, name));
    const text = readFileSync(file, 'utf8');
    await expectUpdateIsCold(graph, () => writeFileSync(file, text.replace(`export function ${name}(`, `export function ${name}Renamed(`)));
    await expectUpdateIsCold(graph, () => writeFileSync(file, text));
  }, 180_000);

  it('S5 S10 after a file is added and another is removed', async () => {
    const { root, repo, graph } = benchGraph(set);
    await graph.update();
    const [, source] = [...repo.files].find(([p]) => p === repo.probes.update.typescript)!;
    await expectUpdateIsCold(graph, () => {
      writeFileSync(join(root, repo.probes.update.typescript.replace(/\.ts$/, '_copy.ts')), source);
      rmSync(join(root, repo.probes.update.python));
    });
  }, 180_000);
});

describe('S5 S10 an update equals a cold index through an aliased import', () => {
  it('S5 S10 renaming the function behind `import { getX as load }` drops the edge of `load()`, and renaming it back makes it again', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rehearse-alias-'));
    writeFileSync(join(root, 'a.ts'), 'export function getX(): number {\n  return 1;\n}\nexport function other(): number {\n  return 2;\n}\n');
    writeFileSync(join(root, 'b.ts'), "import { getX as load } from './a';\nexport function f(): number {\n  return load();\n}\n");
    const graph = openGraph(root, { resolvers: [] });
    open.push(graph);
    await graph.update();
    const a = join(root, 'a.ts');
    const text = readFileSync(a, 'utf8');
    await expectUpdateIsCold(graph, () => writeFileSync(a, text.replace('getX', 'getY')));
    await expectUpdateIsCold(graph, () => writeFileSync(a, text));
  });
});

describe('S5 the freshness check reads a file only when its mtime or size moved', () => {
  it('S5 a file with the same size and an old mtime is not read; the same text with a new mtime is not a change', async () => {
    const { root, repo, graph } = benchGraph('wave1');
    await graph.update();
    // Make every file look older than the index, so the check trusts the recorded mtime and size.
    const old = new Date(Date.now() - 60_000);
    for (const path of repo.files.keys()) utimesSync(join(root, path), old, old);
    await graph.update(true);
    expect((await graph.update()).mode).toBe('none');

    // Same size, older mtime kept: the check does not read it, so the edit is not seen (by design: mtime + size).
    const file = join(root, repo.probes.update.typescript);
    const text = readFileSync(file, 'utf8');
    const same = text.replace(/export function (\w)/, (_, c: string) => `export function ${c === 'a' ? 'b' : 'a'}`);
    writeFileSync(file, same);
    utimesSync(file, old, old);
    expect((await graph.update()).mode).toBe('none');

    // A new mtime: the file is read and hashed, and the change is found.
    utimesSync(file, new Date(), new Date());
    expect((await graph.update()).mode).toBe('update');

    // The same text again with a new mtime: read, same hash, no change.
    utimesSync(file, new Date(), new Date());
    expect((await graph.update()).mode).toBe('none');
  });
});
