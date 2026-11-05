// Boxes `approve` and `sign-off`, core only (R13, R14). The CLI has neither command:
// only the rehearse UI calls these. Both edit YAML with the Document API, so comments
// and every other entry stay as they are. Each event carries an SSH signature (D41):
// with no usable signing key they fail with a reason and write nothing.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isMap, isScalar, isSeq, parseDocument, visit, type Document, type Node, YAMLMap } from 'yaml';
import { scenarioHash } from '../hash.js';
import { loadEpic } from '../loader.js';
import { sortFindings } from '../validate/report.js';
import { RECORD_FILES, type Approval, type DateTime, type Finding, type Id, type Story } from '../types.js';
import { asArray, isObject } from '../util.js';
import { checkSignatures } from './evidence.js';
import { gateItems, simulationFindings, type Simulate } from './gate.js';
import { approvalPayload, defaultVerifier, signOffPayload, type SignedApproval, type SignedSignOff, type Signer, type Verifier } from './signature.js';
import { storyHashV2 } from './story-hash.js';
import { allScenarios } from './stale.js';
import { CURRENT_HASH_RULE, type Identity, type SignOffWithRule } from './types.js';

export interface WriteOptions {
  /** Time of the event. Default: now. */
  now?: Date;
  /** Signs each event (D41). Without one the write fails and writes nothing. */
  signer?: Signer;
  /** Checks the new signature and the existing evidence. Default: the repo's allowed_signers. */
  verifier?: Verifier;
}

/** `reason` is set when signing failed (no key, ssh-keygen error, key not in allowed_signers). */
export type ApproveResult =
  | { ok: true; approvals: { id: Id; file: string; approval: Approval }[] }
  | { ok: false; findings: Finding[]; reason?: string };

export type SignOffResult = { ok: true; signOff: SignOffWithRule } | { ok: false; findings: Finding[]; reason?: string };

