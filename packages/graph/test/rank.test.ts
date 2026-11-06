// Box `update-graph/rank` (G14): PageRank over the graph, its numbers in GraphNode.rank.

import { afterEach, describe, expect, it } from 'vitest';
import { openGraph, pageRank, type Graph, type GraphEdge, type GraphNode } from '../src/index.js';
import { copyFixture } from './helpers.js';

const node = (id: string): GraphNode => ({ id, kind: 'function', name: id, terms: id, language: 'typescript', targetOnly: false, rank: 0 });
const calls = (from: string, to: string): GraphEdge => ({ from, to, kind: 'calls', trust: 'name-match', source: 'tree-sitter' });

describe('G14 PageRank', () => {
  it('a node many nodes point to ranks highest, and the ranks sum to 1', () => {
    const nodes = ['a', 'b', 'c', 'd'].map(node);
    const ranks = pageRank().rank({ nodes, edges: [calls('a', 'd'), calls('b', 'd'), calls('c', 'd'), calls('d', 'a')] });
    expect([...ranks.keys()].sort()).toEqual(['a', 'b', 'c', 'd']);
    const r = (id: string) => ranks.get(id)!;
    expect(r('d')).toBeGreaterThan(r('a'));
    expect(r('a')).toBeGreaterThan(r('b'));
    expect(r('b')).toBe(r('c'));
    expect([...ranks.values()].reduce((s, x) => s + x, 0)).toBeCloseTo(1, 4);
  });

  it('a node with no out-edge spreads its rank to every node, and edges to unknown nodes count for nothing', () => {
    const ranks = pageRank().rank({ nodes: ['a', 'b'].map(node), edges: [calls('a', 'b'), calls('a', 'gone')] });
    expect(ranks.get('b')!).toBeGreaterThan(ranks.get('a')!);
    expect(ranks.has('gone')).toBe(false);
    expect(ranks.get('a')! + ranks.get('b')!).toBeCloseTo(1, 4);
  });

  it('the same graph in another order gives the same ranks (S4-A3)', () => {
    const nodes = ['a', 'b', 'c'].map(node);
    const edges = [calls('a', 'b'), calls('b', 'c'), calls('c', 'a'), calls('a', 'c')];
    const one = pageRank().rank({ nodes, edges });
    const two = pageRank().rank({ nodes: [...nodes].reverse(), edges: [...edges].reverse() });
    expect([...two.entries()].sort()).toEqual([...one.entries()].sort());
  });

  it('an empty graph has no ranks', () => {
    expect(pageRank().rank({ nodes: [], edges: [] }).size).toBe(0);
  });
});

describe('update-graph/rank', () => {
  let graph: Graph;
  afterEach(() => graph.close());

  it('openGraph ranks by PageRank: on the shop, getOrderById (called three times) outranks getOrder (called by none)', async () => {
    graph = openGraph(copyFixture('shop'));
    await graph.update();
    const rank = (name: string) => graph.store.nodesWhere('name = ?', name)[0]!.rank;
    expect(rank('getOrderById')).toBeGreaterThan(rank('getOrder'));
    expect(rank('getOrder')).toBeGreaterThan(0);
  });
});
