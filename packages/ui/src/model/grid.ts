// Grid layout (design pages 5 and 6): the nodes stand in rows and columns, as the design draws
// them, and every edge is orthogonal. An edge between two neighbour cells is a straight line;
// any other edge runs in the channel between two rows and, when it has to change rows, down or
// up the gutter between two columns. So no edge crosses a box. Positions only, no drawing.

import { dotLabel, edgeLabelText, labelSize, type DEdge, type DGraph, type DNode, type GraphLayout, type LaidEdge, type Point, type Rect } from './graph.js';

export interface Cell {
  row: number;
  col: number;
}

export const GRID = {
  pad: 20,
  /** Least height of a channel between two rows. */
  channel: 36,
  /** Room for one edge (and its label) in a channel. */
  lane: 20,
  /** Least width of a gutter between two columns. */
  gutter: 64,
  /** Room for one edge in a gutter. */
  gutterLane: 12,
} as const;

type Side = 'top' | 'bottom' | 'left' | 'right';

interface Plan {
  e: DEdge;
  /** `h`: neighbours in a row; `v`: neighbours in a column; `route`: through channels. */
  kind: 'h' | 'v' | 'route';
  sSide: Side;
  tSide: Side;
  /** Channel next to the source and next to the target (channel k is above row k). */
  ch1: number;
  ch2: number;
  gutter?: number;
  gutterLane?: number;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Width and height a node needs in its cell: a dot keeps room for its label on both sides. */
function cellSize(n: DNode): { w: number; h: number } {
  const below = dotLabel(n);
  return below ? { w: Math.max(n.w, below.w), h: n.h + below.h * 2 } : { w: n.w, h: n.h };
}

/** The point on the outline of `n` at `r`, on `side`, at `at` along that side (x for top and bottom, y for left and right). */
function onOutline(n: DNode, r: Rect, side: Side, at: number): Point {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const vertical = side === 'top' || side === 'bottom';
  const sign = side === 'top' || side === 'left' ? -1 : 1;
  if (n.shape === 'start' || n.shape === 'end') {
    const rad = r.w / 2;
    const d = Math.min(rad, Math.abs(at - (vertical ? cx : cy)));
    const off = Math.sqrt(rad * rad - d * d);
    return vertical ? { x: at, y: cy + sign * off } : { x: cx + sign * off, y: at };
  }
  if (n.shape === 'decision') {
    const half = vertical ? r.h / 2 : r.w / 2;
    const span = vertical ? r.w / 2 : r.h / 2;
    const off = half * Math.max(0, 1 - Math.abs(at - (vertical ? cx : cy)) / span);
    return vertical ? { x: at, y: cy + sign * off } : { x: cx + sign * off, y: at };
  }
  if (vertical) return { x: at, y: side === 'top' ? r.y : r.y + r.h };
  return { x: side === 'left' ? r.x : r.x + r.w, y: at };
}

/** How far along a side ports may spread: dots use their centre, diamonds the middle half. */
function spread(n: DNode, len: number): number {
  if (n.shape === 'start' || n.shape === 'end') return 0;
  return n.shape === 'decision' ? len * 0.4 : len * 0.8;
}

/**
 * Lay the graph out on a grid. `cells` gives the row and column of every node; a node without
 * a cell is left out, and so are its edges. Rows and columns take the size of their biggest node.
 */
export interface GridOptions {
  /** Least height of a channel, instead of GRID.channel. */
  channel?: number;
  /** Room kept free above and below the lanes of every channel, and beside the lanes of every gutter (for frames drawn round groups of cells). */
  channelTop?: number;
  channelBottom?: number;
  gutterSide?: number;
}

export function layoutGrid(graph: DGraph, cells: ReadonlyMap<string, Cell>, opts: GridOptions = {}): GraphLayout {
  const { channel = GRID.channel, channelTop = 0, channelBottom = 0, gutterSide = 0 } = opts;
  const nodes = graph.nodes.filter((n) => cells.has(n.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const cell = (id: string) => cells.get(id)!;
  const rows = Math.max(0, ...nodes.map((n) => cell(n.id).row + 1));
  const cols = Math.max(0, ...nodes.map((n) => cell(n.id).col + 1));
  const rowH = Array.from({ length: rows }, () => 0);
  const colW = Array.from({ length: cols }, () => 0);
  for (const n of nodes) {
    const c = cell(n.id);
    const s = cellSize(n);
    rowH[c.row] = Math.max(rowH[c.row]!, s.h);
    colW[c.col] = Math.max(colW[c.col]!, s.w);
  }

  // 1. Plan each edge.
  const plans: Plan[] = [];
  for (const e of graph.edges) {
    if (!byId.has(e.from) || !byId.has(e.to) || e.from === e.to) continue;
    const s = cell(e.from);
    const t = cell(e.to);
    if (s.row === t.row && Math.abs(s.col - t.col) === 1) {
      const right = t.col > s.col;
      plans.push({ e, kind: 'h', sSide: right ? 'right' : 'left', tSide: right ? 'left' : 'right', ch1: -1, ch2: -1 });
    } else if (s.col === t.col && Math.abs(s.row - t.row) === 1) {
      const down = t.row > s.row;
      plans.push({ e, kind: 'v', sSide: down ? 'bottom' : 'top', tSide: down ? 'top' : 'bottom', ch1: -1, ch2: -1 });
    } else if (t.row > s.row) {
      plans.push({ e, kind: 'route', sSide: 'bottom', tSide: 'top', ch1: s.row + 1, ch2: t.row });
    } else if (t.row < s.row) {
      plans.push({ e, kind: 'route', sSide: 'top', tSide: 'bottom', ch1: s.row, ch2: t.row + 1 });
    } else {
      plans.push({ e, kind: 'route', sSide: 'top', tSide: 'top', ch1: s.row, ch2: s.row });
    }
  }

  // 2. Gutters: one lane per edge that changes channel; a gutter is wide enough for the labels of the straight edges across it.
  const gutterLanes = Array.from({ length: cols + 1 }, () => 0);
  const gutterLabel = Array.from({ length: cols + 1 }, () => 0);
  for (const p of plans) {
    if (p.kind === 'h') {
      const g = Math.max(cell(p.e.from).col, cell(p.e.to).col);
      if (p.e.label) gutterLabel[g] = Math.max(gutterLabel[g]!, labelSize(edgeLabelText(p.e.label)).w + 24);
    }
    if (p.kind !== 'route' || p.ch1 === p.ch2) continue;
    const s = cell(p.e.from).col;
    const t = cell(p.e.to).col;
    p.gutter = t > s ? t : t < s ? t + 1 : t;
    p.gutterLane = gutterLanes[p.gutter]!++;
  }
  const gutterW = gutterLanes.map((n, g) => 2 * gutterSide + Math.max(g === 0 || g === cols ? GRID.pad + n * GRID.gutterLane : GRID.gutter, 24 + n * GRID.gutterLane, gutterLabel[g]!));
  const colX = colW.map((_, c) => sum(gutterW.slice(0, c + 1)) + sum(colW.slice(0, c)));
  const width = sum(gutterW) + sum(colW);

  // 3. Node x, and the ports along the top and bottom of each node.
  const xOf = (n: DNode) => colX[cell(n.id).col]! + (colW[cell(n.id).col]! - n.w) / 2;
  const cxOf = (id: string) => xOf(byId.get(id)!) + byId.get(id)!.w / 2;
  const ports = new Map<string, number>(); // `${edge id}:s` or `:t` → x (top/bottom) or offset from the centre (left/right)
  const sides = new Map<string, { key: string; other: number }[]>();
  const addPort = (node: string, side: Side, key: string, other: number) => {
    const k = `${node}\n${side}`;
    sides.set(k, [...(sides.get(k) ?? []), { key, other }]);
  };
  for (const p of plans) {
    const s = byId.get(p.e.from)!;
    const t = byId.get(p.e.to)!;
    const vertical = p.sSide === 'top' || p.sSide === 'bottom';
    addPort(s.id, p.sSide, `${p.e.id}:s`, vertical ? cxOf(t.id) : cell(t.id).row);
    addPort(t.id, p.tSide, `${p.e.id}:t`, vertical ? cxOf(s.id) : cell(s.id).row);
  }
  for (const [k, list] of sides) {
    const [id, side] = k.split('\n') as [string, Side];
    const n = byId.get(id)!;
    const vertical = side === 'top' || side === 'bottom';
    const len = spread(n, vertical ? n.w : n.h);
    list.sort((a, b) => a.other - b.other || (a.key < b.key ? -1 : 1));
    list.forEach((p, i) => {
      const off = list.length === 1 ? 0 : -len / 2 + (len * i) / (list.length - 1);
      ports.set(p.key, vertical ? xOf(n) + n.w / 2 + off : Math.max(-len / 2, Math.min(len / 2, (i - (list.length - 1) / 2) * 12)));
    });
  }
  // A straight edge between column neighbours keeps one x where it can.
  for (const p of plans) {
    if (p.kind !== 'v') continue;
    const t = byId.get(p.e.to)!;
    const x = ports.get(`${p.e.id}:s`)!;
    const lo = xOf(t) + Math.min(t.w / 2, 8);
    const hi = xOf(t) + t.w - Math.min(t.w / 2, 8);
    ports.set(`${p.e.id}:t`, t.shape === 'start' || t.shape === 'end' ? xOf(t) + t.w / 2 : Math.max(lo, Math.min(hi, x)));
  }

  // 4. Channels: the horizontal runs, packed into lanes where they do not overlap.
  interface Run {
    p: Plan;
    which: 1 | 2;
    x1: number;
    x2: number;
    lane: number;
    label: boolean;
  }
  const runs: Run[] = [];
  for (const p of plans) {
    if (p.kind !== 'route') continue;
    const sx = ports.get(`${p.e.id}:s`)!;
    const tx = ports.get(`${p.e.id}:t`)!;
    if (p.ch1 === p.ch2) runs.push({ p, which: 1, x1: sx, x2: tx, lane: 0, label: !!p.e.label });
    else {
      const g = gutterX(p);
      const one: Run = { p, which: 1, x1: sx, x2: g, lane: 0, label: false };
      const two: Run = { p, which: 2, x1: g, x2: tx, lane: 0, label: false };
      (Math.abs(one.x2 - one.x1) >= Math.abs(two.x2 - two.x1) ? one : two).label = !!p.e.label;
      runs.push(one, two);
    }
  }
  function gutterX(p: Plan): number {
    const g = p.gutter!;
    const left = g === 0 ? 0 : colX[g - 1]! + colW[g - 1]!;
    const w = gutterW[g]!;
    const n = gutterLanes[g]!;
    const first = left + (w - (n - 1) * GRID.gutterLane) / 2;
    return first + p.gutterLane! * GRID.gutterLane;
  }
  const span = (r: Run): [number, number] => {
    let a = Math.min(r.x1, r.x2);
    let b = Math.max(r.x1, r.x2);
    if (r.label && r.p.e.label) {
      const w = labelSize(edgeLabelText(r.p.e.label)).w;
      const mid = (r.x1 + r.x2) / 2;
      a = Math.min(a, mid - w / 2);
      b = Math.max(b, mid + w / 2);
    }
    return [a - 6, b + 6];
  };
  const chOf = (r: Run) => (r.which === 1 ? r.p.ch1 : r.p.ch2);
  const laneCount = Array.from({ length: rows + 1 }, () => 0);
  for (let ch = 0; ch <= rows; ch++) {
    const mine = runs.filter((r) => chOf(r) === ch).sort((a, b) => span(a)[0] - span(b)[0]);
    const ends: number[] = [];
    for (const r of mine) {
      const [a, b] = span(r);
      let lane = ends.findIndex((end) => end < a);
      if (lane < 0) lane = ends.push(0) - 1;
      ends[lane] = b;
      r.lane = lane;
    }
    laneCount[ch] = ends.length;
  }
  const channelH = laneCount.map((n, ch) => channelTop + channelBottom + (n === 0 && (ch === 0 || ch === rows) ? GRID.pad : Math.max(channel, 18 + n * GRID.lane)));
  const rowY = rowH.map((_, r) => sum(channelH.slice(0, r + 1)) + sum(rowH.slice(0, r)));
  const height = sum(channelH) + sum(rowH);
  const laneY = (ch: number, lane: number) => {
    const top = ch === 0 ? 0 : rowY[ch - 1]! + rowH[ch - 1]!;
    const n = laneCount[ch]!;
    return top + channelTop + (channelH[ch]! - channelTop - channelBottom - (n - 1) * GRID.lane) / 2 + lane * GRID.lane;
  };

  // 5. Rects, then the points of each edge.
  const rects: Record<string, Rect> = {};
  for (const n of nodes) {
    const c = cell(n.id);
    rects[n.id] = { x: xOf(n), y: rowY[c.row]! + (rowH[c.row]! - n.h) / 2, w: n.w, h: n.h };
  }
  const endPoint = (id: string, side: Side, key: string): Point => {
    const n = byId.get(id)!;
    const r = rects[id]!;
    const at = side === 'top' || side === 'bottom' ? ports.get(key)! : r.y + r.h / 2 + ports.get(key)!;
    return onOutline(n, r, side, at);
  };
  const runOf = new Map(runs.map((r) => [`${r.p.e.id}:${r.which}`, r]));
  const edges: LaidEdge[] = [];
  for (const p of plans) {
    const sp = endPoint(p.e.from, p.sSide, `${p.e.id}:s`);
    const tp = endPoint(p.e.to, p.tSide, `${p.e.id}:t`);
    let points: Point[];
    let label: Point | undefined;
    if (p.kind === 'h' || p.kind === 'v') {
      const h = p.kind === 'h';
      const aligned = h ? Math.abs(sp.y - tp.y) < 0.5 : Math.abs(sp.x - tp.x) < 0.5;
      const mid = h ? (sp.x + tp.x) / 2 : (sp.y + tp.y) / 2;
      points = aligned ? [sp, tp] : h ? [sp, { x: mid, y: sp.y }, { x: mid, y: tp.y }, tp] : [sp, { x: sp.x, y: mid }, { x: tp.x, y: mid }, tp];
      label = h ? { x: mid, y: sp.y } : { x: tp.x, y: mid };
    } else {
      const one = runOf.get(`${p.e.id}:1`)!;
      const y1 = laneY(p.ch1, one.lane);
      if (p.ch1 === p.ch2) {
        points = [sp, { x: sp.x, y: y1 }, { x: tp.x, y: y1 }, tp];
        label = { x: (sp.x + tp.x) / 2, y: y1 };
      } else {
        const two = runOf.get(`${p.e.id}:2`)!;
        const y2 = laneY(p.ch2, two.lane);
        const gx = gutterX(p);
        points = [sp, { x: sp.x, y: y1 }, { x: gx, y: y1 }, { x: gx, y: y2 }, { x: tp.x, y: y2 }, tp];
        label = one.label ? { x: (sp.x + gx) / 2, y: y1 } : { x: (gx + tp.x) / 2, y: y2 };
      }
    }
    const text = p.e.label ? edgeLabelText(p.e.label) : undefined;
    const size = text ? labelSize(text) : undefined;
    edges.push({ id: p.e.id, points: dedupe(points), ...(size && label ? { label: { x: label.x - size.w / 2, y: label.y - size.h / 2, w: size.w, h: size.h } } : {}) });
  }
  return { width, height, nodes: rects, groups: {}, edges };
}

/** Drop repeated points and points in the middle of a straight run. */
function dedupe(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    const prev = out[out.length - 2];
    if (prev && last && ((Math.abs(prev.x - last.x) < 0.5 && Math.abs(last.x - p.x) < 0.5) || (Math.abs(prev.y - last.y) < 0.5 && Math.abs(last.y - p.y) < 0.5))) out.pop();
    out.push(p);
  }
  return out;
}

/** How many columns of `cellW` (plus a gutter) fit in `width`; at least one. */
export function columnsFor(width: number, cellW: number): number {
  return Math.max(1, Math.floor((width - GRID.pad * 2 + GRID.gutter) / (cellW + GRID.gutter)));
}

/**
 * Cells of a flow in rows that snake (design page 5): the main path in depth-first order from the
 * first start, left to right, then right to left on the next row, so each step stands next to
 * the one before it. Side nodes (an end that is not the last step, and the boxes only a later
 * start reaches) take the free cell nearest to a node they link to.
 */
export function snakeCells(graph: DGraph, cols: number): Map<string, Cell> {
  const ids = graph.nodes.map((n) => n.id);
  const shape = new Map(graph.nodes.map((n) => [n.id, n.shape]));
  const next = new Map<string, string[]>();
  for (const e of graph.edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  const seen = new Set<string>();
  const order: string[] = [];
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
    const outs = next.get(id) ?? [];
    // An end is visited last, so the path carries on before it stops.
    for (const to of [...outs.filter((t) => shape.get(t) !== 'end'), ...outs.filter((t) => shape.get(t) === 'end')]) walk(to);
  };
  const starts = ids.filter((id) => shape.get(id) === 'start');
  walk(starts[0] ?? ids[0]!);
  const mainCount = order.length;
  for (const id of [...starts.slice(1), ...ids]) walk(id);
  const lastEnd = order.slice(0, mainCount).filter((id) => shape.get(id) === 'end').pop();
  const side = new Set(order.filter((id, i) => i >= mainCount || (shape.get(id) === 'end' && id !== lastEnd)));
  const chain = order.filter((id) => !side.has(id));

  const cells = new Map<string, Cell>();
  const taken = new Set<string>();
  const put = (id: string, c: Cell) => {
    cells.set(id, c);
    taken.add(`${c.row},${c.col}`);
  };
  chain.forEach((id, i) => {
    const row = Math.floor(i / cols);
    const k = i % cols;
    put(id, { row, col: row % 2 === 0 ? k : cols - 1 - k });
  });
  const linked = (id: string) => graph.edges.flatMap((e) => (e.from === id ? [e.to] : e.to === id ? [e.from] : []));
  let left = [...side];
  while (left.length > 0) {
    const i = Math.max(0, left.findIndex((id) => linked(id).some((o) => cells.has(o))));
    const id = left[i]!;
    left = left.filter((_, j) => j !== i);
    const near = linked(id).map((o) => cells.get(o)).find((c) => c !== undefined) ?? { row: 0, col: 0 };
    let best: Cell | undefined;
    let bestD = Infinity;
    const lastRow = Math.max(0, ...[...cells.values()].map((c) => c.row)) + 1;
    for (let row = 0; row <= lastRow; row++) {
      for (let col = 0; col < cols; col++) {
        if (taken.has(`${row},${col}`)) continue;
        // Below is nearer than above, so a side step hangs under the step it leaves.
        const d = Math.abs(row - near.row) * 2 + Math.abs(col - near.col) * 2 + (row < near.row ? 1 : 0);
        if (d < bestD) {
          bestD = d;
          best = { row, col };
        }
      }
    }
    put(id, best!);
  }
  return cells;
}

/** The width a diagram may take on a 1920 wide page: the page less its margins and the card padding. */
export const DIAGRAM_W = 1780;

/**
 * A flow snaking in rows as wide as the page at most: as many columns as the widest node allows,
 * one fewer while the lanes in the gutters make it wider than `maxW` (down to three).
 */
export function snakeLayout(graph: DGraph, maxW: number = DIAGRAM_W): { layout: GraphLayout; cols: number } {
  let cols = columnsFor(maxW, Math.max(...graph.nodes.map((n) => n.w)));
  let layout = layoutGrid(graph, snakeCells(graph, cols));
  while (layout.width > maxW && cols > 3) {
    cols -= 1;
    layout = layoutGrid(graph, snakeCells(graph, cols));
  }
  return { layout, cols };
}