/** The identity of the current user: git user.email, plus BB_THREAD_ID when it is set (R13). */
export function currentIdentity(cwd: string, env: Record<string, string | undefined> = process.env): Identity {
  let email = '';
  try {
    email = execFileSync('git', ['config', 'user.email'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    email = '';
  }
  if (email === '') throw new Error('git user.email is not set');
  const threadId = env.BB_THREAD_ID?.trim();
  return threadId ? { by: email, threadId } : { by: email };
}

/** ISO 8601 date-time to the second, like the bootstrap events. */
function timestamp(now: Date | undefined): DateTime {
  return (now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function checkIdentity(identity: Identity): Finding[] {
  if (typeof identity.by === 'string' && identity.by.trim() !== '') return [];
  return [{ kind: 'schema', file: '', path: '', message: 'identity has no git user.email', refs: [] }];
}

type SigningFailure = { ok: false; findings: Finding[]; reason: string };

function signingFailure(reason: string): SigningFailure {
  return { ok: false, reason, findings: [{ kind: 'gate', file: '', path: '', message: `cannot sign: ${reason}`, refs: [] }] };
}

/**
 * Sign a payload and check the new signature with the verifier, so no event is written that the
 * gate would not trust (for example a key that is not in allowed_signers for this email).
 */
function signChecked(payload: string, by: string, opts: WriteOptions, verifier: Verifier): string | SigningFailure {
  if (!opts.signer) return signingFailure('no signing key (set git gpg.format ssh and user.signingkey; see docs/signing.md)');
  let sig: string;
  try {
    sig = opts.signer.sign(payload);
  } catch (e) {
    return signingFailure(e instanceof Error ? e.message : String(e));
  }
  const check = verifier.verify(payload, sig, by);
  if (check.status === 'valid') return sig;
  const key = check.fingerprint ?? opts.signer.keyFingerprint;
  return signingFailure(
    check.status === 'unknown-signer'
      ? `key ${key} is not in .rehearse/allowed_signers for ${by} (see docs/signing.md)`
      : `the new signature does not verify (sigStatus ${check.status})`,
  );
}

function readDoc(file: string): Document {
  return parseDocument(readFileSync(file, 'utf8'), { keepSourceTokens: false });
}

/** A YAML node for a new event. Times and hashes are quoted, like the bootstrap events, so no YAML 1.1 reader takes them as dates. */
function eventNode(doc: Document, value: unknown): Node {
  const node = doc.createNode(value);
  visit(node, {
    Scalar(_key, scalar) {
      if (!isScalar(scalar) || typeof scalar.value !== 'string') return;
      if (scalar.value.startsWith('-----BEGIN SSH SIGNATURE-----')) scalar.type = 'BLOCK_LITERAL';
      else if (/^(sha256:|\d{4}-\d{2}-\d{2}T)/.test(scalar.value)) scalar.type = 'QUOTE_SINGLE';
    },
  });
  return node;
}

function writeDoc(file: string, doc: Document): void {
  writeFileSync(file, doc.toString({ lineWidth: 0 }));
}

/**
 * Approve scenarios by id (S6-A1). Each one gets `status: approved` and an approval with
 * who, when, the hash of its content and an SSH signature over `approvalPayload` (D41).
 * Nothing is written when an id is unknown or when a signature cannot be made.
 */
export function approveScenarios(dir: string, ids: Id[], identity: Identity, opts: WriteOptions = {}): ApproveResult {
  const abs = resolve(dir);
  const { record } = loadEpic(abs);
  const findings = checkIdentity(identity);
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) findings.push({ kind: 'reference', file: '', path: '', message: 'no scenario ids given', refs: [] });
  const byFile = new Map<string, { id: Id; hash: string }[]>();
  for (const id of wanted) {
    const file = record.scenarioFiles.find((f) => f.scenarios.some((s) => isObject(s) && s.id === id));
    if (!file) {
      findings.push({ kind: 'reference', file: RECORD_FILES.scenariosDir, path: id, message: `scenario ${id} unknown`, refs: [] });
      continue;
    }
    const scenario = file.scenarios.find((s) => isObject(s) && s.id === id)!;
    byFile.set(file.file, [...(byFile.get(file.file) ?? []), { id, hash: scenarioHash(scenario) }]);
  }
  if (findings.length > 0) return { ok: false, findings: sortFindings(findings) };

  const at = timestamp(opts.now);
  const verifier = opts.verifier ?? defaultVerifier(abs);
  // Sign every approval before any file changes.
  const signed = new Map<Id, SignedApproval>();
  for (const list of byFile.values()) {
    for (const { id, hash } of list) {
      const a: Approval = identity.threadId ? { by: identity.by, threadId: identity.threadId, at, hash } : { by: identity.by, at, hash };
      const sig = signChecked(approvalPayload(record.slug, id, a), identity.by, opts, verifier);
      if (typeof sig !== 'string') return sig;
      signed.set(id, { ...a, sig });
    }
  }
  const docs: [string, Document][] = [];
  const approvals: { id: Id; file: string; approval: Approval }[] = [];
  for (const [file, list] of byFile) {
    const doc = readDoc(join(abs, file));
    const seq = doc.get('scenarios');
    for (const { id } of list) {
      const node = isSeq(seq) ? seq.items.find((n) => isMap(n) && n.get('id') === id) : undefined;
      if (!isMap(node)) return { ok: false, findings: [{ kind: 'schema', file, path: id, message: `scenario ${id} not found in the YAML document`, refs: [] }] };
      const a = signed.get(id)!;
      // A multi-line signature needs block style, so the approval map is never a flow map.
      const fresh = eventNode(doc, a) as YAMLMap;
      node.set('status', 'approved');
      node.set('approval', fresh);
      approvals.push({ id, file, approval: a });
    }
    docs.push([file, doc]);
  }
  for (const [file, doc] of docs) writeDoc(join(abs, file), doc);
  return { ok: true, approvals };
}

/**
 * Sign off stories (S9-A2). Appends one event to signoff.yaml with who, when, the hash rule,
 * a rule-2 hash for each story and an SSH signature over `signOffPayload` (D41). Fails and lists
 * the findings when the gate does not pass for those stories (S9-A1), including an approval
 * without a valid signature. A finding that a new sign-off of one of the stories clears
 * (stale story, old hash rule, unsigned sign-off) does not block.
 */
export function signOff(dir: string, storyIds: Id[], identity: Identity, opts: WriteOptions & { simulate?: Simulate } = {}): SignOffResult {
  const abs = resolve(dir);
  const loaded = loadEpic(abs);
  const { record } = loaded;
  const findings = checkIdentity(identity);
  const sim = simulationFindings(loaded, opts.simulate);
  if (sim.some((f) => f.kind === 'schema')) return { ok: false, findings: sortFindings([...findings, ...sim]) };

  const stories = asArray<Story>(record.prd?.stories).filter((s) => isObject(s) && typeof s.id === 'string');
  const wanted = new Set(storyIds);
  if (wanted.size === 0) findings.push({ kind: 'reference', file: RECORD_FILES.prd, path: '', message: 'no story ids given', refs: [] });
  for (const id of wanted) {
    if (!stories.some((s) => s.id === id)) findings.push({ kind: 'reference', file: RECORD_FILES.prd, path: id, message: `story ${id} unknown`, refs: [id] });
  }
  const verifier = opts.verifier ?? defaultVerifier(abs);
  for (const item of gateItems(record, sim, checkSignatures(record, verifier))) {
    if (item.resignStory !== undefined && wanted.has(item.resignStory)) continue;
    if (item.stories.length === 0 || item.stories.some((s) => wanted.has(s))) findings.push(item.finding);
  }
  if (findings.length > 0) return { ok: false, findings: sortFindings(findings) };

  const scenarios = allScenarios(record);
  const storyHashes: Record<Id, string> = {};
  for (const story of stories) if (wanted.has(story.id)) storyHashes[story.id] = storyHashV2(story, record.prd!, record.flow, scenarios);
  const unsigned: SignOffWithRule = {
    by: identity.by,
    ...(identity.threadId ? { threadId: identity.threadId } : {}),
    at: timestamp(opts.now),
    hashRule: CURRENT_HASH_RULE,
    storyHashes,
  };
  const sig = signChecked(signOffPayload(record.slug, unsigned), identity.by, opts, verifier);
  if (typeof sig !== 'string') return sig;
  const entry: SignedSignOff = { ...unsigned, sig };

  const file = join(abs, RECORD_FILES.signoff);
  const doc = existsSync(file)
    ? readDoc(file)
    : parseDocument('# Gate sign-off events. Immutable: append only. (R14, D17)\n\nsignOffs: []\n');
  const seq = doc.get('signOffs', true);
  if (!isSeq(seq)) return { ok: false, findings: [{ kind: 'schema', file: RECORD_FILES.signoff, path: 'signOffs', message: 'signOffs is not a list', refs: [] }] };
  if (seq.flow && seq.items.length === 0) seq.flow = false;
  seq.items.push(eventNode(doc, entry));
  writeDoc(file, doc);
  return { ok: true, signOff: entry };
}
