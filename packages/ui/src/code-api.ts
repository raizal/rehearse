// The code reads of the story Code tab: `GET api/code-index` and `GET api/box-code`. Both run
// git on the server, so they send the session token like a write; the browser adds Origin.
// Tests give the Code tab a fake through CodeApiContext.

import { createContext } from 'react';
import type { BoxCodeQuery, BoxCodeView, CodeIndex } from '@rehearse/server';
import { fetchSession } from './api.js';

export type { BoxCodeView, CodeIndex } from '@rehearse/server';

export type BoxCodeOutcome = { ok: true; view: BoxCodeView } | { ok: false; error: string };

export interface CodeApi {
  index: () => Promise<CodeIndex>;
  box: (q: BoxCodeQuery) => Promise<BoxCodeOutcome>;
}

/** The HTTP client. It reads the session token once, from `GET api/session`. */
export function httpCodeApi(session: () => Promise<{ token: string }> = fetchSession): CodeApi {
  let token: Promise<string> | undefined;
  const get = async (url: string): Promise<{ status: number; body: Record<string, unknown> | undefined }> => {
    token ??= session().then((s) => s.token);
    let t: string;
    try {
      t = await token;
    } catch (e) {
      token = undefined;
      throw e;
    }
    const res = await fetch(url, { cache: 'no-store', headers: { 'x-rehearse-token': t } });
    return { status: res.status, body: (await res.json().catch(() => undefined)) as Record<string, unknown> | undefined };
  };
  const message = (url: string, r: { status: number; body: Record<string, unknown> | undefined }) =>
    typeof r.body?.error === 'string' ? r.body.error : `GET ${url}: HTTP ${r.status}`;
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
