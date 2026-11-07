// The UI talks to `rehearse serve` only (R12). URLs are relative, so the app also
// works behind a path prefix (bb panel, bb connect). Approve and sign-off are
// POSTs with the session token; the browser adds the Origin header (R13, R14). The Birdview
// calls go to the same server, which talks to the player on 127.0.0.1 (T13).

import type { Finding, Id } from '@rehearse/core';
import type { MergeDone, MergeKind, MergeSummary, SignOffPreview, StoryProgress, StoryThreadView, TestThreadView } from '@rehearse/server';
import type { StatusTable } from '@rehearse/core';
import type { ApproveOk, PostOutcome, ReviewEpicView, SignOffOk } from './contract.js';
import { SERVER_RESTARTED, sessionClient, TOKEN_HEADER, tokenRejected, type SessionClient, type TokenReply } from './session-client.js';

import type { BirdviewInfo } from '@rehearse/server';

export type { BirdviewInfo, EpicView, ScenarioView } from '@rehearse/server';

export async function fetchEpic(): Promise<ReviewEpicView> {
  const res = await fetch('api/epic', { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET api/epic: HTTP ${res.status}`);
  return (await res.json()) as ReviewEpicView;
}

export { fetchSession } from './session-client.js';

/** A GET or a JSON POST with the session token (through the shared session client). */
function tokenCall(client: SessionClient, url: string, body?: unknown): Promise<TokenReply> {
  return client.withToken((token) =>
    fetch(
      url,
      body === undefined
        ? { cache: 'no-store', headers: { [TOKEN_HEADER]: token } }
        : { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json', [TOKEN_HEADER]: token }, body: JSON.stringify(body) },
    ),
  );
}

export function postApprove(scenarioIds: Id[], client: SessionClient = sessionClient): Promise<PostOutcome<ApproveOk>> {
  return post<ApproveOk>(client, 'api/approve', { scenarioIds });
}

export function postSignOff(storyIds: Id[], client: SessionClient = sessionClient): Promise<PostOutcome<SignOffOk>> {
  return post<SignOffOk>(client, 'api/sign-off', { storyIds });
}

/** This story's tests and the Birdview player, read by the server. */
export async function fetchBirdview(storyId: Id, client: SessionClient = sessionClient): Promise<BirdviewInfo> {
  const url = `api/birdview?story=${encodeURIComponent(storyId)}`;
  const r = await tokenCall(client, url);
  if (tokenRejected(r)) throw new Error(SERVER_RESTARTED);
  if (!r.ok) throw new Error(`GET ${url}: HTTP ${r.status}`);
  return r.body as unknown as BirdviewInfo;
}

/** A Birdview call of the Tests tab (T45), as the server names it. */
export type BirdviewAction = 'play-story' | 'play-test' | 'use-project';

/** What a Birdview call did, or why not: `reason` is busy | off | not-found | bad-request | refused. */
export type BirdviewOutcome = { ok: true; body: Record<string, unknown> } | { ok: false; error: string; reason?: string };

/** Play this story's playlist or one test, or switch the player's project. One try: busy is said, not queued. */
export async function postBirdview(action: BirdviewAction, body: Record<string, string | string[]>, client: SessionClient = sessionClient): Promise<BirdviewOutcome> {
  try {
    const r = await tokenCall(client, `api/birdview/${action}`, body);
    if (r.status === 200 && r.body?.ok === true) return { ok: true, body: r.body };
    if (tokenRejected(r)) return { ok: false, error: SERVER_RESTARTED };
    const reason = typeof r.body?.reason === 'string' ? r.body.reason : undefined;
    return { ok: false, error: typeof r.body?.error === 'string' ? r.body.error : `HTTP ${r.status}`, ...(reason ? { reason } : {}) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function post<T>(client: SessionClient, url: string, body: unknown): Promise<PostOutcome<T>> {
  let r: TokenReply;
  try {
    r = await tokenCall(client, url, body);
  } catch (e) {
    return { kind: 'error', message: `POST ${url}: ${e instanceof Error ? e.message : String(e)}` };
  }
  const json = r.body;
  const text = (key: string) => (typeof json?.[key] === 'string' ? (json[key] as string) : undefined);
  if (r.status === 200 && json?.ok === true) return { kind: 'ok', body: json as T };
  if (r.status === 409) return { kind: 'findings', findings: Array.isArray(json?.findings) ? (json.findings as Finding[]) : [] };
  if (r.status === 503) return { kind: 'unavailable', reason: text('reason') ?? 'signing is not available' };
  if (tokenRejected(r)) return { kind: 'restarted' };
  if (r.status === 403) {
    return { kind: 'forbidden', message: text('reason') ?? text('error') ?? 'the server refused the request (session token or origin); reload the page' };
  }
  return { kind: 'error', message: `POST ${url}: HTTP ${r.status}${text('error') ? `: ${text('error')}` : ''}` };
}

// ---------------------------------------------------------------- the story thread panel (T12)

export type { StoryThreadView } from '@rehearse/server';

/** A story-thread answer: the view, or an error in words (and the raw message behind it, T46). */
export type ThreadOutcome<T> = { kind: 'ok'; body: T } | { kind: 'error'; status: number; message: string; details?: string; conflict?: { files: string[] } };

export type StoryThreadAction = 'link' | 'start' | 'build' | 'send-change' | 'send' | 'open';

/** `GET api/story-thread?story=`. Needs the session token, like every story-thread route. */
export function fetchStoryThread(story: Id, client: SessionClient = sessionClient): Promise<ThreadOutcome<StoryThreadView>> {
  return threadCall<StoryThreadView>(client, `api/story-thread?story=${encodeURIComponent(story)}`);
}

/** `POST api/story-thread/<action>`. link: { threadId }, send: { text, context }; start, build, send-change and open: nothing more. */
export function postStoryThread<T = StoryThreadView>(action: StoryThreadAction, body: { story: Id } & Record<string, string>, client: SessionClient = sessionClient): Promise<ThreadOutcome<T>> {
  return threadCall<T>(client, `api/story-thread/${action}`, body);
}

export type { StoryProgress } from '@rehearse/server';

const NO_PROGRESS = 'this rehearse serve has no progress API; update rehearse';

/** `GET api/story-progress?story=` (T44): what rehearse sees of the work on one story. */
export async function fetchStoryProgress(story: Id, client: SessionClient = sessionClient): Promise<ThreadOutcome<StoryProgress>> {
  const r = await threadCall<{ progress: StoryProgress }>(client, `api/story-progress?story=${encodeURIComponent(story)}`, undefined, NO_PROGRESS);
  return r.kind === 'ok' ? { kind: 'ok', body: r.body.progress } : r;
}

/** `GET api/story-progress` (T44): the progress of every story, for the Stories overview. */
export async function fetchAllProgress(client: SessionClient = sessionClient): Promise<ThreadOutcome<StoryProgress[]>> {
  const r = await threadCall<{ stories: StoryProgress[] }>(client, 'api/story-progress', undefined, NO_PROGRESS);
  return r.kind === 'ok' ? { kind: 'ok', body: r.body.stories } : r;
}

export type { SignOffPreview, SinceSignOff, StorySignOffPreview } from '@rehearse/server';

export type { TestThreadView } from '@rehearse/server';

const NO_TEST_THREADS = 'this rehearse serve cannot start test threads; update rehearse';

/** `GET api/story-tests/thread?story=` (T47): the story's test thread, and the approved scenarios without a test. */
export function fetchTestThread(story: Id, client: SessionClient = sessionClient): Promise<ThreadOutcome<TestThreadView>> {
  return threadCall<TestThreadView>(client, `api/story-tests/thread?story=${encodeURIComponent(story)}`, undefined, NO_TEST_THREADS);
}

/** `POST api/story-tests/thread` starts a test thread; `POST api/story-tests/send` sends more scenarios to it (T47). */
export function postTestThread(action: 'thread' | 'send', body: { story: Id; scenarios?: Id[] }, client: SessionClient = sessionClient): Promise<ThreadOutcome<TestThreadView>> {
  return threadCall<TestThreadView>(client, `api/story-tests/${action}`, body, NO_TEST_THREADS);
}

/** `GET api/sign-off/preview?stories=` (T39): what each story's sign-off covers, and what changed since the last one. */
export function fetchSignOffPreview(storyIds: Id[], client: SessionClient = sessionClient): Promise<ThreadOutcome<SignOffPreview>> {
  return threadCall<SignOffPreview>(client, `api/sign-off/preview?stories=${storyIds.map(encodeURIComponent).join(',')}`, undefined, 'this rehearse serve has no sign-off preview; update rehearse');
}

export type { MergeDone, MergeKind, MergeSummary } from '@rehearse/server';

const NO_MERGE = 'this rehearse serve cannot merge a thread; update rehearse';

/** `GET api/thread/merge?story=&kind=` (T48): what the thread's branch brings that the checked-out branch has not. */
export function fetchMergeSummary(story: Id, kind: MergeKind, client: SessionClient = sessionClient): Promise<ThreadOutcome<MergeSummary>> {
  return threadCall<MergeSummary>(client, `api/thread/merge?story=${encodeURIComponent(story)}&kind=${kind}`, undefined, NO_MERGE);
}

/** `POST api/thread/merge` (T48): the owner's "Merge into <branch>". A conflict comes back with its files. */
export function postMerge(story: Id, kind: MergeKind, client: SessionClient = sessionClient): Promise<ThreadOutcome<MergeDone>> {
  return threadCall<MergeDone>(client, 'api/thread/merge', { story, kind }, NO_MERGE);
}

/** `POST api/thread/ask-rebase` (T48): tell the thread its branch conflicts, and ask it to rebase. */
export function postAskRebase(story: Id, kind: MergeKind, files: string[], client: SessionClient = sessionClient): Promise<ThreadOutcome<{ ok: true; threadId: string }>> {
  return threadCall<{ ok: true; threadId: string }>(client, 'api/thread/ask-rebase', { story, kind, files }, NO_MERGE);
}

async function threadCall<T>(client: SessionClient, url: string, body?: unknown, missing = 'this rehearse serve has no story thread API; update rehearse'): Promise<ThreadOutcome<T>> {
  let r: TokenReply;
  try {
    r = await tokenCall(client, url, body);
  } catch (e) {
    return { kind: 'error', status: 0, message: `cannot reach rehearse serve: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (r.ok && r.body !== undefined) return { kind: 'ok', body: r.body as T };
  if (tokenRejected(r)) return { kind: 'error', status: r.status, message: SERVER_RESTARTED };
  const error = typeof r.body?.error === 'string' ? r.body.error : `HTTP ${r.status}`;
  const details = typeof r.body?.details === 'string' && r.body.details !== '' ? r.body.details : undefined;
  const conflict = r.body?.conflict as { files?: unknown } | undefined;
  const files = Array.isArray(conflict?.files) ? conflict.files.filter((f): f is string => typeof f === 'string') : undefined;
  return { kind: 'error', status: r.status, message: r.status === 404 && error.startsWith('no endpoint') ? missing : error, ...(details ? { details } : {}), ...(files ? { conflict: { files } } : {}) };
}

// ---------------------------------------------------------------- the Status page (T58)

export type { StatusRow, StatusTable } from '@rehearse/core';

/** `GET api/status?epic=` (T58, box status-table): per story, signed, built, tested, done, and what is missing. Read-only. */
export async function fetchStatus(slug: string, client: SessionClient = sessionClient): Promise<ThreadOutcome<StatusTable>> {
  const r = await threadCall<{ status: StatusTable }>(client, `api/status?epic=${encodeURIComponent(slug)}`, undefined, 'this rehearse serve has no Status page yet; update rehearse');
  return r.kind === 'ok' ? { kind: 'ok', body: r.body.status } : r;
}
