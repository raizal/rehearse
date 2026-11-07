// T51: the design index, frame tags, suggestions and links.yaml edits. The `.figcraft` files are
// zips built here; nothing touches design/ of this repo.

import { closeSync, cpSync, mkdirSync, mkdtempSync, openSync, rmSync, utimesSync, writeFileSync, ftruncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  effectiveDesignLinks,
  indexFigcraftFile,
  loadEpic,
  MAX_FIGCRAFT_BYTES,
  pagePngPath,
  framePngPath,
  parseDesignLinks,
  parseFrameTags,
  pictureOf,
  readDesignIndex,
  readDesignState,
  resolveFrameTags,
  setDesignLink,
  stem,
  storyBriefDesign,
  storyTexts,
  suggestDesigns,
  validateEpic,
  words,
  type DesignFileIndex,
  type DesignIndex,
  type EpicFacts,
} from '../../src/index.js';
import { makeZip } from '../zip.js';
import { REAL_EPIC } from '../helpers.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

type Page = { id: number | string; name: string; frames: { id: number | string; name: string; type?: string }[] };

/** A `.figcraft` zip with these pages; page and frame ids as given (numbers or strings). */
function figcraft(pages: Page[], opts: { thumbnail?: boolean; extra?: Record<string, unknown> } = {}): Buffer {
  const nodes: Record<string, unknown> = { ...opts.extra };
  for (const p of pages) {
    nodes[String(p.id)] = { id: p.id, type: 'page', name: p.name, children: p.frames.map((f) => f.id) };
    for (const f of p.frames) nodes[String(f.id)] = { id: f.id, type: f.type ?? 'frame', name: f.name, children: [] };
  }
  const doc = { version: 1, pages: pages.map((p) => p.id), nodes };
  return makeZip([{ name: 'document.json', data: JSON.stringify(doc), deflate: true }, ...(opts.thumbnail === false ? [] : [{ name: 'thumbnail.png', data: 'PNG' }]), { name: 'versions/1.json', data: '{}' }]);
}

const REVIEW: Page[] = [
  { id: 1, name: '1 PRD', frames: [{ id: 10, name: 'PRD' }] },
  { id: 'p2', name: '2 Story view', frames: [{ id: 'f20', name: 'Story · view' }, { id: 21, name: 'note', type: 'text' }] },
  { id: 3, name: '3 Scenario storyboard', frames: [{ id: 30, name: 'Storyboard player' }, { id: 31, name: '[S2] Approve button' }] },
  { id: 4, name: '4 Story tests', frames: [{ id: 40, name: 'Birdview tests' }, { id: 41, name: 'Birdview tests' }] },
];

function indexOf(pages: Page[], pngs: string[] = []): DesignFileIndex {
  const r = indexFigcraftFile('design/review.figcraft', figcraft(pages), (p) => pngs.includes(p));
  if (!('index' in r)) throw new Error(r.finding.message);
  return r.index;
}

/** A repo with the shop EPIC (or another), a .git marker and a design/ folder. */
function repo(epicSrc = REAL_EPIC, slug = '2026-11-05-rehearse'): { top: string; epic: string } {
  const top = mkdtempSync(join(tmpdir(), 'rehearse-t51-'));
  dirs.push(top);
  mkdirSync(join(top, '.git'));
  const epic = join(top, 'docs', 'epics', slug);
  cpSync(epicSrc, epic, { recursive: true });
  mkdirSync(join(top, 'design'));
  return { top, epic };
}

