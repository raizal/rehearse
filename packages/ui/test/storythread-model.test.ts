// The story thread panel without React (T12): collapse choice, read marks, unread, `]`, labels.

import { describe, expect, it } from 'vitest';
import type { ThreadMessage } from '@rehearse/server';
import {
  contextLabel,
  isToggleKey,
  lastSeq,
  loadCollapsed,
  loadReadMarks,
  newIncoming,
  saveCollapsed,
  saveReadMarks,
  shownText,
  threadIdOf,
  timeLabel,
  toneOf,
  unreadCount,
  whoLabel,
} from '../src/model/storythread.js';

const msg = (seq: number, from: ThreadMessage['from'], text = `m${seq}`): ThreadMessage => ({ seq, from, at: 0, text });

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

describe('T12 story thread model', () => {
  it('T12 collapse 3: the collapse choice is one for all stories and survives a reload', () => {
    const s = memoryStorage();
    expect(loadCollapsed(s)).toBe(false);
    saveCollapsed(s, true);
    expect(loadCollapsed(s)).toBe(true);
    saveCollapsed(s, false);
    expect(loadCollapsed(s)).toBe(false);
    expect(loadCollapsed(undefined)).toBe(false);
  });

  it('T12 collapse 1: read marks round-trip and ignore junk', () => {
    const s = memoryStorage();
    saveReadMarks(s, { thr_a: 4 });
    expect(loadReadMarks(s)).toEqual({ thr_a: 4 });
    s.setItem('rehearse:story-thread-read', '{"thr_a":"x","thr_b":2}');
    expect(loadReadMarks(s)).toEqual({ thr_b: 2 });
    s.setItem('rehearse:story-thread-read', 'not json');
    expect(loadReadMarks(s)).toEqual({});
  });

  it('T12 collapse 1: unread counts agent and thread messages after the read mark, not your own', () => {
    const list = [msg(1, 'you'), msg(5, 'agent'), msg(7, 'you'), msg(9, 'thread'), msg(11, 'agent')];
    expect(lastSeq(list)).toBe(11);
    expect(unreadCount(list, 5)).toBe(2);
    expect(unreadCount(list, 11)).toBe(0);
    expect(newIncoming(list, 5)?.seq).toBe(11);
    expect(newIncoming(list, 11)).toBeUndefined();
    expect(newIncoming([msg(12, 'you')], 11)).toBeUndefined();
  });

  it('T12 collapse 2: ] toggles, but not while typing or with a modifier', () => {
    const div = document.createElement('div');
    const input = document.createElement('input');
    const area = document.createElement('textarea');
    expect(isToggleKey({ key: ']', target: div })).toBe(true);
    expect(isToggleKey({ key: ']', target: null })).toBe(true);
    expect(isToggleKey({ key: ']', target: input })).toBe(false);
    expect(isToggleKey({ key: ']', target: area })).toBe(false);
    expect(isToggleKey({ key: ']', ctrlKey: true, target: div })).toBe(false);
    expect(isToggleKey({ key: '[', target: div })).toBe(false);
  });

  it('T12 panel 1: status words map to a tone; who and when are in words', () => {
    expect(toneOf('idle')).toBe('idle');
    expect(toneOf('working')).toBe('working');
    expect(toneOf('stopped')).toBe('failed');
    expect(toneOf('something new')).toBe('none');
    expect(whoLabel(msg(1, 'you'))).toBe('You');
    expect(whoLabel(msg(1, 'agent'))).toBe('Agent');
    expect(whoLabel({ ...msg(1, 'thread'), senderThreadId: 'thr_x' })).toBe('Thread thr_x');
    const at = new Date(2026, 10, 4, 14, 5).getTime();
    expect(timeLabel(at, new Date(2026, 10, 4, 20, 0).getTime())).toBe('14:05');
    expect(timeLabel(at, new Date(2026, 10, 5, 9, 0).getTime())).toBe('Nov 4, 14:05');
  });

  it('T12 panel 2: long text is cut for drawing, with the rest counted', () => {
    expect(shownText('abc', 10)).toBe('abc');
    expect(shownText('abcdefghij', 4)).toBe('abcd\n… (6 more characters in bb)');
  });

  it('T12 panel 4: the context chip names the place; pasted ids are checked', () => {
    expect(contextLabel({ tab: 'overview', detail: 'S1-buy' })).toBe('overview · S1-buy');
    expect(contextLabel({ tab: 'code', box: 'approve', detail: 'write.ts diff' })).toBe('approve · write.ts diff');
    expect(contextLabel({ tab: 'overview' })).toBe('overview');
    expect(threadIdOf(' thr_abc123 ')).toBe('thr_abc123');
    expect(threadIdOf('@thread:thr_abc123')).toBe('thr_abc123');
    expect(threadIdOf('thr_abc; rm -rf')).toBeUndefined();
    expect(threadIdOf('abc')).toBeUndefined();
  });
});
