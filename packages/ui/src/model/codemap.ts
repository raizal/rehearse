// The code map of the repo (T40), one level at a time: the packages, the files of one package, the
// code of one file. The server folds each level to at most about 150 nodes; this groups what is
// not the subject of the level (the outside packages in one collapsible group, the files of a
// package by folder), sizes the nodes by PageRank (a bigger box: more of the code depends on it)
// and wide enough for their names, lays them out (ELK, layered, left to right; the outside nodes in
// side columns) and opens the view at a zoom where the names can be read.

import type { CodeMap, MapEdge, MapNode, MapPlace } from '../codemap-api.js';
import type { CodeLoc } from './nav.js';
import { layoutGraph, type DGraph, type DGroup, type GraphLayout, type Rect } from './graph.js';

/** The font size of a node's name on the map (`.cm-node .cg-name` in codemap.css), in px at zoom 1. */
export const MAP_TITLE_PX = 15;
/** The smallest on-screen size of a name the map opens at. */
export const READABLE_PX = 11;
/** The view never opens below this zoom: names stay about 11 px on screen. */
export const READABLE_ZOOM = READABLE_PX / MAP_TITLE_PX;
/** The view never opens above this zoom either. */
export const MAX_FIT_ZOOM = 1.2;

/** The smallest and largest box of a level. A box is also wide enough for its name, up to `textW`. */
export const MAP_SIZE = { minW: 132, maxW: 280, minH: 52, maxH: 112, smallW: 150, smallH: 50, textW: 380, charW: 9, pad: 44 } as const;

/** The one node all the outside packages fold into, at the packages and package levels. */
export const OUTSIDE_GROUP = 'group:outside-packages';

/** The name drawn on a node: a file of a package without its folder (the folder group says it). */
export function mapNodeLabel(level: CodeMap['level'], n: MapNode): string {
  if (level === 'package' && n.kind === 'file' && !n.outside) return n.name.split('/').pop()!;
  return n.name;
}

/** "· 9 calls" after the name of an other file at the file level. */
export const callsWord = (n: MapNode): string | undefined => (n.calls === undefined ? undefined : `${n.calls} ${n.calls === 1 ? 'call' : 'calls'}`);

const textWidth = (level: CodeMap['level'], n: MapNode): number => {
  const calls = callsWord(n);
  const chars = mapNodeLabel(level, n).length + (calls ? calls.length + 3 : 0);
  return Math.min(MAP_SIZE.textW, chars * MAP_SIZE.charW + MAP_SIZE.pad);
};

/** Inner nodes grow with the square root of their share of the level's largest rank, and fit their name. */
export function mapNodeSize(n: MapNode, maxRank: number, level: CodeMap['level'] = 'packages'): { w: number; h: number } {
  const text = textWidth(level, n);
  if (n.outside || n.kind === 'more') return { w: Math.max(MAP_SIZE.smallW, text), h: MAP_SIZE.smallH };
  const share = maxRank > 0 ? Math.sqrt(Math.max(0, n.rank) / maxRank) : 0;
  return { w: Math.max(text, Math.round(MAP_SIZE.minW + (MAP_SIZE.maxW - MAP_SIZE.minW) * share)), h: Math.round(MAP_SIZE.minH + (MAP_SIZE.maxH - MAP_SIZE.minH) * share) };
}

export const maxRank = (map: Pick<CodeMap, 'nodes'>): number => Math.max(0, ...map.nodes.filter((n) => !n.outside && n.kind !== 'more').map((n) => n.rank));

// ---------------------------------------------------------------- the view: groups

/** A box drawn around nodes: a folder of a package, or the opened outside packages. */
export interface MapFrame {
  id: string;
  title: string;
  kind: 'folder' | 'outside';
}

/** What a level draws: its nodes and edges after grouping, the folder groups, and the outside group. */
export interface MapView {
  level: CodeMap['level'];
  nodes: MapNode[];
  edges: MapEdge[];
  folders: DGroup[];
  /** The folder group a file sits in. */
  folderOf: Record<string, string>;
  /** The outside packages: how many, and whether the group is open. */
  outside?: { count: number; open: boolean; ids: string[] };
}

const TRUST_ORDER: readonly MapEdge['trust'][] = ['exact', 'name-match', 'unresolved'];

