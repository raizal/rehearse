// The code graph in `rehearse serve` (EPIC 2026-11-05-code-graph, S9). Box `serve-query`: the one
// graph route `GET /api/graph?verb=show|near&target=…` answers from @rehearse/graph on the repo of
// the EPIC (G8, G20), and the Code map tab (T40) asks it for find, path and one level of the map;
// http.ts checks the session token and the Origin first. Box `watch`: while serve
// runs, a file watcher brings the graph up to date on save, as an update with trigger `watch` (G5).
//
// Unit test coverage (T43, S12): the lcov files of the repo, read on each request (parsed again only
// when one changed) and laid on the graph by `@rehearse/graph`'s coverage index. The map's nodes and
// the shown node of `show` carry their numbers; `coverage()` answers one target or every box.
//
// The graph opens on the first request, and the watcher starts then: a serve that never shows code
// never indexes. Every graph call runs one after the other, because one store connection cannot hold
// two write transactions. The watcher and the clock are injectable, so tests use fakes.

import { existsSync, watch as fsWatch } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import {
  boxesCoverage, coverageIndexOf, coverageInfo, coverageKey, coverageOf, find, loadCoverage, MapIndex, near, openGraph, outlineNode, path, show, updateGraph, withCoverage,
  type AnswerNode, type AstOutline, type CodeMap, type CoverageAnswer, type CoverageIndex, type CoverageInfo, type CoverageStats, type Graph, type GraphNode, type GraphOptions,
  type IndexRun, type MapPlace, type MapQuery, type NodeCoverage, type NodeKind, type QueryAnswer,
} from '@rehearse/graph';

/** The kind and place of a node at the other end of an edge of a show answer. */
export interface EdgeEnd {
  kind: NodeKind;
  file?: string;
  range?: string;
}

/**
 * What the panel gets: the answer; for show, the kind and place of each node at the other end of
 * its edges (which built nodes are functions, which are tests), and the AST outline of the shown
 * code node (S9-A1).
 */
export type PanelAnswer = QueryAnswer & {
  ends?: Record<string, EdgeEnd>;
  outline?: AstOutline;
  /** The shown code node's unit test coverage: numbers, a mark per line, its tests (T43). */
  coverage?: NodeCoverage;
  /** The lcov files read, or how to make one (T43). */
  coverageInfo?: CoverageInfo;
};

/** `verb=coverage` without a target: every box of the served EPIC that has code (T43). */
export interface BoxesCoverage {
  ok: true;
  boxes: Record<string, CoverageStats>;
  info: CoverageInfo;
}

export interface CoverageQuery {
  /** A file, a code node, or `box <path>`; none: every box in `boxes`. */
  target?: string;
  /** The box paths of the served EPIC. */
  boxes?: readonly string[];
  /** Box path → the files of its Flow-Box commits (boxes with no builds edge). */
  flowBoxFiles?: ReadonlyMap<string, readonly string[]>;
}

export interface PanelQuery {
  verb: 'show' | 'near';
  /** A node ID, a name, a route, a file path, or `box <path>` for a box of the record. */
  target: string;
  /** For near; default 1. */
  depth?: number;
}

/** A find answer with the place of each hit on the code map (T40): its package and file. */
export type FindAnswer = QueryAnswer & { places: Record<string, MapPlace> };

/** Whether the graph is there yet, without waiting for it (T40): the map says "indexing" from it. */
export interface GraphStatus {
  /** The store holds an index. */
  indexed: boolean;
  /** A graph call or a watcher update is running or waiting. */
  busy: boolean;
  /** The last index run, if any. */
  lastRun?: IndexRun;
}

export interface FileWatcher {
  close(): void;
}

/** Watch `root` and call `onChange` with each changed path, relative to `root`. */
export type WatchFiles = (root: string, onChange: (path: string) => void) => FileWatcher;

