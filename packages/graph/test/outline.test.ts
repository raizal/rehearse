// S9-A1 (box code-view): the AST outline the panel shows below a leaf box, for the function the box
// builds. The outline is the tree-sitter syntax tree of the node's lines, named nodes only.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openGraph, outlineNode, type AstOutlineNode, type Graph } from '../src/index.js';
import { copyFixture } from './helpers.js';

let root: string;
let graph: Graph;

beforeEach(async () => {
  root = copyFixture('shop');
  graph = openGraph(root);
  await graph.update();
});

afterEach(() => graph.close());

const types = (n: AstOutlineNode): string[] => [n.type, ...n.children.flatMap(types)];

describe('S9-A1 AST outline of a code node', () => {
  it('S9-A1 the outline of charge is its function declaration, with its name, parameters and body', async () => {
    const charge = (await graph.show('charge')).nodes[0]!;
    const outline = await outlineNode(root, charge);
    expect(outline).toBeDefined();
    expect(outline!.root).toMatchObject({ type: 'function_declaration', name: 'charge', lines: '10-30' });
    const all = types(outline!.root);
    expect(all).toContain('formal_parameters');
    expect(all).toContain('statement_block');
    expect(all).toContain('if_statement');
    expect(all).toContain('return_statement');
    expect(outline!.cut).toBe(false);
    expect(outline!.nodes).toBe(all.length);
  });

  it('S9-A1 a Python function has an outline too; a route keeps its decorator', async () => {
    const load = await outlineNode(root, (await graph.show('load_row')).nodes[0]!);
    expect(load!.root).toMatchObject({ type: 'function_definition', name: 'load_row', lines: '9-10' });
    const route = await outlineNode(root, (await graph.show('get_order')).nodes[0]!);
    expect(route!.root).toMatchObject({ type: 'decorated_definition', name: 'get_order' });
    expect(types(route!.root)).toContain('decorator');
  });

  it('S9-A1 a big tree is cut at the node limit, and says so', async () => {
    const charge = (await graph.show('charge')).nodes[0]!;
    const outline = await outlineNode(root, charge, { maxNodes: 5 });
    expect(outline!.nodes).toBe(5);
    expect(outline!.cut).toBe(true);
  });

  it('S9-A1 a node with no file or lines has no outline', async () => {
    const charge = (await graph.show('charge')).nodes[0]!;
    const { range: _range, ...noRange } = charge;
    expect(await outlineNode(root, noRange)).toBeUndefined();
    expect(await outlineNode(root, { ...charge, file: 'src/gone.ts' })).toBeUndefined();
  });
});
