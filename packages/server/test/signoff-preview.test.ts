// T39, box `sign-off`: GET /api/sign-off/preview. Per story the rule-2 content a sign-off covers,
// and what changed since its last sign-off, read from the commit that added the sign-off entry.
// Temp git repos with throwaway keys; never the real EPICs' git history.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeEpic } from '../../core/test/helpers.js';
import { editYaml, signedEpic } from '../../core/test/trust/helpers.js';
import { KEY, VERIFIER } from '../../core/test/trust/keys.js';
import { execGit, newToken, signOffPreview, startServer, type GitRunner, type RunningServer, type SinceSignOff } from '../src/index.js';

const UI = mkdtempSync(join(tmpdir(), 'rehearse-ui-'));

let running: RunningServer | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' });
}

function commitAll(epicDir: string, message: string): void {
  const repo = dirname(epicDir);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', message);
}

/** Shop signed off (S1, S2) and committed. */
function committedSignedEpic(): string {
  const dir = signedEpic();
  commitAll(dir, 'sign off S1 and S2');
  return dir;
}

async function since(dir: string, id: string, run: GitRunner = execGit): Promise<SinceSignOff | undefined> {
  const p = await signOffPreview(run, dir, [id]);
  return p.stories[0]!.since;
}

describe('T39 sign-off preview: what changed since the last sign-off', () => {
  it('never signed: first sign-off of the story, with the content to agree to', async () => {
    const dir = makeEpic();
    const p = await signOffPreview(execGit, dir, ['S1', 'S9']);
    expect(p.stories[0]).toMatchObject({ id: 'S1', found: true, since: { kind: 'first' }, counts: { requirements: 1, criteria: 1, scenarios: 2, boxes: 2 } });
    expect(p.stories[0]!.content!.criteria[0]!.then).toBe('the order is shipped');
    expect(p.stories[1]).toEqual({ id: 'S9', found: false });
  });

  it('signed and unchanged: no change since the sign-off, with its date', async () => {
    const dir = committedSignedEpic();
    expect(await since(dir, 'S1')).toEqual({ kind: 'unchanged', at: '2026-11-05T10:00:00Z', by: 'a@b.c', hashRule: 3 });
  });

  it('a criterion edited after the committed sign-off: the change, against the sign-off commit, exact', async () => {
    const dir = committedSignedEpic();
    const sha = git(dirname(dir), 'rev-parse', 'HEAD').trim();
    // A later commit that does not touch signoff.yaml, then an edit in the working tree.
    writeFileSync(join(dirname(dir), 'notes.txt'), 'later\n');
    commitAll(dir, 'unrelated');
    editYaml(dir, 'prd.yaml', (doc) => doc.setIn(['stories', 0, 'acceptance', 0, 'then'], 'the order is paid and shipped'));
    const s = await since(dir, 'S1');
    expect(s).toMatchObject({ kind: 'changed', at: '2026-11-05T10:00:00Z', by: 'a@b.c', exact: true, commit: { sha, subject: 'sign off S1 and S2' } });
    if (s?.kind !== 'changed') throw new Error('not changed');
    expect(s.changes).toMatchObject([{ part: 'criterion', id: 'S1-A1', field: 'then', before: 'the order is shipped', after: 'the order is paid and shipped' }]);
    // S2 does not use that criterion.
    expect(await since(dir, 'S2')).toMatchObject({ kind: 'unchanged' });
  });

  it('a scenario removed and a box title changed, both committed after the sign-off', async () => {
    const dir = committedSignedEpic();
    editYaml(dir, 'scenarios/S1.yaml', (doc) => doc.deleteIn(['scenarios', 1]));
    editYaml(dir, 'flow.yaml', (doc) => doc.setIn(['root', 'boxes', 2, 'title'], 'Charge the card'));
    commitAll(dir, 'edit S1');
    const s = await since(dir, 'S1');
    if (s?.kind !== 'changed') throw new Error(`not changed: ${JSON.stringify(s)}`);
    expect(s.changes.map((c) => c.text)).toEqual(['scenario S1-empty removed', 'box pay: title changed']);
  });

  it('the sign-off of a later commit is the one compared: a second sign-off moves the "then" side', async () => {
    const dir = committedSignedEpic();
    editYaml(dir, 'prd.yaml', (doc) => doc.setIn(['stories', 1, 'want'], 'to ship every paid order'));
    commitAll(dir, 'edit S2');
    // S2 is stale; S1 still compares with the first commit.
    const s2 = await since(dir, 'S2');
    expect(s2).toMatchObject({ kind: 'changed', commit: { subject: 'sign off S1 and S2' } });
    if (s2?.kind !== 'changed') throw new Error('not changed');
    expect(s2.changes.map((c) => c.text)).toEqual(['story S2 "I want" changed']);
  });

  it('T62 a new change C1 after the sign-off: only the change is new, each change item is marked', async () => {
    const dir = committedSignedEpic();
    mkdirSync(join(dir, 'changes'));
    writeFileSync(
      join(dir, 'changes', 'C1.yaml'),
      [
        'id: C1',
        'story: S1',
        'title: The buyer pays with a gift card.',
        'why: Buyers ask for gift cards.',
        'criteria:',
        '  - { id: S1-A2, given: a gift card, when: the buyer pays, then: the order is shipped }',
        'scenarios:',
        '  - id: S1-c1-gift',
        '    title: Buyer pays with a gift card',
        '    status: draft',
        '    steps: [{ name: start }, { name: cart }, { name: pay }, { name: in-stock, branch: "yes" }, { name: ship/pack }, { name: ship/send }, { name: done }]',
        '    expect: { criterion: S1-A2, state: { Order.status: shipped } }',
        '',
      ].join('\n'),
    );
    commitAll(dir, 'add C1 to S1');
    const p = await signOffPreview(execGit, dir, ['S1']);
    const s1 = p.stories[0]!;
    expect(s1.content!.changes).toEqual([{ id: 'C1', title: 'The buyer pays with a gift card.', why: 'Buyers ask for gift cards.', file: 'changes/C1.yaml' }]);
    expect(s1.content!.criteria.map((c) => [c.id, c.change])).toEqual([
      ['S1-A1', undefined],
      ['S1-A2', 'C1'],
    ]);
    expect(s1.content!.scenarios.find((s) => s.id === 'S1-c1-gift')?.change).toBe('C1');
    expect(s1.since).toMatchObject({ kind: 'changed', newChanges: ['C1'], exact: true });
    if (s1.since?.kind !== 'changed') throw new Error('not changed');
    expect(s1.since.changes.map((c) => c.text)).toEqual(['criterion S1-A2 added', 'scenario S1-c1-gift added']);
  });

  it('git unavailable: says so and still shows the content; the request does not fail', async () => {
    const dir = committedSignedEpic();
    editYaml(dir, 'prd.yaml', (doc) => doc.setIn(['stories', 0, 'acceptance', 0, 'then'], 'the order is paid'));
    const noGit: GitRunner = async () => ({ ok: false, stdout: '', stderr: 'fatal: not a git repository' });
    const p = await signOffPreview(noGit, dir, ['S1']);
    expect(p.stories[0]!.since).toMatchObject({ kind: 'unavailable', at: '2026-11-05T10:00:00Z', reason: expect.stringContaining('not in a git repo') });
    expect(p.stories[0]!.content!.criteria[0]!.then).toBe('the order is paid');
    const throwing: GitRunner = async () => {
      throw new Error('spawn git ENOENT');
    };
    expect(await since(dir, 'S1', throwing)).toMatchObject({ kind: 'unavailable', reason: expect.stringContaining('ENOENT') });
  });

  it('a sign-off not committed yet: says the signed content is not in git', async () => {
    const dir = signedEpic();
    git(dirname(dir), 'commit', '-q', '--allow-empty', '-m', 'empty');
    editYaml(dir, 'prd.yaml', (doc) => doc.setIn(['stories', 0, 'want'], 'to pay'));
    expect(await since(dir, 'S1')).toMatchObject({ kind: 'unavailable', reason: expect.stringContaining('not in a commit yet') });
  });

  it('the record edited before the sign-off commit: the change list compares with that commit and says it is not exact', async () => {
    const dir = signedEpic();
    // An edit made after signing is committed together with the sign-off entry.
    editYaml(dir, 'prd.yaml', (doc) => doc.setIn(['stories', 0, 'want'], 'to pay now'));
    commitAll(dir, 'sign-off with a later edit');
    editYaml(dir, 'prd.yaml', (doc) => doc.setIn(['stories', 0, 'soThat'], 'I get my items fast'));
    const s = await since(dir, 'S1');
    expect(s).toMatchObject({ kind: 'changed', exact: false });
    if (s?.kind !== 'changed') throw new Error('not changed');
    expect(s.changes.map((c) => c.text)).toEqual(['story S1 "so that" changed']);
  });
});

