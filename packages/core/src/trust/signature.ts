// SSH signatures on approvals and sign-offs (D41, R13, R14).
// Each event is signed over a canonical JSON payload with `ssh-keygen -Y sign -n rehearse`,
// by the builder's git signing key. Gate and CI verify it against
// `<git top-level>/.rehearse/allowed_signers`, with the `by` email as the principal.
// ssh-keygen sits behind the small `SshKeygen` interface, so tests can run it with throwaway keys.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson } from '../hash.js';
import type { Approval, Hash, Id } from '../types.js';
import { signOffRule } from './stale.js';
import type { SignOffWithRule } from './types.js';

/** The namespace of every rehearse signature. A git commit signature (namespace `git`) does not verify here. */
export const SIG_NAMESPACE = 'rehearse';
/** allowed_signers file, relative to the git top-level. */
export const ALLOWED_SIGNERS_FILE = '.rehearse/allowed_signers';

/** An approval with its signature (D41). Missing `sig` → not evidence. */
export interface SignedApproval extends Approval {
  sig?: string;
}

/** A sign-off with its signature (D41). Missing `sig` → not trusted. */
export interface SignedSignOff extends SignOffWithRule {
  sig?: string;
}

/**
 * Result of a signature check.
 * - `valid`: good signature, by a key that allowed_signers lists for the principal.
 * - `missing`: the event has no `sig`.
 * - `invalid`: the signature does not match the payload, or cannot be read.
 * - `unknown-signer`: a good signature, by a key that allowed_signers does not list for the principal.
 */
export type SigStatus = 'valid' | 'missing' | 'invalid' | 'unknown-signer';

export interface SigCheck {
  status: SigStatus;
  /** `SHA256:…` fingerprint of the signing key, when the signature can be read. */
  fingerprint?: string;
}

/** One run of ssh-keygen. */
export interface SshKeygenRun {
  status: number;
  stdout: string;
  stderr: string;
}

/** ssh-keygen with arguments and standard input. */
export interface SshKeygen {
  run(args: string[], input?: string): SshKeygenRun;
}

/** The ssh-keygen on PATH. `env` replaces the process environment (tests drop SSH_AUTH_SOCK). */
export function sshKeygen(env?: Record<string, string | undefined>): SshKeygen {
  return {
    run(args, input) {
      // stdin is a pipe (the payload); a passphrase prompt goes to /dev/tty, not to stdin.
      const r = spawnSync('ssh-keygen', args, { input: input ?? '', encoding: 'utf8', env: env ?? process.env });
      if (r.error) return { status: 127, stdout: '', stderr: r.error.message };
      return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    },
  };
}

/** A signing failure with a reason the UI can show. */
export class SigningError extends Error {
  override name = 'SigningError';
}

// ---------------------------------------------------------------- payloads

/** The payload an approval signs: `{kind:'approval', epic, scenario, hash, by, threadId?, at}`. */
export function approvalPayload(epic: string, scenario: Id, approval: Pick<Approval, 'by' | 'threadId' | 'at' | 'hash'>): string {
  return canonicalJson({ kind: 'approval', epic, scenario, hash: approval.hash, by: approval.by, threadId: approval.threadId, at: approval.at });
}

/** The payload a sign-off signs: `{kind:'sign-off', epic, storyHashes, hashRule, by, threadId?, at}`. A missing hashRule is rule 1. */
export function signOffPayload(epic: string, signOff: Pick<SignOffWithRule, 'by' | 'threadId' | 'at' | 'storyHashes' | 'hashRule'>): string {
  const storyHashes: Record<Id, Hash> = signOff.storyHashes;
  return canonicalJson({ kind: 'sign-off', epic, storyHashes, hashRule: signOffRule(signOff), by: signOff.by, threadId: signOff.threadId, at: signOff.at });
}

// ---------------------------------------------------------------- keys

/** A git `user.signingkey` value: a key file (private or .pub), or a literal public key (`key::ssh-…`, or bare `ssh-…`). */
export type KeyRef = { file: string } | { literal: string };

/** Parse a `user.signingkey` value the way git does for `gpg.format ssh`. */
export function parseKeyRef(value: string): KeyRef {
  const v = value.trim();
  if (v.startsWith('key::')) return { literal: v.slice(5).trim() };
  if (v.startsWith('ssh-') || v.startsWith('ecdsa-') || v.startsWith('sk-')) return { literal: v };
  if (v === '~' || v.startsWith('~/')) return { file: join(homedir(), v.slice(1)) };
  return { file: v };
}

