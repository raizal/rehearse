// One bb thread per story (T12). The link story → thread is local state, not record: a record
// field would change the story hash. It lives in `<repo>/.rehearse/story-threads.json`:
// `{ "<epic slug>": { "<story id>": "thr_…" } }`. The repo ignores that file: a thread id only
// means something to the bb install that made it.
//
// Every `git` and `bb` call goes through a Runner (argument arrays, no shell), so tests use a
// fake and never the real repo or bb. Text for bb goes on stdin (`--message-file -`).

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEpic, type Box, type Diagram, type EpicRecord, type Id } from '@rehearse/core';
import { parseSpawn, parseTell, parseThreadLog, parseThreadShow, statusWords, THREAD_ID, type ThreadMessage } from './bb-json.js';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  /** The program could not start (not on PATH). */
  spawnError?: string;
}

export interface RunOptions {
  cwd: string;
  /** Written to stdin, then stdin is closed. */
  input?: string;
}

/** Runs `git` or `bb` with an argument array. */
export type Runner = (command: 'git' | 'bb', args: string[], opts: RunOptions) => Promise<RunResult>;

/** Output kept per stream. */
const OUTPUT_LIMIT = 8 * 1024 * 1024;

/** The real runner: spawn, no shell, a time limit. */
export function processRunner(env: NodeJS.ProcessEnv = process.env, timeoutMs = 20_000): Runner {
  return (command, args, opts) =>
    new Promise((resolve) => {
      let child;
      try {
        child = spawn(command, args, { cwd: opts.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (e) {
        resolve({ code: -1, stdout: '', stderr: '', spawnError: e instanceof Error ? e.message : String(e) });
        return;
      }
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      let size = 0;
      const keep = (into: Buffer[]) => (b: Buffer) => {
        size += b.length;
        if (size <= OUTPUT_LIMIT) into.push(b);
      };
      child.stdout.on('data', keep(out));
      child.stderr.on('data', keep(err));
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
      let done = false;
      const settle = (r: RunResult) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(r);
      };
      child.on('error', (e) => settle({ code: -1, stdout: '', stderr: '', spawnError: e.message }));
      child.on('close', (code, signal) =>
        settle({
          code: code ?? -1,
          stdout: Buffer.concat(out).toString('utf8'),
          stderr: Buffer.concat(err).toString('utf8') + (signal === 'SIGKILL' ? `\n${command} ran longer than ${timeoutMs} ms and was stopped` : ''),
        }),
      );
      child.stdin.on('error', () => undefined);
      child.stdin.end(opts.input ?? '');
    });
}

// ---------------------------------------------------------------- the link file (pure parts)

/** The link file, relative to the git top-level. */
export const STORY_THREADS_FILE = '.rehearse/story-threads.json';

export type StoryThreads = Record<string, Record<string, string>>;

/** The links in the file text. Entries that are not a story id → thread id are dropped. */
export function parseStoryThreads(text: string): StoryThreads {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {};
  }
  const out: StoryThreads = {};
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return out;
  for (const [slug, stories] of Object.entries(json)) {
    if (typeof stories !== 'object' || stories === null || Array.isArray(stories)) continue;
    const kept = Object.entries(stories).filter((e): e is [string, string] => typeof e[1] === 'string' && THREAD_ID.test(e[1]));
    if (kept.length > 0) out[slug] = Object.fromEntries(kept);
  }
  return out;
}

export function withStoryThread(all: StoryThreads, slug: string, storyId: Id, threadId: string): StoryThreads {
  return { ...all, [slug]: { ...all[slug], [storyId]: threadId } };
}

// ---------------------------------------------------------------- the story brief (pure)

export interface StoryBrief {
  slug: string;
  storyId: Id;
  want: string;
  soThat: string;
  role: string;
  /** The boxes that serve the story (a parent serves what its children serve), in file order. */
  boxes: { path: string; title: string }[];
  scenarios: Id[];
}

function boxesOf(diagram: Diagram | undefined): Box[] {
  return Array.isArray(diagram?.boxes) ? diagram.boxes.filter((b) => b && typeof b.id === 'string') : [];
}

function serves(box: Box, storyId: Id): boolean {
  if (Array.isArray(box.stories) && box.stories.includes(storyId)) return true;
  return boxesOf(box.children).some((c) => serves(c, storyId));
}

/** The brief of a story, or undefined when the record has no such story. */
export function storyBrief(record: EpicRecord, storyId: Id): StoryBrief | undefined {
  const story = (Array.isArray(record.prd?.stories) ? record.prd.stories : []).find((s) => s && s.id === storyId);
  if (!story) return undefined;
  const boxes: StoryBrief['boxes'] = [];
  const walk = (diagram: Diagram | undefined, prefix: string) => {
    for (const b of boxesOf(diagram)) {
      const path = prefix === '' ? b.id : `${prefix}/${b.id}`;
      if (serves(b, storyId)) boxes.push({ path, title: typeof b.title === 'string' ? b.title : path });
      walk(b.children, path);
    }
  };
  walk(record.flow?.root, '');
  const scenarios = record.scenarioFiles.flatMap((f) =>
    (Array.isArray(f.scenarios) ? f.scenarios : []).filter((s) => (s.story ?? f.story) === storyId).map((s) => s.id),
  );
  const role = (Array.isArray(record.prd?.roles) ? record.prd.roles : []).find((r) => r.id === story.role);
  return {
    slug: record.slug,
    storyId,
    want: String(story.want ?? ''),
    soThat: String(story.soThat ?? ''),
    role: typeof role?.name === 'string' ? role.name : String(story.role ?? ''),
    boxes,
    scenarios,
  };
}

/** The first message of a new story thread. */
export function briefPrompt(brief: StoryBrief): string {
  const boxes = brief.boxes.length > 0 ? brief.boxes.map((b) => `${b.path} (${b.title})`).join(', ') : 'none';
  return [
    `Story thread for ${brief.storyId} of the EPIC ${brief.slug}.`,
    '',
    `As ${brief.role}, I want ${brief.want}, so that ${brief.soThat}.`,
    '',
    `Boxes that serve it: ${boxes}.`,
    `Scenarios: ${brief.scenarios.length}${brief.scenarios.length > 0 ? ` (${brief.scenarios.join(', ')})` : ''}.`,
    `Record: docs/epics/${brief.slug} (prd.yaml, flow.yaml, scenarios/).`,
    '',
    'This thread holds the questions and the work on this story. Read the story in the record and say in a few lines what it needs, then wait for questions here.',
  ].join('\n');
}

/** The title of a new story thread. */
export function briefTitle(brief: StoryBrief): string {
  const title = `${brief.storyId} · ${brief.want}`;
  return title.length > 80 ? `${title.slice(0, 79)}…` : title;
}

/** A sent message: the context line on top, then the text. */
export function composeMessage(text: string, context: string | undefined): string {
  const line = (context ?? '').replace(/\s+/g, ' ').trim();
  return line === '' ? text : `Context: ${line}\n\n${text}`;
}

// ---------------------------------------------------------------- earlier work (pure)

export interface FlowBoxCommit {
  sha: string;
  subject: string;
  boxes: string[];
  threads: string[];
}

/** `git log --format=%H%x1f%s%x1f%B%x1e` output → commits with their Flow-Box trailers and thr_ ids. */
export function parseFlowBoxLog(text: string): FlowBoxCommit[] {
  const out: FlowBoxCommit[] = [];
  for (const rec of text.split('\x1e')) {
    const [sha, subject, body] = rec.replace(/^\s+/, '').split('\x1f');
    if (!sha || !/^[0-9a-f]{7,64}$/.test(sha) || body === undefined) continue;
    const boxes = [...body.matchAll(/^Flow-Box:[ \t]*(.+)$/gm)].flatMap((m) => m[1]!.trim().split(/[\s,]+/)).filter(Boolean);
    const threads = [...new Set([...`${subject}\n${body}`.matchAll(/\bthr_[A-Za-z0-9]+\b/g)].map((m) => m[0]))];
    out.push({ sha, subject: subject ?? '', boxes, threads });
  }
  return out;
}

export interface EarlierWork {
  threadId: string;
  /** Subject of the newest commit that names the thread. */
  subject: string;
  sha: string;
  boxes: string[];
}

/** Threads named in commits whose Flow-Box trailers name one of the boxes (or a box inside one), newest first. */
export function earlierWork(commits: FlowBoxCommit[], boxPaths: string[], exclude?: string): EarlierWork[] {
  const byThread = new Map<string, EarlierWork>();
  for (const c of commits) {
    const hit = c.boxes.filter((b) => boxPaths.some((p) => b === p || b.startsWith(`${p}/`)));
    if (hit.length === 0) continue;
    for (const t of c.threads) {
      if (t === exclude) continue;
      const seen = byThread.get(t);
      if (seen) seen.boxes = [...new Set([...seen.boxes, ...hit])];
      else byThread.set(t, { threadId: t, subject: c.subject, sha: c.sha.slice(0, 7), boxes: hit });
    }
  }
  return [...byThread.values()];
}

// ---------------------------------------------------------------- the service

export type BbState = { ok: true; status: string; statusText: string; title: string | null } | { ok: false; error: string };

/** What `GET /api/story-thread?story=` returns. */
export interface StoryThreadView {
  brief: StoryBrief;
  threadId: string | null;
  /** null when the story has no thread. */
  bb: BbState | null;
  messages: ThreadMessage[];
  earlier: EarlierWork[];
}

export class StoryThreadError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface StoryThreadOptions {
  epicDir: string;
  run: Runner;
  /** bb project for `bb thread spawn --project`. */
  bbProject?: string;
  now?: () => number;
}

/** Events per `bb thread log` page, and pages per request. */
const PAGE = 200;
const MAX_PAGES = 25;
/** Messages kept per thread. */
const KEEP_MESSAGES = 300;
const EARLIER_TTL_MS = 60_000;
export const MAX_MESSAGE_CHARS = 20_000;
export const MAX_CONTEXT_CHARS = 200;

export interface StoryThreadService {
  view(storyId: string): Promise<StoryThreadView>;
  link(storyId: string, threadId: string): Promise<StoryThreadView>;
  start(storyId: string): Promise<StoryThreadView>;
  send(storyId: string, text: string, context?: string): Promise<StoryThreadView>;
  open(storyId: string): Promise<void>;
}

function bbFailure(r: RunResult): string {
  if (r.spawnError !== undefined) return `bb is not available here (${r.spawnError})`;
  const text = `${r.stdout}\n${r.stderr}`;
  try {
    const parsed = JSON.parse(r.stdout) as { error?: { message?: string } };
    if (parsed?.error?.message) return parsed.error.message;
  } catch {
    // Not JSON: use the last line of output.
  }
  const last = text.trim().split('\n').pop() ?? '';
  return last === '' ? `bb exited with code ${r.code}` : last.slice(0, 300);
}

export function createStoryThreads(opts: StoryThreadOptions): StoryThreadService {
  const { epicDir, run } = opts;
  const now = opts.now ?? Date.now;
  const logs = new Map<string, { lastSeq: number; messages: ThreadMessage[] }>();
  let earlierCache: { at: number; commits: FlowBoxCommit[] } | undefined;
  const starting = new Set<string>();

  const record = (): EpicRecord => loadEpic(epicDir).record;
  const briefOf = (storyId: string): StoryBrief => {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(storyId)) throw new StoryThreadError(400, 'story must be a story id such as S1');
    const brief = storyBrief(record(), storyId);
    if (!brief) throw new StoryThreadError(404, `no story ${storyId} in prd.yaml`);
    return brief;
  };

  async function topLevel(): Promise<string> {
    const r = await run('git', ['rev-parse', '--show-toplevel'], { cwd: epicDir });
    const top = r.stdout.trim();
    if (r.code !== 0 || top === '') throw new StoryThreadError(503, `the EPIC folder is not in a git repo, so there is no ${STORY_THREADS_FILE}`);
    return top;
  }
  async function readLinks(): Promise<{ file: string; all: StoryThreads }> {
    const file = join(await topLevel(), STORY_THREADS_FILE);
    return { file, all: existsSync(file) ? parseStoryThreads(readFileSync(file, 'utf8')) : {} };
  }
  async function threadOf(brief: StoryBrief): Promise<string | null> {
    try {
      return (await readLinks()).all[brief.slug]?.[brief.storyId] ?? null;
    } catch {
      return null;
    }
  }
  async function saveLink(brief: StoryBrief, threadId: string): Promise<void> {
    const { file, all } = await readLinks();
    mkdirSync(join(file, '..'), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(withStoryThread(all, brief.slug, brief.storyId, threadId), null, 2)}\n`);
    renameSync(tmp, file);
  }

  async function bbState(threadId: string): Promise<BbState> {
    const r = await run('bb', ['thread', 'show', threadId, '--json'], { cwd: epicDir });
    if (r.code !== 0 || r.spawnError !== undefined) return { ok: false, error: bbFailure(r) };
    const t = parseThreadShow(r.stdout);
    return t.ok ? { ok: true, status: t.value.status, statusText: statusWords(t.value.status), title: t.value.title } : { ok: false, error: t.error };
  }

  /** New messages since the last read, page by page. */
  async function messages(threadId: string): Promise<ThreadMessage[]> {
    const cache = logs.get(threadId) ?? { lastSeq: 0, messages: [] };
    for (let page = 0; page < MAX_PAGES; page++) {
      const args = ['thread', 'log', threadId, '--json', '--limit', String(PAGE), ...(cache.lastSeq > 0 ? ['--after-seq', String(cache.lastSeq)] : [])];
      const r = await run('bb', args, { cwd: epicDir });
      if (r.code !== 0 || r.spawnError !== undefined) break;
      const parsed = parseThreadLog(r.stdout);
      if (!parsed.ok) break;
      cache.messages = [...cache.messages, ...parsed.value.messages].slice(-KEEP_MESSAGES);
      cache.lastSeq = Math.max(cache.lastSeq, parsed.value.lastSeq);
      if (parsed.value.events < PAGE) break;
    }
    logs.set(threadId, cache);
    return cache.messages;
  }

  async function earlier(brief: StoryBrief, threadId: string | null): Promise<EarlierWork[]> {
    if (!earlierCache || now() - earlierCache.at > EARLIER_TTL_MS) {
      const r = await run('git', ['log', '-n', '2000', '--grep=^Flow-Box:', '--format=%H%x1f%s%x1f%B%x1e'], { cwd: epicDir });
      earlierCache = { at: now(), commits: r.code === 0 ? parseFlowBoxLog(r.stdout) : [] };
    }
    return earlierWork(earlierCache.commits, brief.boxes.map((b) => b.path), threadId ?? undefined);
  }

  async function view(storyId: string): Promise<StoryThreadView> {
    const brief = briefOf(storyId);
    const threadId = await threadOf(brief);
    const past = await earlier(brief, threadId);
    if (threadId === null) return { brief, threadId, bb: null, messages: [], earlier: past };
    const bb = await bbState(threadId);
    return { brief, threadId, bb, messages: bb.ok ? await messages(threadId) : [], earlier: past };
  }

  async function linked(storyId: string): Promise<{ brief: StoryBrief; threadId: string }> {
    const brief = briefOf(storyId);
    const threadId = await threadOf(brief);
    if (threadId === null) throw new StoryThreadError(409, `story ${storyId} has no thread`);
    return { brief, threadId };
  }

  return {
    view,
    async link(storyId, threadId) {
      const brief = briefOf(storyId);
      if (!THREAD_ID.test(threadId)) throw new StoryThreadError(400, 'a thread id looks like thr_abc123');
      await saveLink(brief, threadId);
      return view(storyId);
    },
    async start(storyId) {
      const brief = briefOf(storyId);
      if ((await threadOf(brief)) !== null) throw new StoryThreadError(409, `story ${storyId} has a thread already`);
      const key = `${brief.slug}/${storyId}`;
      if (starting.has(key)) throw new StoryThreadError(409, `a thread for ${storyId} is starting`);
      starting.add(key);
      try {
        const args = ['thread', 'spawn', '--json', '--prompt-file', '-', '--title', briefTitle(brief), ...(opts.bbProject ? ['--project', opts.bbProject] : [])];
        const r = await run('bb', args, { cwd: epicDir, input: briefPrompt(brief) });
        if (r.code !== 0 || r.spawnError !== undefined) throw new StoryThreadError(502, bbFailure(r));
        const spawned = parseSpawn(r.stdout);
        if (!spawned.ok) throw new StoryThreadError(502, spawned.error);
        await saveLink(brief, spawned.value.id);
      } finally {
        starting.delete(key);
      }
      return view(storyId);
    },
    async send(storyId, text, context) {
      if (text.trim() === '') throw new StoryThreadError(400, 'the message is empty');
      if (text.length > MAX_MESSAGE_CHARS) throw new StoryThreadError(400, `the message is longer than ${MAX_MESSAGE_CHARS} characters`);
      if ((context ?? '').length > MAX_CONTEXT_CHARS) throw new StoryThreadError(400, `the context is longer than ${MAX_CONTEXT_CHARS} characters`);
      const { threadId } = await linked(storyId);
      const r = await run('bb', ['thread', 'tell', threadId, '--message-file', '-', '--json'], { cwd: epicDir, input: composeMessage(text, context) });
      if (r.code !== 0 || r.spawnError !== undefined) throw new StoryThreadError(502, bbFailure(r));
      const told = parseTell(r.stdout);
      if (!told.ok) throw new StoryThreadError(502, told.error);
      return view(storyId);
    },
    async open(storyId) {
      const { threadId } = await linked(storyId);
      const r = await run('bb', ['thread', 'open', threadId, '--json'], { cwd: epicDir });
      if (r.code !== 0 || r.spawnError !== undefined) throw new StoryThreadError(502, bbFailure(r));
    },
  };
}
