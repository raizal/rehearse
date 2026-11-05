// `rehearse serve [dir-or-slug] [--port N]`: the review UI and its JSON API on 127.0.0.1
// only (R12, R20). Remote access: `bb connect expose <port>`. The only writes are approve and
// sign-off from the UI, signed with the git signing key of this process (R13, R14, D41).

import { existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { createSession, startServer, type RunningServer } from '@rehearse/server';
import { EXIT, resolveEpicDir, type Io } from '../index.js';

export const DEFAULT_PORT = 4700;

export interface ServeArgs {
  epicDir: string;
  port: number;
}

/** Parse the arguments. A string is a usage error message. */
export function parseServeArgs(args: string[], cwd: string): ServeArgs | string {
  let port = DEFAULT_PORT;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--port') {
      const v = args[++i];
      if (v === undefined || !/^\d+$/.test(v) || Number(v) > 65535) return `--port needs a number from 0 to 65535, got ${v ?? 'nothing'}`;
      port = Number(v);
    } else if (a.startsWith('-')) {
      return `unknown option ${a}`;
    } else {
      positional.push(a);
    }
  }
  if (positional.length > 1) return 'expected at most one <epic-dir-or-slug>';
  if (positional.length === 1) {
    const dir = resolveEpicDir(positional[0]!, cwd);
    return dir ? { epicDir: dir, port } : `no EPIC folder ${positional[0]} (not a folder, and not found as docs/epics/${positional[0]})`;
  }
  const found = defaultEpicDir(cwd);
  return 'dir' in found ? { epicDir: found.dir, port } : found.error;
}

/** cwd when it is an EPIC folder, else the only folder in the nearest docs/epics. */
function defaultEpicDir(cwd: string): { dir: string } | { error: string } {
  if (existsSync(join(cwd, 'prd.yaml')) || existsSync(join(cwd, 'flow.yaml'))) return { dir: resolve(cwd) };
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    const epics = join(dir, 'docs', 'epics');
    if (existsSync(epics) && statSync(epics).isDirectory()) {
      const slugs = readdirSync(epics).filter((f) => statSync(join(epics, f)).isDirectory()).sort();
      if (slugs.length === 1) return { dir: join(epics, slugs[0]!) };
      return { error: `name the EPIC to serve: ${slugs.length === 0 ? 'docs/epics is empty' : slugs.join(', ')}` };
    }
    if (dirname(dir) === dir) return { error: 'name the EPIC folder or slug to serve' };
  }
}

/** Folder of the built UI (`@rehearse/ui` dist/). */
export function uiDistDir(): string {
  return join(dirname(createRequire(import.meta.url).resolve('@rehearse/ui/package.json')), 'dist');
}

/** Start the server and print its URL. On a usage or listen error (already printed) it resolves to the exit code. */
export async function startServe(args: string[], io: Io, uiDir: string = uiDistDir()): Promise<RunningServer | { code: number }> {
  const parsed = parseServeArgs(args, io.cwd);
  if (typeof parsed === 'string') {
    io.stderr(`rehearse serve: ${parsed}\n\nUsage: rehearse serve [epic-dir-or-slug] [--port N]\n`);
    return { code: EXIT.usage };
  }
  try {
    const session = createSession(parsed.epicDir);
    const running = await startServer({ epicDir: parsed.epicDir, uiDir, port: parsed.port, session });
    const signing = session.signer.ok
      ? `Approve and sign-off as ${session.identity.by}, key ${session.signer.signer.keyFingerprint}.`
      : `Approve and sign-off are off: ${session.signer.reason}.`;
    io.stdout(
      `rehearse serve: ${parsed.epicDir}\n` +
        `  ${running.url}\n` +
        `${signing}\n` +
        `On 127.0.0.1 only. Remote: bb connect expose ${running.port}. Stop with Ctrl+C.\n`,
    );
    return running;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    const hint = err.code === 'EADDRINUSE' ? ` (port in use; pick another with --port N)` : '';
    io.stderr(`rehearse serve: cannot listen on 127.0.0.1:${parsed.port}: ${err.message}${hint}\n`);
    return { code: err.code === 'EADDRINUSE' ? EXIT.usage : EXIT.internal };
  }
}

/**
 * The command. Usage errors return 2 at once. Otherwise the server keeps the
 * process running; a listen error sets the process exit code.
 */
export function runServe(args: string[], io: Io): number {
  const parsed = parseServeArgs(args, io.cwd);
  if (typeof parsed === 'string') {
    io.stderr(`rehearse serve: ${parsed}\n\nUsage: rehearse serve [epic-dir-or-slug] [--port N]\n`);
    return EXIT.usage;
  }
  void startServe(args, io).then((r) => {
    if ('code' in r) process.exitCode = r.code;
  });
  return EXIT.ok;
}
