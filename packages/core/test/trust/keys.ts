// Throwaway SSH keys for signature tests (D41). Made with `ssh-keygen -t ed25519 -N ''` in a
// temp folder; the user's real keys and ssh-agent are never used (SSH_AUTH_SOCK is dropped).

import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sshKeygen, sshSigner, sshVerifier, type Signer } from '../../src/index.js';

const { SSH_AUTH_SOCK: _sock, ...envWithoutAgent } = process.env;
/** ssh-keygen without the ssh-agent. */
export const KEYGEN = sshKeygen(envWithoutAgent);

export interface TestKey {
  /** Private key file. */
  file: string;
  /** `ssh-ed25519 AAAA… comment` */
  pub: string;
  signer: Signer;
}

/** A new throwaway key pair with no passphrase. */
export function makeKey(name = 'key'): TestKey {
  const dir = mkdtempSync(join(tmpdir(), 'rehearse-keys-'));
  const file = join(dir, name);
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', name, '-f', file], { env: envWithoutAgent });
  const pub = readFileSync(`${file}.pub`, 'utf8').trim();
  const r = sshSigner({ file }, KEYGEN);
  if (!r.ok) throw new Error(r.reason);
  return { file, pub, signer: r.signer };
}

/** The key of the test builder `a@b.c`, listed in ALLOWED_SIGNERS. */
export const KEY = makeKey('builder');
/** A key that no allowed_signers file lists. */
export const STRANGER = makeKey('stranger');

/** allowed_signers lines (git's format) that allow `key` for `email`, namespace rehearse. */
export function allowedLine(email: string, key: TestKey): string {
  return `${email} namespaces="rehearse" ${key.pub}\n`;
}

/** An allowed_signers file with KEY for a@b.c. */
export const ALLOWED_SIGNERS = join(mkdtempSync(join(tmpdir(), 'rehearse-allowed-')), 'allowed_signers');
writeFileSync(ALLOWED_SIGNERS, allowedLine('a@b.c', KEY));

export const VERIFIER = sshVerifier(ALLOWED_SIGNERS, KEYGEN);

/**
 * Make the parent folder of an EPIC folder a git repo whose `.rehearse/allowed_signers`
 * has `lines` (default: KEY for a@b.c), so the default verifier finds it.
 */
export function inRepo(epicDir: string, lines = allowedLine('a@b.c', KEY)): string {
  const repo = dirname(epicDir);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  mkdirSync(join(repo, '.rehearse'), { recursive: true });
  writeFileSync(join(repo, '.rehearse', 'allowed_signers'), lines);
  return epicDir;
}
