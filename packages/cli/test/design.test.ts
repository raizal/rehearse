// `rehearse design suggest` (T51, box suggest-design): suggestions for every unlinked story, text and
// --json, and its exit codes. The design file is a zip built here.

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHOP } from '../../core/test/helpers.js';
import { makeZip } from '../../server/test/zip.js';
import { main } from '../src/index.js';

async function cli(args: string[], cwd: string): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(args, { cwd, stdout: (t) => (out += t), stderr: (t) => (err += t) });
  return { code, out, err };
}

/** A repo with the shop EPIC under docs/epics/ and design/shop.figcraft: 1 Cart pay, 2 Ship (frame "Parcel label"). */
function repo(): string {
  const top = mkdtempSync(join(tmpdir(), 'rehearse-suggest-'));
  mkdirSync(join(top, '.git'));
  cpSync(SHOP, join(top, 'docs', 'epics', '2026-11-05-shop'), { recursive: true });
  mkdirSync(join(top, 'design'));
  const doc = {
    pages: [1, 2],
    nodes: {
      1: { type: 'page', name: '1 Cart pay', children: [] },
      2: { type: 'page', name: '2 Ship', children: [20] },
      20: { type: 'frame', name: 'Parcel label', children: [] },
    },
  };
  writeFileSync(join(top, 'design', 'shop.figcraft'), makeZip([{ name: 'document.json', data: JSON.stringify(doc) }]));
  return top;
}

describe('rehearse design suggest (T51)', () => {
  it('lists the top pages and frames of each unlinked story with the reason; writes nothing', async () => {
    const top = repo();
    const r = await cli(['design', 'suggest', '2026-11-05-shop'], top);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Design suggestions for 2026-11-05-shop, from design/shop.figcraft.');
    expect(r.out).toContain("Never linked by themselves: link one from the story's Design tab in rehearse serve.");
    expect(r.out).toMatch(/S1 {2}to pay for my cart\n {4}1\. design\/shop\.figcraft, page 1 "1 Cart pay" {2}\(matches: [a-z, ]*(pay|cart)/);
    expect(r.out).toMatch(/S2 {2}to ship paid orders\n {4}1\. design\/shop\.figcraft, page 2 "2 Ship" {2}\(matches: ship\)/);
    expect(r.out).toContain('Linked already: none.');
    expect(() => readFileSync(join(top, 'design', 'links.yaml'))).toThrow();
  });

  it('a linked story (links.yaml or a frame name) is left out; --json', async () => {
    const top = repo();
    writeFileSync(join(top, 'design', 'links.yaml'), 'epics:\n  2026-11-05-shop:\n    S1: { file: design/shop.figcraft, page: 1 }\n');
    const r = await cli(['design', 'suggest', join(top, 'docs', 'epics', '2026-11-05-shop'), '--json'], tmpdir());
    expect(r.code).toBe(0);
    const j = JSON.parse(r.out);
    expect(j).toMatchObject({ ok: true, epic: '2026-11-05-shop', files: ['design/shop.figcraft'], unreadable: [], linked: ['S1'] });
    expect(j.stories.map((s: { id: string }) => s.id)).toEqual(['S2']);
    expect(j.stories[0].suggestions[0]).toMatchObject({ file: 'design/shop.figcraft', page: 2, pageName: '2 Ship', matches: ['ship'], reason: 'matches: ship' });
    // S2 linked by a frame name: nothing left to suggest.
    const doc = { pages: [1], nodes: { 1: { type: 'page', name: '1 Ship', children: [2] }, 2: { type: 'frame', name: '[S2] Parcel', children: [] } } };
    writeFileSync(join(top, 'design', 'tagged.figcraft'), makeZip([{ name: 'document.json', data: JSON.stringify(doc) }]));
    const t = await cli(['design', 'suggest', '2026-11-05-shop'], top);
    expect(t.out).toContain('Every story has a design linked.');
    expect(t.out).toContain('Linked already: S1, S2.');
  });

  it('exit 1 when there is no readable design file; an unreadable one is named', async () => {
    const top = repo();
    rmSync(join(top, 'design', 'shop.figcraft'));
    const none = await cli(['design', 'suggest', '2026-11-05-shop'], top);
    expect(none.code).toBe(1);
    expect(none.err).toContain('no readable .figcraft file under design/');
    writeFileSync(join(top, 'design', 'bad.figcraft'), 'x');
    const bad = await cli(['design', 'suggest', '2026-11-05-shop', '--json'], top);
    expect(bad.code).toBe(1);
    expect(JSON.parse(bad.out)).toMatchObject({ ok: false, files: [], unreadable: [expect.stringMatching(/^design\/bad\.figcraft: cannot read it/)] });
  });

  it('usage errors exit 2', async () => {
    const top = repo();
    for (const args of [['design'], ['design', 'link'], ['design', 'suggest'], ['design', 'suggest', '2026-11-05-shop', '--nope'], ['design', 'suggest', 'a', 'b'], ['design', 'suggest', 'no-such-epic']]) {
      const r = await cli(args, top);
      expect(r.code, args.join(' ')).toBe(2);
    }
  });
});
