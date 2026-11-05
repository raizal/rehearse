// The UI talks to `rehearse serve` only (R12). URLs are relative, so the app also
// works behind a path prefix (bb panel, bb connect). Approve and sign-off are
// POSTs with the session token; the browser adds the Origin header (R13, R14). The Birdview
// calls go to the same server, which talks to the player on 127.0.0.1 (T13).

import type { Finding, Id } from '@rehearse/core';
import type { StoryThreadView } from '@rehearse/server';
import type { ApproveOk, PostOutcome, ReviewEpicView, Session, SignOffOk } from './contract.js';

import type { BirdviewInfo } from '@rehearse/server';

export type { BirdviewInfo, EpicView, ScenarioView } from '@rehearse/server';

export async function fetchEpic(): Promise<ReviewEpicView> {
  const res = await fetch('api/epic', { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET api/epic: HTTP ${res.status}`);
  return (await res.json()) as ReviewEpicView;
}

export async function fetchSession(): Promise<Session> {
  const res = await fetch('api/session', { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET api/session: HTTP ${res.status}`);
  return (await res.json()) as Session;
}

export function postApprove(token: string, scenarioIds: Id[]): Promise<PostOutcome<ApproveOk>> {
  return post<ApproveOk>('api/approve', token, { scenarioIds });
}

export function postSignOff(token: string, storyIds: Id[]): Promise<PostOutcome<SignOffOk>> {
  return post<SignOffOk>('api/sign-off', token, { storyIds });
}

/** This story's tests and the Birdview player, read by the server. */
export async function fetchBirdview(token: string, storyId: Id): Promise<BirdviewInfo> {
  const url = `api/birdview?story=${encodeURIComponent(storyId)}`;
  const res = await fetch(url, { cache: 'no-store', headers: { 'x-rehearse-token': token } });
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return (await res.json()) as BirdviewInfo;
}

/** Pick this story's playlist in the player. */
export async function postBirdviewSelect(token: string, storyId: Id): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch('api/birdview/action', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json', 'x-rehearse-token': token },
      body: JSON.stringify({ action: 'playlist-select', storyId }),
    });
    const json = (await res.json().catch(() => undefined)) as { ok?: boolean; error?: string } | undefined;
    if (res.status === 200 && json?.ok === true) return { ok: true };
    return { ok: false, error: json?.error ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function post<T>(url: string, token: string, body: unknown): Promise<PostOutcome<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json', 'x-rehearse-token': token },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { kind: 'error', message: `POST ${url}: ${e instanceof Error ? e.message : String(e)}` };
  }
  const json = (await res.json().catch(() => undefined)) as Record<string, unknown> | undefined;
  const text = (key: string) => (typeof json?.[key] === 'string' ? (json[key] as string) : undefined);
  if (res.status === 200 && json?.ok === true) return { kind: 'ok', body: json as T };
  if (res.status === 409) return { kind: 'findings', findings: Array.isArray(json?.findings) ? (json.findings as Finding[]) : [] };
  if (res.status === 503) return { kind: 'unavailable', reason: text('reason') ?? 'signing is not available' };
  if (res.status === 403) {
    return { kind: 'forbidden', message: text('reason') ?? text('error') ?? 'the server refused the request (session token or origin); reload the page' };
  }
  return { kind: 'error', message: `POST ${url}: HTTP ${res.status}${text('error') ? `: ${text('error')}` : ''}` };
}

// ---------------------------------------------------------------- the story thread panel (T12)

export type { StoryThreadView } from '@rehearse/server';

/** A story-thread answer: the view, or an error in words. */
export type ThreadOutcome<T> = { kind: 'ok'; body: T } | { kind: 'error'; status: number; message: string };

export type StoryThreadAction = 'link' | 'start' | 'send' | 'open';

/** `GET api/story-thread?story=`. Needs the session token, like every story-thread route. */
export function fetchStoryThread(token: string, story: Id): Promise<ThreadOutcome<StoryThreadView>> {
  return threadCall<StoryThreadView>(`api/story-thread?story=${encodeURIComponent(story)}`, { method: 'GET', headers: { 'x-rehearse-token': token } });
}

/** `POST api/story-thread/<action>`. link: { threadId }, send: { text, context }, start and open: nothing more. */
export function postStoryThread<T = StoryThreadView>(token: string, action: StoryThreadAction, body: { story: Id } & Record<string, string>): Promise<ThreadOutcome<T>> {
  return threadCall<T>(`api/story-thread/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-rehearse-token': token },
    body: JSON.stringify(body),
  });
}

async function threadCall<T>(url: string, init: RequestInit): Promise<ThreadOutcome<T>> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', ...init });
  } catch (e) {
    return { kind: 'error', status: 0, message: `cannot reach rehearse serve: ${e instanceof Error ? e.message : String(e)}` };
  }
  const json = (await res.json().catch(() => undefined)) as Record<string, unknown> | undefined;
  if (res.ok && json !== undefined) return { kind: 'ok', body: json as T };
  const error = typeof json?.error === 'string' ? json.error : `HTTP ${res.status}`;
  return { kind: 'error', status: res.status, message: res.status === 404 && error.startsWith('no endpoint') ? 'this rehearse serve has no story thread API; update rehearse' : error };
}
