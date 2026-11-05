// The story thread panel (T12, design pages 13 and 15), without React: the collapse choice
// (one for all stories, in localStorage), the `]` key, unread counts, the toast, labels and the
// composer's context line.

import type { ThreadMessage } from '@rehearse/server';

const COLLAPSED_KEY = 'rehearse:story-thread-collapsed';
const READ_KEY = 'rehearse:story-thread-read';

/** Poll while the panel is open, and slower while it is a strip (for the unread count and the toast). */
export const POLL_OPEN_MS = 4000;
export const POLL_COLLAPSED_MS = 12000;
/** How long the "new message" toast stays. */
export const TOAST_MS = 8000;
/** Longest message text the panel draws. */
export const MAX_SHOWN_CHARS = 6000;

export function browserLocalStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** The panel is collapsed for every story once the owner collapses it. */
export function loadCollapsed(storage: Storage | undefined): boolean {
  try {
    return storage?.getItem(COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveCollapsed(storage: Storage | undefined, collapsed: boolean): void {
  try {
    storage?.setItem(COLLAPSED_KEY, collapsed ? 'true' : 'false');
  } catch {
    // Private mode or full storage: the choice lasts for this page only.
  }
}

/** thread id → the highest message seq the owner has seen. */
export type ReadMarks = Record<string, number>;

export function loadReadMarks(storage: Storage | undefined): ReadMarks {
  try {
    const parsed = JSON.parse(storage?.getItem(READ_KEY) ?? '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, number] => typeof e[1] === 'number'));
  } catch {
    return {};
  }
}

export function saveReadMarks(storage: Storage | undefined, marks: ReadMarks): void {
  try {
    storage?.setItem(READ_KEY, JSON.stringify(marks));
  } catch {
    // See saveCollapsed.
  }
}

/** Messages someone else wrote: an agent, or another thread. */
const incoming = (m: ThreadMessage) => m.from === 'agent' || m.from === 'thread';

export function lastSeq(messages: readonly ThreadMessage[]): number {
  return messages.reduce((n, m) => Math.max(n, m.seq), 0);
}

/** Incoming messages after the read mark. */
export function unreadCount(messages: readonly ThreadMessage[], readSeq: number): number {
  return messages.filter((m) => incoming(m) && m.seq > readSeq).length;
}

/** The newest incoming message after `knownSeq`, for the toast; undefined when there is none. */
export function newIncoming(messages: readonly ThreadMessage[], knownSeq: number): ThreadMessage | undefined {
  return [...messages].reverse().find((m) => incoming(m) && m.seq > knownSeq);
}

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target: EventTarget | null;
}

/** `]` toggles the panel, but not while typing in a field and not with a modifier. */
export function isToggleKey(e: KeyLike): boolean {
  if (e.key !== ']' || e.ctrlKey || e.metaKey || e.altKey) return false;
  return !isTyping(e.target);
}

export function isTyping(target: EventTarget | null): boolean {
  const el = target as (Element & { isContentEditable?: boolean }) | null;
  if (!el || typeof el.closest !== 'function') return false;
  return el.isContentEditable === true || el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null;
}

/** Status words → a colour tone. The words are always shown (or read) too. */
export type Tone = 'idle' | 'working' | 'failed' | 'none';

export function toneOf(statusText: string | undefined): Tone {
  if (statusText === 'idle') return 'idle';
  if (statusText === 'working') return 'working';
  if (statusText === 'failed' || statusText === 'stopped') return 'failed';
  return 'none';
}

export function whoLabel(m: ThreadMessage): string {
  if (m.from === 'you') return 'You';
  if (m.from === 'agent') return 'Agent';
  if (m.from === 'thread') return `Thread ${m.senderThreadId ?? ''}`.trim();
  return 'bb';
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `14:52` today, else `Nov 4, 14:52` (local time). */
export function timeLabel(at: number, now: number): string {
  const d = new Date(at);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return new Date(now).toDateString() === d.toDateString() ? hm : `${d.toLocaleString('en-US', { month: 'short' })} ${d.getDate()}, ${hm}`;
}

/** Very long text (a pasted brief, a log) is cut for drawing; the thread in bb has it all. */
export function shownText(text: string, max = MAX_SHOWN_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} more characters in bb)` : text;
}

/** What the owner is looking at, for the composer's context chip. */
export interface StoryContext {
  /** The open tab of the story view: overview, code, tests. */
  tab: string;
  /** The selected box path or id, if any. */
  box?: string;
  /** Finer place: a file and mode (`write.ts diff`), a scenario, a test. */
  detail?: string;
}

/** `approve · write.ts diff`, `overview · S1-buy`. */
export function contextLabel(c: StoryContext): string {
  return [c.box ?? c.tab, c.detail].filter((s) => s !== undefined && s.trim() !== '').join(' · ');
}

/** A pasted id, trimmed; undefined when it is not a thread id. */
export function threadIdOf(text: string): string | undefined {
  const t = text.trim().replace(/^@thread:/, '');
  return /^thr_[A-Za-z0-9]+$/.test(t) ? t : undefined;
}
