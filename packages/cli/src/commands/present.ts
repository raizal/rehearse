// `rehearse present <epic-dir-or-slug> [--out <file.html>] [--pdf <file.pdf>] [--committed-only]`
// (T52, box present-cli): the EPIC as a deck for a supervisor, one self-contained HTML file (default
// presentations/<slug>-<date>-<sha>.html at the git top), and a PDF with --pdf when Chromium can
// print it. Exit 1 with --committed-only when the record has uncommitted changes, or when the PDF
// cannot be made (the HTML is written first and can be printed from a browser). Read-only on the record.
// T53: the proof. Birdview's saved results when the player does not have our project
// (`--birdview-data <dir>` to name its data folder), `--unit-report <file.json>` (default
// .rehearse/unit-report.json when there), and box copy-recordings: `--with-recordings <dir>` writes
// the deck into <dir> and copies only the videos it links into <dir>/<deck>-media/, linked
// relatively. A source that cannot be read is said on stderr and the deck is still made; a named
// --unit-report that cannot be read is exit 1 after the deck is written.
// T54: an executive summary of about six slides by default; `--full` adds every story slide after
// it as an appendix (file <name>-full.html).

import { copyFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { repoTopOf } from '@rehearse/core';
import {
  birdviewInfo, buildDeckHtml, chromiumPrinter, DEFAULT_BIRDVIEW_PORT, deckFileName, deckSources, execGit, findTestProject, PrinterUnavailable, UncommittedError,
  type DeckSourceOptions, type GitRunner, type Printer,
} from '@rehearse/server';
import { EXIT, resolveEpicDir, USAGE, type Io } from '../index.js';

export interface PresentDeps {
  git?: GitRunner;
  printer?: Printer;
  /** Ask Birdview for the last test results. Default: yes, on its default port. */
  birdview?: boolean;
  now?: () => Date;
  /** How the proof sources are found (tests pass a home, an env and a plugin config). */
  sources?: Pick<DeckSourceOptions, 'env' | 'pluginConfig' | 'home'>;
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
  let full = false;
  let withRecordings: string | undefined;
  let unitReport: string | undefined;
  let birdviewData: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--committed-only') committedOnly = true;
    else if (a === '--full') full = true;
    else if (a === '--out' || a === '--pdf' || a === '--with-recordings' || a === '--unit-report' || a === '--birdview-data') {
      const value = args[++i];
      if (value === undefined || value === '' || value.startsWith('-')) return usage(io, `${a} needs a ${a === '--with-recordings' || a === '--birdview-data' ? 'folder' : 'file'} path`);
      if (a === '--out') out = value;
      else if (a === '--pdf') pdf = value;
      else if (a === '--with-recordings') withRecordings = resolve(io.cwd, value);
      else if (a === '--unit-report') unitReport = resolve(io.cwd, value);
      else birdviewData = resolve(io.cwd, value);
    } else if (a.startsWith('-')) return usage(io, `unknown option ${a}`);
    else positional.push(a);
  }
  if (positional.length !== 1) return usage(io, 'expected <epic-dir-or-slug> [--full] [--out <file.html>] [--pdf <file.pdf>] [--committed-only] [--with-recordings <dir>] [--unit-report <file.json>] [--birdview-data <dir>]');
  if (withRecordings && out && dirname(resolve(io.cwd, out)) !== withRecordings)
    return usage(io, '--with-recordings <dir> puts the deck and its videos in <dir>: --out must be a file in that folder, or leave --out out');
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
    const sources = await deckSources({
      repoTop: top,
      git,
      ...(testProject ? { testProject } : {}),
      ...(birdviewData ? { birdviewData } : {}),
      ...(unitReport ? { unitReport } : {}),
      ...(deps.birdview === false ? { pluginConfig: () => undefined, env: {} } : {}),
      ...deps.sources,
    });
    // No Birdview at all (tests): neither the player nor its saved files, unless a data folder is named.
    if (deps.birdview === false && !birdviewData) delete sources.birdviewData;
    const media = withRecordings ? { media: out ? { folder: `${basename(out).replace(/\.html?$/i, '')}-media` } : {} } : {};
    built = await buildDeckHtml({
      ...sources,
      ...media,
      epicDir: dir,
      repoTop: top,
      git: (a) => git(a, dir),
      committedOnly,
      ...(full ? { full } : {}),
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
  const name = `${deckFileName(built.deck.slug, built.facts)}${full ? '-full' : ''}`;
  const htmlPath = out ? resolve(io.cwd, out) : withRecordings ? join(withRecordings, `${name}.html`) : join(top, 'presentations', `${name}.html`);
  mkdirSync(dirname(htmlPath), { recursive: true });
  writeFileSync(htmlPath, built.html);
  const shown = (p: string) => {
    const r = relative(io.cwd, p);
    return r === '' || r.startsWith('..') ? p : r;
  };
  for (const f of built.inputFindings) io.stderr(`rehearse present: presentation.yaml: ${f.message} (left out of the deck)\n`);
  if (built.facts.uncommitted) io.stderr('rehearse present: the record has uncommitted changes; the deck says so on every slide\n');
  for (const w of built.warnings) io.stderr(`rehearse present: ${w}\n`);
  io.stdout(`${shown(htmlPath)}  ${built.deck.slides.length} slides, ${kb(built.bytes)}\n`);
  // Box copy-recordings: only the videos the deck links, next to it.
  if (withRecordings && built.mediaFolder) {
    const mediaDir = join(dirname(htmlPath), built.mediaFolder);
    let bytes = 0;
    let copied = 0;
    for (const v of built.videos) {
      try {
        mkdirSync(mediaDir, { recursive: true });
        copyFileSync(v.src, join(mediaDir, v.name));
        bytes += statSync(join(mediaDir, v.name)).size;
        copied++;
      } catch (e) {
        io.stderr(`rehearse present: the video ${v.name} could not be copied: ${e instanceof Error ? e.message : String(e)}\n`);
      }
    }
    io.stdout(copied > 0 ? `${shown(mediaDir)}/  ${copied} video${copied === 1 ? '' : 's'}, ${kb(bytes)}\n` : 'rehearse present: no recording of these tests to copy; the deck says so\n');
  }
  // A named unit report that cannot be read: the deck is made, the exit says it is not complete.
  const unitFailed = unitReport !== undefined && built.facts.evidence?.unit.file === undefined;
  if (pdf === undefined) return unitFailed ? EXIT.findings : EXIT.ok;
  const pdfPath = resolve(io.cwd, pdf);
  try {
    const bytes = await (deps.printer ?? chromiumPrinter(top))(built.html);
    mkdirSync(dirname(pdfPath), { recursive: true });
    writeFileSync(pdfPath, bytes);
    io.stdout(`${shown(pdfPath)}  ${built.deck.slides.length} pages, ${kb(bytes.length)}\n`);
    return unitFailed ? EXIT.findings : EXIT.ok;
  } catch (e) {
    const why = e instanceof PrinterUnavailable ? e.message : `the PDF could not be printed: ${e instanceof Error ? e.message : String(e)}`;
    io.stderr(`rehearse present: no PDF. ${why}\nThe HTML deck is written: open ${shown(htmlPath)} in a browser and print it.\n`);
    return EXIT.findings;
  }
}
