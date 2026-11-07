import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkDesignLinks,
  DESIGN_HEADING,
  designLinkLine,
  designSection,
  isDesignPath,
  loadEpic,
  NO_DESIGN_LINE,
  FRAME_TAG_LINE,
  parseDesignLinks,
  storyBuildBrief,
  storyDesignLinks,
  validateEpic,
} from '../../src/index.js';
import { makeZip } from '../zip.js';
import { REAL_EPIC } from '../helpers.js';
import { signedEpic } from '../trust/helpers.js';

const LINKS = `epics:
  2026-11-05-rehearse:
    S12: { file: design/rehearse-review.figcraft, page: 14, png: design/14-story-tests.png }
    S11:
      file: design/rehearse-review.figcraft
      page: Story code
      boxes:
        watch-build: { file: design/rehearse-review.figcraft, page: 15 }
  2026-11-05-other:
    S1: { file: design/x.figcraft, page: 1 }
`;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('design links (T50, box design-links)', () => {
  it('parses story and box links per EPIC', () => {
    const { links, findings } = parseDesignLinks(LINKS);
    expect(findings).toEqual([]);
    expect(storyDesignLinks(links, '2026-11-05-rehearse', 'S12')).toEqual({ story: { file: 'design/rehearse-review.figcraft', page: 14, png: 'design/14-story-tests.png' }, boxes: {} });
    expect(storyDesignLinks(links, '2026-11-05-rehearse', 'S11')).toEqual({
      story: { file: 'design/rehearse-review.figcraft', page: 'Story code' },
      boxes: { 'watch-build': { file: 'design/rehearse-review.figcraft', page: 15 } },
    });
    expect(storyDesignLinks(links, '2026-11-05-rehearse', 'S9')).toEqual({ boxes: {} });
  });

  it('a malformed file or link is a finding, never a throw', () => {
    expect(parseDesignLinks('epics: [').findings[0]?.message).toMatch(/^yaml-syntax/);
    expect(parseDesignLinks('- a list').findings[0]?.message).toMatch(/must hold `epics:`/);
    expect(parseDesignLinks('').findings).toEqual([]);
    const bad = parseDesignLinks(`epics:
  e:
    S1: { file: ../secret.figcraft, page: 0, png: design/a.jpg }
    S2: { file: design/a.txt, page: 2 }
    S3: just text
    S4: { file: design/../x.figcraft, page: 1, colour: red }
`);
    const msgs = bad.findings.map((f) => `${f.path}: ${f.message}`);
    expect(msgs).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^epics\.e\.S1\.file: file must be a \.figcraft file under design\//),
        expect.stringMatching(/^epics\.e\.S1\.page: page must be a page number/),
        expect.stringMatching(/^epics\.e\.S1\.png: png must be a \.png file under design\//),
        expect.stringMatching(/^epics\.e\.S2\.file: /),
        expect.stringMatching(/^epics\.e\.S3: a story link must be/),
        expect.stringMatching(/^epics\.e\.S4\.file: /),
        'epics.e.S4.colour: unknown key colour',
      ]),
    );
    expect(bad.links.e).toEqual({ S1: { boxes: {} }, S2: { boxes: {} }, S3: { boxes: {} }, S4: { boxes: {} } });
    expect(bad.findings.every((f) => f.file === 'design/links.yaml' && f.kind === 'reference')).toBe(true);
  });

  it('isDesignPath keeps a link inside design/', () => {
    expect(isDesignPath('design/a.figcraft', '.figcraft')).toBe(true);
    expect(isDesignPath('design/sub/a.figcraft', '.figcraft')).toBe(true);
    for (const p of ['/design/a.figcraft', 'design/../a.figcraft', 'design//a.figcraft', 'design/./a.figcraft', 'docs/a.figcraft', 'design/a.png', 'design\\a.figcraft', 'design/a.figcraft\0'])
      expect(isDesignPath(p, '.figcraft'), p).toBe(false);
  });

  it('checks stories, boxes and files of the EPIC being validated only', () => {
    const { record } = loadEpic(REAL_EPIC);
    const { links } = parseDesignLinks(`epics:
  2026-11-05-rehearse:
    S12: { file: design/rehearse-review.figcraft, page: 14, png: design/99-gone.png }
    S99: { file: design/rehearse-review.figcraft, page: 1 }
    S11:
      boxes:
        no-such-box: { file: design/gone.figcraft, page: 1 }
  2026-11-05-other:
    S1: { file: design/x.figcraft, page: 1 }
`);
    const exists = (p: string) => p === 'design/rehearse-review.figcraft';
    const msgs = checkDesignLinks(links, record, exists).map((f) => `${f.path}: ${f.message}`);
    expect(msgs).toEqual([
      'epics.2026-11-05-rehearse.S12.png: design/99-gone.png does not exist',
      'epics.2026-11-05-rehearse.S99: no story S99 in the EPIC 2026-11-05-rehearse',
      'epics.2026-11-05-rehearse.S11.boxes.no-such-box: no box no-such-box in flow.yaml',
      'epics.2026-11-05-rehearse.S11.boxes.no-such-box.file: design/gone.figcraft does not exist',
    ]);
  });

  it('this repo: the links in design/links.yaml are all good', () => {
    // T60: STE notes on draft text are information only, so this test does not compare them.
    expect(validateEpic(REAL_EPIC)).toMatchObject({ command: 'validate', ok: true, findings: [] });
  });

  it('rehearse validate reports a bad link of its EPIC as a finding', () => {
    const top = mkdtempSync(join(tmpdir(), 'rehearse-design-'));
    dirs.push(top);
    mkdirSync(join(top, '.git'));
    const epic = join(top, 'docs', 'epics', '2026-11-05-rehearse');
    cpSync(REAL_EPIC, epic, { recursive: true });
    mkdirSync(join(top, 'design'));
    // A readable FigCraft file (T51: a linked file that cannot be read is a finding of its own).
    writeFileSync(join(top, 'design', 'a.figcraft'), makeZip([{ name: 'document.json', data: '{"pages":[],"nodes":{}}' }]));
    writeFileSync(join(top, 'design', 'links.yaml'), 'epics:\n  2026-11-05-rehearse:\n    S12: { file: design/a.figcraft, page: 14, png: design/14.png }\n    S4: { file: design/a.figcraft, page: 2 }\n');
    const report = validateEpic(epic);
    expect(report.ok).toBe(false);
    expect(report.findings).toEqual([{ kind: 'reference', file: 'design/links.yaml', path: 'epics.2026-11-05-rehearse.S12.png', message: 'design/14.png does not exist', refs: ['S12'] }]);
    writeFileSync(join(top, 'design', 'links.yaml'), 'epics: [');
    expect(validateEpic(epic).findings[0]).toMatchObject({ file: 'design/links.yaml', message: expect.stringMatching(/^yaml-syntax/) });
  });

  it('the line to add names the story', () => {
    expect(designLinkLine('S16')).toBe('S16: { file: design/<name>.figcraft, page: <page number or name>, png: design/<page>.png }');
  });
});

