// T12, the story thread panel: the bb JSON parsers (fixtures captured from a real thread), the
// link file, the brief, earlier work from Flow-Box trailers, and the routes. Every git and bb call
// goes to a fake runner: no test touches the real repo or bb.

import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadEpic } from '@rehearse/core';
import { makeEpic, SHOP } from '../../core/test/helpers.js';
import {
  briefPrompt,
  composeMessage,
  earlierWork,
  newToken,
  parseFlowBoxLog,
  parseSpawn,
  parseStoryThreads,
  parseTell,
  parseThreadLog,
  parseThreadShow,
  processRunner,
  startServer,
  statusWords,
  storyBrief,
  STORY_THREADS_FILE,
  type RunResult,
  type Runner,
  type RunningServer,
  type ServerSession,
} from '../src/index.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('T12 bb JSON parsers (real output)', () => {
  it('T12 2 reads the thread status and title from bb thread show --json', () => {
    expect(parseThreadShow(fixture('bb-thread-show.json'))).toEqual({
      ok: true,
      value: {
        id: 'thr_sz8f4bedm4',
        status: 'active',
        title: 'Implement collapsible story thread panel',
        projectId: 'proj_np45qbzf4r',
        updatedAt: 1793886954664,
        branch: 'bb/implement-collapsible-story-thread-panel-thr_sz8f4bedm4',
      },
    });
  });

  it('T12 2 reads user and agent messages from bb thread log --json, oldest first, and skips other events', () => {
    const page = parseThreadLog(fixture('bb-thread-log.json'));
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.lastSeq).toBe(74);
    expect(page.value.events).toBe(10);
    expect(page.value.messages.map((m) => [m.seq, m.from])).toEqual([
      [1, 'you'],
      [60, 'agent'],
      [74, 'agent'],
    ]);
    expect(page.value.messages[0]!.text).toContain('# T12: the story thread panel');
    expect(page.value.messages[1]).toMatchObject({ text: 'Now the bb plugin and the bb CLI.', at: 1793886976861 });
  });

  it('T12 2 a message from another thread names the sender', () => {
    const log = JSON.stringify([
      { seq: 3, type: 'client/turn/requested', createdAt: 5, data: { initiator: 'agent', senderThreadId: 'thr_parent1', input: [{ type: 'text', text: 'hi' }] } },
    ]);
    const page = parseThreadLog(log);
    expect(page.ok && page.value.messages).toEqual([{ seq: 3, from: 'thread', senderThreadId: 'thr_parent1', at: 5, text: 'hi' }]);
  });

  it('T12 4 bb errors ({ ok: false }) and broken output are errors, not threads', () => {
    expect(parseThreadShow(fixture('bb-error.json'))).toEqual({ ok: false, error: 'HTTP 404: Thread not found' });
    expect(parseThreadLog(fixture('bb-error.json'))).toEqual({ ok: false, error: 'HTTP 404: Thread not found' });
    expect(parseThreadShow('Error: no server').ok).toBe(false);
    expect(parseThreadShow('{"thread":{"id":"not a thread"}}').ok).toBe(false);
  });

  it('T12 1 reads the new thread from bb thread spawn --json, and tell answers', () => {
    expect(parseSpawn(fixture('bb-thread-spawn.json'))).toMatchObject({ ok: true, value: { id: 'thr_newstory1' } });
    expect(parseTell(fixture('bb-thread-tell.json'))).toEqual({ ok: true, value: null });
    expect(parseTell(fixture('bb-error.json')).ok).toBe(false);
  });

  it('T12 2 says the status in words', () => {
    expect(statusWords('idle')).toBe('idle');
    expect(statusWords('active')).toBe('working');
    expect(statusWords('failed')).toBe('failed');
    expect(statusWords('needs_input')).toBe('needs input');
  });
});

