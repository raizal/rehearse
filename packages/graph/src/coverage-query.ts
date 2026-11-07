// The coverage of one target (T43, S12): a file, a code node, or a plan box, with its numbers, the
// lines not run, and the tests that call it. `rehearse coverage` prints it; the graph route
// answers `verb=coverage` with it; the map and the drill-down add the same numbers to their nodes.

import { statSync } from 'node:fs';
import { join } from 'node:path';
import {
  boxCode, boxCoverage, coverageInfo, CoverageIndex, NO_STATS,
  type CoverageData, type CoverageInfo, type CoverageStats, type TestRef,
} from './coverage.js';
import { epicOf } from './link/record.js';
import type { CodeMap, MapIndex } from './map.js';
import { findTarget } from './query.js';
import type { Store } from './store.js';
import type { GraphNode, NodeKind } from './types.js';

/** A coverage index over the store, with the stale check on the real files. */
export function coverageIndexOf(store: Store, root: string, data: CoverageData): CoverageIndex {
  return new CoverageIndex(data, store.allNodes(), store.edgesWhere('kind IN (?, ?)', 'tests', 'calls'), (file) => {
    try {
      return statSync(join(root, file)).mtimeMs;
    } catch {
      return undefined;
    }
  });
}

/** One piece of code in a coverage answer, least covered first. */
export interface CoverageEntry {
  id: string;
  name: string;
  kind: NodeKind;
  file: string;
  range?: string;
  stats: CoverageStats;
  /** The lines not run, `12-14`, `20`. */
  uncovered: string[];
}

export interface CoverageAnswer {
  ok: boolean;
  /** What the target is. */
  kind: 'file' | 'node' | 'box';
  target: string;
  name: string;
  stats: CoverageStats;
  /** Its code, least covered first: the functions of a file or a box, the node itself. */
  entries: CoverageEntry[];
  /** A code node only: the tests that call it. */
  testedBy: TestRef[];
  info: CoverageInfo;
  notes: string[];
}

const ENTRY_KINDS: readonly NodeKind[] = ['function', 'method', 'class', 'route'];

export interface BoxOptions {
  /** The EPIC folder whose boxes come first. */
  epic?: string;
  /** Box path → the files of its Flow-Box commits, for boxes with no builds edge. */
  flowBoxFiles?: ReadonlyMap<string, readonly string[]>;
}

/** Box path → the code its builds edges reach, for every box node of one EPIC (or of no EPIC). */
export function boxBuilds(store: Store, epic: string | undefined): { paths: string[]; builds: Map<string, GraphNode[]> } {
  const boxes = store.nodesWhere('kind = ?', 'box').filter((b) => (epic === undefined ? true : epicOf(b) === epic));
  const builds = new Map<string, GraphNode[]>();
  for (const b of boxes) {
    const code = store.edgesWhere('kind = ? AND from_id = ?', 'builds', b.id).flatMap((e) => store.node(e.to) ?? []);
    builds.set(b.name, [...(builds.get(b.name) ?? []), ...code]);
  }
  return { paths: [...new Set(boxes.map((b) => b.name))].sort(), builds };
}

const defined = (store: Store) => (file: string): GraphNode[] => store.nodesWhere('file = ? AND target_only = 0', file);

/** The coverage of every box of an EPIC that has code (badges on the boxes). */
export function boxesCoverage(store: Store, index: CoverageIndex, paths: readonly string[], opts: BoxOptions = {}): Record<string, CoverageStats> {
  const { builds } = boxBuilds(store, opts.epic);
  return boxCoverage(index, boxCode({ paths, builds, defined: defined(store), ...(opts.flowBoxFiles ? { flowBoxFiles: opts.flowBoxFiles } : {}) }));
}

/** The EPIC of the first box node named `path`: the served one first, then record boxes. */
function boxEpic(store: Store, path: string, epic: string | undefined): string | undefined | null {
  const boxes = store.nodesWhere('kind = ? AND name = ?', 'box', path);
  if (boxes.length === 0) return null;
  const pick = boxes.find((b) => epic !== undefined && epicOf(b) === epic) ?? boxes.find((b) => epicOf(b) !== undefined) ?? boxes[0]!;
  return epicOf(pick);
}

