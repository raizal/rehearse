// The facade of @rehearse/graph: open the store at <root>/.rehearse/graph.db, bring it up to date
// (box `update-graph`), then answer (box `run-query`). Every query updates first (G4).

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Linker, Ranker, Resolver } from './extend.js';
import { find, near, path, show } from './query.js';
import { Store } from './store.js';
import { updateGraph } from './update.js';
import type { GraphQuery, IndexRun, IndexTrigger, QueryAnswer } from './types.js';

/** The store path below the repo root. `rehearse new` puts `.rehearse/graph.db*` in .gitignore (G29). */
export const GRAPH_DB = '.rehearse/graph.db';

export interface GraphOptions {
  trigger?: IndexTrigger;
  resolvers?: Resolver[];
  linkers?: Linker[];
  ranker?: Ranker;
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
  lastRun(): IndexRun | undefined;
  close(): void;
}

export function openGraph(root: string, opts: GraphOptions = {}): Graph {
  mkdirSync(join(root, '.rehearse'), { recursive: true });
  const store = new Store(join(root, GRAPH_DB));
  const update = (rebuild = false) => updateGraph(root, store, { ...opts, rebuild });
  const graph: Graph = {
    root,
    store,
    update,
    async query(q) {
      if (q.verb === 'context') throw new Error('the context verb is wave 2 (ContextBuilder)');
      await update(q.rebuild === true);
      switch (q.verb) {
        case 'find':
          return find(store, q.target);
        case 'show':
          return show(store, root, q.target);
        case 'near':
          return near(store, q.target, q.depth ?? 1);
        case 'path':
          return path(store, q.target, q.to ?? '');
      }
    },
    find: async (words, o = {}) => (await update(o.rebuild === true), find(store, words, o.limit)),
    show: (target, o = {}) => graph.query({ verb: 'show', target, ...o }),
    near: (target, o = {}) => graph.query({ verb: 'near', target, ...o }),
    path: (from, to, o = {}) => graph.query({ verb: 'path', target: from, to, ...o }),
    lastRun: () => store.lastRun(),
    close: () => store.close(),
  };
  return graph;
}
