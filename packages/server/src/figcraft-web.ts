// The FigCraft web build (T50, box `figcraft-host`): fetch a release's `figcraft-web-<v>.zip`, check
// its SHA-256 against the release's SHA256SUMS.txt, and unpack it into .rehearse/figcraft-web/<v>/
// at the repo top, where `rehearse serve` hosts it at /figcraft/. A wrong or missing hash changes
// nothing on disk. The zip is unpacked into a temp folder first and renamed into place after.
// The zip reader is core's (stored and deflate entries); it refuses absolute paths, `..` and backslashes.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { readZip as readCoreZip, ZipError, type ZipFile } from '@rehearse/core';

/** Where the web builds live, relative to the repo top. */
export const FIGCRAFT_WEB_DIR = '.rehearse/figcraft-web';
export const FIGCRAFT_RELEASES = 'https://github.com/storytold/figcraft/releases';
export const FIGCRAFT_LATEST_API = 'https://api.github.com/repos/storytold/figcraft/releases/latest';
/** Where the desktop app may be: the macOS bundle, then PATH. */
export const FIGCRAFT_APPS = ['/Applications/FigCraft.app/Contents/MacOS/FigCraft', 'FigCraft', 'figcraft'];

/** A version folder name: 0.16.0, or 0.16.0-beta.1. */
export const FIGCRAFT_VERSION = /^\d{1,4}(\.\d{1,4}){1,3}(-[0-9A-Za-z.]{1,32})?$/;
/** Largest unpacked web build. */
const MAX_UNPACKED_BYTES = 512 * 1024 * 1024;

/** Downloads a URL. Throws a FigcraftFetchError of kind `network` when it cannot. */
export type Fetcher = (url: string) => Promise<Uint8Array>;

export type FigcraftFetchErrorKind = 'hash mismatch' | 'network' | 'bad zip';

export class FigcraftFetchError extends Error {
  constructor(
    readonly kind: FigcraftFetchErrorKind,
    message: string,
  ) {
    super(message);
  }
}

/** GET with redirects followed; a non-2xx answer is an error in plain words. */
export const httpFetcher: Fetcher = async (url) => {
  let res: Response;
  try {
    res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'rehearse', accept: '*/*' } });
  } catch (e) {
    throw new FigcraftFetchError('network', `could not reach ${url}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw new FigcraftFetchError('network', `${url} answered ${res.status} ${res.statusText}`.trim());
  return new Uint8Array(await res.arrayBuffer());
};

/** The version of the installed desktop app (`FigCraft 0.16.0 (…)`), or undefined when none answers. */
export async function desktopFigcraftVersion(apps: string[] = FIGCRAFT_APPS): Promise<string | undefined> {
  for (const app of apps) {
    try {
      const { stdout } = await promisify(execFile)(app, ['--version'], { timeout: 5000, encoding: 'utf8' });
      const m = /FigCraft\s+(\d+(?:\.\d+){1,3})/.exec(stdout);
      if (m) return m[1];
    } catch {
      // Not there, or it did not answer in time: try the next.
    }
  }
  return undefined;
}

export interface FetchFigcraftOptions {
  /** The repo top: the build goes to <top>/.rehearse/figcraft-web/<version>/. */
  top: string;
  /** Default: the desktop app's version, else the latest release's. */
  version?: string;
  fetcher?: Fetcher;
  /** The desktop app's version. Default: ask the app (`--version`). */
  appVersion?: () => Promise<string | undefined>;
}

export interface FetchedFigcraft {
  version: string;
  /** Absolute path of the version folder. */
  dir: string;
  sha256: string;
}

/** Fetch, check and unpack one version of the web build. Throws a FigcraftFetchError. */
export async function fetchFigcraftWeb(opts: FetchFigcraftOptions): Promise<FetchedFigcraft> {
  const fetcher = opts.fetcher ?? httpFetcher;
  const get = async (url: string): Promise<Uint8Array> => {
    try {
      return await fetcher(url);
    } catch (e) {
      if (e instanceof FigcraftFetchError) throw e;
      throw new FigcraftFetchError('network', `could not download ${url}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const version = opts.version ?? (await (opts.appVersion ?? desktopFigcraftVersion)()) ?? (await latestVersion(get));
  if (!FIGCRAFT_VERSION.test(version)) throw new FigcraftFetchError('network', `${JSON.stringify(version)} is not a FigCraft version (like 0.16.0)`);
  const zipName = `figcraft-web-${version}.zip`;
  const base = `${FIGCRAFT_RELEASES}/download/v${version}/`;
  const sums = Buffer.from(await get(`${base}SHA256SUMS.txt`)).toString('utf8');
  const zip = Buffer.from(await get(`${base}${zipName}`));
  const want = expectedHash(sums, zipName);
  const got = createHash('sha256').update(zip).digest('hex');
  if (want === undefined) throw new FigcraftFetchError('hash mismatch', `SHA256SUMS.txt of FigCraft ${version} has no line for ${zipName}, so the download cannot be checked. Nothing changed.`);
  if (want !== got) throw new FigcraftFetchError('hash mismatch', `${zipName} has SHA-256 ${got}, but SHA256SUMS.txt says ${want}. Nothing changed.`);
  const files = stripTopFolder(readZip(zip));
  if (!files.some((f) => f.name === 'index.html')) throw new FigcraftFetchError('bad zip', `${zipName} has no index.html. Nothing changed.`);
  const dir = install(join(opts.top, FIGCRAFT_WEB_DIR), version, files);
  return { version, dir, sha256: got };
}

async function latestVersion(get: Fetcher): Promise<string> {
  let tag: unknown;
  try {
    tag = (JSON.parse(Buffer.from(await get(FIGCRAFT_LATEST_API)).toString('utf8')) as { tag_name?: unknown }).tag_name;
  } catch (e) {
    if (e instanceof FigcraftFetchError) throw e;
    throw new FigcraftFetchError('network', `${FIGCRAFT_LATEST_API} did not answer JSON`);
  }
  if (typeof tag !== 'string') throw new FigcraftFetchError('network', `${FIGCRAFT_LATEST_API} has no tag_name`);
  return tag.replace(/^v/, '');
}

/** The hash on the line of `name` in a SHA256SUMS file (`<hex>  <name>` or `<hex> *<name>`). */
export function expectedHash(sums: string, name: string): string | undefined {
  for (const line of sums.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line.trim());
    if (m && m[2]!.trim() === name) return m[1]!.toLowerCase();
  }
  return undefined;
}

