// A tiny zip writer for the FigCraft fetch tests (T50): stored or deflate entries, one central directory.

import { createHash } from 'node:crypto';
import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipEntry {
  name: string;
  data?: string | Buffer;
  deflate?: boolean;
}

export function makeZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.from(e.data ?? '');
    const body = e.deflate ? deflateRawSync(data) : data;
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(e.deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(e.deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** A FigCraft web release: the zip of `figcraft-web-<v>/…` and its SHA256SUMS.txt. */
export function fakeRelease(version: string, opts: { entries?: ZipEntry[]; hash?: string } = {}): { zip: Buffer; sums: string } {
  const top = `figcraft-web-${version}`;
  const zip = makeZip(
    opts.entries ?? [
      { name: `${top}/` },
      { name: `${top}/index.html`, data: '<!doctype html><title>FigCraft</title>', deflate: true },
      { name: `${top}/figcraft-web-abc123.js`, data: 'export default 1;\n' },
      { name: `${top}/figcraft-web-abc123_bg.wasm`, data: Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]), deflate: true },
      { name: `${top}/_headers`, data: '/*\n' },
    ],
  );
  return { zip, sums: `${opts.hash ?? sha256(zip)}  figcraft-web-${version}.zip\n0000000000000000000000000000000000000000000000000000000000000000  other.zip\n` };
}

/** A fetcher that answers the release URLs of one version from memory and records the URLs asked. */
export function fakeFetcher(version: string, release: { zip: Buffer; sums: string }, latest = version): { fetcher: (url: string) => Promise<Uint8Array>; urls: string[] } {
  const urls: string[] = [];
  const base = `https://github.com/storytold/figcraft/releases/download/v${version}/`;
  return {
    urls,
    fetcher: async (url) => {
      urls.push(url);
      if (url === `${base}SHA256SUMS.txt`) return Buffer.from(release.sums);
      if (url === `${base}figcraft-web-${version}.zip`) return release.zip;
      if (url === 'https://api.github.com/repos/storytold/figcraft/releases/latest') return Buffer.from(JSON.stringify({ tag_name: `v${latest}` }));
      throw new Error(`404 Not Found: ${url}`);
    },
  };
}
