// The deck calls (T52): `GET api/present?epic=<slug>` (the EPIC as one self-contained HTML file) and
// `&format=pdf` (the same deck printed by Chromium); T53 `&format=zip` (the HTML and a media folder
// with the recordings it links). T54: the executive summary by default; `{ full: true }` adds
// `&full=1`, every story slide after the summary. All send the session token; the file name comes from the server's
// content-disposition. No Chromium is a 503 with the server's plain words.

import { SERVER_RESTARTED, sessionClient, TOKEN_HEADER, tokenRejected, type SessionClient } from './session-client.js';
import { at } from './base.js';

export interface DeckFile<T> {
  data: T;
  /** `<slug>-<date>-<sha>.html` or `.pdf`. */
  name: string;
}

export interface DeckHtml extends DeckFile<string> {
  slides: number;
}

export interface DeckZip extends DeckFile<Blob> {
  /** Videos in the zip's media folder. */
  videos: number;
}

export type PresentOutcome<T> = { ok: true; body: T } | { ok: false; error: string };

export interface DeckChoice {
  /** The summary and then every story slide (T54). Default: the summary alone. */
  full?: boolean;
}

export interface PresentApi {
  html: (slug: string, choice?: DeckChoice) => Promise<PresentOutcome<DeckHtml>>;
  pdf: (slug: string, choice?: DeckChoice) => Promise<PresentOutcome<DeckFile<Blob>>>;
  zip: (slug: string, choice?: DeckChoice) => Promise<PresentOutcome<DeckZip>>;
}

const deckUrl = (slug: string, choice: DeckChoice | undefined, format?: 'pdf' | 'zip'): string =>
  `api/present?epic=${encodeURIComponent(slug)}${format ? `&format=${format}` : ''}${choice?.full ? '&full=1' : ''}`;

const fileName = (res: Response, fallback: string): string => /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallback;

/** The HTTP client. The session token comes from the session client. */
export function httpPresentApi(client: SessionClient = sessionClient): PresentApi {
  async function get<T>(url: string, read: (res: Response) => Promise<T>): Promise<PresentOutcome<T>> {
    let body: T | undefined;
    try {
      // The deck is read before the session client reads the body as JSON (which then fails quietly).
      const r = await client.withToken(async (token) => {
        const res = await fetch(at(url), { cache: 'no-store', headers: { [TOKEN_HEADER]: token } });
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
    html: (slug, choice) =>
      get(deckUrl(slug, choice), async (res) => ({
        data: await res.text(),
        name: fileName(res, `${slug}.html`),
        slides: Number(res.headers.get('x-deck-slides') ?? 0),
      })),
    pdf: (slug, choice) => get(deckUrl(slug, choice, 'pdf'), async (res) => ({ data: await res.blob(), name: fileName(res, `${slug}.pdf`) })),
    zip: (slug, choice) =>
      get(deckUrl(slug, choice, 'zip'), async (res) => ({
        data: await res.blob(),
        name: fileName(res, `${slug}.zip`),
        videos: Number(res.headers.get('x-deck-videos') ?? 0),
      })),
  };
}

export const HTTP_PRESENT_API: PresentApi = httpPresentApi();