describe('T12 link file, brief and earlier work', () => {
  it('T12 1 keeps only story id → thr_ id entries from the link file', () => {
    expect(parseStoryThreads('{"e":{"S1":"thr_abc","S2":"nope","S3":5},"f":[],"g":{}}')).toEqual({ e: { S1: { thread: 'thr_abc' } } });
    expect(parseStoryThreads('not json')).toEqual({});
  });

  it('T12 2 the brief has the story, the boxes that serve it (a parent serves its children\'s stories) and the scenarios', () => {
    const brief = storyBrief(loadEpic(SHOP).record, 'S2')!;
    expect(brief.storyId).toBe('S2');
    expect(brief.want).toBe('to ship paid orders');
    expect(brief.boxes.map((b) => b.path)).toEqual(['ship']);
    expect(brief.scenarios.length).toBeGreaterThan(0);
    expect(storyBrief(loadEpic(SHOP).record, 'S9')).toBeUndefined();
    expect(briefPrompt(brief)).toContain('I want to ship paid orders');
  });

  it('T12 2 puts the context line on top of a sent message', () => {
    expect(composeMessage('Why?', 'approve · write.ts diff')).toBe('Context: approve · write.ts diff\n\nWhy?');
    expect(composeMessage('Why?', '  ')).toBe('Why?');
  });

  it('T12 2 earlier work: threads named in commits whose Flow-Box trailers name a box of the story', () => {
    const log = [
      ['aaaaaaa1111', 'Sign approvals', 'Sign approvals\n\nThread: thr_iayeg6das6\nFlow-Box: approve sign-off\n'],
      ['bbbbbbb2222', 'Gate report', 'Gate report\n\nFlow-Box: gate/report\nthr_ncedfwrufr did it\n'],
      ['ccccccc3333', 'No thread', 'No thread\n\nFlow-Box: approve\n'],
      ['ddddddd4444', 'Other box', 'Other box\n\nFlow-Box: review thr_other1\n'],
    ]
      .map((c) => c.join('\x1f'))
      .join('\x1e\n');
    const commits = parseFlowBoxLog(log);
    expect(commits[0]).toEqual({ sha: 'aaaaaaa1111', subject: 'Sign approvals', boxes: ['approve', 'sign-off'], threads: ['thr_iayeg6das6'] });
    expect(earlierWork(commits, ['approve', 'gate'])).toEqual([
      { threadId: 'thr_iayeg6das6', subject: 'Sign approvals', sha: 'aaaaaaa', boxes: ['approve'] },
      { threadId: 'thr_ncedfwrufr', subject: 'Gate report', sha: 'bbbbbbb', boxes: ['gate/report'] },
    ]);
    expect(earlierWork(commits, ['approve'], 'thr_iayeg6das6')).toEqual([]);
  });
});

// ---------------------------------------------------------------- routes, with a fake runner

interface Call {
  command: 'git' | 'bb';
  args: string[];
  input?: string;
}

function fakeRunner(repo: string, bb: (args: string[]) => RunResult | 'missing'): { run: Runner; calls: Call[] } {
  const calls: Call[] = [];
  const run: Runner = async (command, args, opts) => {
    calls.push({ command, args, ...(opts.input !== undefined ? { input: opts.input } : {}) });
    if (command === 'git') {
      if (args[0] === 'rev-parse') return { code: 0, stdout: `${repo}\n`, stderr: '' };
      return { code: 0, stdout: ['abcdef1234', 'Ship it', 'Ship it\n\nFlow-Box: ship\nThread: thr_shipper1\n'].join('\x1f') + '\x1e', stderr: '' };
    }
    const r = bb(args);
    return r === 'missing' ? { code: -1, stdout: '', stderr: '', spawnError: 'spawn bb ENOENT' } : r;
  };
  return { run, calls };
}

const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: '' });

function happyBb(args: string[]): RunResult {
  if (args[1] === 'show') return ok(fixture('bb-thread-show.json').replace(/"status": "active"/, '"status": "idle"'));
  if (args[1] === 'log') return ok(fixture('bb-thread-log.json'));
  if (args[1] === 'spawn') return ok(fixture('bb-thread-spawn.json'));
  if (args[1] === 'tell') return ok(fixture('bb-thread-tell.json'));
  if (args[1] === 'open') return ok('{"ok":true}');
  return { code: 1, stdout: '', stderr: 'unknown' };
}

let running: RunningServer | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

