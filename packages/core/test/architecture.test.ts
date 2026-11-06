// The system as built (docs/system/) and an EPIC's change to it (architecture.yaml), D43.
// Design pages 8, 11 and 12. Not in the v1 record yet, so the tests are named T16 <feature n>.

import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import {
  applyArchitectureChange,
  compareEntities,
  compareFlowEdges,
  compareFlows,
  compareSystem,
  countDiffs,
  loadEpic,
  loadSystem,
  parseDecisionIds,
  storyHash,
  systemDirFor,
  validateEpic,
  validateRecord,
  validateSystem,
  type ArchitectureChange,
  type Flow,
  type SystemArchitecture,
} from '../src/index.js';
import { BOOTSTRAP_EPIC, brief, makeEpic, REAL_EPIC } from './helpers.js';

const CODE_GRAPH_REPO = fileURLToPath(new URL('./fixtures/code-graph', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const REAL_SYSTEM = join(REPO_ROOT, 'docs/system');

/** A copy of the code-graph repo fixture; `edit` changes files of the EPIC or of docs/system/. */
function codeGraphRepo(edit?: (docs: Record<string, any>) => void, drop: string[] = []): string {
  const root = join(mkdtempSync(join(tmpdir(), 'rehearse-arch-')), 'repo');
  cpSync(CODE_GRAPH_REPO, root, { recursive: true });
  const epic = join(root, 'docs/epics/2026-11-05-code-graph');
  if (edit) {
    const files = ['system/architecture.yaml', 'system/flow.yaml', 'system/entities.yaml', 'epic/architecture.yaml', 'epic/flow.yaml', 'epic/prd.yaml', 'epic/entities.yaml'];
    const at = (f: string) => (f.startsWith('system/') ? join(root, 'docs', f) : join(epic, f.slice('epic/'.length)));
    const docs: Record<string, any> = {};
    for (const f of files) docs[f] = parse(readFileSync(at(f), 'utf8'));
    edit(docs);
    for (const f of files) writeFileSync(at(f), stringify(docs[f]));
  }
  for (const f of drop) rmSync(join(epic, f), { force: true });
  return epic;
}

const ASIS: SystemArchitecture = {
  version: 1,
  zones: [{ id: 'repo', name: 'Repo machine' }],
  components: [
    { id: 'cli', name: 'rehearse CLI', zone: 'repo', about: 'new · validate' },
    { id: 'core', name: '@rehearse/core', zone: 'repo' },
    { id: 'old', name: 'old thing', zone: 'repo' },
  ],
  links: [
    { from: 'cli', to: 'core', label: 'uses' },
    { from: 'cli', to: 'old', label: 'calls' },
  ],
  notes: [{ zone: 'repo', text: 'Signing happens only here.' }],
};

describe('T16 1 record format: docs/system/ and the EPIC change', () => {
  it('T16 1 loads docs/system/ next to docs/epics/ and the EPIC change with it', () => {
    const { record } = loadEpic(join(CODE_GRAPH_REPO, 'docs/epics/2026-11-05-code-graph'));
    expect(record.architecture?.components?.map((c) => `${c.change} ${c.id}`)).toEqual([
      'added graph',
      'added graph-db',
      'changed cli',
      'changed serve',
      'changed ui',
      'changed repo',
    ]);
    expect(record.system?.exists).toBe(true);
    expect(record.system?.architecture?.zones.map((z) => z.id)).toEqual(['bb', 'agent', 'repo', 'ci']);
    expect(record.system?.flow?.epic).toBe('2026-11-05-rehearse');
    expect(record.decisions).toContain('G13');
    expect(record.decisions).toContain('D19');
  });

  it('T16 1 the code-graph fixture validates with no findings', () => {
    const r = validateEpic(join(CODE_GRAPH_REPO, 'docs/epics/2026-11-05-code-graph'));
    expect(brief(r.findings)).toEqual([]);
    expect(validateSystem(join(CODE_GRAPH_REPO, 'docs/system')).findings).toEqual([]);
  });

  it('T16 1 an EPIC without architecture.yaml loads and validates as before and does not read docs/system/', () => {
    const { record } = loadEpic(REAL_EPIC);
    expect(record.architecture).toBeUndefined();
    expect(record.system).toBeUndefined();
    expect(Object.keys(record.raw)).not.toContain('architecture.yaml');
    expect(validateEpic(makeEpic()).findings).toEqual([]);
  });

  it('T16 1 adding architecture.yaml does not change any story hash', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'rehearse-hash-')), '2026-11-05-rehearse');
    cpSync(BOOTSTRAP_EPIC, dir, { recursive: true });
    const hashes = (d: string) => {
      const { record } = loadEpic(d);
      const scenarios = record.scenarioFiles.flatMap((f) => f.scenarios);
      return record.prd!.stories.map((s) => [storyHash(1, s, record.prd!, record.flow, scenarios), storyHash(2, s, record.prd!, record.flow, scenarios)]);
    };
    const before = hashes(dir);
    writeFileSync(join(dir, 'architecture.yaml'), stringify({ version: 1, components: [{ id: 'x', change: 'added', name: 'X', why: ['D4'] }] }));
    expect(hashes(dir)).toEqual(before);
  });

  it('T16 1 schema: a change item needs why, an added part needs a name, change is an enum', () => {
    const epic = codeGraphRepo((d) => {
      d['epic/architecture.yaml'].components.push({ id: 'nameless', change: 'added', why: ['G1'] });
      d['epic/architecture.yaml'].components.push({ id: 'moved', change: 'moved', why: ['G1'] });
      d['epic/architecture.yaml'].links.push({ from: 'cli', to: 'core', change: 'changed' });
    });
    const r = validateEpic(epic).findings.filter((f) => f.kind === 'schema');
    expect(brief(r)).toEqual([
      'schema architecture.yaml components[6]: missing field name',
      'schema architecture.yaml components[7].change: field change must be one of: added, changed, removed',
      'schema architecture.yaml links[5]: missing field why',
    ]);
  });

  it('T16 1 unknown ids are findings: parts, zones, links, boxes, entities, stories, decisions', () => {
    const epic = codeGraphRepo((d) => {
      const a = d['epic/architecture.yaml'];
      a.components.push({ id: 'ghost', change: 'changed', what: 'x', why: ['G1'] });
      a.components.push({ id: 'core', change: 'added', name: 'again', zone: 'repo', why: ['G1'] });
      a.components.push({ id: 'lost', change: 'added', name: 'Lost', zone: 'moon', why: ['G1'] });
      a.links.push({ from: 'cli', to: 'nowhere', change: 'added', why: ['G1'] });
      a.links.push({ from: 'ui', to: 'core', change: 'removed', why: ['G1'] });
      a.boxes.push({ path: 'no-such-box', why: ['G1'] });
      a.boxes.push({ path: 'gone', change: 'removed', why: ['G1'] });
      a.entities.push({ id: 'Nope', why: ['G1'] });
      a.components[0].stories = ['S1', 'S7'];
      a.components[1].why = ['G2', 'G99'];
    });
    const r = validateEpic(epic).findings;
    expect(brief(r)).toEqual([
      'reference architecture.yaml box gone: box gone unknown in docs/system/flow.yaml; a step outside the record needs a title',
      'reference architecture.yaml box no-such-box: box no-such-box unknown in flow.yaml',
      'reference architecture.yaml core: component core is already in docs/system/architecture.yaml; use change: changed',
      'reference architecture.yaml entity Nope: entity Nope unknown in entities.yaml',
      'reference architecture.yaml ghost: component ghost unknown in docs/system/architecture.yaml',
      'reference architecture.yaml graph: story S7 unknown',
      'reference architecture.yaml graph-db: decision G99 unknown (no brainstorm.md in docs/epics/ has it)',
      'reference architecture.yaml link cli -> nowhere: component nowhere unknown in the to-be',
      'reference architecture.yaml link ui -> core: link unknown in docs/system/architecture.yaml',
      'reference architecture.yaml lost: zone moon unknown in the to-be',
    ]);
  });

  it('T16 1 without prd.yaml a story id is a finding, and without docs/system/ a changed part is one', () => {
    const noPrd = codeGraphRepo(undefined, ['prd.yaml']);
    expect(brief(validateEpic(noPrd).findings.filter((f) => f.file === 'architecture.yaml'))).toContain(
      'reference architecture.yaml graph: story S1: there is no prd.yaml yet',
    );
    const noSystem = codeGraphRepo();
    rmSync(join(noSystem, '../../system'), { recursive: true });
    const r = brief(validateEpic(noSystem).findings);
    expect(r).toContain('reference architecture.yaml cli: component cli cannot be changed: there is no docs/system/architecture.yaml');
  });

  it('T16 1 docs/system/ checks: zone of a part, ends of a link, duplicate ids, schema', () => {
    const root = join(mkdtempSync(join(tmpdir(), 'rehearse-sys-')), 'system');
    cpSync(join(CODE_GRAPH_REPO, 'docs/system'), root, { recursive: true });
    const arch = parse(readFileSync(join(root, 'architecture.yaml'), 'utf8'));
    arch.components.push({ id: 'panel', name: 'again', zone: 'mars' });
    arch.links.push({ from: 'panel', to: 'ghost' });
    arch.zones.push({ id: 'x', name: 'X', colour: 'red' });
    writeFileSync(join(root, 'architecture.yaml'), stringify(arch));
    expect(brief(validateSystem(root).findings)).toEqual([
      'reference docs/system/architecture.yaml link panel -> ghost: component ghost unknown',
      'reference docs/system/architecture.yaml panel: duplicate component id panel',
      'reference docs/system/architecture.yaml panel: zone mars unknown',
      'schema docs/system/architecture.yaml zones[4]: unknown field colour',
    ]);
  });

  it('T16 1 a missing docs/system/ is no finding: the system has no as-is yet', () => {
    expect(validateSystem(join(tmpdir(), 'no-such-system-folder')).findings).toEqual([]);
    expect(loadSystem(join(tmpdir(), 'no-such-system-folder')).system.exists).toBe(false);
  });

  it('T16 1 a YAML syntax error in docs/system/ is a finding, not a throw', () => {
    const root = join(mkdtempSync(join(tmpdir(), 'rehearse-sys-')), 'system');
    cpSync(join(CODE_GRAPH_REPO, 'docs/system'), root, { recursive: true });
    writeFileSync(join(root, 'architecture.yaml'), 'zones: [\n');
    const r = validateSystem(root);
    expect(r.findings[0]?.file).toBe('docs/system/architecture.yaml');
    expect(r.findings[0]?.message).toMatch(/^yaml-syntax/);
  });

  it('T16 1 decision ids come from the bold ids of brainstorm.md lines', () => {
    expect(parseDecisionIds('# x\n- **D4 As-is**: a\n- **G13 Record links**: b\n  - **D19 Code**: c\nD20 is not a decision line\n')).toEqual(['D19', 'D4', 'G13']);
  });

  it('T19 a line with more ids (D2/D6/D12) gives each id', () => {
    expect(parseDecisionIds('- **D2/D6/D12 Relation**: a\n')).toEqual(['D12', 'D2', 'D6']);
  });

  it('T16 1 systemDirFor finds docs/system/ from an EPIC folder', () => {
    expect(systemDirFor('/r/docs/epics/2026-11-05-x')).toBe('/r/docs/system');
  });
});

