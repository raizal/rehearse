// The server session (D41, R13, R14): a random token per server start, and the identity and
// signing key of the server process. The identity comes from git and BB_THREAD_ID, never from
// a request, so a client cannot approve or sign off as someone else.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { currentIdentity, gitSigner, type Identity, type SignerResult, type SshKeygen } from '@rehearse/core';

export interface ServerSession {
  /** Every POST must send it in `X-Rehearse-Token`. */
  token: string;
  identity: Identity;
  signer: SignerResult;
}

/** What `GET /api/session` returns. */
export interface SessionInfo {
  token: string;
  identity: Identity;
  signing: { ok: true; keyFingerprint: string } | { ok: false; reason: string };
}

/** A new random token. */
export function newToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * The session of a server process for an EPIC folder: git user.email (+ BB_THREAD_ID) and the
 * git signing key (gpg.format ssh, user.signingkey). Without an email, signing is off.
 */
export function createSession(epicDir: string, env: Record<string, string | undefined> = process.env, keygen?: SshKeygen): ServerSession {
  const token = newToken();
  let identity: Identity;
  try {
    identity = currentIdentity(epicDir, env);
  } catch (e) {
    return { token, identity: { by: '' }, signer: { ok: false, reason: e instanceof Error ? e.message : String(e) } };
  }
  return { token, identity, signer: gitSigner(epicDir, keygen) };
}

export function sessionInfo(session: ServerSession): SessionInfo {
  const signing: SessionInfo['signing'] = session.signer.ok
    ? { ok: true, keyFingerprint: session.signer.signer.keyFingerprint }
    : { ok: false, reason: session.signer.reason };
  return { token: session.token, identity: session.identity, signing };
}

/** Constant-time token check. */
export function tokenMatches(session: ServerSession, given: string | string[] | undefined): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(session.token);
  return a.length === b.length && timingSafeEqual(a, b);
}
