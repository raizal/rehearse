// A mock `fetch` that answers the review HTTP contract (T6 builds the real server side).
// Each route can be replaced per test; every call is recorded.

import { vi } from 'vitest';
import type { ReviewEpicView, Session } from '../src/contract.js';
import { FIXTURE_KEY } from './fixture.js';

export interface Reply {
  status: number;
  body: unknown;
}

export interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

export interface MockRoutes {
  /** Answer of `GET api/epic`; called on each request, so a test can change the record between loads. */
  epic: () => ReviewEpicView;
  session?: () => Reply;
  approve?: (body: { scenarioIds: string[] }) => Reply;
  signOff?: (body: { storyIds: string[] }) => Reply;
  /** `GET api/birdview?story=<id>` (T13). */
  birdview?: (storyId: string) => Reply;
  /** `POST api/birdview/play-story | play-test | use-project` (T45). */
  birdviewCall?: (action: string, body: Record<string, string | string[]>) => Reply;
  /** `GET api/sign-off/preview?stories=S1,S2` (T39). */
  signOffPreview?: (storyIds: string[]) => Reply;
  /** `GET api/graph?verb=…` (T36, T40). */
  graph?: (query: URLSearchParams) => Reply;
  /** `GET api/story-progress` and `?story=` (T44). */
  progress?: (storyId: string | null) => Reply;
  /** `GET api/story-tests/thread?story=`, `POST api/story-tests/thread | send` (T47). */
  testThread?: (method: string, path: string, body: unknown) => Reply;
  /** `GET api/thread/merge?story=&kind=`, `POST api/thread/merge | ask-rebase` (T48): GET passes the query as the body. */
  threadMerge?: (method: string, path: 'merge' | 'ask-rebase', body: Record<string, unknown>) => Reply;
  /** `GET api/design?story=` (T50). Without it the server has no design API (404). */
  design?: (storyId: string) => Reply;
  /** `GET api/design/file?file=` (T50): the bytes of the file. */
  designFile?: (file: string) => { status: number; bytes: Uint8Array };
  /** `POST api/design/save` (T50). */
  designSave?: (body: { file: string; bytes: string }) => Reply;
  /** `POST api/design/link` (T51). */
  designLink?: (body: Record<string, unknown>) => Reply;
  /** `POST api/design/refresh` (T51). */
  designRefresh?: (body: { story: string }) => Reply;
  /** `POST api/figcraft/fetch` (T50). */
  figcraftFetch?: () => Reply;
  /** `GET api/present?epic=&format=` (T52): the deck, or an error body. */
  present?: (format: 'html' | 'pdf' | 'zip', epic: string) => { status: number; data?: string; headers?: Record<string, string | undefined>; body?: unknown };
}

export const SESSION: Session = {
  token: 'tok-123',
  identity: { by: 'builder@example.com', threadId: 'thr_test' },
  signing: { ok: true, keyFingerprint: FIXTURE_KEY },
};

export function mockServer(routes: MockRoutes): { calls: Call[]; posts: (url: string) => Call[]; gets: (url: string) => Call[] } {
  const calls: Call[] = [];
  const respond = ({ status, body }: Reply) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, headers, body });
    if (url === 'api/epic' && method === 'GET') return respond({ status: 200, body: routes.epic() });
    if (url === 'api/session' && method === 'GET') return respond(routes.session?.() ?? { status: 200, body: SESSION });
    if (url === 'api/approve' && method === 'POST') {
      return respond(routes.approve?.(body) ?? { status: 200, body: { ok: true, approved: body.scenarioIds } });
    }
    if (url.startsWith('api/birdview?story=') && method === 'GET') {
      return respond(routes.birdview?.(decodeURIComponent(url.slice('api/birdview?story='.length))) ?? { status: 404, body: { error: 'no route' } });
    }
    if (url.startsWith('api/sign-off/preview?stories=') && method === 'GET') {
      const ids = url.slice('api/sign-off/preview?stories='.length).split(',').map(decodeURIComponent);
      return respond(routes.signOffPreview?.(ids) ?? { status: 404, body: { error: 'no endpoint api/sign-off/preview' } });
    }
    if (url.startsWith('api/graph?') && method === 'GET') {
      return respond(routes.graph?.(new URLSearchParams(url.slice('api/graph?'.length))) ?? { status: 404, body: { ok: false, error: 'no route' } });
    }
    if ((url === 'api/story-progress' || url.startsWith('api/story-progress?story=')) && method === 'GET' && routes.progress) {
      const story = url.includes('?story=') ? decodeURIComponent(url.split('?story=')[1]!) : null;
      return respond(routes.progress(story));
    }
    if (url.startsWith('api/story-tests/') && routes.testThread) {
      return respond(routes.testThread(method, url.split('?')[0]!.slice('api/story-tests/'.length), body ?? { story: decodeURIComponent(url.split('?story=')[1] ?? '') }));
    }
    if (url.startsWith('api/thread/') && routes.threadMerge) {
      const [path = '', query = ''] = url.slice('api/thread/'.length).split('?');
      return respond(routes.threadMerge(method, path as 'merge' | 'ask-rebase', body ?? Object.fromEntries(new URLSearchParams(query))));
    }
    if (url.startsWith('api/birdview/') && method === 'POST') {
      return respond(routes.birdviewCall?.(url.slice('api/birdview/'.length), body) ?? { status: 404, body: { error: 'no route' } });
    }
    if (url.startsWith('api/design?story=') && method === 'GET' && routes.design) return respond(routes.design(decodeURIComponent(url.slice('api/design?story='.length))));
    if (url.startsWith('api/design/file?file=') && method === 'GET' && routes.designFile) {
      const { status, bytes } = routes.designFile(decodeURIComponent(url.slice('api/design/file?file='.length)));
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      return { ok: status >= 200 && status < 300, status, arrayBuffer: async () => buffer, json: async () => JSON.parse('not json') } as unknown as Response;
    }
    if (url === 'api/design/save' && method === 'POST' && routes.designSave) return respond(routes.designSave(body));
    if (url === 'api/design/link' && method === 'POST' && routes.designLink) return respond(routes.designLink(body));
    if (url === 'api/design/refresh' && method === 'POST' && routes.designRefresh) return respond(routes.designRefresh(body));
    if (url === 'api/figcraft/fetch' && method === 'POST' && routes.figcraftFetch) return respond(routes.figcraftFetch());
    if (url.startsWith('api/present?') && method === 'GET' && routes.present) {
      const q = new URLSearchParams(url.slice('api/present?'.length));
      const r = routes.present(q.get('format') === 'pdf' ? 'pdf' : q.get('format') === 'zip' ? 'zip' : 'html', q.get('epic') ?? '');
      const headers = new Headers(Object.entries(r.headers ?? {}).filter((e): e is [string, string] => e[1] !== undefined));
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        headers,
        text: async () => r.data ?? '',
        blob: async () => new Blob([r.data ?? ''], { type: headers.get('content-type') ?? '' }),
        json: async () => (r.body === undefined ? JSON.parse('not json') : r.body),
      } as unknown as Response;
    }
    if (url === 'api/sign-off' && method === 'POST') return respond(routes.signOff?.(body) ?? { status: 500, body: { error: 'no route' } });
    return respond({ status: 404, body: { error: `no endpoint ${url}` } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    calls,
    posts: (url) => calls.filter((c) => c.method === 'POST' && c.url === url),
    gets: (url) => calls.filter((c) => c.method === 'GET' && c.url === url),
  };
}