/** Edges with the same two ends as one: counts added, the best trust. */
export function mergeEdges(edges: MapEdge[]): MapEdge[] {
  const out = new Map<string, MapEdge>();
  for (const e of edges) {
    if (e.from === e.to) continue;
    const key = `${e.from}\u0000${e.to}`;
    const m = out.get(key);
    if (!m) out.set(key, { ...e, kinds: [...e.kinds] });
    else {
      m.count += e.count;
      m.exact += e.exact;
      if (TRUST_ORDER.indexOf(e.trust) < TRUST_ORDER.indexOf(m.trust)) m.trust = e.trust;
      for (const k of e.kinds) if (!m.kinds.includes(k)) m.kinds.push(k);
    }
  }
  return [...out.values()];
}

/**
 * The level as drawn. The outside packages (and the "+N more" of the outside) fold into one node
 * "Outside packages (N)" unless the group is open; their edges add up on it. At the package level
 * the files sit in one group per folder (src/, test/, src/model/ …).
 */
export function mapView(map: CodeMap, outsideOpen = false): MapView {
  const isOutsidePkg = (n: MapNode) => map.level !== 'file' && n.outside && (n.kind === 'outside' || n.id === 'more:outside');
  const out = map.nodes.filter(isOutsidePkg);
  const count = out.reduce((k, n) => k + (n.kind === 'more' ? (n.more ?? 0) : 1), 0);
  let nodes = map.nodes;
  let edges = map.edges;
  if (out.length > 0 && !outsideOpen) {
    const ids = new Set(out.map((n) => n.id));
    const group: MapNode = { id: OUTSIDE_GROUP, kind: 'outside', name: `Outside packages (${count})`, rank: 0, outside: true, test: false, boxes: [] };
    nodes = [...map.nodes.filter((n) => !ids.has(n.id)), group];
    edges = mergeEdges(map.edges.map((e) => ({ ...e, from: ids.has(e.from) ? OUTSIDE_GROUP : e.from, to: ids.has(e.to) ? OUTSIDE_GROUP : e.to })));
  }
  const folders = new Map<string, DGroup>();
  const folderOf: Record<string, string> = {};
  if (map.level === 'package') {
    for (const n of nodes) {
      if (n.kind !== 'file' || n.outside) continue;
      const parts = n.name.split('/').slice(0, -1);
      if (parts.length === 0) continue;
      for (let i = 1; i <= parts.length; i++) {
        const id = `folder:${parts.slice(0, i).join('/')}`;
        if (!folders.has(id)) folders.set(id, { id, title: `${parts[i - 1]}/`, kind: 'cluster', ...(i > 1 ? { parent: `folder:${parts.slice(0, i - 1).join('/')}` } : {}) });
      }
      folderOf[n.id] = `folder:${parts.join('/')}`;
    }
  }
  return {
    level: map.level, nodes, edges, folders: [...folders.values()], folderOf,
    ...(out.length > 0 ? { outside: { count, open: outsideOpen, ids: out.map((n) => n.id) } } : {}),
  };
}

// ---------------------------------------------------------------- the layout

export interface MapLayout extends GraphLayout {
  /** The folder groups and the opened outside group, with their titles. */
  frames: (MapFrame & { rect: Rect })[];
}

const COLUMN_GAP = 110;
const STACK_GAP = 14;
const FRAME_TOP = 32;
const FRAME_PAD = 14;

/**
 * The inner nodes (the subject of the level) are laid out by ELK, left to right, in their folder
 * groups. The outside nodes stand in side columns next to the nodes they link to: on the left the
 * ones that only call in, on the right the rest, and the outside packages in a column of their own
 * at the far right.
 */
