// `rehearse figcraft fetch [--version <v>] [--json]` (T50, box `figcraft-host`): download the
// FigCraft web build of a release (default: the installed desktop app's version, else the latest),
// check it against the release's SHA256SUMS.txt and unpack it into .rehearse/figcraft-web/<v>/ at
// the git top-level, where `rehearse serve` hosts it for the Design tab. Exit 1 on a hash mismatch
// or a network error: nothing changed. It writes no design file.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { repoTopOf } from '@rehearse/core';
import { FIGCRAFT_VERSION, FIGCRAFT_WEB_DIR, FigcraftFetchError, fetchFigcraftWeb, type FetchFigcraftOptions } from '@rehearse/server';
import { EXIT, USAGE, type Io } from '../index.js';

/** What tests replace: the downloads and the desktop app's version. */
export type FigcraftDeps = Pick<FetchFigcraftOptions, 'fetcher' | 'appVersion'>;

export async function runFigcraft(args: string[], io: Io, deps: FigcraftDeps = {}): Promise<number> {
  const usage = () => {
    io.stderr(`rehearse figcraft: expected fetch [--version <v>] [--json]\n\n${USAGE}`);
    return EXIT.usage;
  };
  const [verb, ...rest] = args;
  if (verb !== 'fetch') return usage();
  let version: string | undefined;
  let json = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === '--json') json = true;
    else if (a === '--version' && version === undefined) {
      version = rest[++i];
      if (version === undefined || !FIGCRAFT_VERSION.test(version.replace(/^v/, ''))) return usage();
      version = version.replace(/^v/, '');
    } else return usage();
  }
  // The git top-level of cwd; outside a repo, cwd itself.
  const found = repoTopOf(io.cwd);
  const top = existsSync(join(found, '.git')) ? found : io.cwd;
  try {
    const r = await fetchFigcraftWeb({ top, ...(version ? { version } : {}), ...deps });
    const where = `${FIGCRAFT_WEB_DIR}/${r.version}/`;
    if (json) io.stdout(JSON.stringify({ ok: true, version: r.version, dir: where, sha256: r.sha256 }, null, 2) + '\n');
    else io.stdout(`FigCraft web ${r.version} is ready in ${where} (SHA-256 checked). Open a story's Design tab in rehearse serve.\n`);
    return EXIT.ok;
  } catch (e) {
    if (!(e instanceof FigcraftFetchError)) {
      io.stderr(`rehearse figcraft: internal error: ${e instanceof Error ? e.message : String(e)}\n`);
      return EXIT.internal;
    }
    if (json) io.stdout(JSON.stringify({ ok: false, reason: e.kind, error: e.message }, null, 2) + '\n');
    else io.stderr(`rehearse figcraft: ${e.message}${e.message.includes('Nothing changed') ? '' : ' Nothing changed.'}\n`);
    return EXIT.findings;
  }
}
