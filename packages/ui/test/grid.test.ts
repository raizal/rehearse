// T18b: the grid layout of design pages 5, 6 and 8 (user flow, data flow, architecture). Nodes in
// rows and columns, orthogonal edges that never cross a box, and the map fits its width.

import { describe, expect, it } from 'vitest';
import { archCells, archLayout, drawingOf, diffDrawing } from '../src/model/architecture.js';
import { dataFlow, dataFlowCells } from '../src/model/dataflow.js';
import type { DGraph, GraphLayout, Point, Rect } from '../src/model/graph.js';
import { columnsFor, DIAGRAM_W, layoutGrid, snakeCells, type Cell } from '../src/model/grid.js';
import { userFlow } from '../src/model/userflow.js';
import { codeGraphEpic, realEpic, reviewEpic } from './fixture.js';

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Does the segment a–b (horizontal or vertical) pass through the inside of r? */
function crosses(a: Point, b: Point, r: Rect): boolean {
  const e = 0.5;
  if (Math.abs(a.y - b.y) < e) return a.y > r.y + e && a.y < r.y + r.h - e && Math.max(a.x, b.x) > r.x + e && Math.min(a.x, b.x) < r.x + r.w - e;
  return a.x > r.x + e && a.x < r.x + r.w - e && Math.max(a.y, b.y) > r.y + e && Math.min(a.y, b.y) < r.y + r.h - e;
}

/** Every node placed in the canvas, none overlap; every edge orthogonal and clear of the boxes it does not join. */
function expectGridReadable(nodes: { id: string }[], edges: { id: string; from: string; to: string }[], lay: GraphLayout) {
  const rects = nodes.map((n) => ({ id: n.id, r: lay.nodes[n.id]! }));
  for (const { id, r } of rects) {
    expect(r, id).toBeDefined();
    expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= lay.width && r.y + r.h <= lay.height, `${id} inside the canvas`).toBe(true);
  }
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i]!.r, rects[j]!.r), `${rects[i]!.id} overlaps ${rects[j]!.id}`).toBe(false);
  for (const e of edges) {
    const pts = lay.edges.find((l) => l.id === e.id)?.points ?? [];
    expect(pts.length, `edge ${e.from} → ${e.to}`).toBeGreaterThanOrEqual(2);
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1]!;
      const b = pts[k]!;
      expect(Math.abs(a.x - b.x) < 0.5 || Math.abs(a.y - b.y) < 0.5, `edge ${e.from} → ${e.to} is orthogonal`).toBe(true);
      for (const { id, r } of rects) if (id !== e.from && id !== e.to) expect(crosses(a, b, r), `edge ${e.from} → ${e.to} crosses ${id}`).toBe(false);
    }
  }
}

const uniqueCells = (cells: Map<string, Cell>) => new Set([...cells.values()].map((c) => `${c.row},${c.col}`)).size === cells.size;