/** Run `fn` with a key file for the ref. A literal key goes to a temp file that is removed after. */
function withKeyFile<T>(ref: KeyRef, fn: (file: string, literal: boolean) => T): T {
  if ('file' in ref) return fn(ref.file, false);
  const dir = mkdtempSync(join(tmpdir(), 'rehearse-key-'));
  try {
    const file = join(dir, 'key.pub');
    writeFileSync(file, `${ref.literal}\n`, { mode: 0o600 });
    return fn(file, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Run `fn` with the signature in a temp file. */
function withSigFile<T>(sig: string, fn: (file: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'rehearse-sig-'));
  try {
    const file = join(dir, 'sig');
    writeFileSync(file, sig.endsWith('\n') ? sig : `${sig}\n`);
    return fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const FINGERPRINT = /SHA256:[A-Za-z0-9+/=]+/;

function firstLine(text: string): string {
  return text.split('\n').map((l) => l.trim()).find((l) => l !== '' && !l.startsWith('Signing data')) ?? '';
}

/** `SHA256:…` fingerprint of a key. Throws SigningError when ssh-keygen cannot read it. */
export function keyFingerprint(ref: KeyRef, keygen: SshKeygen = sshKeygen()): string {
  if ('file' in ref && !existsSync(ref.file)) throw new SigningError(`signing key file ${ref.file} does not exist`);
  return withKeyFile(ref, (file) => {
    const r = keygen.run(['-l', '-E', 'sha256', '-f', file]);
    const m = FINGERPRINT.exec(r.stdout);
    if (r.status !== 0 || !m) throw new SigningError(`ssh-keygen cannot read the signing key: ${firstLine(r.stderr) || `exit ${r.status}`}`);
    return m[0];
  });
}

/**
 * Sign a payload: `ssh-keygen -Y sign -n rehearse -f <key>`, payload on stdin. A public key
 * (a .pub file or a literal) signs through the ssh-agent, as git does. Returns the armored signature.
 */
export function sign(payload: string, ref: KeyRef, keygen: SshKeygen = sshKeygen()): string {
  return withKeyFile(ref, (file, literal) => {
    const args = ['-Y', 'sign', '-n', SIG_NAMESPACE, '-f', file, ...(literal ? ['-U'] : [])];
    const r = keygen.run(args, payload);
    const begin = r.stdout.indexOf('-----BEGIN SSH SIGNATURE-----');
    if (r.status !== 0 || begin < 0) {
      throw new SigningError(`ssh-keygen could not sign: ${firstLine(r.stderr) || `exit ${r.status}`}`);
    }
    return r.stdout.slice(begin).trim() + '\n';
  });
}

/**
 * Verify a signature: `ssh-keygen -Y verify -n rehearse -I <principal> -f <allowed_signers> -s <sig>`,
 * payload on stdin. When that fails, `-Y check-novalidate` tells a good signature by an unlisted key
 * (`unknown-signer`) from a bad one (`invalid`). A missing allowed_signers file lists no key.
 */
export function verify(
  payload: string,
  sig: string | undefined,
  principal: string,
  allowedSignersPath: string | undefined,
  keygen: SshKeygen = sshKeygen(),
): SigCheck {
  if (typeof sig !== 'string' || sig.trim() === '') return { status: 'missing' };
  return withSigFile(sig, (sigFile) => {
    if (allowedSignersPath !== undefined && existsSync(allowedSignersPath) && principal !== '') {
      const r = keygen.run(['-Y', 'verify', '-n', SIG_NAMESPACE, '-I', principal, '-f', allowedSignersPath, '-s', sigFile], payload);
      const m = FINGERPRINT.exec(r.stdout);
      if (r.status === 0 && m) return { status: 'valid', fingerprint: m[0] };
    }
    const c = keygen.run(['-Y', 'check-novalidate', '-n', SIG_NAMESPACE, '-s', sigFile], payload);
    const m = FINGERPRINT.exec(c.stdout);
    if (c.status === 0 && m) return { status: 'unknown-signer', fingerprint: m[0] };
    return { status: 'invalid' };
  });
}

// ---------------------------------------------------------------- signer and verifier

/** What the writers sign with. `sign` throws SigningError. */
export interface Signer {
  keyFingerprint: string;
  sign(payload: string): string;
}

/** What gate, validate and the server verify with. */
export interface Verifier {
  verify(payload: string, sig: string | undefined, principal: string): SigCheck;
}

export type SignerResult = { ok: true; signer: Signer } | { ok: false; reason: string };

/** A signer for one key. Fails when ssh-keygen cannot read the key. */
export function sshSigner(ref: KeyRef, keygen: SshKeygen = sshKeygen()): SignerResult {
  try {
    const fingerprint = keyFingerprint(ref, keygen);
    return { ok: true, signer: { keyFingerprint: fingerprint, sign: (payload) => sign(payload, ref, keygen) } };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

function gitConfig(cwd: string, key: string): string {
  try {
    return execFileSync('git', ['config', '--get', key], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

/** The builder's signer from git config: `gpg.format ssh` and `user.signingkey` (see docs/signing.md). */
export function gitSigner(cwd: string, keygen: SshKeygen = sshKeygen()): SignerResult {
  const key = gitConfig(cwd, 'user.signingkey');
  if (key === '') return { ok: false, reason: 'git user.signingkey is not set (see docs/signing.md)' };
  if (gitConfig(cwd, 'gpg.format') !== 'ssh') return { ok: false, reason: 'git gpg.format is not ssh (see docs/signing.md)' };
  return sshSigner(parseKeyRef(key), keygen);
}

/** A verifier against one allowed_signers file. */
export function sshVerifier(allowedSignersPath: string | undefined, keygen: SshKeygen = sshKeygen()): Verifier {
  return { verify: (payload, sig, principal) => verify(payload, sig, principal, allowedSignersPath, keygen) };
}

/** `<git top-level>/.rehearse/allowed_signers` for a folder in a repo; undefined outside a repo. */
export function allowedSignersPath(dir: string): string | undefined {
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return top === '' ? undefined : join(top, ALLOWED_SIGNERS_FILE);
  } catch {
    return undefined;
  }
}

/** The default verifier for an EPIC folder: its repo's allowed_signers. */
export function defaultVerifier(dir: string): Verifier {
  return sshVerifier(allowedSignersPath(dir));
}
