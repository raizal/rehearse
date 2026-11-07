// The owner's inputs to the deck (T52): docs/epics/<slug>/presentation.yaml. It is not part of the
// signed record: the loader, validate's record checks, simulate, the gate and every hash leave it
// alone. `validate` checks only its shape (presentationFindings): unknown keys, slide keys and
// story ids are findings. A missing file is no inputs.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EpicRecord, Finding, Id } from '../types.js';
import { asArray, isObject } from '../util.js';
import { parseYaml } from '../yaml.js';

export const PRESENTATION_FILE = 'presentation.yaml';

/** The slide keys `narration` may name; a story's own slides are `<story id>` and `<story id>-checks`. */
export const SLIDE_KEYS = ['title', 'why', 'requirements', 'big-picture', 'progress', 'quality', 'risks', 'asks', 'next', 'glossary'] as const;
export type SlideKey = (typeof SLIDE_KEYS)[number];

export interface PresentationInputs {
  /** What the owner needs from the supervisor. The slide is left out when empty. */
  asks: string[];
  /** The owner's next steps; empty: the generated to-finish list. */
  next: string[];
  /** The owner's risks, shown before the generated ones. */
  risks: string[];
  /** Slide key → the narration that replaces the generated one. */
  narration: Record<string, string>;
  /** Stories left out of the deck; it says how many. */
  hide: Id[];
}

export const NO_INPUTS: PresentationInputs = { asks: [], next: [], risks: [], narration: {}, hide: [] };

const KEYS = ['asks', 'next', 'risks', 'narration', 'hide'] as const;

const finding = (path: string, message: string, refs: string[] = []): Finding => ({ kind: 'schema', file: PRESENTATION_FILE, path, message, refs });

function storyIds(record: EpicRecord): Set<string> {
  return new Set(asArray<{ id?: unknown }>(record.prd?.stories).flatMap((s) => (isObject(s) && typeof s.id === 'string' ? [s.id] : [])));
}

/** A slide key narration may name, for this record. */
export function isSlideKey(key: string, stories: ReadonlySet<string>): boolean {
  if ((SLIDE_KEYS as readonly string[]).includes(key)) return true;
  const story = key.endsWith('-checks') ? key.slice(0, -'-checks'.length) : key;
  return stories.has(story);
}

/** Parse presentation.yaml text against the record: the inputs it holds, and its shape findings. */
export function parsePresentation(text: string, record: EpicRecord): { inputs: PresentationInputs; findings: Finding[] } {
  const parsed = parseYaml(text, PRESENTATION_FILE);
  if (parsed.finding) return { inputs: NO_INPUTS, findings: [parsed.finding] };
  const doc = parsed.value;
  if (doc === null || doc === undefined) return { inputs: NO_INPUTS, findings: [] };
  if (!isObject(doc)) return { inputs: NO_INPUTS, findings: [finding('', `${PRESENTATION_FILE} must be a map with ${KEYS.join(', ')}`)] };
  const findings: Finding[] = [];
  const stories = storyIds(record);
  const inputs: PresentationInputs = { asks: [], next: [], risks: [], narration: {}, hide: [] };
  for (const key of Object.keys(doc)) if (!(KEYS as readonly string[]).includes(key)) findings.push(finding(key, `unknown key ${key}; ${PRESENTATION_FILE} has ${KEYS.join(', ')}`));
  for (const key of ['asks', 'next', 'risks'] as const) {
    const v = doc[key];
    if (v === undefined || v === null) continue;
    if (!Array.isArray(v)) {
      findings.push(finding(key, `${key} must be a list of sentences`));
      continue;
    }
    v.forEach((item, i) => {
      if (typeof item === 'string' && item.trim() !== '') inputs[key].push(item.trim());
      else findings.push(finding(`${key}[${i}]`, `${key}[${i}] must be a sentence`));
    });
  }
  if (doc.narration !== undefined && doc.narration !== null) {
    if (!isObject(doc.narration)) findings.push(finding('narration', 'narration must be a map of slide key → text'));
    else
      for (const [key, text] of Object.entries(doc.narration)) {
        if (!isSlideKey(key, stories)) findings.push(finding(`narration.${key}`, `unknown slide key ${key}; use ${SLIDE_KEYS.join(', ')}, a story id or <story id>-checks`));
        else if (typeof text !== 'string' || text.trim() === '') findings.push(finding(`narration.${key}`, `narration.${key} must be text`));
        else inputs.narration[key] = text.trim();
      }
  }
  if (doc.hide !== undefined && doc.hide !== null) {
    if (!Array.isArray(doc.hide)) findings.push(finding('hide', 'hide must be a list of story ids'));
    else
      doc.hide.forEach((id, i) => {
        if (typeof id === 'string' && stories.has(id)) inputs.hide.push(id);
        else findings.push(finding(`hide[${i}]`, `unknown story ${String(id)} in hide`, typeof id === 'string' ? [id] : []));
      });
  }
  return { inputs, findings };
}

/** Read presentation.yaml of an EPIC folder; a missing file is no inputs and no findings. */
export function readPresentation(record: EpicRecord): { inputs: PresentationInputs; findings: Finding[] } {
  const file = join(record.dir, PRESENTATION_FILE);
  if (!existsSync(file)) return { inputs: NO_INPUTS, findings: [] };
  return parsePresentation(readFileSync(file, 'utf8'), record);
}
