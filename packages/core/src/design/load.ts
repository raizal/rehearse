// Read design/links.yaml from disk (T50): the only fs side of the design links. No file → no links.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { EpicRecord, Finding } from '../types.js';
import { checkDesignLinks, DESIGN_LINKS_FILE, parseDesignLinks, type DesignLinks } from './links.js';

/** The git top-level above a folder (the folder holding `.git`), else the folder two above it (docs/epics/<slug> → repo). */
export function repoTopOf(dir: string): string {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, '.git'))) return d;
    if (dirname(d) === d) return dirname(dirname(dirname(dir)));
  }
}

/** The links of the repo at `top`, with the findings of parsing them. */
export function readDesignLinks(top: string): { links: DesignLinks; findings: Finding[] } {
  const file = join(top, DESIGN_LINKS_FILE);
  if (!existsSync(file)) return { links: {}, findings: [] };
  return parseDesignLinks(readFileSync(file, 'utf8'));
}

/** A file relative to the repo top exists. */
export function fileExistsIn(top: string): (path: string) => boolean {
  return (path) => {
    try {
      return statSync(join(top, path)).isFile();
    } catch {
      return false;
    }
  };
}

/** Every finding of the repo's links that concerns this EPIC: parse findings, and bad links of its stories. */
export function designLinkFindings(record: EpicRecord, top: string): Finding[] {
  const { links, findings } = readDesignLinks(top);
  const mine = findings.filter((f) => f.path === '' || f.path.startsWith('line ') || f.path === `epics.${record.slug}` || f.path.startsWith(`epics.${record.slug}.`));
  return [...mine, ...checkDesignLinks(links, record, fileExistsIn(top))];
}
