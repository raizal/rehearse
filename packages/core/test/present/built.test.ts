// T58 (S23, box box-evidence): honest "built". Each box is built (Flow-Box commits and/or code the
// code graph maps to it), needs no code of its own (start and end boxes; a decision only when a
// built neighbour branches on it), or is not built, and the words say what was looked for.

import { describe, expect, it } from 'vitest';
import {
  boxEvidence,
  branchLine,
  builtWords,
  countsBuilt,
  decisionTokens,
  isSourceFile,
  NO_GRAPH,
  trailerPath,
  type EpicRecord,
  type GraphBuilds,
  type GraphCode,
  type TrailerCommit,
} from '../../src/index.js';

const SLUG = '2026-11-05-demo';

/** A small plan: start → form → check (decision) → saved | rejected (end), and an orphan decision lonely. */
function record(): EpicRecord {
  return {
    dir: `/x/${SLUG}`,
    slug: SLUG,
    scenarioFiles: [],
    flow: {
      version: 1,
      epic: SLUG,
      root: {
        boxes: [
          { id: 'start', kind: 'start', title: 'Builder has an idea' },
          {
            id: 'form',
            kind: 'input',
            title: 'Fill the form',
            children: { boxes: [{ id: 'name', kind: 'input', title: 'Type a name' }, { id: 'email', kind: 'input', title: 'Type an email' }], edges: [{ from: 'name', to: 'email' }] },
          },
          { id: 'name-ok', kind: 'decision', title: 'Is the name ok?', inputs: { nameValid: 'boolean' } },
          { id: 'saved', kind: 'end', title: 'Saved' },
          { id: 'lonely', kind: 'decision', title: 'Lonely?' },
          { id: 'mail', kind: 'process', title: 'Send a mail' },
        ],
        edges: [
          { from: 'start', to: 'form' },
          { from: 'form', to: 'name-ok' },
          { from: 'name-ok', to: 'saved' },
          { from: 'lonely', to: 'mail' },
        ],
      },
    },
  } as unknown as EpicRecord;
}

const commit = (sha: string, boxes: string[], files: string[] = []): TrailerCommit => ({ sha, subject: `T1: ${sha}`, boxes, branch: 'main', files });
const NO = { ok: false, why: NO_GRAPH } as const satisfies GraphBuilds;
const graph = (builds: Record<string, GraphCode[]>): GraphBuilds => ({ ok: true, at: '2026-11-07T10:00:00Z', builds });

const FORM_TS = ['export function submit(f) {', '  // the name check lives here', '  if (!f.nameValid) return reject();', '  return save(f);', '}'].join('\n');
const files: Record<string, string> = { 'packages/ui/src/form.ts': FORM_TS, 'packages/ui/test/form.test.ts': 'if (nameValid) {}' };
const readFile = (f: string) => files[f];

const one = (paths: string[], commits: TrailerCommit[], g: GraphBuilds = NO) => boxEvidence({ record: record(), paths, commits, graph: g, readFile });

describe('trailerPath', () => {
  it('strips this EPIC folder, skips another EPIC, keeps a bare path', () => {
    expect(trailerPath(`${SLUG}/form/name`, SLUG)).toBe('form/name');
    expect(trailerPath('2026-11-05-other/form', SLUG)).toBeUndefined();
    expect(trailerPath('form', SLUG)).toBe('form');
  });
});

describe('isSourceFile', () => {
  it('keeps product code and leaves out tests, type declarations, docs and design', () => {
    expect(isSourceFile('packages/core/src/trust/readiness.ts')).toBe(true);
    expect(isSourceFile('tools/x.py')).toBe(true);
    for (const f of ['packages/core/test/a.test.ts', 'packages/ui/src/a.spec.tsx', 'packages/core/dist/a.d.ts', 'design/figcraft/build_design.py', 'docs/x.ts', 'scripts/a.ts', 'e2e/a.ts', 'tests/test_a.py', 'README.md'])
      expect(isSourceFile(f), f).toBe(false);
  });
});

describe('decisionTokens and branchLine', () => {
  it('squashes the id and two-word inputs', () => {
    expect(decisionTokens({ id: 'gate-ok', inputs: { readyNow: 'boolean', x: 'string' } })).toEqual(['gateok', 'readynow']);
  });
  it('finds a branching line that names a token, and skips comments and plain lines', () => {
    expect(branchLine(FORM_TS, ['namevalid'])).toEqual({ line: 3, text: 'if (!f.nameValid) return reject();' });
    expect(branchLine('// if nameValid\nconst nameValid = 1;', ['namevalid'])).toBeUndefined();
  });
});

