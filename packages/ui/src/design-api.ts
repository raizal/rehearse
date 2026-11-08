// The design calls (T50): `GET api/design?story=` (the story's design link, its boxes' links, the
// findings and whether the FigCraft web build is fetched), `GET api/design/file?file=` (the bytes
// of a linked .figcraft file), `POST api/design/save` (a Save from the embedded editor, base64)
// and `POST api/figcraft/fetch` (fetch the FigCraft web build). All send the session token. The
// PNG of a page is served without a token at `design/<page>.png`.
//
// T51: the same answer carries the design index (files, pages, top-level frames), the suggestions
// for an unlinked story or box, and where each link comes from (links.yaml or a frame name).
// `POST api/design/link` links, changes or unlinks (the owner's click) and `POST api/design/refresh`
// asks a running FigCraft for fresh pictures. A file's thumbnail is at `design-thumbnail?file=`.

import type { DesignFileIndex, DesignLinkSource, DesignPicture, DesignSuggestion, Finding, Id } from '@rehearse/core';
import { SERVER_RESTARTED, sessionClient, TOKEN_HEADER, tokenRejected, type SessionClient, type TokenReply } from './session-client.js';
import { at } from './base.js';

/** One link: a page of a FigCraft file, and the PNG of that page (paths from the repo top). */
export interface DesignLinkView {
  file: string;
  /** The page number (1 is the first) or the page name. */
  page: number | string;
  /** T51: a top-level frame of the page (its name, or its id when names repeat). */
  frame?: string;
  png?: string;
}

/** T51: where a link comes from, and the frame's name for a link by frame name. */
export interface LinkSourceView {
  source: DesignLinkSource;
  frameName?: string;
}

/** What `GET api/design?story=` returns. */
export interface DesignInfo {
  ok: true;
  slug: string;
  story: DesignLinkView | null;
  /** Box path → the link of that box, for this story. */
  boxes: Record<string, DesignLinkView>;
  findings: Finding[];
  linksFile: string;
  /** The line to add under `epics: <slug>:` to link the story. */
  linkLine: string;
  figcraft: { fetched: boolean; version?: string; url: string; command: string };
  /** The owner's name, for FigCraft comments. */
  author: string;
  /** T51 (absent from a T50 server): where the links come from, their pictures, the picker and the suggestions. */
  storySource?: LinkSourceView;
  boxSources?: Record<string, LinkSourceView>;
  storyPicture?: DesignPicture;
  boxPictures?: Record<string, DesignPicture>;
  /** The boxes that serve the story: path → title. */
  storyBoxes?: Record<string, string>;
  suggestions?: DesignSuggestion[];
  boxSuggestions?: Record<string, DesignSuggestion[]>;
  index?: DesignFileIndex[];
}

/** T51: what the picker or a suggestion links: a page, or a frame of it, for the story or a box of it. */
export interface DesignTarget {
  file: string;
  page: number;
  frame?: string;
}

export interface LinkRequest {
  epic: string;
  story: Id;
  box?: string;
}

export type DesignOutcome<T> = { ok: true; body: T } | { ok: false; error: string };

export interface DesignApi {
  design: (storyId: Id) => Promise<DesignOutcome<DesignInfo>>;
  file: (file: string) => Promise<DesignOutcome<ArrayBuffer>>;
  save: (file: string, base64: string) => Promise<DesignOutcome<{ file: string; size: number }>>;
  fetchFigcraft: () => Promise<DesignOutcome<{ version?: string }>>;
  /** T51: link the story (or a box of it) to a page or frame; `null` unlinks. */
  link: (who: LinkRequest, target: DesignTarget | null) => Promise<DesignOutcome<{ link: DesignLinkView | null; linksFile: string }>>;
  /** T51: fresh pictures of the story's linked pages and frames from the running FigCraft. */
  refresh: (storyId: Id) => Promise<DesignOutcome<{ wrote: string[]; message: string }>>;
}

const errorOf = (url: string, r: TokenReply): string =>
  tokenRejected(r) ? SERVER_RESTARTED : typeof r.body?.error === 'string' ? r.body.error : `${url}: HTTP ${r.status}`;

const failed = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : String(e) });

/** The HTTP client. The session token comes from the session client. */
export function httpDesignApi(client: SessionClient = sessionClient): DesignApi {
  const call = (url: string, body?: unknown): Promise<TokenReply> =>
    client.withToken((token) =>
      fetch(
        at(url),
        body === undefined
          ? { cache: 'no-store', headers: { [TOKEN_HEADER]: token } }
          : { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json', [TOKEN_HEADER]: token }, body: JSON.stringify(body) },
      ),
    );
  const json = async <T>(url: string, body?: unknown): Promise<DesignOutcome<T>> => {
    try {
      const r = await call(url, body);
      if (r.ok && r.body?.ok === true) return { ok: true, body: r.body as unknown as T };
      return { ok: false, error: errorOf(url, r) };
    } catch (e) {
      return failed(e);
    }
  };
  return {
    design: (storyId) => json<DesignInfo>(`api/design?story=${encodeURIComponent(storyId)}`),
    async file(file) {
      const url = `api/design/file?file=${encodeURIComponent(file)}`;
      let bytes: ArrayBuffer | undefined;
      try {
        // The bytes are read before the session client reads the body as JSON (which then fails quietly).
        const r = await client.withToken(async (token) => {
          const res = await fetch(at(url), { cache: 'no-store', headers: { [TOKEN_HEADER]: token } });
          if (res.ok) bytes = await res.arrayBuffer();
          return res;
        });
        if (r.ok && bytes) return { ok: true, body: bytes };
        return { ok: false, error: errorOf(url, r) };
      } catch (e) {
        return failed(e);
      }
    },
    save: (file, base64) => json<{ file: string; size: number }>('api/design/save', { file, bytes: base64 }),
    fetchFigcraft: () => json<{ version?: string }>('api/figcraft/fetch', {}),
    link: (who, target) => json<{ link: DesignLinkView | null; linksFile: string }>('api/design/link', target ? { ...who, ...target } : { ...who, unlink: true }),
    refresh: (storyId) => json<{ wrote: string[]; message: string }>('api/design/refresh', { story: storyId }),
  };
}

export const HTTP_DESIGN_API: DesignApi = httpDesignApi();
