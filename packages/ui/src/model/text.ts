// Text that fits a box in an SVG diagram: SVG text does not wrap by itself.

/** Up to `max` lines of about `width` characters; the last one ends in … when text is cut. */
export function wrapLines(text: string, width: number, max = 2): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && (line + ' ' + word).length > width) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  if (out.length > max) return [...out.slice(0, max - 1), `${out[max - 1]!.slice(0, width - 1)}…`];
  return out;
}

/** A key fingerprint short enough for a chip: "SHA256:9fQ…k2". Keys of 8 characters or fewer stay whole. */
export function shortKey(key: string): string {
  const at = key.indexOf(':');
  const algo = at < 0 ? '' : key.slice(0, at + 1);
  const hash = key.slice(algo.length);
  return hash.length <= 8 ? key : `${algo}${hash.slice(0, 3)}…${hash.slice(-2)}`;
}
