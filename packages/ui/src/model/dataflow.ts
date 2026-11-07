// The data flow diagram of the EPIC, level 1 (D42, design page 6). External entities are the
// lanes of kind human, agent and external; processes are the root boxes that read or write
// data, numbered 1.0, 2.0 … in flow order; data stores are the entities, numbered D1, D2 … in
// entities.yaml order. Flows come from `writes` (process → store), `reads` (store → process)
// and inputs/outputs: an output a later process takes as input flows between the two, an input
// no earlier process gives comes from the role of the lane, an output no later process takes
// goes back to it. Fields of flow.yaml `context` reach every box, so they are not drawn.

import type { Box, EntityModel, Flow, Prd } from '@rehearse/core';
import { lanesFor } from './diagram.js';
import { nodeSize, type DEdge, type DGraph, type DNode, type FoldRow, type GraphLayout } from './graph.js';
import { columnsFor, DIAGRAM_W, layoutGrid, type Cell } from './grid.js';
import { mergeEdges, rootGraph } from './userflow.js';

export interface DataProcess {
  path: string;
  number: string;
  title: string;
}

export interface DataStore {
  entity: string;
  number: string;
  /** False for an entity a box names but entities.yaml does not have. */
  known: boolean;
}

export interface OnlyWriter {
  entity: string;
  store: string;
  process: DataProcess;
}

export interface DataFlow extends DGraph {
  processes: DataProcess[];
  stores: DataStore[];
  /** Entities that one process alone writes. */
  onlyWriters: OnlyWriter[];
  /** Root process, input, output and external boxes that read and write nothing. */
  noData: FoldRow[];
}

/** Lane kinds drawn as external entities. */
export const EXTERNAL_KINDS = ['human', 'agent', 'external'] as const;

/** `Story.status:draft->signed` → entity Story, words `status: draft→signed`; `Box.*` → `all fields`. */
export function parseAccess(access: string): { entity: string; words: string } | undefined {
  const m = /^([A-Za-z][\w]*)\.([^:]+)(?::(.*))?$/.exec(access.trim());
  if (!m) return undefined;
  const field = m[2] === '*' ? 'all fields' : m[2]!;
  const change = m[3] === undefined ? '' : `: ${m[3].replace('->', '→')}`;
  return { entity: m[1]!, words: `${field}${change}` };
}

function accessList(list: unknown): string[] {
  return Array.isArray(list) ? list.filter((a): a is string => typeof a === 'string') : [];
}

/** Entity → its fields in words, in the order the list names them. */
function byEntity(list: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const a of accessList(list)) {
    const p = parseAccess(a);
    if (!p) continue;
    const words = out.get(p.entity) ?? [];
    if (!words.includes(p.words)) words.push(p.words);
    out.set(p.entity, words);
  }
  return out;
}

const keys = (m: unknown): string[] => (m && typeof m === 'object' && !Array.isArray(m) ? Object.keys(m) : []);