describe('T39 GET /api/sign-off/preview', () => {
  const token = newToken();
  async function serve(dir: string): Promise<string> {
    running = await startServer({ epicDir: dir, uiDir: UI, port: 0, session: { token, identity: { by: 'a@b.c' }, signer: { ok: true, signer: KEY.signer } }, verifier: VERIFIER });
    return running.url;
  }

  it('answers with the token and a same-origin Origin; 403 without the token or from another Origin', async () => {
    const url = await serve(committedSignedEpic());
    const at = new URL('api/sign-off/preview?stories=S1,S2', url);
    expect((await fetch(at)).status).toBe(403);
    expect((await fetch(at, { headers: { 'x-rehearse-token': 'wrong' } })).status).toBe(403);
    expect((await fetch(at, { headers: { 'x-rehearse-token': token, origin: 'http://evil.example' } })).status).toBe(403);
    const ok = await fetch(at, { headers: { 'x-rehearse-token': token, origin: new URL(url).origin } });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.ok).toBe(true);
    expect(body.stories.map((s: { id: string; since: { kind: string } }) => [s.id, s.since.kind])).toEqual([
      ['S1', 'unchanged'],
      ['S2', 'unchanged'],
    ]);
  });

  it('400 for a missing or bad story list; only GET', async () => {
    const url = await serve(makeEpic());
    const headers = { 'x-rehearse-token': token };
    expect((await fetch(new URL('api/sign-off/preview', url), { headers })).status).toBe(400);
    expect((await fetch(new URL('api/sign-off/preview?stories=S1,../x', url), { headers })).status).toBe(400);
    expect((await fetch(new URL('api/sign-off/preview?stories=S1', url), { method: 'POST', headers })).status).toBe(405);
  });
});
