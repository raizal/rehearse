// The facade of @rehearse/graph: open the store at <root>/.rehearse/graph.db, bring it up to date
// (box `update-graph`), then answer (box `run-query`). Every query updates first (G4).

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { context, DEFAULT_BUDGET, NO_VENV } from './context/build.js';
import type { ContextBuilder, Linker, Ranker, Resolver } from './extend.js';
import { defaultLinkers } from './link/index.js';
import { find, near, path, show } from './query.js';
import { pageRank } from './rank/pagerank.js';
import { defaultResolvers } from './resolve/index.js';
import { Store } from './store.js';
import { updateGraph } from './update.js';
import type { GraphQuery, IndexRun, IndexTrigger, QueryAnswer } from './types.js';


/** The answer with NO_VENV added when it holds Python code and the run had no venv. */
export function withVenvNote(answer: QueryAnswer, run: IndexRun | undefined): QueryAnswer {
  if (!run || run.venv !== undefined || answer.notes.includes(NO_VENV)) return answer;
  const python = answer.nodes.some((n) => n.language === 'python')
    || answer.edges.some((e) => e.from.startsWith('scip-python ') || e.to.startsWith('scip-python '));
  return python ? { ...answer, notes: [...answer.notes, NO_VENV] } : answer;
}

/** The store path below the repo root. `rehearse new` puts `.rehearse/graph.db*` in .gitignore (G29). */
export const GRAPH_DB = '.rehearse/graph.db';

export interface GraphOptions {
  trigger?: IndexTrigger;
  /** The resolvers; ts-morph, scip-python and basedpyright when missing (G10). */
  resolvers?: Resolver[];
  /** Default: defaultLinkers() (record, git, tests, http). `[]` for none. */
  linkers?: Linker[];
  /** Default: PageRank (G14). */
  ranker?: Ranker;
  /** The `context` verb; default: the code around the target by distance and PageRank (G6). */
  contextBuilder?: ContextBuilder;
}

export interface Graph {
  readonly root: string;
  readonly store: Store;
  /** Hash the files and update the store; `rebuild` makes a cold index. */
  update(rebuild?: boolean): Promise<IndexRun>;
  /** Update, then answer one query. */
  query(q: Omit<GraphQuery, 'json' | 'from'> & Partial<Pick<GraphQuery, 'json' | 'from'>>): Promise<QueryAnswer>;
  find(words: string, opts?: { rebuild?: boolean; limit?: number }): Promise<QueryAnswer>;
  show(target: string, opts?: { rebuild?: boolean }): Promise<QueryAnswer>;
  near(target: string, opts?: { rebuild?: boolean; depth?: number }): Promise<QueryAnswer>;
  path(from: string, to: string, opts?: { rebuild?: boolean }): Promise<QueryAnswer>;
  context(target: string, opts?: { rebuild?: boolean; budget?: number }): Promise<QueryAnswer>;
  lastRun(): IndexRun | undefined;
  close(): void;
}

export function openGraph(root: string, opts: GraphOptions = {}): Graph {
  mkdirSync(join(root, '.rehearse'), { recursive: true });
  const store = new Store(join(root, GRAPH_DB));
  const linkers = opts.linkers ?? defaultLinkers();
  const resolvers = opts.resolvers ?? defaultResolvers();
  const update = (rebuild = false) => updateGraph(root, store, { ranker: pageRank(), ...opts, linkers, resolvers, rebuild });
  const graph: Graph = {
    root,
    store,
    update,
    async query(q) {
      await update(q.rebuild === true);
      return withVenvNote(await answer(q), store.lastRun());
    },
    find: async (words, o = {}) => (await update(o.rebuild === true), withVenvNote(find(store, words, o.limit), store.lastRun())),
    show: (target, o = {}) => graph.query({ verb: 'show', target, ...o }),
    near: (target, o = {}) => graph.query({ verb: 'near', target, ...o }),
    path: (from, to, o = {}) => graph.query({ verb: 'path', target: from, to, ...o }),
    context: (target, o = {}) => graph.query({ verb: 'context', target, ...o }),
    lastRun: () => store.lastRun(),
    close: () => {
      // A resolver keeps a server warm (basedpyright); stopping it does not wait.
      for (const r of resolvers) void r.close?.();
      store.close();
    },
  };
  const answer = (q: Parameters<Graph['query']>[0]): QueryAnswer | Promise<QueryAnswer> => {
    switch (q.verb) {
      case 'find':
        return find(store, q.target);
      case 'show':
        return show(store, root, q.target);
      case 'near':
        return near(store, q.target, q.depth ?? 1);
      case 'path':
        return path(store, q.target, q.to ?? '');
      case 'context':
        return context(store, root, q.target, q.budget ?? DEFAULT_BUDGET, opts.contextBuilder);
    }
  };
  return graph;
}
