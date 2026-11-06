// The code map of the repo (T40), one level at a time: the packages, the files of one package, the
// code of one file. The server folds each level to at most about 150 nodes; this sizes them by
// PageRank (a bigger box: more of the code depends on it), lays them out with ELK (layered, left to
// right, like the call graph of T36) and says what a click does and where a found node lives.

import type { CodeMap, MapNode, MapPlace } from '../codemap-api.js';
import type { CodeLoc } from './nav.js';
import { layoutGraph, type DGraph, type GraphLayout } from './graph.js';

/** The smallest and largest box of a level. */
export const MAP_SIZE = { minW: 132, maxW: 280, minH: 44, maxH: 112, smallW: 150, smallH: 44 } as const;

/** Inner nodes grow with the square root of their share of the level's largest rank. */
export function mapNodeSize(n: MapNode, maxRank: number): { w: number; h: number } {
  if (n.outside || n.kind === 'more') return { w: MAP_SIZE.smallW, h: MAP_SIZE.smallH };
  const share = maxRank > 0 ? Math.sqrt(Math.max(0, n.rank) / maxRank) : 0;
  return { w: Math.round(MAP_SIZE.minW + (MAP_SIZE.maxW - MAP_SIZE.minW) * share), h: Math.round(MAP_SIZE.minH + (MAP_SIZE.maxH - MAP_SIZE.minH) * share) };
}

export const maxRank = (map: CodeMap): number => Math.max(0, ...map.nodes.filter((n) => !n.outside && n.kind !== 'more').map((n) => n.rank));

export async function layoutCodeMap(map: CodeMap): Promise<GraphLayout> {
  const top = maxRank(map);
  const graph: DGraph = {
    nodes: map.nodes.map((n) => ({ id: n.id, shape: 'step', title: n.name, ...mapNodeSize(n, top) })),
    edges: map.edges.map((e, i) => ({ id: `e${i}`, from: e.from, to: e.to, kind: 'normal' })),
    groups: [],
  };
  return layoutGraph(graph, 'RIGHT', { 'elk.spacing.nodeNode': '18', 'elk.layered.spacing.nodeNodeBetweenLayers': '90', 'elk.edgeRouting': 'SPLINES' });
}

/** What a click on a map node does. */
export type MapClick = { go: CodeLoc } | { select: string } | undefined;

/** A package or a stub opens its files; a file opens its code; a code node is selected; "+N more" does nothing. */
export function mapClick(map: CodeMap, n: MapNode): MapClick {
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

/** The kind word under a node's name. */
export function mapKindWord(n: MapNode): string {
  if (n.kind === 'stub') return 'package';
  if (n.kind === 'outside') return 'outside package';
  if (n.kind === 'more') return 'folded';
  if (n.kind === 'file') return n.test ? 'test file' : 'file';
  return n.outside ? `outside · ${n.kind}` : n.kind;
}

/** The tooltip: the name, the kind, the counts or the place, and the boxes it serves. */
export function mapNodeTitle(n: MapNode): string {
  const parts = [`${n.name} (${mapKindWord(n)})`];
  if (n.kind === 'package') parts.push(`${n.files ?? 0} files, ${n.functions ?? 0} functions, ${n.tests ?? 0} tests`);
  else if (n.file) parts.push(`${n.file}${n.range ? `:${n.range.split('-')[0]}` : ''}`);
  if (n.more) parts.push(`${n.more} more not shown`);
  if (n.boxes.length) parts.push(`serves ${n.boxes.map((b) => b.path).join(', ')}`);
  return parts.join(' · ');
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
