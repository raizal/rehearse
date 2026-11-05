// The prose files of an EPIC as data for the Tech spec page: the decision log (brainstorm.md,
// D1…) and the corrections (corrections.md, C1…; D7, D34). Pure functions over the text.

/** One decision of brainstorm.md. A line can hold more than one id (`D2/D6/D12`). */
export interface Decision {
  ids: string[];
  title: string;
  /** The text, on one line. */
  text: string;
  /** The heading the decision is under. */
  section: string;
}

/** A `- Label: text` note under a correction (What, Why, Fix, Also, …). */
export interface CorrectionNote {
  label: string;
  text: string;
}

/** One entry of corrections.md. */
export interface Correction {
  /** e.g. `C11`. */
  id: string;
  /** `caught-in-simulation` or `caught-after-build`; other text is kept as it is. */
  tag: string;
  /** What the entry is about, e.g. ``box `approve` ``. */
  about: string;
  /** e.g. `DONE in T9` or `OPEN`, when the head line has one. */
  status?: string;
  /** The `##` heading the entry is under. */
  section: string;
  notes: CorrectionNote[];
}

const DECISION_LINE = /^- \*\*(D\d+(?:\/D\d+)*)\s+([^*]+?)\*\*:\s*(.*)$/;
const HEADING = /^(#{2,6})\s+(.*)$/;
const HEADING_IDS = /^(.*?)\s*\((D\d+(?:,\s*D\d+)*)\)\s*$/;

/**
 * Decisions in file order: each `- **D<n> Title**: text` bullet (its indented lines go on),
 * and each heading `## Title (D<n>, D<m>)` with the text under it up to the next heading.
 */
export function parseDecisions(text: string): Decision[] {
  const out: Decision[] = [];
  let section = '';
  let open: Decision | undefined;
  let bullet = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h = HEADING.exec(line);
    if (h) {
      const title = h[2]!.trim();
      const ids = HEADING_IDS.exec(title);
      section = ids ? ids[1]! : title;
      open = ids ? { ids: ids[2]!.split(/,\s*/), title: ids[1]!, text: '', section } : undefined;
      if (open) out.push(open);
      bullet = false;
      continue;
    }
    const d = DECISION_LINE.exec(line);
    if (d) {
      open = { ids: d[1]!.split('/'), title: d[2]!.trim(), text: d[3]!.trim(), section };
      out.push(open);
      bullet = true;
      continue;
    }
    if (!open || line.trim() === '') {
      if (bullet) open = undefined;
      continue;
    }
    // A bullet goes on only on indented lines; a heading decision takes every line under it.
    if (bullet && !/^\s+\S/.test(line)) {
      open = undefined;
      continue;
    }
    open.text = `${open.text} ${line.trim()}`.trim();
  }
  return out;
}

const ENTRY_LINE = /^- \*\*(C\d+)\*\*\s+`([^`]*)`\s*(.*)$/;
const NOTE_LINE = /^\s{2,}- ([A-Z][A-Za-z ()0-9]*?):\s*(.*)$/;
const STATUS = /^(DONE\b.*|OPEN\b.*)$/;

/** Correction entries in file order, each with its notes. */
export function parseCorrectionLog(text: string): Correction[] {
  const out: Correction[] = [];
  let section = '';
  let entry: Correction | undefined;
  let note: CorrectionNote | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h = HEADING.exec(line);
    if (h) {
      section = h[2]!.trim();
      entry = undefined;
      note = undefined;
      continue;
    }
    const e = ENTRY_LINE.exec(line);
    if (e) {
      const parts = e[3]!.replace(/^·\s*/, '').split(/\s+·\s+/).filter(Boolean);
      const status = parts.length > 1 && STATUS.test(parts[parts.length - 1]!) ? parts.pop() : undefined;
      entry = { id: e[1]!, tag: e[2]!, about: parts.join(' · '), ...(status ? { status } : {}), section, notes: [] };
      out.push(entry);
      note = undefined;
      continue;
    }
    if (!entry) continue;
    const n = NOTE_LINE.exec(line);
    if (n) {
      note = { label: n[1]!, text: n[2]!.trim() };
      entry.notes.push(note);
    } else if (note && /^\s{4,}\S/.test(line)) {
      note.text = `${note.text} ${line.trim()}`;
    } else if (line.trim() !== '') {
      entry = undefined;
      note = undefined;
    }
  }
  return out;
}