describe('T18b grid layout (pages 5 and 6)', () => {
  it('T18b 5 the real user flow snakes in rows that fit the page width, with no edge through a box', () => {
    const view = realEpic();
    const uf = userFlow(view.flow, view.prd);
    const cols = columnsFor(DIAGRAM_W, Math.max(...uf.nodes.map((n) => n.w)));
    const cells = snakeCells(uf, cols);
    expect(cells.size).toBe(uf.nodes.length);
    expect(uniqueCells(cells)).toBe(true);
    expect(Math.max(...[...cells.values()].map((c) => c.col))).toBeLessThan(cols);
    const lay = layoutGrid(uf, cells);
    expect(lay.width).toBeLessThanOrEqual(DIAGRAM_W);
    expectGridReadable(uf.nodes, uf.edges, lay);
  });

  it('T18b 5 neighbours in a row are joined by one straight line, labelled in the gap', () => {
    const g: DGraph = {
      nodes: [
        { id: 'a', shape: 'action', title: 'A', w: 120, h: 50 },
        { id: 'b', shape: 'action', title: 'B', w: 120, h: 50 },
        { id: 'c', shape: 'action', title: 'C', w: 120, h: 50 },
      ],
      edges: [
        { id: 'ab', from: 'a', to: 'b', label: 'next', kind: 'normal' },
        { id: 'ac', from: 'a', to: 'c', kind: 'normal' },
      ],
      groups: [],
    };
    const cells = new Map<string, Cell>([
      ['a', { row: 0, col: 0 }],
      ['b', { row: 0, col: 1 }],
      ['c', { row: 0, col: 2 }],
    ]);
    const lay = layoutGrid(g, cells);
    const ab = lay.edges.find((e) => e.id === 'ab')!;
    expect(ab.points.length).toBe(2);
    expect(ab.label!.x).toBeGreaterThanOrEqual(lay.nodes.a!.x + lay.nodes.a!.w);
    expect(ab.label!.x + ab.label!.w).toBeLessThanOrEqual(lay.nodes.b!.x);
    // a → c jumps over b: it runs in the channel above the row.
    const ac = lay.edges.find((e) => e.id === 'ac')!;
    expect(Math.min(...ac.points.map((p) => p.y))).toBeLessThan(lay.nodes.b!.y);
    expectGridReadable(g.nodes, g.edges, lay);
  });

  it('T18b 6 data flow: entities in the first column, processes in even rows, stores in odd rows under them', () => {
    for (const view of [reviewEpic(), realEpic()]) {
      const df = dataFlow(view.flow, view.prd, view.entities);
      const cells = dataFlowCells(df, 7);
      expect(cells.size).toBe(df.nodes.length);
      expect(uniqueCells(cells)).toBe(true);
      for (const n of df.nodes) {
        const c = cells.get(n.id)!;
        if (n.shape === 'entity') expect(c.col, n.id).toBe(0);
        if (n.shape === 'process') expect(c.row % 2, n.id).toBe(0);
        if (n.shape === 'store') expect(c.row % 2, n.id).toBe(1);
      }
      const lay = layoutGrid(df, cells);
      expect(lay.width).toBeLessThanOrEqual(DIAGRAM_W);
      expectGridReadable(df.nodes, df.edges, lay);
    }
  });
});

describe('T18b architecture on the grid (pages 8 and 11)', () => {
  it('T18b 8 the biggest zone stands right, the zones that fit its height stack left of it, the rest go below', () => {
    const d = drawingOf(realEpic().system!.architecture!);
    const cells = archCells(d);
    const cols = (zone: string) => new Set(d.parts.filter((p) => p.zone === zone).map((p) => cells.get(p.id)!.col));
    expect(Math.min(...cols('repo'))).toBeGreaterThan(Math.max(...cols('bb'), ...cols('agent')));
    const rows = (zone: string) => d.parts.filter((p) => p.zone === zone).map((p) => cells.get(p.id)!.row);
    expect(Math.min(...rows('ci'))).toBeGreaterThan(Math.max(...rows('repo'), ...rows('bb'), ...rows('agent')));
    expect(cells.get('builder')).toEqual({ row: cells.get('panel')!.row, col: 0 });
    expect(cells.get('pull-request')!.row).toBe(cells.get('ci-runner')!.row);
  });

  it('T18b 8 notes stand in their zone; no link runs through a part or a note', () => {
    const d = drawingOf(realEpic().system!.architecture!);
    const lay = archLayout(d);
    const inside = (a: Rect, z: Rect) => a.x >= z.x && a.y >= z.y && a.x + a.w <= z.x + z.w && a.y + a.h <= z.y + z.h;
    d.notes.forEach((n, i) => expect(inside(lay.notes.get(i)!, lay.zones.get(n.zone!)!), `note ${i}`).toBe(true));
    const nodes: GraphLayout['nodes'] = { ...Object.fromEntries(lay.parts), ...Object.fromEntries([...lay.notes].map(([i, r]) => [`note ${i}`, r])) };
    const grid: GraphLayout = { width: lay.width, height: lay.height, nodes, groups: {}, edges: lay.links.map((l, i) => ({ id: String(i), points: l.points })) };
    expectGridReadable(
      Object.keys(nodes).map((id) => ({ id })),
      lay.links.map((l, i) => ({ id: String(i), from: l.from, to: l.to })),
      grid,
    );
  });

  it('T18b 11 the compact layout of a side is narrower than the full one, and holds every part', () => {
    const d = diffDrawing(codeGraphEpic().compare!.architecture, 'diff');
    const full = archLayout(d);
    const compact = archLayout(d, { compact: true });
    expect(compact.width).toBeLessThan(full.width * 0.75);
    for (const p of d.parts) expect(compact.parts.get(p.id), p.id).toBeDefined();
  });
});