describe('the design index (T51, box design-index)', () => {
  it('lists pages (number, name) and their top-level frames (id, name); page and frame ids may be numbers or strings', () => {
    const idx = indexOf(REVIEW);
    expect(idx.file).toBe('design/review.figcraft');
    expect(idx.thumbnail).toBe(true);
    expect(idx.pages.map((p) => [p.number, p.id, p.name])).toEqual([
      [1, '1', '1 PRD'],
      [2, 'p2', '2 Story view'],
      [3, '3', '3 Scenario storyboard'],
      [4, '4', '4 Story tests'],
    ]);
    // A text node is not a frame.
    expect(idx.pages[1]!.frames).toEqual([{ id: 'f20', name: 'Story · view' }]);
    expect(idx.pages[3]!.frames.map((f) => f.id)).toEqual(['40', '41']);
  });

  it('a page picture is design/<n>-<slug>.png when it exists, else the file thumbnail; a frame has design/frames/<slug>.png', () => {
    expect(pagePngPath(13, '13 Story code')).toBe('design/13-story-code.png');
    expect(pagePngPath(2, 'Story view')).toBe('design/2-story-view.png');
    expect(framePngPath('Story · code')).toBe('design/frames/story-code.png');
    const idx = indexOf(REVIEW, ['design/2-story-view.png', 'design/frames/storyboard-player.png']);
    const [p1, p2, p3] = idx.pages;
    expect(p2!.png).toBe('design/2-story-view.png');
    expect(pictureOf(idx, p2!)).toEqual({ kind: 'page', png: 'design/2-story-view.png' });
    expect(pictureOf(idx, p1!)).toEqual({ kind: 'file thumbnail', file: 'design/review.figcraft' });
    expect(pictureOf(idx, p3!, p3!.frames[0])).toEqual({ kind: 'frame', png: 'design/frames/storyboard-player.png' });
    const bare = indexFigcraftFile('design/b.figcraft', figcraft(REVIEW, { thumbnail: false }), () => false);
    if (!('index' in bare)) throw new Error('not indexed');
    expect(pictureOf(bare.index, bare.index.pages[0]!)).toBeUndefined();
  });

  it('a file that cannot be read is a finding, not a throw', () => {
    const say = (bytes: Buffer) => {
      const r = indexFigcraftFile('design/x.figcraft', bytes, () => false);
      return 'finding' in r ? r.finding.message : 'indexed';
    };
    expect(say(Buffer.from('x'))).toMatch(/^design\/x\.figcraft: cannot read it: not a zip file/);
    expect(say(makeZip([{ name: 'thumbnail.png', data: 'PNG' }]))).toBe('design/x.figcraft: it has no document.json; is it a FigCraft file?');
    expect(say(makeZip([{ name: 'document.json', data: '{' }]))).toMatch(/^design\/x\.figcraft: document\.json is not JSON/);
    expect(say(makeZip([{ name: 'document.json', data: '{"pages": 3}' }]))).toBe('design/x.figcraft: document.json has no `pages` list and `nodes` map');
  });

  it('reads design/**/*.figcraft from disk, caches by mtime and size, and a file over 64 MB is a finding', () => {
    const { top } = repo();
    mkdirSync(join(top, 'design', 'sub'));
    writeFileSync(join(top, 'design', 'review.figcraft'), figcraft(REVIEW));
    writeFileSync(join(top, 'design', 'sub', 'b.figcraft'), figcraft([{ id: 1, name: 'Only', frames: [] }]));
    writeFileSync(join(top, 'design', 'notes.txt'), 'x');
    const fd = openSync(join(top, 'design', 'huge.figcraft'), 'w');
    ftruncateSync(fd, MAX_FIGCRAFT_BYTES + 1);
    closeSync(fd);
    const first = readDesignIndex(top);
    expect(first.files.map((f) => f.file)).toEqual(['design/review.figcraft', 'design/sub/b.figcraft']);
    expect(first.findings).toEqual([expect.objectContaining({ path: 'design/huge.figcraft', message: 'design/huge.figcraft: the file is larger than 64 MB; not read' })]);
    // A PNG that appears shows at once; a changed file is read again.
    writeFileSync(join(top, 'design', '1-prd.png'), 'PNG');
    expect(readDesignIndex(top).files[0]!.pages[0]!.png).toBe('design/1-prd.png');
    writeFileSync(join(top, 'design', 'review.figcraft'), figcraft([{ id: 1, name: '1 PRD renamed', frames: [] }]));
    utimesSync(join(top, 'design', 'review.figcraft'), new Date(), new Date(Date.now() + 5000));
    expect(readDesignIndex(top).files[0]!.pages.map((p) => p.name)).toEqual(['1 PRD renamed']);
  });
});

