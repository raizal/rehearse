// The UI talks to `rehearse serve` only (R12). URLs are relative, so the app also
// works behind a path prefix (bb panel, bb connect). Approve and sign-off are
// POSTs with the session token; the browser adds the Origin header (R13, R14).

import type { Finding, Id } from '@rehearse/core';
import type { ApproveOk, PostOutcome, ReviewEpicView, Session, SignOffOk } from './contract.js';

export type { EpicView, ScenarioView } from '@rehearse/server';

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
