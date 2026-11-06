// The code map reads (T40): `GET api/graph?verb=map|find|path|status`. The route needs the session
// token like the other graph reads; the browser adds Origin. Tests give the Code map tab a fake
// through CodeMapApiContext, so the drill-down's GraphApi fakes stay as they are.

import { createContext } from 'react';
import type { CodeMap, FindAnswer, GraphStatus, MapLevel, QueryAnswer } from '@rehearse/server';
import { SERVER_RESTARTED, sessionClient, TOKEN_HEADER, tokenRejected, type SessionClient } from './session-client.js';

export type { CodeMap, FindAnswer, GraphStatus, MapBox, MapEdge, MapLevel, MapNode, MapPlace, MapTotals } from '@rehearse/server';

/** ok: the answer. notFound: no such package, file or node (404). error: anything else. */
export type MapOutcome<T> = { ok: true; value: T } | { ok: false; notFound: boolean; error: string };

export interface MapRequest {
  level: MapLevel;
  /** The package (level package) or the file (level file). */
  target?: string;
  hideTests?: boolean;
  hideOutside?: boolean;
  /** Only nodes serving a box of this EPIC. */
  epic?: string;
}

export interface CodeMapApi {
  map: (q: MapRequest) => Promise<MapOutcome<CodeMap>>;
  find: (words: string) => Promise<MapOutcome<FindAnswer>>;
  /** The chain from one node to another; ok with no nodes and the note "no path" when there is none. */
  path: (from: string, to: string) => Promise<MapOutcome<QueryAnswer>>;
  status: () => Promise<MapOutcome<GraphStatus>>;
}

/** The query string of one map level. */
export function mapParams(q: MapRequest): URLSearchParams {
  const p = new URLSearchParams({ verb: 'map', level: q.level });
  if (q.target !== undefined) p.set('target', q.target);
  if (q.hideTests) p.set('tests', 'hide');
  if (q.hideOutside) p.set('outside', 'hide');
  if (q.epic) p.set('epic', q.epic);
  return p;
}

/** The HTTP client. The session token comes from the session client. */
export function httpCodeMapApi(client: SessionClient = sessionClient): CodeMapApi {
  const get = async <T,>(params: URLSearchParams, accept: (status: number, body: Record<string, unknown>) => boolean = (s, b) => s === 200 && b.ok === true): Promise<MapOutcome<T>> => {
    const url = `api/graph?${params.toString()}`;
    try {
      const r = await client.withToken((token) => fetch(url, { cache: 'no-store', headers: { [TOKEN_HEADER]: token } }));
      const body = (r.body ?? {}) as Record<string, unknown>;
      if (accept(r.status, body)) return { ok: true, value: body as unknown as T };
      if (r.status === 404 && body.ok === false) return { ok: false, notFound: true, error: 'not found' };
      const error = tokenRejected(r) ? SERVER_RESTARTED : typeof body.error === 'string' ? body.error : `GET ${url}: HTTP ${r.status}`;
      return { ok: false, notFound: false, error };
    } catch (e) {
      return { ok: false, notFound: false, error: e instanceof Error ? e.message : String(e) };
    }
  };
  return {
    map: (q) => get(mapParams(q)),
    find: (words) => get(new URLSearchParams({ verb: 'find', target: words }), (s) => s === 200),
    path: (from, to) => get(new URLSearchParams({ verb: 'path', target: from, to }), (s) => s === 200),
    status: () => get(new URLSearchParams({ verb: 'status' })),
  };
}

export const CodeMapApiContext = createContext<CodeMapApi>(httpCodeMapApi());