export async function layoutCodeMap(view: MapView): Promise<MapLayout> {
  const top = maxRank(view);
  const size = (n: MapNode) => mapNodeSize(n, top, view.level);
  const inner = view.nodes.filter((n) => !n.outside);
  const innerIds = new Set(inner.map((n) => n.id));
  const graph: DGraph = {
    nodes: inner.map((n) => ({ id: n.id, shape: 'step', title: n.name, ...size(n), ...(view.folderOf[n.id] ? { group: view.folderOf[n.id] } : {}) })),
    edges: view.edges.filter((e) => innerIds.has(e.from) && innerIds.has(e.to)).map((e, i) => ({ id: `e${i}`, from: e.from, to: e.to, kind: 'normal' })),
    groups: view.folders,
  };
  const lay = await layoutGraph(graph, 'RIGHT', { 'elk.spacing.nodeNode': '22', 'elk.layered.spacing.nodeNodeBetweenLayers': '80', 'elk.edgeRouting': 'SPLINES' });
  const nodes: Record<string, Rect> = { ...lay.nodes };
  const frames: MapLayout['frames'] = view.folders.flatMap((g) => (lay.groups[g.id] ? [{ id: g.id, title: g.title, kind: 'folder' as const, rect: lay.groups[g.id]! }] : []));

  const outsidePkgs = new Set([...(view.outside?.ids ?? []), OUTSIDE_GROUP]);
  const side = view.nodes.filter((n) => n.outside);
  const callsInOnly = (n: MapNode) => view.edges.some((e) => e.from === n.id) && !view.edges.some((e) => e.to === n.id);
  const columns: { nodes: MapNode[]; side: 'left' | 'right' | 'far' }[] = [
    { nodes: side.filter((n) => !outsidePkgs.has(n.id) && callsInOnly(n)), side: 'left' },
    { nodes: side.filter((n) => !outsidePkgs.has(n.id) && !callsInOnly(n)), side: 'right' },
    { nodes: side.filter((n) => outsidePkgs.has(n.id)), side: 'far' },
  ];
  const innerTop = Math.min(20, ...Object.values(lay.nodes).map((r) => r.y));
  let right = lay.width;
  for (const col of columns) {
    if (col.nodes.length === 0) continue;
    const framed = col.side === 'far' && view.outside?.open === true;
    const w = Math.max(...col.nodes.map((n) => size(n).w));
    const x = col.side === 'left' ? -(w + COLUMN_GAP) : right + COLUMN_GAP + (framed ? FRAME_PAD : 0);
    // Each node at the mean height of the inner nodes it links to, pushed down so none overlap.
    const want = col.nodes.map((n) => {
      const ys = view.edges.flatMap((e) => {
        const other = e.from === n.id ? e.to : e.to === n.id ? e.from : undefined;
        const r = other !== undefined ? lay.nodes[other] : undefined;
        return r ? [r.y + r.h / 2] : [];
      });
      return { n, y: ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length - size(n).h / 2 : innerTop };
    });
    // In a frame the nodes go top to bottom by how much they are used, so the frame stays one block.
    if (framed) want.sort((a, b) => b.n.rank - a.n.rank || a.n.name.localeCompare(b.n.name));
    else want.sort((a, b) => a.y - b.y || a.n.id.localeCompare(b.n.id));
    let next = innerTop + (framed ? FRAME_TOP : 0);
    for (const { n, y } of want) {
      const at = framed ? next : Math.max(next, y);
      nodes[n.id] = { x, y: at, ...size(n) };
      next = at + size(n).h + STACK_GAP;
    }
    if (framed) frames.push({ id: 'frame:outside', title: `Outside packages (${view.outside!.count})`, kind: 'outside', rect: { x: x - FRAME_PAD, y: innerTop, w: w + FRAME_PAD * 2, h: next - innerTop + FRAME_PAD - STACK_GAP } });
    if (col.side !== 'left') right = x + w + (framed ? FRAME_PAD : 0);
  }

  // Everything from 20, 20.
  const rects = [...Object.values(nodes), ...frames.map((f) => f.rect)];
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const dx = 20 - minX;
  const dy = 20 - minY;
  const move = (r: Rect): Rect => ({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h });
  for (const id of Object.keys(nodes)) nodes[id] = move(nodes[id]!);
  for (const f of frames) f.rect = move(f.rect);
  const width = Math.max(...rects.map((r) => r.x + dx + r.w)) + 20;
  const height = Math.max(...rects.map((r) => r.y + dy + r.h)) + 20;
  return { width, height, nodes, groups: Object.fromEntries(frames.map((f) => [f.id, f.rect])), edges: [], frames };
}

// ---------------------------------------------------------------- the first view

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

const PAD = 24;

/**
 * Where the view opens. The whole level when it fits at a zoom where the names can be read;
 * otherwise at that zoom, centred on `focus` (the selected node, else the biggest one), kept inside
 * the map so no screen is empty. The user pans from there.
 */
export function mapViewport(layout: Pick<GraphLayout, 'width' | 'height'>, focus: Rect | undefined, screen: { w: number; h: number }): Viewport {
  const w = Math.max(1, layout.width);
  const h = Math.max(1, layout.height);
  const fit = Math.min((screen.w - PAD * 2) / w, (screen.h - PAD * 2) / h, MAX_FIT_ZOOM);
  const zoom = Math.max(fit, READABLE_ZOOM);
  const axis = (size: number, view: number, centre: number) => {
    if (size * zoom + PAD * 2 <= view) return (view - size * zoom) / 2;
    const at = view / 2 - centre * zoom;
    return Math.min(PAD, Math.max(view - size * zoom - PAD, at));
  };
  const cx = focus ? focus.x + focus.w / 2 : w / 2;
  const cy = focus ? focus.y + focus.h / 2 : h / 2;
  return { x: axis(w, screen.w, cx), y: axis(h, screen.h, cy), zoom };
}

