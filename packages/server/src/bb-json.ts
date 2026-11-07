// The `bb thread … --json` output the story thread panel reads, parsed in pure functions.
// Shapes (see `bb guide json` and test/fixtures/bb-*.json, captured from a real thread):
// - `bb thread show <id> --json`: { thread: { id, status, title, projectId, … }, environment, pendingTodos }
// - `bb thread log <id> --json`: a bare array of raw events, oldest first. A user or thread message
//   is a `client/turn/requested` event (`data.input[]` of `{ type: 'text', text }`); an agent message
//   is an `item/completed` event whose `data.item.type` is `agentMessage` (`data.item.text`).
// - `bb thread spawn --json`: the created thread, { id, status, title, projectId, … }
// - any error with --json: { ok: false, error: { code, message, hint? } } on stdout.

/** A thread id as bb prints it. */
export const THREAD_ID = /^thr_[A-Za-z0-9]+$/;

export interface BbThread {
  id: string;
  /** bb's word: idle, active, failed, … */
  status: string;
  title: string | null;
  projectId: string | null;
  /** Epoch milliseconds of the last change, when bb says. */
  updatedAt?: number | null;
  /** The git branch of the thread's environment (`bb thread show` only). */
  branch?: string | null;
}

export type ThreadMessageFrom = 'you' | 'agent' | 'thread' | 'system';

export interface ThreadMessage {
  /** Event sequence number: the order, and the read mark. */
  seq: number;
  from: ThreadMessageFrom;
  /** The sending thread, when another thread sent it. */
  senderThreadId?: string;
  /** Epoch milliseconds. */
  at: number;
  text: string;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function parseJson(text: string): Parsed<unknown> {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, error: 'bb printed no JSON' };
  }
}

/** The message of a `{ ok: false, error }` answer, else undefined. */
export function bbError(value: unknown): string | undefined {
  if (!isObject(value) || value.ok !== false) return undefined;
  const error = isObject(value.error) ? value.error : {};
  return str(error.message) ?? str(error.code) ?? 'bb failed';
}

function thread(value: unknown): BbThread | undefined {
  if (!isObject(value)) return undefined;
  const id = str(value.id);
  if (id === undefined || !THREAD_ID.test(id)) return undefined;
  const updatedAt = typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? value.updatedAt : null;
  return { id, status: str(value.status) ?? 'unknown', title: str(value.title) ?? null, projectId: str(value.projectId) ?? null, updatedAt };
}

/** `bb thread show <id> --json`. */
export function parseThreadShow(text: string): Parsed<BbThread> {
  const json = parseJson(text);
  if (!json.ok) return json;
  const error = bbError(json.value);
  if (error !== undefined) return { ok: false, error };
  const t = thread(isObject(json.value) ? json.value.thread : undefined);
  if (!t) return { ok: false, error: 'bb thread show: no thread in the answer' };
  const env = isObject(json.value) && isObject(json.value.environment) ? json.value.environment : {};
  return { ok: true, value: { ...t, branch: str(env.branchName) ?? null } };
}

/** `bb thread spawn --json`: the new thread. */
export function parseSpawn(text: string): Parsed<BbThread> {
  const json = parseJson(text);
  if (!json.ok) return json;
  const error = bbError(json.value);
  if (error !== undefined) return { ok: false, error };
  const t = thread(json.value);
  return t ? { ok: true, value: t } : { ok: false, error: 'bb thread spawn: no thread id in the answer' };
}

/** `bb thread tell --json`: ok unless bb says it failed. */
export function parseTell(text: string): Parsed<null> {
  const json = parseJson(text);
  if (!json.ok) return json;
  const error = bbError(json.value);
  return error !== undefined ? { ok: false, error } : { ok: true, value: null };
}

export interface LogPage {
  messages: ThreadMessage[];
  /** Highest event seq on the page (0 for an empty page): the next `--after-seq`. */
  lastSeq: number;
  /** Events on the page, messages or not. */
  events: number;
}

/** `bb thread log <id> --json`: the messages among the events, oldest first. */
export function parseThreadLog(text: string): Parsed<LogPage> {
  const json = parseJson(text);
  if (!json.ok) return json;
  const error = bbError(json.value);
  if (error !== undefined) return { ok: false, error };
  if (!Array.isArray(json.value)) return { ok: false, error: 'bb thread log: the answer is not a list of events' };
  const messages: ThreadMessage[] = [];
  let lastSeq = 0;
  for (const e of json.value) {
    if (!isObject(e) || typeof e.seq !== 'number') continue;
    lastSeq = Math.max(lastSeq, e.seq);
    const m = messageOf(e);
    if (m) messages.push(m);
  }
  return { ok: true, value: { messages, lastSeq, events: json.value.length } };
}

function messageOf(e: Record<string, unknown>): ThreadMessage | undefined {
  const data = isObject(e.data) ? e.data : {};
  const at = typeof e.createdAt === 'number' ? e.createdAt : 0;
  const seq = e.seq as number;
  if (e.type === 'client/turn/requested') {
    const text = (Array.isArray(data.input) ? data.input : [])
      .filter((i): i is Record<string, unknown> => isObject(i) && i.type === 'text' && typeof i.text === 'string')
      .map((i) => i.text as string)
      .join('\n\n');
    if (text === '') return undefined;
    const sender = str(data.senderThreadId);
    if (sender) return { seq, from: 'thread', senderThreadId: sender, at, text };
    return { seq, from: data.initiator === 'user' ? 'you' : 'system', at, text };
  }
  if (e.type === 'item/completed') {
    const item = isObject(data.item) ? data.item : {};
    if (item.type === 'agentMessage' && typeof item.text === 'string' && item.text.trim() !== '') return { seq, from: 'agent', at, text: item.text };
  }
  return undefined;
}

/** bb's thread status in words for the panel. */
export function statusWords(status: string): string {
  switch (status) {
    case 'idle':
      return 'idle';
    case 'active':
    case 'running':
    case 'working':
      return 'working';
    case 'failed':
    case 'error':
    case 'errored':
      return 'failed';
    case 'interrupted':
      return 'stopped';
    default:
      return status === '' ? 'unknown' : status.replace(/[_-]+/g, ' ');
  }
}
