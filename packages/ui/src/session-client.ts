// The one session client of the UI (T24). `rehearse serve` makes a new token at every start, so
// a page that stays open across a restart holds a dead token. The client reads `GET api/session`
// once, keeps the token, and when a request answers 403 with the token error it reads the session
// again and sends the request once more. A second token 403 means the page must reload; the
// Origin 403 is never retried.
//
// Retrying a POST is safe: the server checks the token before it reads the body or writes
// anything (`checkRequest`, first step of `readJsonPost` in packages/server/src/http.ts).

import type { Session } from './contract.js';
import { at } from './base.js';

export const TOKEN_HEADER = 'x-rehearse-token';
/** The server's error for a missing or old token. */
export const TOKEN_ERROR = `missing or wrong ${TOKEN_HEADER} header`;
/** What the UI says when the token is still refused after one fresh read of the session. */
export const SERVER_RESTARTED = 'The rehearse server restarted. Reload the page.';

/** A token request's answer, its JSON body read once. */
export interface TokenReply {
  status: number;
  ok: boolean;
  body: Record<string, unknown> | undefined;
}

/** True when the server refused the token (not the Origin). */
export function tokenRejected(r: TokenReply): boolean {
  return r.status === 403 && r.body?.error === TOKEN_ERROR;
}

export async function fetchSession(): Promise<Session> {
  const res = await fetch(at('api/session'), { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET api/session: HTTP ${res.status}`);
  return (await res.json()) as Session;
}

export interface SessionClient {
  /** The cached session; read from the server on first use and after a token 403. */
  session: () => Promise<Session>;
  /** Send `fn(token)`; on a token 403 read the session again and send it once more. */
  withToken: (fn: (token: string) => Promise<Response>) => Promise<TokenReply>;
  /** Called with each session read from the server. Returns the unsubscribe. */
  subscribe: (listener: (s: Session) => void) => () => void;
  /** Forget the cached session (tests). */
  reset: () => void;
}

export function createSessionClient(load: () => Promise<Session> = fetchSession): SessionClient {
  let cache: { promise: Promise<Session>; token?: string } | undefined;
  const listeners = new Set<(s: Session) => void>();

  const session = (): Promise<Session> => {
    if (cache) return cache.promise;
    const entry: { promise: Promise<Session>; token?: string } = {
      promise: load().then(
        (s) => {
          entry.token = s.token;
          for (const l of listeners) l(s);
          return s;
        },
        (e: unknown) => {
          if (cache === entry) cache = undefined;
          throw e;
        },
      ),
    };
    cache = entry;
    return entry.promise;
  };

  const send = async (fn: (token: string) => Promise<Response>): Promise<{ token: string; reply: TokenReply }> => {
    const { token } = await session();
    const res = await fn(token);
    const body = (await res.json().catch(() => undefined)) as Record<string, unknown> | undefined;
    return { token, reply: { status: res.status, ok: res.ok, body } };
  };

  return {
    session,
    async withToken(fn) {
      const first = await send(fn);
      if (!tokenRejected(first.reply)) return first.reply;
      // Drop the cache only if it still holds the refused token: a parallel request may have read the new one.
      if (cache?.token === first.token) cache = undefined;
      return (await send(fn)).reply;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset() {
      cache = undefined;
    },
  };
}

/** The client every part of the UI shares. */
export const sessionClient = createSessionClient();