export function dataFlow(flow: Flow | undefined, prd: Prd | undefined, entities: EntityModel | undefined): DataFlow {
  const lanes = lanesFor(flow, prd, flow?.root, true);
  const { boxes, edges } = rootGraph(flow);
  const context = new Set(keys(flow?.context));
  const isProcess = (b: Box) => accessList(b.reads).length + accessList(b.writes).length > 0;
  const processBoxes = boxes.filter(isProcess);
  const processes: DataProcess[] = processBoxes.map((b, i) => ({ path: b.id, number: `${i + 1}.0`, title: typeof b.title === 'string' ? b.title : b.id }));
  const procOf = new Map(processes.map((p) => [p.path, p]));

  const known = (Array.isArray(entities?.entities) ? entities.entities : []).map((e) => e.id);
  const used = new Set(processBoxes.flatMap((b) => [...byEntity(b.reads).keys(), ...byEntity(b.writes).keys()]));
  const storeIds = [...known.filter((id) => used.has(id)), ...[...used].filter((id) => !known.includes(id)).sort()];
  const stores: DataStore[] = storeIds.map((entity, i) => ({ entity, number: `D${i + 1}`, known: known.includes(entity) }));

  const nodes: DNode[] = [];
  const raw: Omit<DEdge, 'id'>[] = [];
  const externals = lanes.filter((l) => (EXTERNAL_KINDS as readonly string[]).includes(l.kind ?? ''));
  for (const l of externals) nodes.push({ id: `x:${l.role}`, shape: 'entity', title: l.label, tag: l.kind!, ...nodeSize('entity', l.label) });
  for (const p of processes) nodes.push({ id: `p:${p.path}`, shape: 'process', title: p.title, tag: p.number, path: p.path, ...nodeSize('process', p.title) });
  for (const s of stores) nodes.push({ id: `d:${s.entity}`, shape: 'store', title: s.entity, tag: s.number, ...nodeSize('store', s.entity) });

  // Process to process: the next processes along the edges, through boxes that hold no data.
  const out = new Map<string, string[]>();
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const nextProcesses = (from: string): string[] => {
    const found: string[] = [];
    const seen = new Set<string>([from]);
    const queue = [...(out.get(from) ?? [])];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (procOf.has(id)) found.push(id);
      else queue.push(...(out.get(id) ?? []));
    }
    return found;
  };
  const given = new Map<string, Set<string>>();
  const taken = new Map<string, Set<string>>();
  const ioFlows: Omit<DEdge, 'id'>[] = [];
  for (const a of processBoxes) {
    const outs = keys(a.outputs).filter((k) => !context.has(k));
    for (const bId of nextProcesses(a.id)) {
      const b = byId.get(bId)!;
      const shared = outs.filter((k) => keys(b.inputs).includes(k));
      if (shared.length === 0) continue;
      for (const k of shared) {
        given.set(bId, (given.get(bId) ?? new Set()).add(k));
        taken.set(a.id, (taken.get(a.id) ?? new Set()).add(k));
      }
      ioFlows.push({ from: `p:${a.id}`, to: `p:${bId}`, label: shared.join(', '), kind: 'data' });
    }
  }

  const ext = new Set(externals.map((l) => l.role));
  for (const b of processBoxes) {
    const id = `p:${b.id}`;
    if (ext.has(b.lane)) {
      const ins = keys(b.inputs).filter((k) => !context.has(k) && !given.get(b.id)?.has(k));
      if (ins.length) raw.push({ from: `x:${b.lane}`, to: id, label: ins.join(', '), kind: 'data' });
    }
    for (const [entity, words] of byEntity(b.reads)) raw.push({ from: `d:${entity}`, to: id, label: words.join(', '), kind: 'read' });
    for (const [entity, words] of byEntity(b.writes)) raw.push({ from: id, to: `d:${entity}`, label: words.join(', '), kind: 'write' });
    if (ext.has(b.lane)) {
      const outs = keys(b.outputs).filter((k) => !context.has(k) && !taken.get(b.id)?.has(k));
      if (outs.length) raw.push({ from: id, to: `x:${b.lane}`, label: outs.join(', '), kind: 'data' });
    }
  }
  raw.push(...ioFlows);

  const writers = new Map<string, string[]>();
  for (const b of processBoxes) for (const entity of byEntity(b.writes).keys()) writers.set(entity, [...(writers.get(entity) ?? []), b.id]);
  const onlyWriters: OnlyWriter[] = stores.flatMap((s) => {
    const w = writers.get(s.entity) ?? [];
    return w.length === 1 ? [{ entity: s.entity, store: s.number, process: procOf.get(w[0]!)! }] : [];
  });

  const lane = new Map(lanes.map((l) => [l.role, l.label]));
  const noData = boxes
    .filter((b) => !isProcess(b) && b.kind !== 'start' && b.kind !== 'end' && b.kind !== 'decision')
    .map((b) => ({ path: b.id, title: typeof b.title === 'string' ? b.title : b.id, lane: lane.get(b.lane) ?? b.lane }));

  return { nodes, edges: mergeEdges(raw), groups: [], processes, stores, onlyWriters, noData };
}

/**
 * Cells of the data flow (design page 6): the external entities in the first column, the
 * processes in flow order in rows of `cols`, and under each row of processes a row of the data
 * stores that row reads or writes first, each one under a process that uses it where it can.
 * An entity stands in the row of the first process it gives data to or takes data from.
 */
export function dataFlowCells(df: DataFlow, cols: number): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  const taken = new Set<string>();
  const put = (id: string, c: Cell) => {
    cells.set(id, c);
    taken.add(`${c.row},${c.col}`);
  };
  const perRow = Math.max(1, cols - 1);
  df.processes.forEach((p, i) => put(`p:${p.path}`, { row: Math.floor(i / perRow) * 2, col: 1 + (i % perRow) }));
  const linked = (id: string) => df.edges.flatMap((e) => (e.from === id ? [e.to] : e.to === id ? [e.from] : []));
  const firstProcess = (id: string) =>
    linked(id)
      .map((o) => cells.get(o))
      .filter((c): c is Cell => c !== undefined && c.row % 2 === 0)
      .sort((a, b) => a.row - b.row || a.col - b.col)[0];
  for (const n of df.nodes.filter((x) => x.shape === 'entity')) {
    let row = firstProcess(n.id)?.row ?? 0;
    while (taken.has(`${row},0`)) row += 1;
    put(n.id, { row, col: 0 });
  }
  for (const s of df.stores) {
    const near = firstProcess(`d:${s.entity}`) ?? { row: 0, col: 1 };
    let row = near.row + 1;
    for (;;) {
      const free = Array.from({ length: cols }, (_, c) => c)
        .filter((c) => !taken.has(`${row},${c}`))
        .sort((a, b) => Math.abs(a - near.col) - Math.abs(b - near.col) || a - b)[0];
      if (free !== undefined) {
        put(`d:${s.entity}`, { row, col: free });
        break;
      }
      row += 2;
    }
  }
  return cells;
}

/**
 * The data flow laid out as wide as the page at most: as many columns as the widest node allows,
 * one fewer while the lanes in the gutters make it wider than `maxW` (down to three).
 */
export function dataFlowLayout(df: DataFlow, maxW: number = DIAGRAM_W): { layout: GraphLayout; cols: number } {
  let cols = columnsFor(maxW, Math.max(...df.nodes.map((n) => n.w)));
  let layout = layoutGrid(df, dataFlowCells(df, cols));
  while (layout.width > maxW && cols > 3) {
    cols -= 1;
    layout = layoutGrid(df, dataFlowCells(df, cols));
  }
  return { layout, cols };
}