describe('boxEvidence', () => {
  it('built by a Flow-Box commit, named in words', () => {
    const [ev] = one(['mail'], [commit('a1', [`${SLUG}/mail`])]);
    expect(ev!.state).toBe('built');
    expect(ev!.commits.map((c) => c.sha)).toEqual(['a1']);
    expect(ev!.text).toBe('built: 1 Flow-Box commit');
  });

  it('built by the code graph only, with its files and symbols, product code first', () => {
    const [ev] = one(['mail'], [], graph({ mail: [{ file: 'packages/core/test/mail.test.ts' }, { file: 'packages/core/src/mail.ts', symbol: 'sendMail', line: 4 }] }));
    expect(ev!.state).toBe('built');
    expect(ev!.commits).toEqual([]);
    expect(ev!.text).toBe('built: code the graph maps to it: packages/core/src/mail.ts (sendMail), packages/core/test/mail.test.ts');
  });

  it('built by both, and a child commit counts for its parent', () => {
    const [ev] = one(['form'], [commit('b1', ['form/name']), commit('b2', ['form'])], graph({ 'form/email': [{ file: 'packages/ui/src/form.ts' }] }));
    expect(ev!.state).toBe('built');
    expect(ev!.text).toBe('built: 2 Flow-Box commits; code the graph maps to it: packages/ui/src/form.ts');
  });

  it('a parent trailer does not make its children built, and says so', () => {
    const [ev] = one(['form/email'], [commit('c1', ['form']), commit('c2', ['form'])]);
    expect(ev!.state).toBe('not-built');
    expect(ev!.text).toContain('2 commits name only its parent form, which does not say this box is built');
  });

  it('a start or end box needs no code of its own', () => {
    const [s, e] = one(['start', 'saved'], []);
    expect([s!.state, s!.text]).toEqual(['no-code', 'no code of its own: a start box']);
    expect([e!.state, e!.text]).toEqual(['no-code', 'no code of its own: an end box']);
    expect(countsBuilt(e!)).toBe(true);
  });

  it('a decision whose branch is in a built neighbour names the neighbour, file and line', () => {
    const [ev] = one(['name-ok'], [commit('d1', ['form'], ['packages/ui/src/form.ts', 'packages/ui/test/form.test.ts'])]);
    expect(ev!.state).toBe('no-code');
    expect(ev!.branch).toEqual({ neighbour: 'form', file: 'packages/ui/src/form.ts', line: 3, text: 'if (!f.nameValid) return reject();', via: 'commits' });
    expect(ev!.text).toBe('no code of its own: its branch is in the built box form, packages/ui/src/form.ts:3 (a file of its Flow-Box commits)');
  });

  it('the graph code of a neighbour is read before its commit files', () => {
    const [ev] = one(['name-ok'], [], graph({ form: [{ file: 'packages/ui/src/form.ts', symbol: 'submit' }] }));
    expect(ev!.branch?.via).toBe('graph');
    expect(ev!.text).toContain('(code the graph maps to it)');
  });

  it('a decision whose built neighbour does not branch on it is not built', () => {
    const [ev] = boxEvidence({ record: record(), paths: ['name-ok'], commits: [commit('e1', ['form'], ['packages/ui/src/form.ts'])], graph: NO, readFile: () => 'export const x = 1;' });
    expect(ev!.state).toBe('not-built');
    expect(ev!.text).toContain('the code of its built neighbours (form) has no branch on "nameok" or "namevalid"');
    expect(countsBuilt(ev!)).toBe(false);
  });

  it('a decision with no built neighbour is not built, and the neighbours are named', () => {
    const [ev] = one(['lonely'], []);
    expect(ev!.state).toBe('not-built');
    expect(ev!.text).toContain('none of its neighbours (mail) is built');
  });

  it('nothing: says what was looked for, with and without the code graph', () => {
    expect(one(['mail'], [])[0]!.text).toBe(`not built: no Flow-Box commit names it or a box inside it; ${NO_GRAPH}`);
    expect(one(['mail'], [], graph({}))[0]!.text).toBe('not built: no Flow-Box commit names it or a box inside it, and the code graph maps no code to it');
  });

  it("another EPIC's trailer does not count", () => {
    expect(one(['mail'], [commit('f1', ['2026-11-05-other/mail'])])[0]!.state).toBe('not-built');
  });
});

describe('builtWords', () => {
  it('says all of them or how many are left', () => {
    expect(builtWords(8, 8)).toBe('8 of 8 boxes');
    expect(builtWords(1, 1)).toBe('1 of 1 box');
    expect(builtWords(6, 8)).toBe('6 of 8 — 2 left');
    expect(builtWords(0, 0)).toBe('nothing planned');
  });
});