/** The node the view opens on: the selected one, else the biggest node of the subject of the level. */
export function focusNode(view: MapView, selected: string | undefined): string | undefined {
  if (selected !== undefined && view.nodes.some((n) => n.id === selected)) return selected;
  const inner = view.nodes.filter((n) => !n.outside && n.kind !== 'more');
  return [...inner].sort((a, b) => b.rank - a.rank || (a.id < b.id ? -1 : 1))[0]?.id;
}

// ---------------------------------------------------------------- clicks, places and words

/** What a click on a map node does. */
export type MapClick = { go: CodeLoc } | { select: string } | { toggle: 'outside' } | undefined;

/**
 * A package or a stub opens its files; a file opens its code; a code node or an other file is
 * selected; the outside group opens; "+N more" does nothing.
 */
export function mapClick(map: Pick<CodeMap, 'level'>, n: MapNode): MapClick {
  if (n.id === OUTSIDE_GROUP) return { toggle: 'outside' };
  if (n.kind === 'more') return undefined;
  if (n.kind === 'package') return { go: { tab: 'code', level: { kind: 'package', target: n.id } } };
  if (n.kind === 'stub') return n.unit ? { go: { tab: 'code', level: { kind: 'package', target: n.unit } } } : undefined;
  if (n.kind === 'outside') return map.level === 'file' ? { select: n.id } : undefined;
  if (n.kind === 'file' && map.level === 'package') return { go: { tab: 'code', level: { kind: 'file', target: n.id } } };
  return { select: n.id };
}

/** Where a found node lives on the map: its file, else its package. Undefined outside the repo. */
export function placeLoc(id: string, place: MapPlace | undefined): CodeLoc | undefined {
  if (!place) return undefined;
  if (place.file) return { tab: 'code', level: { kind: 'file', target: place.file }, node: id };
  return { tab: 'code', level: { kind: 'package', target: place.unit }, node: id };
}

/** The level a node of an answer is on, from its file alone (a link in the side panel or a path). */
export const fileLoc = (n: { id: string; file?: string }): CodeLoc | undefined => (n.file ? { tab: 'code', level: { kind: 'file', target: n.file }, node: n.id } : undefined);

/** The kind word over a node's name. */
export function mapKindWord(n: MapNode): string {
  if (n.id === OUTSIDE_GROUP) return 'outside · click to open';
  if (n.kind === 'stub') return 'package';
  if (n.kind === 'outside') return 'outside package';
  if (n.kind === 'more') return 'folded';
  if (n.kind === 'file') return n.outside ? (n.test ? 'other test file' : 'other file') : n.test ? 'test file' : 'file';
  return n.outside ? `outside · ${n.kind}` : n.kind;
}

/** The tooltip: the name, the kind, the counts or the place, and the boxes it serves. */
export function mapNodeTitle(n: MapNode): string {
  const parts = [`${n.name} (${mapKindWord(n)})`];
  if (n.kind === 'package') parts.push(`${n.files ?? 0} files, ${n.functions ?? 0} functions, ${n.tests ?? 0} tests`);
  else if (n.members) parts.push(`${n.file ?? n.unit ?? ''}${n.file || n.unit ? ': ' : ''}${callsWord(n)} with this file`);
  else if (n.file) parts.push(`${n.file}${n.range ? `:${n.range.split('-')[0]}` : ''}`);
  if (n.more) parts.push(`${n.more} more not shown`);
  if (n.boxes.length) parts.push(`serves ${n.boxes.map((b) => b.path).join(', ')}`);
  return parts.join(' · ');
}

/** The title of a test without its describe blocks: `MapIndex > packages > sizes` is `sizes`. */
export function shortTestName(name: string, max = 60): string {
  const last = name.split(' > ').pop()!.trim();
  return last.length > max ? `${last.slice(0, max - 1)}…` : last;
}

/** "Your repo: N packages, M files, K functions." */
export function plainWords(map: CodeMap): string {
  const t = map.totals;
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  return `Your repo: ${n(t.packages, 'package', 'packages')}, ${n(t.files, 'file', 'files')}, ${n(t.functions, 'function', 'functions')}. Bigger box = more of the code depends on it.`;
}

/** The level one up: a file's package, a package's repo. */
export function upLoc(map: CodeMap | undefined, loc: CodeLoc): CodeLoc {
  if (loc.level?.kind === 'file' && map?.unit) return { tab: 'code', level: { kind: 'package', target: map.unit.key } };
  return { tab: 'code' };
}
