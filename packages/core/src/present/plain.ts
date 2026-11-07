// Plain words for the deck (T52): record text loses its code marks and its references, so a reader
// who has never seen the record reads sentences, not ids. Ids go to the slide's corner only.

/** Record ids: requirements, stories, criteria, decisions, gate and task ids (R12, S3, S3-A1, D4, G20, T52, C11). */
export const ID_PATTERN = /\b(?:[RSDGTC]\d+(?:-A\d+)?)\b/g;

/** Record field names that would show the YAML under a sentence. */
export const YAML_KEYS = [
  'soThat',
  'storyHashes',
  'errorExits',
  'sideEffects',
  'acceptance',
  'requirements',
  'scenarios',
  'expectedState',
  'criterion',
  'approval',
  'signOffs',
  'inputs',
  'outputs',
  'lanes',
  'boxes',
  'edges',
  'expect',
  'steps',
] as const;

/** One record text as plain words: no backticks, no `(D12, C3)` notes, no bare ids, one line. */
export function plain(text: string | undefined): string {
  if (!text) return '';
  return text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s*\((?:[^()]*\b[RSDGTC]\d+[^()]*)\)/g, '')
    .replace(/\b(?:story|stories)\s+([RSDGTC]\d+(?:-A\d+)?)(?:\s*(?:,|and|or)\s*[RSDGTC]\d+(?:-A\d+)?)*/gi, (m) => (/^stories/i.test(m) ? 'other stories' : 'another story'))
    .replace(/\b[RSDGTC]\d+-A\d+\b/g, 'a criterion')
    .replace(ID_PATTERN, '')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The first sentences of a text, at most `max` characters, cut at a sentence end when it can. */
export function sentences(text: string, max: number): string {
  const t = plain(text);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (end > max / 3) return cut.slice(0, end + 1);
  const space = cut.lastIndexOf(' ');
  return `${cut.slice(0, space > 0 ? space : max).replace(/[,;:]$/, '')}…`;
}

/** Why a text is not plain words: record ids, YAML keys, box paths, code marks. Empty when it is. */
export function plainWordProblems(text: string, boxPaths: readonly string[] = []): string[] {
  const out: string[] = [];
  const ids = text.match(ID_PATTERN);
  if (ids) out.push(`record ids: ${[...new Set(ids)].join(', ')}`);
  // camelCase keys are never English; a plain-word key only at the start of a line or a list item.
  for (const key of YAML_KEYS) if (new RegExp(/[A-Z]/.test(key) ? `\\b${key}:` : `(?:^|\\n|- )\\s*${key}:`).test(text)) out.push(`YAML key ${key}:`);
  for (const p of boxPaths) if (p.includes('/') && text.includes(p)) out.push(`box path ${p}`);
  if (text.includes('`')) out.push('code marks (`)');
  return out;
}
