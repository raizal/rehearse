// The code graph in `rehearse serve` (EPIC 2026-11-05-code-graph, S9). Box `serve-query`: the one
// graph route `GET /api/graph?verb=show|near&target=…` answers from @rehearse/graph on the repo of
// the EPIC (G8, G20); http.ts checks the session token and the Origin first. Box `watch`: while serve
// runs, a file watcher brings the graph up to date on save, as an update with trigger `watch` (G5).
//
// The graph opens on the first request, and the watcher starts then: a serve that never shows code
// never indexes. Every graph call runs one after the other, because one store connection cannot hold
// two write transactions. The watcher and the clock are injectable, so tests use fakes.

import { existsSync, watch as fsWatch } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { near, openGraph, outlineNode, show, updateGraph, type AstOutline, type Graph, type GraphOptions, type IndexRun, type QueryAnswer } from '@rehearse/graph';

/** What the panel gets: the answer, and the AST outline of the shown code node (S9-A1). */
export type PanelAnswer = QueryAnswer & { outline?: AstOutline };

export interface PanelQuery {
  verb: 'show' | 'near';
  /** A node ID, a name, a route, a file path, or `box <path>` for a box of the record. */
  target: string;
  /** For near; default 1. */
  depth?: number;
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
  /** Resolvers, linkers and the ranker of the graph. */
  graph?: GraphOptions;
  /** Default: `fs.watch` with `recursive`. `false`: no watcher. */
  watch?: WatchFiles | false;
  clock?: Clock;
  /** Quiet time after the last save before the update; default 150 ms. */
  debounceMs?: number;
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

  /** Run `fn` after every earlier graph call. */
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const out = chain.then(fn);
    chain = out.catch(() => undefined);
    return out;
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
        last = { changed, run };
      });
    }, debounce);
  }

  return {
    answer: (q) =>
      serial(async () => {
        if (closed) throw new Error('the graph service is closed');
        const g = open();
        await g.update();
        const id = targetId(g, q.target);
        const answer: PanelAnswer = q.verb === 'show' ? show(g.store, g.root, id) : near(g.store, id, q.depth ?? 1);
        const shown = answer.nodes[0];
        if (q.verb === 'show' && shown?.code !== undefined) {
          const outline = await outlineNode(g.root, shown);
          if (outline) answer.outline = outline;
        }
        return answer;
      }),
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

/** `box <path>` is the box node's ID or, when no node has that ID or name, the box node named `<path>`. */
function targetId(g: Graph, target: string): string {
  const box = /^box (.+)$/.exec(target)?.[1];
  if (box === undefined || g.store.node(target) || g.store.nodesWhere('name = ?', target).length > 0) return target;
  return g.store.nodesWhere('kind = ? AND name = ?', 'box', box)[0]?.id ?? target;
}