describe('T16 1 as-is + change → to-be (pure)', () => {
  const change: ArchitectureChange = {
    version: 1,
    components: [
      { id: 'graph', change: 'added', name: '@rehearse/graph', zone: 'repo', why: ['G2'], stories: ['S1'] },
      { id: 'cli', change: 'changed', about: 'new · validate · find', why: ['G1'] },
      { id: 'old', change: 'removed', why: ['G9'] },
    ],
    links: [
      { from: 'cli', to: 'graph', change: 'added', label: 'find', why: ['G1'] },
      { from: 'cli', to: 'core', change: 'changed', label: 'uses, finds', why: ['G1'] },
    ],
  };

  it('T16 1 gives each part, link and zone a status and builds the to-be', () => {
    const c = applyArchitectureChange(ASIS, change);
    expect(c.parts.map((p) => `${p.status} ${p.id}`)).toEqual(['changed cli', 'same core', 'removed old', 'added graph']);
    expect(c.links.map((l) => `${l.status} ${l.from}->${l.to}`)).toEqual(['changed cli->core', 'removed cli->old', 'added cli->graph']);
    expect(c.zones.map((z) => `${z.status} ${z.id}`)).toEqual(['same repo']);
    expect(c.after?.components.map((p) => p.id)).toEqual(['cli', 'core', 'graph']);
    expect(c.after?.components[0]).toEqual({ id: 'cli', name: 'rehearse CLI', zone: 'repo', about: 'new · validate · find' });
    expect(c.after?.links).toEqual([
      { from: 'cli', to: 'core', label: 'uses, finds' },
      { from: 'cli', to: 'graph', label: 'find' },
    ]);
    expect(c.after?.notes).toEqual(ASIS.notes);
    expect(c.before).toBe(ASIS);
  });

  it('T16 1 says what changes when the change does not, and a link to a removed part goes with it', () => {
    const c = applyArchitectureChange(ASIS, change);
    expect(c.parts[0]!.what).toBe('about: new · validate → new · validate · find');
    expect(c.links[0]!.what).toBe('label: uses → uses, finds');
    expect(c.links[1]).toMatchObject({ status: 'removed', why: ['G9'], what: 'goes with old' });
    expect(c.parts[3]).toMatchObject({ why: ['G2'], stories: ['S1'] });
  });

  it('T16 1 does not change its inputs', () => {
    const asIs = structuredClone(ASIS);
    const ch = structuredClone(change);
    applyArchitectureChange(asIs, ch);
    expect(asIs).toEqual(ASIS);
    expect(ch).toEqual(change);
  });

  it('T16 1 with no as-is the change is the whole to-be; with neither there is no to-be', () => {
    const c = applyArchitectureChange(undefined, change);
    expect(c.before).toBeUndefined();
    expect(c.parts.map((p) => `${p.status} ${p.id}`)).toEqual(['added graph']);
    expect(applyArchitectureChange(undefined, undefined).after).toBeUndefined();
    expect(applyArchitectureChange(ASIS, undefined).parts.every((p) => p.status === 'same')).toBe(true);
  });

  it('T16 1 flow: boxes of the EPIC are added, changed or same by path; a removal must be said', () => {
    const asIs = loadSystem(join(CODE_GRAPH_REPO, 'docs/system')).system.flow as Flow;
    const { record } = loadEpic(join(CODE_GRAPH_REPO, 'docs/epics/2026-11-05-code-graph'));
    const boxes = compareFlows(asIs, record.flow, record.architecture!.boxes);
    expect(boxes.map((b) => `${b.status} ${b.path}${b.inEpic ? '' : ' (not in EPIC)'}`)).toEqual([
      'same start',
      'added ask-context',
      'added check-freshness',
      'added rank-nodes',
      'added fill-budget',
      'changed draft-record',
      'same validate',
      'same done',
      'same sign-off (not in EPIC)',
      'removed grep-code',
    ]);
    const draft = boxes.find((b) => b.path === 'draft-record')!;
    expect(draft).toMatchObject({ what: 'in: + contextBundle', asIsStories: ['S2'], stories: ['S1'], why: ['G8'] });
    expect(boxes.find((b) => b.path === 'ask-context')!.what).toBe('in: target, budget → out: target, budget');
    expect(boxes.find((b) => b.path === 'grep-code')).toMatchObject({ title: 'Agent reads code with grep and cat', stories: ['S1'] });
  });

  it('T16 1 entities: added, changed (fields in words) and same', () => {
    const asIs = loadSystem(join(CODE_GRAPH_REPO, 'docs/system')).system.entities;
    const { record } = loadEpic(join(CODE_GRAPH_REPO, 'docs/epics/2026-11-05-code-graph'));
    const ents = compareEntities(asIs, record.entities, record.architecture!.entities);
    expect(ents.map((e) => `${e.status} ${e.id}: ${e.what ?? ''}`)).toEqual([
      'added GraphNode: edge trust: exact · name-match · unresolved',
      'added Edge: from, to, trust',
      'changed Box: fields: + code',
      'same Story: ',
    ]);
  });

  it('T16 1 compareSystem: counts match page 11 (2 added, 4 changed, 5 same parts; page 11 does not draw CI)', () => {
    const { record } = loadEpic(join(CODE_GRAPH_REPO, 'docs/epics/2026-11-05-code-graph'));
    const c = compareSystem(record.system, record);
    expect(c.hasSystem && c.hasChange).toBe(true);
    expect(c.asIsEpic).toBe('2026-11-05-rehearse');
    const parts = c.architecture.parts.filter((p) => (p.after ?? p.before)!.kind !== 'person' && p.id !== 'ci');
    expect(countDiffs(parts)).toEqual({ added: 2, changed: 4, same: 5, removed: 0 });
    expect(parts.filter((p) => p.status === 'same').map((p) => p.id)).toEqual(['panel', 'host', 'gate', 'core', 'source']);
    expect(countDiffs(c.architecture.links)).toEqual({ added: 5, changed: 0, same: 9, removed: 0 });
  });

  it('T16 1 compareSystem without a change compares nothing in the flow', () => {
    const c = compareSystem(loadSystem(REAL_SYSTEM).system, loadEpic(REAL_EPIC).record);
    expect(c.hasChange).toBe(false);
    expect(c.boxes).toEqual([]);
    expect(c.flowEdges).toEqual([]);
    expect(c.architecture.parts.every((p) => p.status === 'same')).toBe(true);
  });
});

