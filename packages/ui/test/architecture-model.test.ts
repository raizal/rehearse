// T16: layout and diff of the system architecture (page 8), its before / after (page 11) and a
// story's before / after (page 12). Pure functions; the views are tested in architecture.test.tsx.

import { describe, expect, it } from 'vitest';
import type { SystemArchitecture } from '@rehearse/core';
import {
  archLayout,
  ARCH,
  changeRows,
  clipToRect,
  countStatuses,
  countsText,
  diffDrawing,
  drawingOf,
  partCountsText,
  linkWord,
  statusLook,
  storyNote,
} from '../src/model/architecture.js';
import { storyBaLayout, storyChangeSummary, storyCompare } from '../src/model/story-compare.js';
import { codeGraphEpic, codeGraphNoPrd, realEpic, reviewEpic } from './fixture.js';

const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a: { x: number; y: number; w: number; h: number }, z: { x: number; y: number; w: number; h: number }) =>
  a.x >= z.x && a.y >= z.y && a.x + a.w <= z.x + z.w && a.y + a.h <= z.y + z.h;

describe('T16 2 architecture layout (page 8)', () => {
  const arch = realEpic().system!.architecture!;
  const d = drawingOf(arch);
  const lay = archLayout(d);

  it('T16 2 every part of the real docs/system/ sits inside its zone; people and outside systems with no zone stand left of all zones', () => {
    for (const p of d.parts) {
      const r = lay.parts.get(p.id)!;
      expect(r, p.id).toBeDefined();
      if (p.zone) expect(inside(r, lay.zones.get(p.zone)!), p.id).toBe(true);
      else for (const z of lay.zones.values()) expect(r.x + r.w, p.id).toBeLessThan(z.x);
    }
  });

  it('T16 2 no two parts and no two zones overlap; the canvas holds them all', () => {
    const parts = [...lay.parts.values()];
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) expect(overlap(parts[i]!, parts[j]!)).toBe(false);
    const zones = [...lay.zones.values()];
    for (let i = 0; i < zones.length; i++) for (let j = i + 1; j < zones.length; j++) expect(overlap(zones[i]!, zones[j]!)).toBe(false);
    for (const r of [...parts, ...zones]) expect(r.x + r.w <= lay.width && r.y + r.h <= lay.height).toBe(true);
  });

  it('T16 2 a zone has at most three components across (T18b: the biggest zone three, the stacked zones two)', () => {
    const across = (zone: string) => new Set(d.parts.filter((p) => p.zone === zone).map((p) => lay.parts.get(p.id)!.x)).size;
    expect(across('repo')).toBe(ARCH.maxCols);
    expect(across('bb')).toBe(ARCH.sideCols);
  });

  it('T16 2 each link runs between the borders of its two parts, with its label on the line (T18b: orthogonal)', () => {
    expect(lay.links.length).toBe(arch.links.length);
    const l = lay.links.find((x) => x.from === 'core' && x.to === 'repo')!;
    const a = lay.parts.get('core')!;
    const onBorder = (r: typeof a, x: number, y: number) => Math.abs(x - r.x) < 0.01 || Math.abs(x - r.x - r.w) < 0.01 || Math.abs(y - r.y) < 0.01 || Math.abs(y - r.y - r.h) < 0.01;
    const first = l.points[0]!;
    const last = l.points[l.points.length - 1]!;
    expect(onBorder(a, first.x, first.y)).toBe(true);
    expect(onBorder(lay.parts.get('repo')!, last.x, last.y)).toBe(true);
    const label = l.label!;
    const mid = { x: label.x + label.w / 2, y: label.y + label.h / 2 };
    const onLine = l.points.slice(1).some((q, i) => {
      const p = l.points[i]!;
      return (Math.abs(p.x - q.x) < 0.5 && Math.abs(mid.x - p.x) < 0.5) || (Math.abs(p.y - q.y) < 0.5 && Math.abs(mid.y - p.y) < 0.5);
    });
    expect(onLine).toBe(true);
  });

  it('T16 2 clipToRect leaves the box on the side that faces the target', () => {
    const r = { x: 0, y: 0, w: 100, h: 50 };
    expect(clipToRect(r, 500, 25)).toEqual({ x: 100, y: 25 });
    expect(clipToRect(r, 50, -200)).toEqual({ x: 50, y: 0 });
  });

  it('T16 2 a part whose zone is unknown stands in the left column, and a link to an unknown part is not drawn', () => {
    const odd: SystemArchitecture = {
      version: 1,
      zones: [{ id: 'z', name: 'Z' }],
      components: [
        { id: 'a', name: 'A', zone: 'z' },
        { id: 'b', name: 'B', zone: 'nowhere' },
      ],
      links: [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'ghost' },
      ],
    };
    const l = archLayout(drawingOf(odd));
    expect(l.parts.get('b')!.x + l.parts.get('b')!.w).toBeLessThan(l.zones.get('z')!.x);
    expect(l.links.map((x) => x.to)).toEqual(['b']);
    expect(drawingOf(odd).zones[0]!.color).toBe('blue');
  });
});

