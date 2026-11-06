// The code reads of the story Code tab: `GET api/code-index` and `GET api/box-code`. Both run
// git on the server, so they send the session token like a write; the browser adds Origin.
// Tests give the Code tab a fake through CodeApiContext. The token comes from the shared session
// client, which reads it again when the server restarted (T24).

import { createContext } from 'react';
import type { BoxCodeQuery, BoxCodeView, CodeIndex } from '@rehearse/server';
import { SERVER_RESTARTED, sessionClient, TOKEN_HEADER, tokenRejected, type SessionClient, type TokenReply } from './session-client.js';

export type { BoxCodeView, CodeIndex } from '@rehearse/server';

export type BoxCodeOutcome = { ok: true; view: BoxCodeView } | { ok: false; error: string };

export interface CodeApi {
  index: () => Promise<CodeIndex>;
  box: (q: BoxCodeQuery) => Promise<BoxCodeOutcome>;
}

/** The HTTP client. The session token comes from the session client. */
export function httpCodeApi(client: SessionClient = sessionClient): CodeApi {
  const get = (url: string): Promise<TokenReply> => client.withToken((token) => fetch(url, { cache: 'no-store', headers: { [TOKEN_HEADER]: token } }));
  const message = (url: string, r: TokenReply) =>
    tokenRejected(r) ? SERVER_RESTARTED : typeof r.body?.error === 'string' ? r.body.error : `GET ${url}: HTTP ${r.status}`;
  return {
    async index() {
      try {
        const r = await get('api/code-index');
        if (r.status === 200 && r.body) return r.body as unknown as CodeIndex;
        return { ok: false, reason: message('api/code-index', r) };
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : String(e) };
      }
    },
    async box(q) {
      const params = new URLSearchParams({ box: q.box });
      if (q.before) params.set('before', q.before);
      if (q.after) params.set('after', q.after);
      if (q.file) params.set('file', q.file);
      const url = `api/box-code?${params.toString()}`;
      try {
        const r = await get(url);
        if (r.status === 200 && r.body?.ok === true) return { ok: true, view: r.body as unknown as BoxCodeView };
        return { ok: false, error: message(url, r) };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}

export const CodeApiContext = createContext<CodeApi>(httpCodeApi());