describe('links by frame name (T51, box frame-tag-links)', () => {
  it('parses [S16], [S11/watch-build] and [<epic slug>:S16]', () => {
    expect(parseFrameTags('[S16] Design tab')).toEqual([{ raw: 'S16', storyId: 'S16' }]);
    expect(parseFrameTags('Build [S11/watch-build]')).toEqual([{ raw: 'S11/watch-build', storyId: 'S11', box: 'watch-build' }]);
    expect(parseFrameTags('[2026-11-05-rehearse:S16/a/b] x')).toEqual([{ raw: '2026-11-05-rehearse:S16/a/b', slug: '2026-11-05-rehearse', storyId: 'S16', box: 'a/b' }]);
    expect(parseFrameTags('[s16] [S] [16] Story · code (S16)')).toEqual([]);
  });

  const facts = (slug: string, stories: string[], boxes: string[] = []): EpicFacts => ({ slug, stories: new Set(stories), boxes: new Set(boxes) });
  const tagged = (names: string[]): DesignIndex => ({ files: [indexOf([{ id: 1, name: '1 Screens', frames: names.map((name, i) => ({ id: 100 + i, name })) }])], findings: [] });

  it('links the frame to the story (or box) of the one EPIC that has it', () => {
    const r = resolveFrameTags(tagged(['[S2] Approve', '[S1/pay] Pay form']), [facts('2026-01-01-a', ['S1', 'S2'], ['pay'])], {});
    expect(r.findings).toEqual([]);
    expect(r.links).toEqual([
      { slug: '2026-01-01-a', storyId: 'S2', link: { file: 'design/review.figcraft', page: 1, frame: '[S2] Approve' }, frameName: '[S2] Approve' },
      { slug: '2026-01-01-a', storyId: 'S1', box: 'pay', link: { file: 'design/review.figcraft', page: 1, frame: '[S1/pay] Pay form' }, frameName: '[S1/pay] Pay form' },
    ]);
  });

  it('two EPICs with the story: the one links.yaml links the file to, or the tag must name the EPIC', () => {
    const epics = [facts('2026-01-01-a', ['S1']), facts('2026-01-02-b', ['S1'])];
    const amb = resolveFrameTags(tagged(['[S1] Home']), epics, {});
    expect(amb.links).toEqual([]);
    expect(amb.findings.map((f) => [f.epics, f.finding.message])).toEqual([
      [['2026-01-01-a', '2026-01-02-b'], 'design/review.figcraft, page 1 "1 Screens", frame "[S1] Home": the tag [S1]: 2026-01-01-a and 2026-01-02-b both have S1; name the EPIC, for example [2026-01-01-a:S1]'],
    ]);
    const named = resolveFrameTags(tagged(['[2026-01-02-b:S1] Home']), epics, {});
    expect(named.links.map((l) => l.slug)).toEqual(['2026-01-02-b']);
    const { links } = parseDesignLinks('epics:\n  2026-01-01-a:\n    S1: { file: design/review.figcraft, page: 1 }\n');
    expect(resolveFrameTags(tagged(['[S1] Home']), epics, links).links.map((l) => l.slug)).toEqual(['2026-01-01-a']);
  });

  it('a tag that names a story, box or EPIC that does not exist is a finding', () => {
    const r = resolveFrameTags(tagged(['[S9] Gone', '[S1/nope] Box', '[2026-09-09-zzz:S1] X', '[2026-01-01-a:S7] Y']), [facts('2026-01-01-a', ['S1'], ['pay'])], {});
    expect(r.links).toEqual([]);
    expect(r.findings.map((f) => f.finding.message.split(': ').slice(1).join(': '))).toEqual([
      'the tag [S9] names S9, which no EPIC has',
      'the tag [S1/nope] names the box nope, which is not in flow.yaml of 2026-01-01-a',
      'the tag [2026-09-09-zzz:S1] names the EPIC 2026-09-09-zzz, which does not exist',
      'the tag [2026-01-01-a:S7] names S7, which the EPIC 2026-01-01-a does not have',
    ]);
    expect(r.findings.every((f) => f.finding.file === 'design/review.figcraft' && f.finding.kind === 'reference')).toBe(true);
  });

  it('precedence: a links.yaml entry wins over a frame tag; a frame tag fills what links.yaml leaves', () => {
    const tags = resolveFrameTags(tagged(['[S1] Home', '[S1/pay] Pay']), [facts('2026-01-01-a', ['S1'], ['pay', 'ship'])], {}).links;
    const none = effectiveDesignLinks({ boxes: {} }, tags, '2026-01-01-a', 'S1');
    expect(none.story).toEqual({ link: { file: 'design/review.figcraft', page: 1, frame: '[S1] Home' }, source: 'frame name', frameName: '[S1] Home' });
    expect(none.boxes.pay?.source).toBe('frame name');
    const explicit = { file: 'design/other.figcraft', page: 2 };
    const both = effectiveDesignLinks({ story: explicit, boxes: { ship: explicit } }, tags, '2026-01-01-a', 'S1');
    expect(both.story).toEqual({ link: explicit, source: 'links.yaml' });
    expect(Object.fromEntries(Object.entries(both.boxes).map(([b, s]) => [b, s.source]))).toEqual({ pay: 'frame name', ship: 'links.yaml' });
    expect(effectiveDesignLinks({ boxes: {} }, tags, '2026-01-01-b', 'S1')).toEqual({ boxes: {} });
  });

  it('validate reports a tag that names a story or box that does not exist; the brief takes a tag link', () => {
    const { top, epic } = repo();
    writeFileSync(join(top, 'design', 'screens.figcraft'), figcraft([{ id: 1, name: '1 Screens', frames: [{ id: 2, name: '[S99] Nothing' }, { id: 3, name: '[S12/no-box] X' }, { id: 4, name: '[S16] Design tab' }] }]));
    const report = validateEpic(epic);
    expect(report.ok).toBe(false);
    expect(report.findings.map((f) => f.message).sort()).toEqual([
      'design/screens.figcraft, page 1 "1 Screens", frame "[S12/no-box] X": the tag [S12/no-box] names the box no-box, which is not in flow.yaml of 2026-11-05-rehearse',
      'design/screens.figcraft, page 1 "1 Screens", frame "[S99] Nothing": the tag [S99] names S99, which no EPIC has',
    ]);
    expect(storyBriefDesign(top, loadEpic(epic).record, 'S16')).toEqual({ story: { file: 'design/screens.figcraft', page: 1, frame: '[S16] Design tab' }, boxes: {} });
  });

  it('validate reports a linked design file that cannot be read', () => {
    const { top, epic } = repo();
    writeFileSync(join(top, 'design', 'a.figcraft'), 'not a zip');
    writeFileSync(join(top, 'design', 'links.yaml'), 'epics:\n  2026-11-05-rehearse:\n    S4: { file: design/a.figcraft, page: 2 }\n');
    expect(validateEpic(epic).findings).toEqual([expect.objectContaining({ file: 'design/links.yaml', path: 'design/a.figcraft', message: expect.stringMatching(/^design\/a\.figcraft: cannot read it/) })]);
    // An unlinked unreadable file is no business of this EPIC.
    writeFileSync(join(top, 'design', 'links.yaml'), 'epics: {}\n');
    expect(validateEpic(epic)).toMatchObject({ ok: true, findings: [] });
    expect(readDesignState(top).index.findings).toHaveLength(1);
  });
});

