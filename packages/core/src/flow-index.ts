// Helpers to walk nested diagrams. Shared by validate and (later) simulate.

import type { Box, Diagram, Edge, EdgeKind, Flow } from './types.js';
import { asArray, isObject } from './util.js';

export interface BoxEntry {
  box: Box;
  /** Box path, e.g. `validate/parse`. */
  path: string;
  /** The diagram that contains the box. */
  diagram: Diagram;
  /** Path of the parent box, or undefined for a root box. */
  parent?: string;
}

/** A step from one leaf box to the next leaf box. */
export interface LeafStep {
  /** The edge taken. */
  edge: Edge;
  /** Path of the box the edge leaves (the leaf or one of its ancestors). */
  fromPath: string;
  /** Path of the leaf box entered. */
  to: string;
}

export function edgeKind(e: Edge): EdgeKind {
  return e.kind ?? 'normal';
}

export function hasChildren(box: Box): boolean {
  return isObject(box.children) && asArray(box.children.boxes).length > 0;
}

/** Index every box of the flow by its path, in file order. */
export function indexBoxes(flow: Flow | undefined): Map<string, BoxEntry> {
  const out = new Map<string, BoxEntry>();
  const walk = (diagram: Diagram, prefix: string, parent: string | undefined): void => {
    for (const box of asArray<Box>(diagram.boxes)) {
      if (!isObject(box) || typeof box.id !== 'string') continue;
      const path = prefix + box.id;
      if (!out.has(path)) out.set(path, parent === undefined ? { box, path, diagram } : { box, path, diagram, parent });
      if (hasChildren(box)) walk(box.children as Diagram, `${path}/`, path);
    }
  };
  if (isObject(flow) && isObject(flow.root)) walk(flow.root, '', undefined);
  return out;
}

/**
 * Edges whose two ends are boxes of the diagram. Refs reports the other edges;
 * the walk ignores them, so one bad edge gives one finding.
 */
export function knownEdges(diagram: Diagram): Edge[] {
  const ids = new Set(asArray<Box>(diagram.boxes).filter(isObject).map((b) => b.id));
  return asArray<Edge>(diagram.edges).filter((e) => isObject(e) && ids.has(e.from) && ids.has(e.to));
}

/** Children with no incoming edge: the entry boxes of a nested diagram. */
export function entryChildren(diagram: Diagram): Box[] {
  const tos = new Set(knownEdges(diagram).map((e) => e.to));
  return asArray<Box>(diagram.boxes).filter((b) => isObject(b) && !tos.has(b.id));
}

/** Children with no outgoing edge: the exit boxes of a nested diagram. */
export function exitChildren(diagram: Diagram): Box[] {
  const froms = new Set(knownEdges(diagram).map((e) => e.from));
  return asArray<Box>(diagram.boxes).filter((b) => isObject(b) && !froms.has(b.id));
}

/**
 * Leaf boxes that you enter when you enter `path`.
 * Entering a box with children enters its child that has no incoming edge (scenarios/README.md).
 */
export function entryLeaves(index: Map<string, BoxEntry>, path: string): string[] {
  const entry = index.get(path);
  if (!entry) return [];
  if (!hasChildren(entry.box)) return [path];
  return entryChildren(entry.box.children as Diagram).flatMap((c) => entryLeaves(index, `${path}/${c.id}`));
}

/**
 * Leaf boxes that can come directly after leaf `path` in a scenario.
 * Leaving a box with children leaves from its child that has no outgoing edge.
 */
export function nextLeaves(index: Map<string, BoxEntry>, path: string): LeafStep[] {
  const entry = index.get(path);
  if (!entry) return [];
  const outs = knownEdges(entry.diagram).filter((e) => e.from === entry.box.id);
  if (outs.length === 0 && entry.parent !== undefined) return nextLeaves(index, entry.parent);
  const prefix = entry.parent === undefined ? '' : `${entry.parent}/`;
  return outs.flatMap((edge) => entryLeaves(index, prefix + edge.to).map((to) => ({ edge, fromPath: path, to })));
}