/**
 * The coverage of a target: `box <path>` (or a box path no node has as its name), a file path, or
 * a code node (ID, name or route). Not found: ok false, the note "not found".
 */
export function coverageOf(store: Store, index: CoverageIndex, root: string, target: string, opts: BoxOptions = {}): CoverageAnswer {
  const info = coverageInfo(index.data, root);
  const base = { target, testedBy: [] as TestRef[], info, notes: [] as string[] };
  const entry = (n: GraphNode): CoverageEntry => {
    const nc = index.nodeCoverage(n.id);
    return {
      id: n.id, name: n.route ?? n.name, kind: n.kind, file: n.file!, ...(n.range !== undefined ? { range: n.range } : {}),
      stats: nc?.stats ?? NO_STATS, uncovered: nc?.uncovered ?? [],
    };
  };
  const sorted = (list: CoverageEntry[]) =>
    list.sort((a, b) => (a.stats.percent ?? 101) - (b.stats.percent ?? 101) || a.file.localeCompare(b.file) || startOf(a.range) - startOf(b.range) || a.id.localeCompare(b.id));

  const boxPath = /^box (.+)$/.exec(target)?.[1];
  const isFile = boxPath === undefined && store.nodesWhere('kind = ? AND file = ?', 'file', target).length > 0;
  const found = boxPath === undefined && !isFile ? findTarget(store, target) : undefined;
  const asBox = boxPath ?? (found?.node.kind === 'box' ? found.node.name : found === undefined && !isFile ? target : undefined);

  if (asBox !== undefined) {
    const epic = boxEpic(store, asBox, opts.epic);
    if (epic === null) return { ...base, ok: false, kind: 'box', name: asBox, stats: NO_STATS, entries: [], notes: ['not found'] };
    const { paths, builds } = boxBuilds(store, epic);
    const code = boxCode({ paths, builds, defined: defined(store), ...(opts.flowBoxFiles ? { flowBoxFiles: opts.flowBoxFiles } : {}) }).get(asBox) ?? [];
    const stats = boxCoverage(index, new Map([[asBox, code]]))[asBox] ?? NO_STATS;
    return { ...base, ok: true, kind: 'box', name: asBox, stats, entries: sorted(code.map(entry)), notes: code.length === 0 ? ['this box has no code yet'] : [] };
  }
  if (isFile) {
    const code = store.nodesWhere('file = ? AND target_only = 0', target).filter((n) => ENTRY_KINDS.includes(n.kind));
    return { ...base, ok: true, kind: 'file', name: target, stats: index.file(target), entries: sorted(code.map(entry)) };
  }
  if (!found || found.node.file === undefined || found.node.targetOnly) {
    return { ...base, ok: false, kind: 'node', name: target, stats: NO_STATS, entries: [], notes: [found ? 'not in the repo' : 'not found'] };
  }
  const n = found.node;
  if (n.kind === 'file') return coverageOf(store, index, root, n.file!, opts);
  return { ...base, ok: true, kind: 'node', name: n.route ?? n.name, stats: index.node(n.id), entries: [entry(n)], testedBy: index.testedBy(n.id), notes: found.notes };
}

const startOf = (range: string | undefined): number => Number(range?.split('-')[0] ?? 0);

/** Add the coverage to a level of the code map: packages, files and code nodes; folders add up in the UI. */
export function withCoverage(map: CodeMap, mapIndex: MapIndex, index: CoverageIndex, root: string): CodeMap {
  const info = coverageInfo(index.data, root);
  if (!info.found) return { ...map, coverage: info };
  const nodes = map.nodes.map((n) => {
    if (n.outside || n.test || n.kind === 'more') return n;
    if (n.kind === 'package') return { ...n, coverage: index.files(mapIndex.unitFiles(n.id)) };
    if (n.kind === 'file' && n.file !== undefined) return { ...n, coverage: index.file(n.file) };
    if (ENTRY_KINDS.includes(n.kind as NodeKind)) return { ...n, coverage: index.node(n.id) };
    return n;
  });
  return { ...map, nodes, coverage: info };
}