async function serve(bb: (args: string[]) => RunResult | 'missing' = happyBb) {
  const epicDir = makeEpic();
  const repo = mkdtempSync(join(tmpdir(), 'rehearse-repo-'));
  const fake = fakeRunner(repo, bb);
  const session: ServerSession = { token: newToken(), identity: { by: 'me@example.com' }, signer: { ok: false, reason: 'off' } };
  running = await startServer({ epicDir, uiDir: mkdtempSync(join(tmpdir(), 'rehearse-ui-')), port: 0, session, run: fake.run, bbProject: 'proj_abc' });
  const url = running.url;
  const headers = { 'x-rehearse-token': session.token };
  const get = (story: string, h: Record<string, string> = headers) => fetch(new URL(`api/story-thread?story=${encodeURIComponent(story)}`, url), { headers: h });
  const post = (path: string, body: unknown, h: Record<string, string> = headers) =>
    fetch(new URL(`api/story-thread/${path}`, url), { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) });
  const linkFile = join(repo, STORY_THREADS_FILE);
  return { get, post, headers, calls: fake.calls, linkFile, slug: '2026-11-05-shop' };
}

describe('T12 story thread routes', () => {
  it('T12 1 every route needs the session token and a same-origin Origin', async () => {
    const s = await serve();
    expect((await s.get('S1', {})).status).toBe(403);
    expect((await s.get('S1', { 'x-rehearse-token': 'wrong' })).status).toBe(403);
    for (const path of ['link', 'start', 'send', 'open']) {
      expect((await s.post(path, { story: 'S1' }, {})).status).toBe(403);
    }
    expect(s.calls.filter((c) => c.command === 'bb')).toEqual([]);
  });

  it('T12 1 refuses a cross-origin request', async () => {
    const s = await serve();
    expect((await s.post('start', { story: 'S1' }, { ...s.headers, origin: 'http://evil.example' })).status).toBe(403);
    expect((await s.get('S1', { ...s.headers, origin: 'http://evil.example' })).status).toBe(403);
    expect(s.calls.filter((c) => c.command === 'bb')).toEqual([]);
  });

  it('T12 1 checks story ids against the EPIC and thread ids against ^thr_[A-Za-z0-9]+$', async () => {
    const s = await serve();
    expect((await s.get('S9')).status).toBe(404);
    expect((await s.get('../etc')).status).toBe(400);
    expect((await s.post('link', { story: 'S1', threadId: 'thr_x; rm -rf /' })).status).toBe(400);
    expect((await s.post('link', { story: 'S9', threadId: 'thr_abc' })).status).toBe(404);
    expect(existsSync(s.linkFile)).toBe(false);
  });

  it('T12 1 no thread yet: the view has the brief, no thread, and earlier work', async () => {
    const s = await serve();
    const body = await (await s.get('S2')).json();
    expect(body).toMatchObject({ threadId: null, bb: null, messages: [], brief: { storyId: 'S2', boxes: [{ path: 'ship' }] } });
    expect(body.earlier).toEqual([{ threadId: 'thr_shipper1', subject: 'Ship it', sha: 'abcdef1', boxes: ['ship'] }]);
    expect(s.calls.filter((c) => c.command === 'bb')).toEqual([]);
  });

  it('T12 1 link a thread: the link goes to .rehearse/story-threads.json by EPIC slug and story id, not to the record', async () => {
    const s = await serve();
    const res = await s.post('link', { story: 'S1', threadId: 'thr_sz8f4bedm4' });
    expect(res.status).toBe(200);
    expect(JSON.parse(readFileSync(s.linkFile, 'utf8'))).toEqual({ [s.slug]: { S1: 'thr_sz8f4bedm4' } });
    const body = await res.json();
    expect(body.threadId).toBe('thr_sz8f4bedm4');
    expect(body.bb).toMatchObject({ ok: true, status: 'idle', statusText: 'idle', title: 'Implement collapsible story thread panel' });
    expect(body.messages.map((m: { from: string }) => m.from)).toEqual(['you', 'agent', 'agent']);
  });

  it('T12 2 polling reads only new events (--after-seq)', async () => {
    const s = await serve();
    await s.post('link', { story: 'S1', threadId: 'thr_sz8f4bedm4' });
    await s.get('S1');
    const logs = s.calls.filter((c) => c.command === 'bb' && c.args[1] === 'log').map((c) => c.args);
    expect(logs[0]).toEqual(['thread', 'log', 'thr_sz8f4bedm4', '--json', '--limit', '200']);
    expect(logs[1]).toEqual(['thread', 'log', 'thr_sz8f4bedm4', '--json', '--limit', '200', '--after-seq', '74']);
  });

  it('T12 1 start a thread: spawns one in the EPIC project with the brief on stdin, and links it', async () => {
    const s = await serve();
    const res = await s.post('start', { story: 'S1' });
    expect(res.status).toBe(200);
    const spawn = s.calls.find((c) => c.args[1] === 'spawn')!;
    expect(spawn.args).toEqual(['thread', 'spawn', '--json', '--prompt-file', '-', '--title', 'S1 · to pay for my cart', '--project', 'proj_abc']);
    expect(spawn.input).toContain('Story thread for S1 of the EPIC 2026-11-05-shop');
    expect(JSON.parse(readFileSync(s.linkFile, 'utf8'))).toEqual({ [s.slug]: { S1: { thread: 'thr_newstory1', kind: 'question', at: expect.any(String) } } });
    expect((await s.post('start', { story: 'S1' })).status).toBe(409);
  });

  it('T12 2 send: the text with the context line on top goes to the story thread on stdin', async () => {
    const s = await serve();
    expect((await s.post('send', { story: 'S1', text: 'Why?' })).status).toBe(409);
    await s.post('link', { story: 'S1', threadId: 'thr_sz8f4bedm4' });
    expect((await s.post('send', { story: 'S1', text: '   ' })).status).toBe(400);
    const res = await s.post('send', { story: 'S1', text: 'Why does approve return early?', context: 'approve · write.ts diff' });
    expect(res.status).toBe(200);
    const tell = s.calls.find((c) => c.args[1] === 'tell')!;
    expect(tell.args).toEqual(['thread', 'tell', 'thr_sz8f4bedm4', '--message-file', '-', '--json']);
    expect(tell.input).toBe('Context: approve · write.ts diff\n\nWhy does approve return early?');
  });

  it('T12 2 open runs bb thread open for the story thread', async () => {
    const s = await serve();
    await s.post('link', { story: 'S1', threadId: 'thr_sz8f4bedm4' });
    expect((await s.post('open', { story: 'S1' })).status).toBe(200);
    expect(s.calls.find((c) => c.args[1] === 'open')!.args).toEqual(['thread', 'open', 'thr_sz8f4bedm4', '--json']);
  });

  it('T12 4 no bb: the view keeps the thread id and says why, and start and send fail in words', async () => {
    const s = await serve(() => 'missing');
    await s.post('link', { story: 'S1', threadId: 'thr_sz8f4bedm4' });
    const body = await (await s.get('S1')).json();
    expect(body.threadId).toBe('thr_sz8f4bedm4');
    expect(body.bb).toEqual({ ok: false, error: 'bb is not available here (spawn bb ENOENT)' });
    expect(body.messages).toEqual([]);
    const sent = await s.post('send', { story: 'S1', text: 'hi' });
    expect(sent.status).toBe(502);
    expect((await sent.json()).error).toContain('bb is not available');
    await running!.close();
    const s2 = await serve(() => ({ code: 1, stdout: fixture('bb-error.json'), stderr: 'Error: HTTP 404' }));
    await s2.post('link', { story: 'S1', threadId: 'thr_gone' });
    expect((await (await s2.get('S1')).json()).bb).toEqual({ ok: false, error: 'HTTP 404: Thread not found' });
  });
});

describe('T12 the process runner', () => {
  it('T12 4 a program that is not on PATH is a spawn error, not a crash', async () => {
    const r = await processRunner({ PATH: '/nonexistent' })('bb', ['thread', 'show', 'thr_x', '--json'], { cwd: tmpdir() });
    expect(r.spawnError).toBeDefined();
  });

  it('T12 2 runs with an argument array and passes input on stdin', async () => {
    const r = await processRunner()('git', ['hash-object', '--stdin'], { cwd: tmpdir(), input: 'a; $(rm -rf /)\n' });
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^[0-9a-f]{40}$/);
  });
});
