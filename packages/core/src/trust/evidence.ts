// Signed evidence (D41, R13, R14): the signature status of each approval and sign-off of a
// record, the gate findings for those that are not valid, and the signers with their key
// fingerprints for the gate report. Simulate does not use this: it checks design, not trust.

import { RECORD_FILES, type DateTime, type EpicRecord, type Finding, type Id } from '../types.js';
import { asArray, cmp, isObject } from '../util.js';
import type { GateItem } from './gate.js';
import { approvalPayload, signOffPayload, type SignedApproval, type SignedSignOff, type SigStatus, type Verifier } from './signature.js';
import { detectStale } from './stale.js';
import type { GateReport, StaleResult } from './types.js';

/** Signature state of the approval of one scenario. */
export interface ApprovalSig {
  scenario: Id;
  story: Id;
  file: string;
  by: string;
  at: DateTime;
  sigStatus: SigStatus;
  /** Key fingerprint, when the signature can be read. */
  signer?: string;
}

/** Signature state of one sign-off event, in signoff.yaml order. */
export interface SignOffSig {
  /** Index in `signOffs`. */
  index: number;
  by: string;
  at: DateTime;
  stories: Id[];
  sigStatus: SigStatus;
  signer?: string;
}

export interface RecordSignatures {
  /** Every scenario that has an approval, in file order. */
  approvals: ApprovalSig[];
  signOffs: SignOffSig[];
}

/** A key that signed valid evidence, for the gate report (D41: remaining risk). */
export interface GateSigner {
  by: string;
  fingerprint: string;
  /** Scenario ids whose valid approval this key signed. Sorted. */
  approvals: Id[];
  /** Indexes of the valid sign-offs this key signed. */
  signOffs: number[];
}

/** Gate report with signature checks: each signer and its key fingerprint. */
export interface SignedGateReport extends GateReport {
  signers: GateSigner[];
}

/** Check the signature of every approval and sign-off of a loaded record. */
export function checkSignatures(record: EpicRecord, verifier: Verifier): RecordSignatures {
  const approvals: ApprovalSig[] = [];
  for (const file of record.scenarioFiles) {
    for (const s of asArray(file.scenarios)) {
      if (!isObject(s) || !isObject(s.approval)) continue;
      const a = s.approval as SignedApproval;
      const check = verifier.verify(approvalPayload(record.slug, s.id, a), a.sig, String(a.by ?? ''));
      approvals.push({ scenario: s.id, story: s.story, file: file.file, by: a.by, at: a.at, sigStatus: check.status, ...(check.fingerprint ? { signer: check.fingerprint } : {}) });
    }
  }
  const signOffs: SignOffSig[] = [];
  asArray<SignedSignOff>(record.signoff?.signOffs).forEach((s, index) => {
    if (!isObject(s)) return;
    const check = verifier.verify(signOffPayload(record.slug, s), s.sig, String(s.by ?? ''));
    const stories = isObject(s.storyHashes) ? Object.keys(s.storyHashes).sort(cmp) : [];
    signOffs.push({ index, by: s.by, at: s.at, stories, sigStatus: check.status, ...(check.fingerprint ? { signer: check.fingerprint } : {}) });
  });
  return { approvals, signOffs };
}

const SIG_REASON: Record<Exclude<SigStatus, 'valid'>, string> = {
  missing: 'no signature',
  invalid: 'the signature does not match',
  'unknown-signer': 'the key is not in .rehearse/allowed_signers for this email',
};

function statusText(status: Exclude<SigStatus, 'valid'>, signer: string | undefined): string {
  return `sigStatus ${status}: ${SIG_REASON[status]}${signer ? ` (key ${signer})` : ''}`;
}

/** The latest sign-off that covers a story. */
function latestSignOff(sigs: RecordSignatures, story: Id): SignOffSig | undefined {
  return [...sigs.signOffs].reverse().find((s) => s.stories.includes(story));
}

/**
 * Gate items for evidence without a valid signature.
 * - traced: an approval whose hash matches (status approved) but whose signature is not valid.
 *   It names the scenario and the status. (A stale approval is already a no-stale finding.)
 * - no-stale: a story whose latest sign-off has no valid signature. A story that must be signed
 *   again for another reason (stale, old hash rule) keeps only that finding.
 */
export function signatureItems(record: EpicRecord, sigs: RecordSignatures, stale: StaleResult = detectStale(record)): GateItem[] {
  const items: GateItem[] = [];
  for (const a of sigs.approvals) {
    if (a.sigStatus === 'valid') continue;
    const trust = stale.scenarios.find((s) => s.id === a.scenario && s.file === a.file);
    if (trust?.status !== 'approved') continue;
    const finding: Finding = {
      kind: 'gate',
      file: a.file,
      path: a.scenario,
      message: `approval of ${a.scenario} by ${a.by} is not evidence: ${statusText(a.sigStatus, a.signer)}; approve it again in the UI`,
      refs: [a.story],
    };
    items.push({ check: 'traced', stories: [a.story], finding });
  }
  for (const story of stale.stories) {
    if (story.status !== 'signed' || !story.trusted) continue;
    const latest = latestSignOff(sigs, story.id);
    if (!latest || latest.sigStatus === 'valid') continue;
    const finding: Finding = {
      kind: 'gate',
      file: RECORD_FILES.signoff,
      path: story.id,
      message: `sign-off ${latest.index} by ${latest.by} is not trusted: ${statusText(latest.sigStatus, latest.signer)}; must be signed again`,
      refs: [story.id],
    };
    items.push({ check: 'no-stale', stories: [story.id], resignStory: story.id, finding });
  }
  return items;
}

/** Each key that signed valid evidence, sorted by email, then fingerprint. */
export function gateSigners(sigs: RecordSignatures): GateSigner[] {
  const byKey = new Map<string, GateSigner>();
  const get = (by: string, fingerprint: string): GateSigner => {
    const k = `${by}\n${fingerprint}`;
    let s = byKey.get(k);
    if (!s) byKey.set(k, (s = { by, fingerprint, approvals: [], signOffs: [] }));
    return s;
  };
  for (const a of sigs.approvals) if (a.sigStatus === 'valid' && a.signer) get(a.by, a.signer).approvals.push(a.scenario);
  for (const s of sigs.signOffs) if (s.sigStatus === 'valid' && s.signer) get(s.by, s.signer).signOffs.push(s.index);
  return [...byKey.values()]
    .map((s) => ({ ...s, approvals: [...s.approvals].sort(cmp) }))
    .sort((a, b) => cmp(a.by, b.by) || cmp(a.fingerprint, b.fingerprint));
}

/** Text lines for the signers of a gate report: one line per key (D41). */
export function signersToText(signers: GateSigner[]): string {
  if (signers.length === 0) return 'signers: none\n';
  const lines = signers.map((s) => {
    const n = s.approvals.length;
    const m = s.signOffs.length;
    return `  ${s.by} ${s.fingerprint}: ${n} approval${n === 1 ? '' : 's'}, ${m} sign-off${m === 1 ? '' : 's'}`;
  });
  return `signers (check each key; a change to .rehearse/allowed_signers needs human review):\n${lines.join('\n')}\n`;
}
