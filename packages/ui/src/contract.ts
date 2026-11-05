// The review side of the HTTP contract with `rehearse serve` (S6, S7, S8, S9; D41).
// The server builds these; the UI only reads them. Fields the server adds to
// `GET /api/epic` are optional here, so the UI also works with an older server.

import type { Finding, GateReport, Id, Identity, PermissionBoxes, PermissionMatrix, SignedReadiness, SignOffWithRule } from '@rehearse/core';
import type { EpicView } from '@rehearse/server';

/** Result of the SSH signature check of an approval or a sign-off (D41). */
export type SigStatus = 'valid' | 'missing' | 'invalid' | 'unknown-signer';

/** Signing is available when the serve process can sign with the builder's key. */
export type Signing = { ok: true; keyFingerprint: string } | { ok: false; reason: string };

/** `GET /api/session`. The token is random per server start; every POST sends it. */
export interface Session {
  token: string;
  identity: Identity;
  signing: Signing;
}

/** One approval as the server checked it. */
export interface ApprovalView {
  by: string;
  at: string;
  /** Key fingerprint of the signer. */
  signer?: string;
  sigStatus: SigStatus;
}

/** One sign-off event as the server checked it. */
export interface SignOffView extends SignOffWithRule {
  signer?: string;
  sigStatus: SigStatus;
}

/** The review fields of `GET /api/epic`. */
export interface ReviewFields {
  /** Gate report, computed with simulate. */
  gate: GateReport;
  /** A newer server counts only approvals with a valid signature as proof (C28); the UI does too. */
  readiness: SignedReadiness;
  simulation: { permissionMatrix: PermissionMatrix; permissionBoxes: PermissionBoxes };
  /** scenario id → approval. */
  approvals: Record<Id, ApprovalView>;
  signOffs: SignOffView[];
}

/** `GET /api/epic`: the record view plus the review fields. */
export type ReviewEpicView = EpicView & Partial<ReviewFields>;

/** `POST /api/approve` 200. */
export interface ApproveOk {
  ok: true;
  approved: Id[];
}

/** `POST /api/sign-off` 200. */
export interface SignOffOk {
  ok: true;
  signOff: SignOffView;
}

/** What a POST gave, sorted by what the UI shows. */
export type PostOutcome<T> =
  | { kind: 'ok'; body: T }
  /** 409: the record or the gate has findings. */
  | { kind: 'findings'; findings: Finding[] }
  /** 503: signing is not available. */
  | { kind: 'unavailable'; reason: string }
  /** 403: bad token or origin. */
  | { kind: 'forbidden'; message: string }
  /** Any other failure. */
  | { kind: 'error'; message: string };

/**
 * The guide to signing setup (D41), in the rehearse repo. `rehearse serve` does not serve it,
 * so the UI shows the path as text with the steps in short form (C29).
 */
export const SIGNING_DOC = 'docs/signing.md';
