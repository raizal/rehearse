// What the box drawer shows (T38): a box over the page the reader is on. Its place (parents,
// lane, kind), its contract, the steps inside it, the edges in and out of it with their labels,
// the stories and decisions it names, and the scenarios that step through it.

import type { Box, Diagram, EdgeKind, Id } from '@rehearse/core';
import type { ReviewEpicView } from '../contract.js';
import { boxAt, breadcrumb, diagramAt, hasChildren, laneColor, parentPath, roleName, type Crumb } from './diagram.js';

/** Kind marks, the same as on the boxes of a diagram. */
export const KIND_ICON: Record<string, string> = {
  start: '●',
  end: '◉',
  process: '▭',
  decision: '◆',
  input: '⇥',
  output: '⇤',
  external: '☁',
};

/** An edge into or out of the box: the box at its other end and the edge label (a branch or an error exit). */
export interface DrawerEdge {
  /** Path of the box at the other end. */
  path: string;
  title: string;
  kind: EdgeKind;
  label?: string;
}

export interface DrawerScenario {
  id: Id;
  title: string;
  /** Step numbers (from 1) on this box or a box inside it. */
  steps: number[];
}

export interface BoxDrawerView {
  path: string;
  box: Box;
  /** The boxes above this one, outermost first; empty for a box of the root diagram. */
  parents: Crumb[];
  lane: { role: string; label: string; color: string };
  /** The diagram inside the box, when it has one. */
  children?: Diagram;
  /** Paths of the boxes inside, in diagram order. */
  childPaths: string[];
  outgoing: DrawerEdge[];
  incoming: DrawerEdge[];
  stories: Id[];
  decisions: Id[];
  scenarios: DrawerScenario[];
}

const list = <T>(v: T[] | undefined): T[] => (Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined) : []);

/** The drawer of the box at `path`, or undefined when flow.yaml has no box there. */
export function boxDrawer(view: ReviewEpicView, path: string): BoxDrawerView | undefined {
  const box = boxAt(view.flow, path);
  if (!box) return undefined;
  const parent = parentPath(path);
  const diagram = diagramAt(view.flow, parent);
  const prefix = parent === '' ? '' : `${parent}/`;
  const boxes = new Map(list(diagram?.boxes).map((b) => [b.id, b]));
  const edge = (other: string, e: { label?: string; kind?: EdgeKind }): DrawerEdge => ({
    path: prefix + other,
    title: boxes.get(other)?.title ?? other,
    kind: e.kind ?? 'normal',
    ...(e.label !== undefined ? { label: e.label } : {}),
  });
  const edges = list(diagram?.edges);
  const inside = (name: unknown) => typeof name === 'string' && (name === path || name.startsWith(`${path}/`));
  return {
    path,
    box,
    parents: breadcrumb(view.flow, parent).slice(1),
    lane: { role: box.lane, label: roleName(view.prd, box.lane), color: laneColor(view.flow, box.lane) },
    ...(hasChildren(box) ? { children: box.children! } : {}),
    childPaths: hasChildren(box) ? list(box.children!.boxes).map((b) => `${path}/${b.id}`) : [],
    outgoing: edges.filter((e) => e.from === box.id && boxes.has(e.to)).map((e) => edge(e.to, e)),
    incoming: edges.filter((e) => e.to === box.id && boxes.has(e.from)).map((e) => edge(e.from, e)),
    stories: list(box.stories),
    decisions: list(box.decisions),
    scenarios: view.scenarios.flatMap(({ scenario: s }) => {
      const steps = list(s.steps).flatMap((st, i) => (inside(st.name) ? [i + 1] : []));
      return steps.length ? [{ id: s.id, title: s.title, steps }] : [];
    }),
  };
}

/** `◆ decision`, `▭ process`, … */
export function kindText(kind: string): string {
  return `${KIND_ICON[kind] ?? '▭'} ${kind}`;
}