describe('T42 1 flow edges of the before / after', () => {
  const box = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, kind: 'process', lane: 'agent', ...extra });
  const flow = (boxes: unknown[], edges: unknown[]): Flow => ({ version: 1, epic: 'x', lanes: [{ role: 'agent', order: 1 }], root: { boxes, edges } }) as unknown as Flow;
  const line = (e: { status: string; diagram: string; from: string; to: string; after?: { label?: string }; before?: { label?: string } }) =>
    `${e.status} ${e.diagram ? `[${e.diagram}] ` : ''}${e.from}->${e.to}${(e.after ?? e.before)?.label ? ` ${(e.after ?? e.before)!.label}` : ''}`;

  it('T42 1 same, added and removed by diagram, ends and label; an as-is edge the EPIC does not draw stays', () => {
    const asIs = flow([box('a'), box('b'), box('c'), box('d')], [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }]);
    const epic = flow([box('a'), box('b'), box('c'), box('n')], [{ from: 'a', to: 'b' }, { from: 'a', to: 'n' }, { from: 'n', to: 'c' }]);
    expect(compareFlowEdges(asIs, epic).map(line)).toEqual(['same a->b', 'added a->n', 'added n->c', 'removed b->c', 'same c->d']);
  });

  it('T42 1 a new label or kind on the same ends is a change, said in words; two branches of one check stay apart', () => {
    const asIs = flow([box('q', { kind: 'decision' }), box('y'), box('z')], [{ from: 'q', to: 'y', label: 'yes', kind: 'branch' }, { from: 'q', to: 'z', label: 'no', kind: 'branch' }, { from: 'y', to: 'z' }]);
    const epic = flow([box('q', { kind: 'decision' }), box('y'), box('z')], [{ from: 'q', to: 'y', label: 'ok', kind: 'branch' }, { from: 'q', to: 'z', label: 'no', kind: 'branch' }, { from: 'y', to: 'z', label: 'late', kind: 'error' }, { from: 'y', to: 'z' }]);
    const edges = compareFlowEdges(asIs, epic);
    expect(edges.map(line)).toEqual(['changed q->y ok', 'same q->z no', 'added y->z late', 'same y->z']);
    expect(edges[0]!.what).toBe('label: yes → ok');
    expect(edges[0]!.before).toEqual({ from: 'q', to: 'y', label: 'yes', kind: 'branch' });
  });

  it('T42 1 nested edges carry the path of their box; an edge to a removed box goes with it', () => {
    const kids = (edges: unknown[], extra: unknown[] = []) => ({ boxes: [box('s1'), box('s2'), ...extra], edges });
    const asIs = flow([box('p', { children: kids([{ from: 's1', to: 's2' }], [box('s3')]) }), box('old')], [{ from: 'p', to: 'old' }]);
    const epic = flow([box('p', { children: kids([{ from: 's1', to: 's2', label: 'ids' }, { from: 's2', to: 's4' }], [box('s4')]) })], []);
    const edges = compareFlowEdges(asIs, epic, [{ path: 'old', change: 'removed', why: ['G9'], stories: ['S2'] }]);
    expect(edges.map(line)).toEqual(['removed p->old', 'changed [p] p/s1->p/s2 ids', 'added [p] p/s2->p/s4']);
    expect(edges[0]).toMatchObject({ what: 'goes with old', why: ['G9'], stories: ['S2'] });
    expect(edges[0]!.after).toBeUndefined();
  });

  it('T42 1 with no as-is flow every edge of the EPIC is added; with no EPIC flow every as-is edge stays', () => {
    const f = flow([box('a'), box('b')], [{ from: 'a', to: 'b', label: 'go' }]);
    expect(compareFlowEdges(undefined, f).map(line)).toEqual(['added a->b go']);
    expect(compareFlowEdges(f, undefined).map(line)).toEqual(['same a->b go']);
    expect(compareFlowEdges(undefined, undefined)).toEqual([]);
  });

  it('T42 1 compareSystem: the code-graph fixture keeps, adds and redraws edges', () => {
    const { record } = loadEpic(join(CODE_GRAPH_REPO, 'docs/epics/2026-11-05-code-graph'));
    const c = compareSystem(record.system, record);
    expect(c.flowEdges.map(line)).toEqual([
      'added start->ask-context',
      'added ask-context->check-freshness target, budget',
      'added check-freshness->rank-nodes',
      'added rank-nodes->fill-budget',
      'added fill-budget->draft-record contextBundle',
      'same draft-record->validate epicDir',
      'added validate->done',
      'removed start->draft-record',
      'same validate->sign-off',
      'same sign-off->done',
    ]);
  });
});

