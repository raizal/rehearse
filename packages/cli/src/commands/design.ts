// `rehearse design suggest <epic> [--json]` (T51, box `suggest-design`): for every story of the EPIC
// with no design link (none in design/links.yaml, none by a frame name), the top pages and frames of
// the design files under design/ by word overlap with the story, each with a plain reason. It only
// reads: a suggestion is linked by the owner, from the story's Design tab, never by this command.
// Exit 1 when there is no readable design file under design/ to suggest from.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadEpic, readDesignState, storyEffectiveDesign, storyTexts, suggestDesigns, type DesignSuggestion } from '@rehearse/core';
import { EXIT, resolveEpicDir, USAGE, type Io } from '../index.js';

/** The git top-level above an EPIC folder, else the folder above docs/epics. */
function repoTop(dir: string): string {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, '.git'))) return d;
    if (dirname(d) === d) return dirname(dirname(dir));
  }
}

/** `design/r.figcraft, page 14 "14 Story tests", frame "Birdview"` */
export function suggestionText(s: DesignSuggestion): string {
  return `${s.file}, page ${s.page} "${s.pageName}"${s.frame ? `, frame "${s.frame.name}"` : ''}`;
}

export function runDesign(args: string[], io: Io): number {
  const usage = () => {
    io.stderr(`rehearse design: expected suggest <epic-dir-or-slug> [--json]\n\n${USAGE}`);
    return EXIT.usage;
  };
  const [verb, ...rest] = args;
  if (verb !== 'suggest') return usage();
  const json = rest.includes('--json');
  const positional = rest.filter((a) => !a.startsWith('-'));
  if (rest.some((a) => a.startsWith('-') && a !== '--json') || positional.length !== 1) return usage();
  const dir = resolveEpicDir(positional[0]!, io.cwd);
  if (!dir) {
    io.stderr(`rehearse design: no EPIC folder ${positional[0]} (not a folder, and not found as docs/epics/${positional[0]})\n`);
    return EXIT.usage;
  }
  try {
    const { record } = loadEpic(dir);
    if (!record.prd) {
      io.stderr(`rehearse design: ${dir} has no readable prd.yaml; run rehearse validate\n`);
      return EXIT.findings;
    }
    const top = repoTop(dir);
    const state = readDesignState(top, record);
    const others = record.prd.stories.map((s) => storyTexts(record, s.id));
    const linked: string[] = [];
    const stories: { id: string; want: string; suggestions: DesignSuggestion[] }[] = [];
    for (const story of record.prd.stories) {
      if (storyEffectiveDesign(state, record.slug, story.id).story) {
        linked.push(story.id);
        continue;
      }
      stories.push({ id: story.id, want: story.want, suggestions: suggestDesigns(state.index, storyTexts(record, story.id), { others }) });
    }
    const files = state.index.files.map((f) => f.file);
    const unreadable = state.index.findings.map((f) => f.message);
    const ok = files.length > 0;
    if (json) {
      io.stdout(JSON.stringify({ ok, epic: record.slug, files, unreadable, linked, stories }, null, 2) + '\n');
      return ok ? EXIT.ok : EXIT.findings;
    }
    if (!ok) {
      io.stderr(`rehearse design: no readable .figcraft file under design/ of ${top}; nothing to suggest from${unreadable.length ? `\n  ${unreadable.join('\n  ')}` : ''}\n`);
      return EXIT.findings;
    }
    const out: string[] = [`Design suggestions for ${record.slug}, from ${files.join(', ')}.`, `Never linked by themselves: link one from the story's Design tab in rehearse serve.`, ''];
    for (const u of unreadable) out.push(`Not read: ${u}`);
    if (unreadable.length) out.push('');
    if (stories.length === 0) out.push('Every story has a design linked.');
    for (const s of stories) {
      out.push(`${s.id}  ${s.want}`);
      if (s.suggestions.length === 0) out.push('    no page or frame shares a word with this story');
      s.suggestions.forEach((x, i) => out.push(`    ${i + 1}. ${suggestionText(x)}  (${x.reason})`));
    }
    out.push('', `Linked already: ${linked.length ? linked.join(', ') : 'none'}.`);
    io.stdout(out.join('\n') + '\n');
    return EXIT.ok;
  } catch (e) {
    io.stderr(`rehearse design: internal error: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.internal;
  }
}