describe('T16 3 before / after (page 11)', () => {
  const c = codeGraphEpic().compare!;

  it('T16 3 the three sides hold the same items in the same places: before has no status, after has no removed item, diff has all', () => {
    const before = diffDrawing(c.architecture, 'before');
    const after = diffDrawing(c.architecture, 'after');
    const diff = diffDrawing(c.architecture, 'diff');
    expect(before.parts.some((p) => p.status)).toBe(false);
    expect(before.parts.map((p) => p.id)).not.toContain('graph');
    expect(after.parts.find((p) => p.id === 'graph')?.status).toBe('added');
    expect(after.parts.find((p) => p.id === 'cli')?.status).toBe('changed');
    expect(after.parts.find((p) => p.id === 'core')?.status).toBe('same');
    expect(diff.parts.length).toBe(c.architecture.parts.length);
    const all = archLayout(diff);
    expect(all.parts.get('graph')).toBeDefined();
    expect(after.links.filter((l) => l.status === 'added').map((l) => `${l.from}->${l.to}`)).toEqual(['cli->graph', 'serve->graph', 'graph->graph-db', 'graph->source', 'graph->repo']);
  });

  it('T16 3 status in words and marks; an added link is a new link', () => {
    expect(statusLook('added')).toEqual({ className: 'is-added', word: 'added', mark: '+' });
    expect(statusLook('removed')?.word).toBe('removed');
    expect(statusLook(undefined)).toBeUndefined();
    expect(linkWord('added')).toBe('new link');
    expect(linkWord('same')).toBe('same link');
  });

  it('T16 3 counts in words: 2 added · 4 changed · 5 same parts (page 11 does not draw people or CI)', () => {
    const parts = c.architecture.parts.filter((p) => !['person'].includes((p.after ?? p.before)!.kind ?? '') && p.id !== 'ci');
    expect(countsText(countStatuses(parts))).toBe('2 added · 4 changed · 5 same');
    expect(countsText({ added: 0, changed: 0, same: 0, removed: 0 })).toBe('no change');
  });

  it('T19 the count leaves out planned parts (CI with no workflow) and says so', () => {
    const plain = structuredClone(c.architecture);
    expect(partCountsText(plain)).toBe(countsText(countStatuses(plain.parts.filter((p: any) => (p.after ?? p.before)!.kind !== 'person'))));
    const planned = structuredClone(c.architecture);
    for (const p of planned.parts) {
      for (const side of [p.before, p.after]) if (side && side.zone === 'ci') side.planned = true;
    }
    const n = planned.parts.filter((p: any) => (p.after ?? p.before)!.zone === 'ci').length;
    expect(n).toBeGreaterThan(0);
    const zone = planned.zones.find((z: any) => z.id === 'ci')!;
    expect(partCountsText(planned)).toMatch(new RegExp(` · ${(zone.after ?? zone.before)!.name} left out: ${n} planned part${n === 1 ? '' : 's'} not built yet$`));
  });

  it('T16 3 change rows: change, part, before, after, why, story; parts, then links, boxes and entities', () => {
    const rows = changeRows(c);
    const parts = rows.filter((r) => r.key.startsWith('part '));
    // In the order of docs/system/architecture.yaml, then the added parts.
    expect(parts.map((r) => [r.status, r.item, r.before, r.after])).toEqual([
      ['changed', 'rehearse CLI', 'new · validate · simulate · gate · serve', '+ find · show · near · path · context, each with --json'],
      ['changed', '@rehearse/ui', 'review views', '+ code drill-down below a leaf box: code, AST, call graph'],
      ['changed', 'rehearse serve', 'serves the UI and /api/*', '+ watches files, answers graph queries for the panel'],
      ['changed', 'git repo', 'YAML records, allowed_signers', '+ reads Flow-Box: commit trailers for box → code links'],
      ['added', '@rehearse/graph', '—', 'indexer and queries: tree-sitter, ts-morph, Pyright; BM25; PageRank'],
      ['added', '.rehearse/graph.db', '—', 'SQLite FTS5 cache; git ignores it; a rebuild makes it again'],
    ]);
    expect(parts[4]).toMatchObject({ area: 'component', why: ['G2', 'G4', 'G14', 'G15'], stories: ['S1'] });
    expect(parts[5]!.area).toBe('store');
    expect(rows.find((r) => r.key === 'link cli graph')).toMatchObject({ area: 'link', item: 'rehearse CLI → @rehearse/graph', before: '—', after: 'find · context' });
    expect(rows.find((r) => r.key === 'box grep-code')).toMatchObject({ status: 'removed', item: 'Agent reads code with grep and cat' });
    expect(rows.find((r) => r.key === 'box draft-record')).toMatchObject({ status: 'changed', before: 'in: epicDir, findings', after: 'in: + contextBundle' });
    expect(rows.find((r) => r.key === 'entity Box')).toMatchObject({ status: 'changed', after: 'fields: + code' });
    expect(rows.some((r) => r.status === 'same')).toBe(false);
  });

  it('T16 3 the story note: none yet before prd.yaml; with prd.yaml it counts changes with no story', () => {
    const rows = changeRows(codeGraphNoPrd().compare!);
    expect(storyNote(false, rows)).toMatch(/^Stories: none yet/);
    expect(storyNote(true, [])).toBeUndefined();
    expect(storyNote(true, changeRows(c))).toMatch(/^\d+ of \d+ changes name no story yet\.$/);
  });
});