describe('design suggestions (T51, box suggest-design)', () => {
  it('words: lower case, stop words, numbers and story ids dropped; a light stem', () => {
    expect(words('As the owner I want to see S12 tests on page 14 in Birdview')).toEqual(['owner', 'want', 'tests', 'birdview']);
    expect(['stories', 'tests', 'linked', 'playing', 'boxes', 'class'].map(stem)).toEqual(['story', 'test', 'link', 'play', 'box', 'class']);
  });

  it('ranks pages and frames by the words they share with the story; the top 3, with a plain reason', () => {
    const idx: DesignIndex = { files: [indexOf(REVIEW)], findings: [] };
    const s = suggestDesigns(idx, ['the owner watches the tests in the Birdview player']);
    expect(s.map((x) => [x.page, x.frame?.name ?? null, x.reason])).toEqual([
      [4, 'Birdview tests', 'matches: birdview, tests'],
      [4, 'Birdview tests', 'matches: birdview, tests'],
      [3, 'Storyboard player', 'matches: player'],
    ]);
    // Two frames of a page share a name: the link names them by id.
    expect(s.slice(0, 2).map((x) => x.frame?.ref)).toEqual(['40', '41']);
    expect(s[0]!.picture).toEqual({ kind: 'file thumbnail', file: 'design/review.figcraft' });
    expect(suggestDesigns(idx, ['nothing alike here at all'])).toEqual([]);
    expect(suggestDesigns(idx, ['storyboard'], { limit: 1 }).map((x) => x.page)).toEqual([3]);
  });

  it('a word most stories use counts less than a word few use', () => {
    const idx: DesignIndex = { files: [indexOf([{ id: 1, name: '1 Owner story', frames: [] }, { id: 2, name: '2 Storyboard', frames: [] }])], findings: [] };
    const texts = ['the owner plays the storyboard'];
    const others = [texts, ['the owner signs'], ['the owner reads']];
    expect(suggestDesigns(idx, texts, { others }).map((x) => x.page)).toEqual([2, 1]);
  });

  it("a story's texts: want, so that, criteria and the titles of its boxes", () => {
    const { record } = loadEpic(REAL_EPIC);
    const t = storyTexts(record, 'S12');
    expect(t.length).toBeGreaterThan(3);
    expect(t.join(' ')).toMatch(/test/i);
    expect(storyTexts(record, 'S999')).toEqual([]);
  });
});

