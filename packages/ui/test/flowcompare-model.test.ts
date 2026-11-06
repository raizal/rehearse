// T42: Before / after → Flow as a flow chart. The chart model: the root of both flows with a status
// per box and edge, the side filters, the React Flow elements and the path of edges that skip boxes.

import { describe, expect, it } from 'vitest';
import { BOX_H, BOX_W, layoutDiagram } from '../src/model/layout.js';
import { chartSide, compareElements, detourPath, edgeText, flowCompareChart, OUTSIDE_LANE } from '../src/model/flowcompare.js';
import { codeGraphEpic, realEpic } from './fixture.js';

const chartOf = (view = codeGraphEpic()) => flowCompareChart(view.compare!, view.system?.flow, view.flow, view.prd);

describe('T42 2 the flow chart model', () => {
  it('T42 2 the root boxes of both flows with their status; a box with children is one box with its steps', () => {
    const view = codeGraphEpic();
    const after = view.compare!.boxes.find((b) => b.path === 'draft-record')!.after!;
    after.children = { boxes: [{ ...after, id: 'a', path: 'draft-record/a', children: undefined }, { ...after, id: 'b', path: 'draft-record/b', children: undefined }], edges: [] };
    const chart = chartOf(view);
    expect(chart.boxes.map((b) => `${b.status} ${b.path}`)).toEqual(expect.arrayContaining(['same start', 'added ask-context', 'changed draft-record', 'removed grep-code', 'same done']));
    expect(chart.boxes.every((b) => !b.path.includes('/'))).toBe(true);
    const draft = chart.boxes.find((b) => b.path === 'draft-record')!;
    expect(draft.steps).toBe(2);
    expect(chart.boxes.find((b) => b.path === 'validate')!.steps).toBe(0);
    expect(draft.opens).toBe(true);
    // A removed step no flow has stands in its own lane, and the drawer cannot open it.
    const grep = chart.boxes.find((b) => b.path === 'grep-code')!;
    expect(grep).toMatchObject({ onBefore: false, onAfter: false, opens: false });
    expect(grep.box.lane).toBe(OUTSIDE_LANE);
    expect(chart.lanes.find((l) => l.role === OUTSIDE_LANE)?.label).toBe('Outside the record');
  });

  it('T42 2 the root edges with their status and branch names, nested edges left out', () => {
    const chart = chartOf();
    expect(chart.edges.map((e) => `${e.status} ${e.from}->${e.to}${e.label ? ` ${e.label}` : ''}`)).toEqual(
      expect.arrayContaining(['added start->ask-context', 'removed start->draft-record', 'same validate->sign-off', 'same sign-off->done']),
    );
    const view = codeGraphEpic();
    expect(chart.edges).toHaveLength(view.compare!.flowEdges.filter((e) => e.diagram === '').length);
  });

  it('T42 2 each side keeps its own boxes and edges; before shows no status', () => {
    const chart = chartOf();
    const before = chartSide(chart, 'before');
    const after = chartSide(chart, 'after');
    const diff = chartSide(chart, 'diff');
    expect(before.boxes.map((b) => b.path).sort()).toEqual(['done', 'draft-record', 'sign-off', 'start', 'validate']);
    expect(before.boxes.every((b) => b.shown === undefined)).toBe(true);
    expect(before.edges.some((e) => e.from === 'start' && e.to === 'draft-record')).toBe(true);
    expect(after.boxes.some((b) => b.path === 'ask-context')).toBe(true);
    expect(after.edges.some((e) => e.status === 'removed')).toBe(false);
    expect(diff.boxes).toHaveLength(chart.boxes.length);
    expect(diff.edges.find((e) => e.status === 'removed')?.shown).toBe('removed');
  });

  it('T42 2 the elements: one layout places a box in the same spot on every side; edges carry their status look', async () => {
    const chart = chartOf();
    const layout = await layoutDiagram(chart.diagram, chart.lanes);
    const at = (side: 'before' | 'after' | 'diff') =>
      new Map(compareElements(chart, layout, side).nodes.filter((n) => n.type === 'cbox').map((n) => [n.id, `${n.parentId} ${n.position.x},${n.position.y}`]));
    const before = at('before');
    const after = at('after');
    expect(before.size).toBe(5);
    for (const [id, pos] of before) expect(after.get(id) ?? at('diff').get(id)).toBe(pos);
    const diff = compareElements(chart, layout, 'diff');
    const removed = diff.edges.find((e) => e.ariaLabel === 'start → draft-record (removed link)');
    expect(removed?.className).toContain('is-removed');
    expect(diff.edges.find((e) => e.ariaLabel === 'start → ask-context (new link)')?.className).toContain('is-added');
    expect(compareElements(chart, layout, 'before').edges.every((e) => !/is-(added|changed|removed)/.test(e.className ?? ''))).toBe(true);
  });

  it('T42 2 hover lights the edges of one box and fades the others', async () => {
    const chart = chartOf();
    const layout = await layoutDiagram(chart.diagram, chart.lanes);
    const { nodes, edges } = compareElements(chart, layout, 'diff', 'validate');
    const lit = edges.filter((e) => e.className?.includes('is-lit'));
    expect(lit.length).toBeGreaterThan(0);
    expect(lit.every((e) => e.source === 'box:validate' || e.target === 'box:validate')).toBe(true);
    expect(edges.filter((e) => e.className?.includes('is-faint')).length).toBe(edges.length - lit.length);
    expect(nodes.find((n) => n.id === 'box:validate')?.data).toMatchObject({ lit: true });
  });

  it('T42 2 an edge shows its branch name; an error edge is marked', () => {
    expect(edgeText({ kind: 'normal' })).toBeUndefined();
    expect(edgeText({ label: 'yes', kind: 'normal' })).toBe('yes');
    expect(edgeText({ label: 'forbidden', kind: 'error' })).toBe('⚠ forbidden');
  });

  it('T42 2 an edge to the next column is a plain step; one that goes back or skips a column runs under the row', () => {
    expect(detourPath(100, 50, 156, 50)).toBeUndefined();
    expect(detourPath(100, 50, 156, 150)).toBeUndefined();
    const back = detourPath(600, 50, 100, 50)!;
    expect(back.labelY).toBe(50 + BOX_H / 2 + 11);
    expect(back.path.startsWith('M 600 50')).toBe(true);
    expect(back.path.endsWith('L 100 50')).toBe(true);
    const skip = detourPath(100, 50, 100 + BOX_W + 2 * 56 + 56, 150)!;
    expect(skip.labelY).toBe(150 + BOX_H / 2 + 11);
  });

  it('T42 2 an EPIC with no root flow and an as-is with none draw nothing', () => {
    const view = realEpic();
    const chart = flowCompareChart({ ...view.compare!, boxes: [], flowEdges: [] } as never, undefined, undefined, undefined);
    expect(chart.boxes).toEqual([]);
    expect(chart.edges).toEqual([]);
  });
});