describe('the Design section of the build brief (T50, box design-brief)', () => {
  it('names the file, page and PNG of the story and its boxes, and says never to write it', () => {
    const md = designSection({ story: { file: 'design/r.figcraft', page: 14, png: 'design/14.png' }, boxes: { pay: { file: 'design/r.figcraft', page: 'Pay' } } });
    expect(md).toContain(`${DESIGN_HEADING}\n\n- The story: \`design/r.figcraft\`, page 14, picture \`design/14.png\`.`);
    expect(md).toContain('- Box `pay`: `design/r.figcraft`, page Pay (no PNG linked).');
    expect(md).toContain('Build the screen to match this: read the PNG.');
    expect(md).toContain('127.0.0.1:4800');
    expect(md).toContain('read-only with the figcraft-use skill');
    expect(md).toContain('Never write to the design file, and never call `POST /api/design/save`');
  });

  it('no link: one line, and how a new screen links itself (T51)', () => {
    expect(designSection(undefined)).toBe(`${DESIGN_HEADING}\n\n${NO_DESIGN_LINE}\n\n${FRAME_TAG_LINE}`);
    expect(designSection({ boxes: {} })).toBe(
      '## Design\n\nNo design linked for this story.\n\nIf you design a new screen in FigCraft, name its top frame `[<story id>] <what it shows>` so it links itself.',
    );
  });

  it('a frame link names the frame, and the tag line closes the section (T51)', () => {
    const md = designSection({ story: { file: 'design/r.figcraft', page: 14, frame: 'Story · tests', png: 'design/frames/story-tests.png' }, boxes: {} });
    expect(md).toContain('- The story: `design/r.figcraft`, page 14, frame "Story · tests", picture `design/frames/story-tests.png`.');
    expect(md.endsWith(FRAME_TAG_LINE)).toBe(true);
  });

  it('the build brief has it after the boxes, with and without a link', () => {
    const { record } = loadEpic(signedEpic());
    const none = storyBuildBrief(record, 'S1');
    if (!none.ok) throw new Error(none.reason);
    const heads = none.markdown.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3));
    expect(heads.indexOf('Design')).toBe(heads.indexOf('Boxes') + 1);
    expect(none.markdown).toContain('## Design\n\nNo design linked for this story.\n');
    const linked = storyBuildBrief(record, 'S1', { design: { story: { file: 'design/shop.figcraft', page: 3, png: 'design/3-pay.png' }, boxes: {} } });
    if (!linked.ok) throw new Error(linked.reason);
    expect(linked.markdown).toContain('- The story: `design/shop.figcraft`, page 3, picture `design/3-pay.png`.');
    expect(linked.hash).toBe(none.hash);
  });
});