/** The timers of the debounce. Tests pass a fake clock. */
export interface Clock {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface GraphServiceOptions {
  /** The repo root: the git top level of the EPIC folder. */
  root: string;
  /** The served EPIC folder, relative to `root`: `box <path>` picks this EPIC's box first. */
  epic?: string;
  /** Resolvers, linkers and the ranker of the graph. */
  graph?: GraphOptions;
  /** Default: `fs.watch` with `recursive`. `false`: no watcher. */
  watch?: WatchFiles | false;
  clock?: Clock;
  /** Quiet time after the last save before the update; default 150 ms. */
  debounceMs?: number;
  /** lcov files to read besides every `coverage/lcov.info` of the repo (T43). */
  lcov?: readonly string[];
}

/** One update the watcher made. */
export interface WatchUpdate {
  /** The saved paths that started it (box `watch`, output `changed`). */
  changed: string[];
  run: IndexRun;
}

export interface GraphService {
  /** Update the graph (a query run), then answer. */
  answer(q: PanelQuery): Promise<PanelAnswer>;
  /** Update, then one level of the code map (T40). */
  map(q: MapQuery): Promise<CodeMap>;
  /** Update, then find by words, with each hit's place on the map. */
  find(words: string, limit?: number): Promise<FindAnswer>;
  /** Update, then the shortest chain of edges from one node to another. */
  path(from: string, to: string): Promise<QueryAnswer>;
  /** Update, then the unit test coverage of a target, or of every box (T43). */
  coverage(q: CoverageQuery): Promise<CoverageAnswer | BoxesCoverage>;
  /** Is the repo indexed, and is a graph call running? Answers at once: it neither waits nor updates. */
  status(): GraphStatus;
  /** Resolves when every pending graph call and watcher update is done. */
  idle(): Promise<void>;
  /** The last update the watcher made. */
  lastWatch(): WatchUpdate | undefined;
  close(): Promise<void>;
}

export const DEBOUNCE_MS = 150;

/** The files whose save can change the graph: code and the files that set the scope. */
const WATCHED = /(?:\.(?:ts|tsx|mts|cts|py)|(?:^|\/)tsconfig[^/]*\.json|(?:^|\/)pyproject\.toml|(?:^|\/)pyvenv\.cfg)$/;
const IGNORED = /(?:^|\/)(?:\.git|node_modules|\.rehearse|dist|\.venv|__pycache__)(?:\/|$)/;

/** True when a save of this repo path can change the graph. */
export function watchedPath(path: string): boolean {
  const p = path.split(sep).join('/');
  return WATCHED.test(p) && !IGNORED.test(p) && !p.endsWith('.d.ts');
}

/**
 * The real watcher: `fs.watch` on the whole repo. When the OS refuses it (EMFILE, no recursive
 * watch), serve runs without it: each query still updates the changed files first (G5).
 */
export const watchFiles: WatchFiles = (root, onChange) => {
  try {
    const w = fsWatch(root, { recursive: true }, (_event, name) => {
      if (name) onChange(String(name));
    });
    w.on('error', () => w.close());
    return { close: () => w.close() };
  } catch {
    return { close: () => undefined };
  }
};

export const realClock: Clock = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** The nearest folder at or above `dir` that holds `.git` (a folder, or a file in a worktree). */
export function repoRoot(dir: string): string {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, '.git'))) return d;
    if (dirname(d) === d) return dir;
  }
}

