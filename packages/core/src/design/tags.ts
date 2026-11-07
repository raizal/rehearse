// Links by frame name (T51, box `frame-tag-links`), pure. A top-level frame whose name holds
// `[<story id>]` or `[<story id>/<box path>]` (e.g. `[S16] Design tab`, `[S11/watch-build]`) links
// itself to that story, or that box of it. The EPIC is the one that has the story id; when two
// EPICs have it, the one design/links.yaml links the file to; else the frame must say
// `[<epic slug>:S16]`. A tag that names no story, no box, or an EPIC it cannot pick is a finding.
// Precedence: an explicit links.yaml entry, then a frame tag, then (never linked by itself) a suggestion.

import type { Finding, Id } from '../types.js';
import { type DesignLink, type DesignLinks, type StoryDesignLinks } from './links.js';
import type { DesignFileIndex, DesignFrame, DesignIndex, DesignPage } from './figcraft-index.js';

/** One tag in a frame name. */
export interface FrameTag {
  /** The text in brackets, e.g. `S11/watch-build`. */
  raw: string;
  slug?: string;
  storyId: Id;
  box?: string;
}

const TAG = /\[(?:(\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*):)?(S\d+)(?:\/([a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*))?\]/g;

/** The tags of a frame name, in order. `[S16] Design tab` → one tag of S16. */
export function parseFrameTags(name: string): FrameTag[] {
  const out: FrameTag[] = [];
  for (const m of name.matchAll(TAG)) {
    out.push({ raw: m[0].slice(1, -1), storyId: m[2]!, ...(m[1] ? { slug: m[1] } : {}), ...(m[3] ? { box: m[3] } : {}) });
  }
  return out;
}

/** What the tag resolver needs of an EPIC: its slug, story ids and box paths. */
export interface EpicFacts {
  slug: string;
  stories: Set<Id>;
  boxes: Set<string>;
}

/** A link made by a frame's name. */
export interface TagLink {
  slug: string;
  storyId: Id;
  box?: string;
  link: DesignLink;
  /** The frame's full name, as the tab shows it. */
  frameName: string;
}

/** A tag finding, and the EPICs it concerns (every EPIC when empty). */
export interface TagFinding {
  epics: string[];
  finding: Finding;
}

/** The frame as a links.yaml `frame` value: its name, or its id when two frames of the page share the name. */
export function frameRef(page: DesignPage, frame: DesignFrame): string {
  return page.frames.filter((f) => f.name === frame.name).length > 1 ? frame.id : frame.name;
}

/** The link a frame makes: the file, the page number, the frame and its picture (the frame's PNG, else the page's). */
export function frameLink(file: DesignFileIndex, page: DesignPage, frame: DesignFrame): DesignLink {
  const png = frame.png ?? page.png;
  return { file: file.file, page: page.number, frame: frameRef(page, frame), ...(png ? { png } : {}) };
}

/** The EPIC slugs whose links.yaml entries point at this file. */
export function epicsLinkingFile(links: DesignLinks, file: string): string[] {
  const out: string[] = [];
  for (const [slug, stories] of Object.entries(links)) {
    const all = Object.values(stories).flatMap((s) => [...(s.story ? [s.story] : []), ...Object.values(s.boxes)]);
    if (all.some((l) => l.file === file)) out.push(slug);
  }
  return out;
}

/** Resolve every frame tag of the index against the EPICs. The first frame that links a story (or box) wins. */
export function resolveFrameTags(index: DesignIndex, epics: EpicFacts[], links: DesignLinks): { links: TagLink[]; findings: TagFinding[] } {
  const out: TagLink[] = [];
  const findings: TagFinding[] = [];
  const seen = new Set<string>();
  for (const file of index.files) {
    const linked = epicsLinkingFile(links, file.file);
    for (const page of file.pages) {
      for (const frame of page.frames) {
        for (const tag of parseFrameTags(frame.name)) {
          const where = `page ${page.number} "${page.name}", frame "${frame.name}"`;
          const say = (epicsOf: string[], message: string, refs: string[] = []) =>
            findings.push({ epics: epicsOf, finding: { kind: 'reference', file: file.file, path: where, message: `${file.file}, ${where}: ${message}`, refs } });
          let epic: EpicFacts | undefined;
          if (tag.slug) {
            epic = epics.find((e) => e.slug === tag.slug);
            if (!epic) {
              say(linked, `the tag [${tag.raw}] names the EPIC ${tag.slug}, which does not exist`);
              continue;
            }
            if (!epic.stories.has(tag.storyId)) {
              say([epic.slug], `the tag [${tag.raw}] names ${tag.storyId}, which the EPIC ${epic.slug} does not have`, [tag.storyId]);
              continue;
            }
          } else {
            const having = epics.filter((e) => e.stories.has(tag.storyId));
            const preferred = having.length > 1 ? having.filter((e) => linked.includes(e.slug)) : having;
            if (having.length === 0) {
              say(linked, `the tag [${tag.raw}] names ${tag.storyId}, which no EPIC has`, [tag.storyId]);
              continue;
            }
            if (preferred.length !== 1) {
              say(
                having.map((e) => e.slug),
                `the tag [${tag.raw}]: ${having.map((e) => e.slug).join(' and ')} both have ${tag.storyId}; name the EPIC, e.g. [${having[0]!.slug}:${tag.raw}]`,
                [tag.storyId],
              );
              continue;
            }
            epic = preferred[0]!;
          }
          if (tag.box !== undefined && !epic.boxes.has(tag.box)) {
            say([epic.slug], `the tag [${tag.raw}] names the box ${tag.box}, which is not in flow.yaml of ${epic.slug}`, [tag.storyId]);
            continue;
          }
          const key = `${epic.slug}\0${tag.storyId}\0${tag.box ?? ''}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ slug: epic.slug, storyId: tag.storyId, ...(tag.box !== undefined ? { box: tag.box } : {}), link: frameLink(file, page, frame), frameName: frame.name });
        }
      }
    }
  }
  return { links: out, findings };
}

/** Where a story's (or box's) link comes from. */
export type DesignLinkSource = 'links.yaml' | 'frame name';

export interface SourcedLink {
  link: DesignLink;
  source: DesignLinkSource;
  /** For a link by frame name: the frame's name. */
  frameName?: string;
}

/** A story's links after precedence: links.yaml first, then frame tags. */
export interface EffectiveDesignLinks {
  story?: SourcedLink;
  boxes: Record<string, SourcedLink>;
}

/** The story's links: each from links.yaml when it has one, else from a frame tag. */
export function effectiveDesignLinks(explicit: StoryDesignLinks, tags: TagLink[], slug: string, storyId: Id): EffectiveDesignLinks {
  const mine = tags.filter((t) => t.slug === slug && t.storyId === storyId);
  const byTag = (box?: string): SourcedLink | undefined => {
    const t = mine.find((x) => x.box === box);
    return t ? { link: t.link, source: 'frame name', frameName: t.frameName } : undefined;
  };
  const out: EffectiveDesignLinks = { boxes: {} };
  const story = explicit.story ? { link: explicit.story, source: 'links.yaml' as const } : byTag();
  if (story) out.story = story;
  for (const t of mine) if (t.box !== undefined) out.boxes[t.box] = byTag(t.box)!;
  for (const [box, link] of Object.entries(explicit.boxes)) out.boxes[box] = { link, source: 'links.yaml' };
  return out;
}

/** The plain links of effective links (what the build brief and the drawer read). */
export function plainDesignLinks(e: EffectiveDesignLinks): StoryDesignLinks {
  return { ...(e.story ? { story: e.story.link } : {}), boxes: Object.fromEntries(Object.entries(e.boxes).map(([b, s]) => [b, s.link])) };
}
