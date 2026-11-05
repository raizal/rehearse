// Pure model: lanes, swimlane layout and grouping, elements, playback steps.

import { describe, expect, it } from 'vitest';
import { boxAt, breadcrumb, diagramAt, lanesFor, parentPath } from '../src/model/diagram.js';
import { boxNodeId, laneNodeId, toFlowElements } from '../src/model/elements.js';
import { BOX_H, layoutDiagram, swimlaneLayout } from '../src/model/layout.js';
import { stepView } from '../src/model/playback.js';
import { reviewEpic } from './fixture.js';

const view = reviewEpic();
const flow = view.flow!;
const prd = view.prd!;

describe('swimlanes (R9)', () => {
  it('S4-A1: two lanes, builder then system, and each box is in the lane of its role', async () => {
    const lanes = lanesFor(flow, prd, flow.root, true);
    expect(lanes.map((l) => [l.role, l.label, l.kind])).toEqual([
      ['builder', 'Builder', 'human'],
      ['system', 'System', 'system'],
    ]);
    const layout = await layoutDiagram(flow.root, lanes);
    expect(layout.lanes.map((l) => l.role)).toEqual(['builder', 'system']);
    const lane = Object.fromEntries(layout.boxes.map((b) => [b.id, b.lane]));
    for (const box of flow.root.boxes) expect(lane[box.id]).toBe(box.lane);
    expect(lane).toMatchObject({ cart: 'builder', pay: 'system' });
    // Each box lies inside its lane band, and lanes do not overlap.
    const [builder, system] = layout.lanes;
    expect(system!.y).toBe(builder!.y + builder!.height);
    for (const b of layout.boxes) {
      const band = layout.lanes.find((l) => l.role === b.lane)!;
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y + BOX_H).toBeLessThanOrEqual(band.height);
    }
  });

  it('S4-A1: React Flow box nodes are children of their lane node', async () => {
    const lanes = lanesFor(flow, prd, flow.root, true);
    const { nodes } = toFlowElements(flow.root, await layoutDiagram(flow.root, lanes), { diagramPath: '' });
    expect(nodes.filter((n) => n.type === 'lane').map((n) => n.id)).toEqual([laneNodeId('builder'), laneNodeId('system')]);
    const parent = Object.fromEntries(nodes.filter((n) => n.type === 'box').map((n) => [n.id, n.parentId]));
    expect(parent[boxNodeId('cart')]).toBe(laneNodeId('builder'));
    expect(parent[boxNodeId('pay')]).toBe(laneNodeId('system'));
    expect(parent[boxNodeId('failed')]).toBe(laneNodeId('builder'));
  });

  it('boxes of one lane in the same column go to separate rows, so they do not overlap', () => {
    const diagram = { boxes: [box('a', 'x'), box('b', 'x'), box('c', 'y')], edges: [] };
    const layout = swimlaneLayout(diagram, [{ role: 'x', label: 'X', color: '#000' }, { role: 'y', label: 'Y', color: '#111' }], new Map([['a', 0], ['b', 0], ['c', 0]]));
    const [a, b] = layout.boxes;
    expect(a!.x).toBe(b!.x);
    expect(Math.abs(a!.y - b!.y)).toBeGreaterThanOrEqual(BOX_H);
    expect(layout.lanes[0]!.height).toBeGreaterThan(layout.lanes[1]!.height);
  });

  it('a nested diagram shows only the lanes it uses; an unlisted lane gets its own lane', () => {
    expect(lanesFor(flow, prd, diagramAt(flow, 'ship'), false).map((l) => l.role)).toEqual(['system']);
    const odd = { boxes: [box('a', 'builder'), box('b', 'ghost')], edges: [] };
    expect(lanesFor(flow, prd, odd, true).map((l) => [l.role, l.unknown ?? false])).toEqual([
      ['builder', false],
      ['system', false],
      ['ghost', true],
    ]);
  });

  it('edges keep their labels; error exits and branches have their own kind', async () => {
    const lanes = lanesFor(flow, prd, flow.root, true);
    const { edges } = toFlowElements(flow.root, await layoutDiagram(flow.root, lanes), { diagramPath: '' });
    const label = (from: string, to: string) => edges.find((e) => e.source === boxNodeId(from) && e.target === boxNodeId(to));
    expect(label('cart', 'failed')).toMatchObject({ label: '⚠ empty-cart', className: 'edge-error' });
    expect(label('in-stock', 'ship')).toMatchObject({ label: 'yes', className: 'edge-branch' });
    expect(label('cart', 'pay')).toMatchObject({ className: 'edge-normal' });
  });
});

describe('drill-down paths (S4-A2)', () => {
  it('S4-A2: the breadcrumb of a nested diagram is root, then the box', () => {
    expect(breadcrumb(flow, 'ship').map((c) => c.label)).toEqual(['root', 'ship']);
    expect(diagramAt(flow, 'ship')!.boxes.map((b) => b.path)).toEqual(['ship/pack', 'ship/send']);
    expect(diagramAt(flow, 'pay')).toBeUndefined();
    expect(boxAt(flow, 'ship/send')!.title).toBe('Send');
    expect(parentPath('ship/send')).toBe('ship');
    expect(parentPath('pay')).toBe('');
  });
});

describe('playback steps (R10, R21)', () => {
  const buy = view.scenarios.find((s) => s.scenario.id === 'S1-buy')!.scenario;

  it('S5-A1: step 2 is box pay, with its input, output and state change', () => {
    const s = stepView(flow, buy, 1)!;
    expect(s).toMatchObject({
      path: 'pay',
      diagramPath: '',
      input: { orderId: 'o1' },
      output: { orderId: 'o1' },
      stateAfter: { 'Order.status': 'paid' },
      writes: ['Order.status:draft->paid'],
    });
  });

  it('a leaf path step opens the nested diagram, and the last step shows the expected end state', () => {
    const s = stepView(flow, buy, 3)!;
    expect(s).toMatchObject({ path: 'ship/pack', diagramPath: 'ship', expect: { 'Order.status': 'shipped' } });
    expect(stepView(flow, buy, 2)).toMatchObject({ path: 'in-stock', branch: 'yes' });
    expect(stepView(flow, buy, 9)).toBeUndefined();
  });
});

function box(id: string, lane: string) {
  return { id, path: id, lane, kind: 'process' as const, title: id };
}