export type { ZipFile } from '@rehearse/core';

/** The files of a zip (folders left out), from its central directory. Throws a `bad zip` FigcraftFetchError on anything odd. */
export function readZip(zip: Buffer): ZipFile[] {
  try {
    return readCoreZip(zip, { maxBytes: MAX_UNPACKED_BYTES });
  } catch (e) {
    if (e instanceof ZipError) throw new FigcraftFetchError('bad zip', e.message.startsWith('not a zip') ? `the download is ${e.message}` : e.message);
    throw e;
  }
}

/** Drop the one folder every file is in (`figcraft-web-0.16.0/index.html` → `index.html`). */
function stripTopFolder(files: ZipFile[]): ZipFile[] {
  const first = files[0]?.name.split('/')[0];
  if (first === undefined || !files.every((f) => f.name.startsWith(`${first}/`))) return files;
  return files.map((f) => ({ name: f.name.slice(first.length + 1), data: f.data }));
}

/** Write the files to a temp folder in `root`, then rename it to `root/<version>`; an old copy goes only after. */
function install(root: string, version: string, files: ZipFile[]): string {
  mkdirSync(root, { recursive: true });
  const tmp = mkdtempSync(join(root, `.unpack-${version}-`));
  const dest = join(root, version);
  try {
    for (const f of files) {
      const path = join(tmp, ...f.name.split('/'));
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, f.data);
    }
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  const old = existsSync(dest) ? `${tmp}-old` : undefined;
  if (old) renameSync(dest, old);
  try {
    renameSync(tmp, dest);
  } catch (e) {
    if (old) renameSync(old, dest);
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  if (old) rmSync(old, { recursive: true, force: true });
  return dest;
}

/** -1, 0 or 1: numbers part by part; a pre-release comes before its release. */
export function compareVersions(a: string, b: string): number {
  const [ma = '', pa] = a.split('-', 2);
  const [mb = '', pb] = b.split('-', 2);
  const na = ma.split('.').map(Number);
  const nb = mb.split('.').map(Number);
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const d = (na[i] ?? 0) - (nb[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  if (pa === pb) return 0;
  if (pa === undefined) return 1;
  if (pb === undefined) return -1;
  return pa < pb ? -1 : 1;
}

/** The newest fetched version that has an index.html, or undefined. */
export function installedFigcraftWeb(top: string): { version: string; dir: string } | undefined {
  const root = join(top, FIGCRAFT_WEB_DIR);
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return undefined;
  }
  const ready = names.filter((v) => FIGCRAFT_VERSION.test(v) && isFile(join(root, v, 'index.html'))).sort(compareVersions);
  const version = ready.at(-1);
  return version === undefined ? undefined : { version, dir: join(root, version) };
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
