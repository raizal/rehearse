// Design pictures in the deck (T52) go in as data URIs, at most MAX_DECK_IMAGE_WIDTH px wide. This
// shrinks a PNG with an area average: 8-bit grey, grey+alpha, RGB and RGBA, not interlaced. Any
// other PNG is kept as it is (never fails a deck over a picture).

import { deflateSync, inflateSync } from 'node:zlib';

export const MAX_DECK_IMAGE_WIDTH = 1600;

// A Uint8Array, not a Buffer: the UI bundle loads this module, and a browser has no Buffer.
const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface PngSize {
  width: number;
  height: number;
}

/** Width and height from the IHDR chunk; undefined when it is not a PNG. */
export function pngSize(png: Uint8Array): PngSize | undefined {
  const b = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  if (b.length < 24 || !b.subarray(0, 8).equals(SIGNATURE) || b.toString('latin1', 12, 16) !== 'IHDR') return undefined;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

interface Raw {
  width: number;
  height: number;
  channels: number;
  colorType: number;
  pixels: Uint8Array;
}

function decode(png: Buffer): Raw | undefined {
  if (!png.subarray(0, 8).equals(SIGNATURE)) return undefined;
  let pos = 8;
  let ihdr: Buffer | undefined;
  const idat: Buffer[] = [];
  while (pos + 8 <= png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString('latin1', pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') ihdr = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!ihdr || ihdr.length < 13) return undefined;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const depth = ihdr[8]!;
  const colorType = ihdr[9]!;
  const interlace = ihdr[12]!;
  const channels = CHANNELS[colorType];
  if (depth !== 8 || interlace !== 0 || channels === undefined || width === 0 || height === 0) return undefined;
  const data = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (data.length < (stride + 1) * height) return undefined;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = data[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    const prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const raw = data[src + x]!;
      const a = x >= channels ? pixels[row + x - channels]! : 0;
      const b = y > 0 ? pixels[prev + x]! : 0;
      const c = x >= channels && y > 0 ? pixels[prev + x - channels]! : 0;
      let v: number;
      if (filter === 0) v = raw;
      else if (filter === 1) v = raw + a;
      else if (filter === 2) v = raw + b;
      else if (filter === 3) v = raw + ((a + b) >> 1);
      else if (filter === 4) v = raw + paeth(a, b, c);
      else return undefined;
      pixels[row + x] = v & 0xff;
    }
  }
  return { width, height, channels, colorType, pixels };
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const body = Buffer.concat([head.subarray(4), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head.subarray(0, 4), body, crc]);
}

function encode(raw: Raw): Buffer {
  const { width, height, channels, pixels } = raw;
  const stride = width * channels;
  const out = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    out[y * (stride + 1)] = 4; // Paeth
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[row + x - channels]! : 0;
      const b = y > 0 ? pixels[row - stride + x]! : 0;
      const c = x >= channels && y > 0 ? pixels[row - stride + x - channels]! : 0;
      out[y * (stride + 1) + 1 + x] = (pixels[row + x]! - paeth(a, b, c)) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = raw.colorType;
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(out, { level: 9 })), chunk('IEND', new Uint8Array(0))]);
}

/** Area-average resample to `width` (height keeps the aspect). */
function shrink(raw: Raw, width: number): Raw {
  const height = Math.max(1, Math.round((raw.height * width) / raw.width));
  const ch = raw.channels;
  const sx = raw.width / width;
  const sy = raw.height / height;
  const pixels = new Uint8Array(width * height * ch);
  const acc = new Float64Array(ch);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(raw.height, Math.floor((y + 1) * sy)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.min(raw.width, Math.floor((x + 1) * sx)));
      acc.fill(0);
      for (let yy = y0; yy < y1; yy++) {
        let p = (yy * raw.width + x0) * ch;
        for (let xx = x0; xx < x1; xx++) for (let k = 0; k < ch; k++) acc[k] = acc[k]! + raw.pixels[p++]!;
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = (y * width + x) * ch;
      for (let k = 0; k < ch; k++) pixels[o + k] = Math.round(acc[k]! / n);
    }
  }
  return { width, height, channels: ch, colorType: raw.colorType, pixels };
}

/**
 * The PNG at most `maxWidth` px wide. A narrower one, or one this cannot read (palette, 16-bit,
 * interlaced, broken), comes back unchanged.
 */
export function downscalePng(png: Uint8Array, maxWidth = MAX_DECK_IMAGE_WIDTH): { png: Uint8Array; width: number; height: number; scaled: boolean } {
  const size = pngSize(png);
  if (!size || size.width <= maxWidth) return { png, width: size?.width ?? 0, height: size?.height ?? 0, scaled: false };
  let raw: Raw | undefined;
  try {
    raw = decode(Buffer.from(png.buffer, png.byteOffset, png.byteLength));
  } catch {
    raw = undefined;
  }
  if (!raw) return { png, width: size.width, height: size.height, scaled: false };
  const small = shrink(raw, maxWidth);
  return { png: encode(small), width: small.width, height: small.height, scaled: true };
}

/** A tiny RGBA PNG of one colour, for tests and placeholders. */
export function solidPng(width: number, height: number, rgba: [number, number, number, number]): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) pixels.set(rgba, i * 4);
  return encode({ width, height, channels: 4, colorType: 6, pixels });
}
