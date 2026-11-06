// S6-A1: the scope reads every tsconfig*.json and never indexes node_modules or the venv (G12, G19).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findScope, globRegex, openGraph, splitWords, type Graph } from '../src/index.js';
import { copyFixture } from './helpers.js';

let graph: Graph | undefined;
afterEach(() => {
  graph?.close();
  graph = undefined;
});

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

describe('S6-A1 scope', () => {
  it('S6-A1 indexes the files of both tsconfigs, none of node_modules, and lodash.get() is a target-only node', async () => {
    const root = copyFixture('monorepo');
    write(root, 'node_modules/lodash/index.ts', 'export function get(o: object, k: string) { return o; }\n');
    write(root, 'packages/a/node_modules/left-pad/index.ts', 'export default function pad() {}\n');
    write(root, 'packages/b/dist/index.ts', 'export const built = 1;\n');
    const scope = findScope(root);
    expect(scope.tsconfigs).toEqual(['packages/a/tsconfig.json', 'packages/b/tsconfig.build.json']);
    expect(scope.files.map((f) => f.path)).toEqual(['packages/a/src/index.ts', 'packages/b/src/index.ts']);

    graph = openGraph(root);
    await graph.update();
    expect(graph.store.files().map((f) => f.path)).toEqual(['packages/a/src/index.ts', 'packages/b/src/index.ts']);
    expect(graph.store.allNodes().filter((n) => n.file?.includes('node_modules'))).toEqual([]);
    const lodashGet = graph.store.nodesWhere('name = ?', 'lodash.get');
    expect(lodashGet).toHaveLength(1);
    expect(lodashGet[0]).toMatchObject({ targetOnly: true, id: 'scip-typescript npm lodash . lodash/get().' });
    const edges = graph.store.edgesWhere('to_id = ?', lodashGet[0]!.id);
    expect(edges).toMatchObject([{ kind: 'calls', trust: 'unresolved', from: 'scip-typescript npm @mono/a 1.0.0 packages/a/src/index.ts/pick().' }]);
    // A target-only node is not a find hit.
    expect((await graph.find('lodash get')).nodes.map((n) => n.name)).not.toContain('lodash.get');
    // An import of a workspace package goes to its entry file.
    const run = await graph.path('run', 'pick');
    expect(run.edges.map((e) => `${e.fromName} -> ${e.toName}`)).toEqual(['run -> pick']);
  });

  it('S6-A1 never indexes the venv, nor a folder with a pyvenv.cfg', () => {
    const root = copyFixture('shop');
    write(root, '.venv/lib/python3.12/site-packages/requests/__init__.py', 'def get(url): pass\n');
    write(root, 'env2/pyvenv.cfg', 'home = /usr/bin\n');
    write(root, 'env2/lib/site.py', 'x = 1\n');
    const scope = findScope(root);
    expect(scope.venv).toBe('.venv');
    expect(scope.files.filter((f) => f.language === 'python').map((f) => f.path)).toEqual(['api/orders.py', 'api/test_orders.py']);
  });

  it('S6-A1 a file outside every tsconfig is not in scope; with no tsconfig, every TypeScript file but .d.ts is', () => {
    const root = copyFixture('monorepo');
    write(root, 'tools/gen.ts', 'export const gen = 1;\n');
    expect(findScope(root).files.map((f) => f.path)).not.toContain('tools/gen.ts');
    const bare = join(dirname(root), 'bare');
    write(bare, 'src/a.ts', 'export const a = 1;\n');
    write(bare, 'src/a.d.ts', 'export declare const a: number;\n');
    write(bare, 'node_modules/x/index.ts', 'export const x = 1;\n');
    expect(findScope(bare)).toEqual({ files: [{ path: 'src/a.ts', language: 'typescript' }], tsconfigs: [] });
  });

  it('globRegex: a folder in include means every file below it; ** is any folders', () => {
    expect(globRegex('src', true).test('src/a/b.ts')).toBe(true);
    expect(globRegex('src/**/*.ts', true).test('src/b.ts')).toBe(true);
    expect(globRegex('src/*.ts', true).test('src/a/b.ts')).toBe(false);
    expect(globRegex('dist', false).test('dist')).toBe(true);
    expect(globRegex('**/*.test.ts', false).test('a/b.test.ts')).toBe(true);
  });
});

describe('terms (G2)', () => {
  it('splits camelCase, acronyms and snake_case into lower-case words', () => {
    expect(splitWords('getOrderById')).toBe('get order by id');
    expect(splitWords('get_order_by_id')).toBe('get order by id');
    expect(splitWords('parseHTTPResponse')).toBe('parse http response');
    expect(splitWords('src/orders.test.ts')).toBe('src orders test ts');
  });
});
