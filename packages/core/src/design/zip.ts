// A small zip reader (T50, moved to core in T51): stored and deflate entries, from the central
// directory. Used for the FigCraft web build (server) and for `.figcraft` files, which are zips of
// `document.json`, `thumbnail.png` and versions (the design index). It refuses absolute paths, `..`,
// backslashes, encrypted entries and zip64, checks sizes and CRCs, and never unpacks more than a cap.

import * as zlib from 'node:zlib';

export interface ZipFile {
  /** Relative path with `/`; never absolute, never `..`. */
  name: string;
  data: Buffer;
}

/** Anything odd about a zip: the message says what, in plain words. */
export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

export interface ReadZipOptions {
  /** Unpack only the entries this keeps (the others are skipped, unread). Default: all. */
  only?: (name: string) => boolean;
  /** Most bytes the kept entries may unpack to, together. */
  maxBytes: number;
}

/** A safe relative path: no leading slash, drive letter, backslash, NUL, or `.`/`..`/empty part. */
export function safeZipName(name: string): boolean {
  if (name === '' || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.includes('\\') || name.includes('\0')) return false;
  return name.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

/** The files of a zip (folders left out), from its central directory. Throws a ZipError on anything odd. */
export function readZip(zip: Buffer, opts: ReadZipOptions): ZipFile[] {
  const bad = (message: string) => new ZipError(message);
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw bad('not a zip file (no end of central directory)');
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  if (count === 0xffff || at === 0xffffffff) throw bad('the zip is a zip64 file, which rehearse cannot read');
  const files: ZipFile[] = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== 0x02014b50) throw bad('the zip central directory is broken');
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const packed = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLen = zip.readUInt16LE(at + 28);
    const next = at + 46 + nameLen + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const raw = zip.subarray(at + 46, at + 46 + nameLen).toString('utf8');
    at = next;
    const isDir = raw.endsWith('/');
    const name = isDir ? raw.slice(0, -1) : raw;
    if (!safeZipName(name)) throw bad(`the zip holds an unsafe path ${JSON.stringify(raw)}; nothing was unpacked`);
    if (isDir || (opts.only && !opts.only(name))) continue;
    if (flags & 1) throw bad(`${name} in the zip is encrypted`);
    if (local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) throw bad(`the zip entry ${name} is broken`);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    if (start + packed > zip.length) throw bad(`the zip entry ${name} is cut short`);
    total += size;
    if (total > opts.maxBytes) throw bad(`the zip unpacks to more than ${opts.maxBytes} bytes`);
    const body = zip.subarray(start, start + packed);
    let data: Buffer;
    if (method === 0) data = Buffer.from(body);
    else if (method === 8) {
      try {
        data = zlib.inflateRawSync(body, { maxOutputLength: Math.max(1, size) });
      } catch (e) {
        throw bad(`the zip entry ${name} does not inflate: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else throw bad(`the zip entry ${name} uses compression method ${method}; only stored and deflate are read`);
    if (data.length !== size) throw bad(`the zip entry ${name} has ${data.length} bytes, not ${size}`);
    const crc32 = (zlib as { crc32?: (data: Buffer) => number }).crc32;
    if (crc32 && crc32(data) >>> 0 !== crc) throw bad(`the zip entry ${name} fails its CRC check`);
    files.push({ name, data });
  }
  return files;
}
