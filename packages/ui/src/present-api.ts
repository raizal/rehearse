// The deck calls (T52): `GET api/present?epic=<slug>` (the EPIC as one self-contained HTML file) and
// `&format=pdf` (the same deck printed by Chromium). Both send the session token; the file name
// comes from the server's content-disposition. No Chromium is a 503 with the server's plain words.

import { SERVER_RESTARTED, sessionClient, TOKEN_HEADER, tokenRejected, type SessionClient } from './session-client.js';

export interface DeckFile<T> {
  data: T;
  /** `<slug>-<date>-<sha>.html` or `.pdf`. */
  name: string;
}

export interface DeckHtml extends DeckFile<string> {
  slides: number;
}

export type PresentOutcome<T> = { ok: true; body: T } | { ok: false; error: string };

export interface PresentApi {
  html: (slug: string) => Promise<PresentOutcome<DeckHtml>>;
  pdf: (slug: string) => Promise<PresentOutcome<DeckFile<Blob>>>;
}

const fileName = (res: Response, fallback: string): string => /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallback;

/** The HTTP client. The session token comes from the session client. */
export function httpPresentApi(client: SessionClient = sessionClient): PresentApi {
  async function get<T>(url: string, read: (res: Response) => Promise<T>): Promise<PresentOutcome<T>> {
    let body: T | undefined;
    try {
      // The deck is read before the session client reads the body as JSON (which then fails quietly).
      const r = await client.withToken(async (token) => {
        const res = await fetch(url, { cache: 'no-store', headers: { [TOKEN_HEADER]: token } });
        if (res.ok) body = await read(res);
        return res;
      });
      if (r.ok && body !== undefined) return { ok: true, body };
      if (tokenRejected(r)) return { ok: false, error: SERVER_RESTARTED };
      return { ok: false, error: typeof r.body?.error === 'string' ? r.body.error : `${url}: HTTP ${r.status}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return {
    html: (slug) =>
      get(`api/present?epic=${encodeURIComponent(slug)}`, async (res) => ({
        data: await res.text(),
        name: fileName(res, `${slug}.html`),
        slides: Number(res.headers.get('x-deck-slides') ?? 0),
      })),
    pdf: (slug) => get(`api/present?epic=${encodeURIComponent(slug)}&format=pdf`, async (res) => ({ data: await res.blob(), name: fileName(res, `${slug}.pdf`) })),
  };
}

export const HTTP_PRESENT_API: PresentApi = httpPresentApi();