describe('T16 5 data: docs/system/architecture.yaml for rehearse v1', () => {
  it('T16 5 validates with no findings', () => {
    expect(brief(validateSystem(REAL_SYSTEM).findings)).toEqual([]);
  });

  it('T16 5 every code path is in the repo, and every package is a part', () => {
    const arch = loadSystem(REAL_SYSTEM).system.architecture!;
    const paths = arch.components.flatMap((c) => c.code ?? []);
    for (const p of paths) expect(existsSync(join(REPO_ROOT, p)), p).toBe(true);
    // A package that an open EPIC adds (`change: added`) is a part of the system once that EPIC lands.
    const epics = join(REPO_ROOT, 'docs/epics');
    const added = readdirSync(epics)
      .map((e) => join(epics, e, 'architecture.yaml'))
      .filter((f) => existsSync(f))
      .flatMap((f) => ((parse(readFileSync(f, 'utf8')) as { components?: Array<{ change?: string; code?: string[] }> }).components ?? []))
      .filter((c) => c.change === 'added')
      .flatMap((c) => c.code ?? []);
    const packages = readdirSync(join(REPO_ROOT, 'packages')).filter((n) => existsSync(join(REPO_ROOT, 'packages', n, 'package.json')));
    for (const n of packages) expect([...paths, ...added].some((p) => p.startsWith(`packages/${n}/`)), `packages/${n}`).toBe(true);
  });

  it('T16 5 the rehearse EPIC still validates as before with docs/system/ present', () => {
    const before = validateRecord(loadEpic(REAL_EPIC));
    expect(loadEpic(REAL_EPIC).record.system).toBeUndefined();
    expect(before.findings.filter((f) => f.file === 'architecture.yaml')).toEqual([]);
  });
});
