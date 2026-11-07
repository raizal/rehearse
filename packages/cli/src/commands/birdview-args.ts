// Shared by `rehearse play` and `rehearse playlists --push` (T45): the player port option, and how a
// Birdview failure becomes an exit code.

import { BirdviewError } from '@rehearse/server';
import { EXIT } from '../index.js';

/** `--birdview-port N`: a port from 1 to 65535, or the reason it is not one. */
export function portArg(v: string | undefined): number | string {
  if (v === undefined || !/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 65535) return `--birdview-port needs a number from 1 to 65535, got ${v ?? 'nothing'}`;
  return Number(v);
}

/** A bad request is a usage error (2); busy, not running, not found or refused is 1; anything else is a bug (3). */
export function birdviewExit(e: unknown): { code: number; message: string } {
  if (e instanceof BirdviewError) return { code: e.kind === 'bad-request' ? EXIT.usage : EXIT.findings, message: e.message };
  return { code: EXIT.internal, message: `internal error: ${e instanceof Error ? e.message : String(e)}` };
}
