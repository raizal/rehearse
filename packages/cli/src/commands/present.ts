// `rehearse present <epic-dir-or-slug> [--out <file.html>] [--pdf <file.pdf>] [--committed-only]`
// (T52, box present-cli): the EPIC as a deck for a supervisor, one self-contained HTML file (default
// presentations/<slug>-<date>-<sha>.html at the git top), and a PDF with --pdf when Chromium can
// print it. Exit 1 with --committed-only when the record has uncommitted changes, or when the PDF
// cannot be made (the HTML is written first and can be printed from a browser). Read-only on the record.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { repoTopOf } from '@rehearse/core';
import {
  birdviewInfo, buildDeckHtml, chromiumPrinter, DEFAULT_BIRDVIEW_PORT, deckFileName, execGit, findTestProject, PrinterUnavailable, UncommittedError,
  type GitRunner, type Printer,
} from '@rehearse/server';
import { EXIT, resolveEpicDir, USAGE, type Io } from '../index.js';

export interface PresentDeps {
  git?: GitRunner;
  printer?: Printer;
  /** Ask Birdview for the last test results. Default: yes, on its default port. */
  birdview?: boolean;
  now?: () => Date;
}

const usage = (io: Io, why: string): number => {
  io.stderr(`rehearse present: ${why}\n\n${USAGE}`);
  return EXIT.usage;
};

const kb = (n: number): string => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export async function runPresent(args: string[], io: Io, deps: PresentDeps = {}): Promise<number> {
  let out: string | undefined;
  let pdf: string | undefined;
  let committedOnly = false;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--committed-only') committedOnly = true;
    else if (a === '--out' || a === '--pdf') {
      const value = args[++i];
      if (value === undefined || value === '' || value.startsWith('-')) return usage(io, `${a} needs a file path`);
      if (a === '--out') out = value;
      else pdf = value;
    } else if (a.startsWith('-')) return usage(io, `unknown option ${a}`);
    else positional.push(a);
  }
  if (positional.length !== 1) return usage(io, 'expected <epic-dir-or-slug> [--out <file.html>] [--pdf <file.pdf>] [--committed-only]');
  const epic = positional[0]!;
  const dir = resolveEpicDir(epic, io.cwd);
  if (!dir) {
    io.stderr(`rehearse present: no EPIC folder ${epic} (not a folder, and not found as docs/epics/${epic})\n`);
    return EXIT.usage;
  }
  const top = repoTopOf(dir);
  const git = deps.git ?? execGit;
  const testProject = findTestProject(dir);
  const birdview = { port: DEFAULT_BIRDVIEW_PORT, projectDir: testProject };
  let built;
  try {
    built = await buildDeckHtml({
      epicDir: dir,
      repoTop: top,
      git: (a) => git(a, dir),
      committedOnly,
      ...(testProject ? { testProject } : {}),
      ...(deps.birdview === false
        ? {}
        : {
            testResults: async (storyId: string) => {
              const info = await birdviewInfo(birdview, storyId, dir);
              return info.player.kind === 'ours' ? info.player.results : undefined;
            },
          }),
      ...(deps.now ? { now: deps.now } : {}),
    });
  } catch (e) {
    if (e instanceof UncommittedError) {
      io.stderr(`rehearse present: no deck: ${e.message}\n`);
      return EXIT.findings;
    }
    io.stderr(`rehearse present: internal error: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.internal;
  }
  const name = deckFileName(built.deck.slug, built.facts);
  const htmlPath = out ? resolve(io.cwd, out) : join(top, 'presentations', `${name}.html`);
  mkdirSync(dirname(htmlPath), { recursive: true });
  writeFileSync(htmlPath, built.html);
  const shown = (p: string) => {
    const r = relative(io.cwd, p);
    return r === '' || r.startsWith('..') ? p : r;
  };
  for (const f of built.inputFindings) io.stderr(`rehearse present: presentation.yaml: ${f.message} (left out of the deck)\n`);
  if (built.facts.uncommitted) io.stderr('rehearse present: the record has uncommitted changes; the deck says so on every slide\n');
  io.stdout(`${shown(htmlPath)}  ${built.deck.slides.length} slides, ${kb(built.bytes)}\n`);
  if (pdf === undefined) return EXIT.ok;
  const pdfPath = resolve(io.cwd, pdf);
  try {
    const bytes = await (deps.printer ?? chromiumPrinter(top))(built.html);
    mkdirSync(dirname(pdfPath), { recursive: true });
    writeFileSync(pdfPath, bytes);
    io.stdout(`${shown(pdfPath)}  ${built.deck.slides.length} pages, ${kb(bytes.length)}\n`);
    return EXIT.ok;
  } catch (e) {
    const why = e instanceof PrinterUnavailable ? e.message : `the PDF could not be printed: ${e instanceof Error ? e.message : String(e)}`;
    io.stderr(`rehearse present: no PDF. ${why}\nThe HTML deck is written: open ${shown(htmlPath)} in a browser and print it.\n`);
    return EXIT.findings;
  }
}
