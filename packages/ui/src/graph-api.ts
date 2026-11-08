// The code graph reads of the box drill-down (S9, box drill-code): `GET api/graph?verb=show|near`.
// The route needs the session token like the code reads; the browser adds Origin. The token comes
// from the shared session client, which reads it again when the server restarted (T24). Tests give
// the drill-down a fake through GraphApiContext.

import { createContext } from 'react';
import type { PanelAnswer } from '@rehearse/server';
import { SERVER_RESTARTED, sessionClient, TOKEN_HEADER, tokenRejected, type SessionClient } from './session-client.js';
import { at } from './base.js';

export type { PanelAnswer } from '@rehearse/server';

/** ok: the answer. notFound: the graph has no such node (404). error: anything else. */
export type GraphOutcome = { ok: true; answer: PanelAnswer } | { ok: false; notFound: boolean; error: string };

export interface GraphApi {
  show: (target: string) => Promise<GraphOutcome>;
  near: (target: string, depth?: number) => Promise<GraphOutcome>;
}

/** The HTTP client. The session token comes from the session client. */
export function httpGraphApi(client: SessionClient = sessionClient): GraphApi {
  const get = async (params: URLSearchParams): Promise<GraphOutcome> => {
    const url = `api/graph?${params.toString()}`;
    try {
      const r = await client.withToken((token) => fetch(at(url), { cache: 'no-store', headers: { [TOKEN_HEADER]: token } }));
      if (r.status === 200 && r.body?.ok === true) return { ok: true, answer: r.body as unknown as PanelAnswer };
      if (r.status === 404 && r.body?.ok === false) return { ok: false, notFound: true, error: 'not found' };
      const error = tokenRejected(r) ? SERVER_RESTARTED : typeof r.body?.error === 'string' ? r.body.error : `GET ${url}: HTTP ${r.status}`;
      return { ok: false, notFound: false, error };
    } catch (e) {
      return { ok: false, notFound: false, error: e instanceof Error ? e.message : String(e) };
    }
  };
  return {
    show: (target) => get(new URLSearchParams({ verb: 'show', target })),
    near: (target, depth = 1) => get(new URLSearchParams({ verb: 'near', target, depth: String(depth) })),
  };
}

export const GraphApiContext = createContext<GraphApi>(httpGraphApi());