export function createGraphService(opts: GraphServiceOptions): GraphService {
  const clock = opts.clock ?? realClock;
  const debounce = opts.debounceMs ?? DEBOUNCE_MS;
  let graph: Graph | undefined;
  let watcher: FileWatcher | undefined;
  let chain: Promise<unknown> = Promise.resolve();
  let timer: unknown;
  let closed = false;
  let last: WatchUpdate | undefined;
  const pending = new Set<string>();
  // The map's view of the store, made again after an index run that wrote (T40).
  let mapIndex: MapIndex | undefined;
  let busy = 0;
  // The coverage index, made again after a written index run or when an lcov file changed (T43).
  let written = 0;
  let cov: { key: string; index: CoverageIndex } | undefined;
  const coverage = (g: Graph): CoverageIndex => {
    const data = loadCoverage(g.root, opts.lcov ?? []);
    const key = `${written}#${coverageKey(data)}`;
    if (cov?.key !== key) cov = { key, index: coverageIndexOf(g.store, g.root, data) };
    return cov.index;
  };

  /** Run `fn` after every earlier graph call. */
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    busy++;
    const out = chain.then(fn).finally(() => void busy--);
    chain = out.catch(() => undefined);
    return out;
  };

  /** Open the graph, bring it up to date, and say whether the update wrote. */
  const fresh = async (): Promise<Graph> => {
    if (closed) throw new Error('the graph service is closed');
    const g = open();
    const run = await g.update();
    if (run.status === 'written') {
      mapIndex = undefined;
      written++;
    }
    return g;
  };

  const open = (): Graph => {
    if (graph) return graph;
    graph = openGraph(opts.root, opts.graph ?? {});
    const watch = opts.watch === undefined ? watchFiles : opts.watch;
    if (watch) watcher = watch(opts.root, saved);
    return graph;
  };

  /** Box `watch`: collect the saved paths, and update once the saves stop. */
  function saved(path: string): void {
    if (closed || !watchedPath(path)) return;
    pending.add(path.split(sep).join('/'));
    if (timer !== undefined) clock.clear(timer);
    timer = clock.set(() => {
      timer = undefined;
      const changed = [...pending].sort();
      pending.clear();
      void serial(async () => {
        if (closed || !graph) return;
        const run = await updateGraph(graph.root, graph.store, { ...opts.graph, trigger: 'watch' });
        if (run.status === 'written') {
          mapIndex = undefined;
          written++;
        }
        last = { changed, run };
      });
    }, debounce);
  }

  return {
    answer: (q) =>
      serial(async () => {
        const g = await fresh();
        const id = targetId(g, q.target, opts.epic);
        // The centre of near and the shown node carry their unit test coverage (the Code map's side
        // panel reads near, the drill-down reads show).
        const withNodeCoverage = (answer: PanelAnswer, shown: AnswerNode | undefined): PanelAnswer => {
          if (shown?.file === undefined || shown.targetOnly || shown.language === 'record') return answer;
          const index = coverage(g);
          answer.coverageInfo = coverageInfo(index.data, g.root);
          const nc = index.nodeCoverage(shown.id);
          if (nc) answer.coverage = nc;
          return answer;
        };
        if (q.verb === 'near') {
          const answer: PanelAnswer = near(g.store, id, q.depth ?? 1);
          return withNodeCoverage(answer, answer.nodes.find((n) => n.distance === 0));
        }
        const answer: PanelAnswer = show(g.store, g.root, id);
        const shown = answer.nodes[0];
        if (!shown) return answer;
        answer.ends = edgeEnds(g, answer, shown.id);
        if (shown.code !== undefined) {
          const outline = await outlineNode(g.root, shown);
          if (outline) answer.outline = outline;
        }
        return withNodeCoverage(answer, shown);
      }),
    map: (q) =>
      serial(async () => {
        const g = await fresh();
        mapIndex ??= MapIndex.fromStore(g.store);
        return withCoverage(mapIndex.level(q), mapIndex, coverage(g), g.root);
      }),
    find: (words, limit) =>
      serial(async () => {
        const g = await fresh();
        mapIndex ??= MapIndex.fromStore(g.store);
        const answer = find(g.store, words, limit);
        const places: Record<string, MapPlace> = {};
        for (const n of answer.nodes) {
          const p = mapIndex.place(n.id);
          if (p) places[n.id] = p;
        }
        return { ...answer, places };
      }),
    path: (from, to) =>
      serial(async () => {
        const g = await fresh();
        return path(g.store, from, to);
      }),
    coverage: (q) =>
      serial(async () => {
        const g = await fresh();
        const index = coverage(g);
        const box = { ...(opts.epic !== undefined ? { epic: opts.epic.split(sep).pop()! } : {}), ...(q.flowBoxFiles ? { flowBoxFiles: q.flowBoxFiles } : {}) };
        if (q.target !== undefined) return coverageOf(g.store, index, g.root, q.target, box);
        return { ok: true as const, boxes: boxesCoverage(g.store, index, q.boxes ?? [], box), info: coverageInfo(index.data, g.root) };
      }),
    status: () => {
      if (closed) return { indexed: false, busy: false };
      const g = open();
      const run = g.store.lastRun();
      return { indexed: g.store.indexed(), busy: busy > 0, ...(run ? { lastRun: run } : {}) };
    },
    idle: () => serial(async () => undefined),
    lastWatch: () => last,
    async close() {
      if (closed) return;
      closed = true;
      if (timer !== undefined) clock.clear(timer);
      watcher?.close();
      await chain;
      graph?.close();
    },
  };
}

/** The graph service of a served EPIC folder: its repo, with that EPIC's boxes first. */
export function graphServiceFor(epicDir: string, opts: Omit<GraphServiceOptions, 'root' | 'epic'> = {}): GraphService {
  const root = repoRoot(epicDir);
  return createGraphService({ ...opts, root, epic: relative(root, epicDir) });
}

/**
 * `box <path>` is the node of that ID or, when no node has that ID or name, a box node named
 * `<path>`: the served EPIC's record box first, then another record box, then the box a Flow-Box
 * trailer made (T30's record and git linkers). Two EPICs can have a box of the same path.
 */
function targetId(g: Graph, target: string, epic: string | undefined): string {
  const box = /^box (.+)$/.exec(target)?.[1];
  if (box === undefined || g.store.node(target) || g.store.nodesWhere('name = ?', target).length > 0) return target;
  const boxes = g.store.nodesWhere('kind = ? AND name = ?', 'box', box).sort((a, b) => boxRank(a, epic) - boxRank(b, epic) || (a.id < b.id ? -1 : 1));
  return boxes[0]?.id ?? target;
}

const boxRank = (n: GraphNode, epic: string | undefined): number =>
  epic !== undefined && n.file !== undefined && (n.file + '/').startsWith(epic.split(sep).join('/') + '/') ? 0 : n.language === 'record' ? 1 : 2;

function edgeEnds(g: Graph, answer: QueryAnswer, shown: string): Record<string, EdgeEnd> {
  const ends: Record<string, EdgeEnd> = {};
  for (const e of answer.edges) {
    for (const id of [e.from, e.to]) {
      if (id === shown || id in ends) continue;
      const n = g.store.node(id);
      if (n) ends[id] = { kind: n.kind, ...(n.file !== undefined ? { file: n.file } : {}), ...(n.range !== undefined ? { range: n.range } : {}) };
    }
  }
  return ends;
}