describe('editing design/links.yaml (T51, box link-design)', () => {
  const TEXT = `# head comment
epics:
  e:
    # S4 comment
    S4: { file: design/r.figcraft, page: 2, png: design/2-a.png } # trailing
    S11:
      file: design/r.figcraft
      page: 13
      boxes:
        watch: { file: design/r.figcraft, page: 15 }
    S12: { file: design/r.figcraft, page: 14 }
`;
  const link = { file: 'design/r.figcraft', page: 3, frame: 'Storyboard', png: 'design/frames/storyboard.png' };

  it('the same link again leaves the file byte for byte', () => {
    expect(setDesignLink(TEXT, 'e', 'S4', undefined, { file: 'design/r.figcraft', page: 2, png: 'design/2-a.png' })).toBe(TEXT);
  });

  it('link a new story: one flow line at the end, comments and order kept', () => {
    const out = setDesignLink(TEXT, 'e', 'S16', undefined, link);
    expect(out).toBe(`${TEXT}    S16: { file: design/r.figcraft, page: 3, frame: Storyboard, png: design/frames/storyboard.png }\n`);
    expect(parseDesignLinks(out).findings).toEqual([]);
  });

  it('change a link in place, keeping its comments', () => {
    const out = setDesignLink(TEXT, 'e', 'S4', undefined, link);
    expect(out).toContain('    # S4 comment\n    S4: { file: design/r.figcraft, page: 3, frame: Storyboard, png: design/frames/storyboard.png } # trailing\n');
    expect(out.indexOf('S4:')).toBeLessThan(out.indexOf('S11:'));
    const s11 = setDesignLink(TEXT, 'e', 'S11', undefined, { file: 'design/r.figcraft', page: 9 });
    expect(s11).toContain('    S11:\n      file: design/r.figcraft\n      page: 9\n      boxes:\n        watch: { file: design/r.figcraft, page: 15 }\n');
  });

  it('unlink a story or a box; a story with boxes keeps them', () => {
    const noS4 = setDesignLink(TEXT, 'e', 'S4', undefined, null);
    expect(noS4).not.toContain('S4:');
    expect(noS4).toContain('# head comment');
    const noS11 = setDesignLink(TEXT, 'e', 'S11', undefined, null);
    expect(noS11).toContain('    S11:\n      boxes:\n        watch: { file: design/r.figcraft, page: 15 }\n');
    const noBox = setDesignLink(TEXT, 'e', 'S11', 'watch', null);
    expect(noBox).toContain('    S11:\n      file: design/r.figcraft\n      page: 13\n    S12:');
    expect(setDesignLink(TEXT, 'e', 'S99', undefined, null)).toBe(TEXT);
    expect(setDesignLink(TEXT, 'other', 'S1', undefined, null)).toBe(TEXT);
  });

  it('link a box of a story with a flow link or none', () => {
    const out = setDesignLink(TEXT, 'e', 'S12', 'pay', { file: 'design/r.figcraft', page: 5 });
    expect(parseDesignLinks(out).links.e!.S12).toEqual({ story: { file: 'design/r.figcraft', page: 14 }, boxes: { pay: { file: 'design/r.figcraft', page: 5 } } });
    const fresh = setDesignLink(TEXT, 'e', 'S20', 'a/b', { file: 'design/r.figcraft', page: 5 });
    expect(parseDesignLinks(fresh).links.e!.S20).toEqual({ boxes: { 'a/b': { file: 'design/r.figcraft', page: 5 } } });
    expect(fresh.startsWith(TEXT)).toBe(true);
  });

  it('a file that does not exist yet, a new EPIC; bad YAML throws', () => {
    const out = setDesignLink(undefined, 'e', 'S1', undefined, { file: 'design/r.figcraft', page: 1 });
    expect(out).toContain('# Which design page');
    expect(out).toContain('epics:\n  e:\n    S1: { file: design/r.figcraft, page: 1 }\n');
    expect(parseDesignLinks(setDesignLink(TEXT, 'f', 'S1', undefined, { file: 'design/r.figcraft', page: 1 })).links.f).toBeDefined();
    expect(setDesignLink('epics:\n  e:\n    S1: { file: design/r.figcraft, page: 1 }\n', 'e', 'S1', undefined, null)).toBe('epics: {}\n');
    expect(() => setDesignLink('epics: [', 'e', 'S1', undefined, null)).toThrow(/not valid YAML/);
    expect(() => setDesignLink('epics: [1]\n', 'e', 'S1', undefined, link)).toThrow(/must be a map/);
  });
});