describe('T16 4 story before / after (page 12)', () => {
  const sc = storyCompare(codeGraphEpic(), 'S1');

  it('T16 4 the story boxes before and after, in lanes; Files holds the store the story adds', () => {
    expect(sc.available).toBe(true);
    expect(sc.boxes.map((b) => `${b.status} ${b.key} @${b.lane}${b.onBefore ? ' B' : ''}${b.onAfter ? ' A' : ''}`)).toEqual([
      'added ask-context @agent A',
      'added check-freshness @rehearse A',
      'added rank-nodes @rehearse A',
      'added fill-budget @rehearse A',
      'changed draft-record @agent B A',
      'same validate @rehearse B A',
      'removed grep-code @agent B',
      'added part:graph-db @files A',
    ]);
    expect(sc.boxes.find((b) => b.key === 'grep-code')!.outside).toBe(true);
    expect(sc.lanes.map((l) => l.label)).toEqual(['Agent', 'rehearse', 'Files']);
    expect(sc.edges.filter((e) => e.side === 'before').map((e) => `${e.from}->${e.to}`)).toEqual(['draft-record->validate']);
    expect(sc.edges.filter((e) => e.side === 'after').map((e) => `${e.from}->${e.to}`)).toContain('fill-budget->draft-record');
  });

  it('T16 4 one layout for both sides: each box in its lane, no two boxes overlap', () => {
    const lay = storyBaLayout(sc);
    const lanes = new Map(lay.lanes.map((l) => [l.id, l]));
    const rects = sc.boxes.map((b) => {
      const r = lay.boxes.get(b.key)!;
      const lane = lanes.get(b.lane)!;
      expect(r.y >= lane.y && r.y + r.h <= lane.y + lane.h, b.key).toBe(true);
      return r;
    });
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i]!, rects[j]!)).toBe(false);
  });

  it('T16 4 what changes in this story: boxes, entities, the NFR and the file, added first and same last', () => {
    expect(sc.rows.map((r) => `${r.status} ${r.area} ${r.item}`)).toEqual([
      'added box ask for context',
      'added box check freshness',
      'added box rank nodes',
      'added box fill budget',
      'added entity GraphNode',
      'added entity Edge',
      'added requirement performance (R2)',
      'added file .rehearse/graph.db',
      'changed box draft-record',
      'changed entity Box',
      'removed box Agent reads code with grep and cat',
      'same box validate',
    ]);
    expect(sc.rows.find((r) => r.item === 'validate')).toMatchObject({ before: 'in: epicDir', after: 'no change' });
    expect(sc.rows.find((r) => r.area === 'requirement')!.after).toMatch(/less than 100 ms/);
    expect(storyChangeSummary(sc.rows)).toEqual([
      { status: 'added', text: 'added: 4 boxes, 2 entities, 1 NFR, 1 file' },
      { status: 'changed', text: 'changed: 1 box, 1 entity' },
      { status: 'removed', text: 'removed: 1 box' },
      { status: 'same', text: 'same: 1 box' },
    ]);
  });

  it('T16 4 impact: the as-is boxes it touches and the frozen stories of the finished EPIC', () => {
    expect(sc.impact).toEqual({
      boxes: [
        { path: 'draft-record', title: 'draft-record', status: 'changed' },
        { path: 'validate', title: 'validate', status: 'same' },
      ],
      frozen: ['S2'],
      asIsEpic: '2026-11-05-rehearse',
      scenarios: 0,
      newBoxes: 4,
    });
    expect(sc.why.slice(0, 3)).toEqual(['G1', 'G3', 'G4']);
  });

  it('T16 4 an EPIC with no change has nothing to compare', () => {
    expect(storyCompare(reviewEpic(), 'S1').available).toBe(false);
    expect(storyCompare(realEpic(), 'S1')).toMatchObject({ available: false, rows: [], boxes: [] });
  });
});
