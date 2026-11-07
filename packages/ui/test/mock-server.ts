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
  birdviewCall?: (action: string, body: Record<string, string>) => Reply;
  /** `GET api/sign-off/preview?stories=S1,S2` (T39). */
  signOffPreview?: (storyIds: string[]) => Reply;
  /** `GET api/graph?verb=…` (T36, T40). */
  graph?: (query: URLSearchParams) => Reply;
  /** `GET api/story-progress` and `?story=` (T44). */
  progress?: (storyId: string | null) => Reply;
  /** `GET api/story-tests/thread?story=`, `POST api/story-tests/thread | send` (T47). */
  testThread?: (method: string, path: string, body: unknown) => Reply;
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
    if (url.startsWith('api/birdview/') && method === 'POST') {
      return respond(routes.birdviewCall?.(url.slice('api/birdview/'.length), body) ?? { status: 404, body: { error: 'no route' } });
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
