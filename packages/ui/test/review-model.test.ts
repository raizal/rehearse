// Pure review model and the POST outcome mapping of the HTTP contract.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Finding } from '@rehearse/core';
import { postApprove, postSignOff } from '../src/api.js';
import { approveReason, blockingFindings, findingStories, groupByStory, matrixAxes, sigText } from '../src/model/review.js';
import { reviewEpic } from './fixture.js';
import { mockServer, SESSION } from './mock-server.js';

const view = reviewEpic();
const sv = (id: string) => view.scenarios.find((s) => s.scenario.id === id)!;
const f = (file: string, path: string, refs: string[] = [], kind: Finding['kind'] = 'gate'): Finding => ({ kind, file, path, message: 'm', refs });

describe('approve model (S6-A1)', () => {
  it('S6-A1: draft and stale can be approved; approved needs a valid signature', () => {
    expect(approveReason(sv('S1-empty'), view.approvals)).toBe('draft');
    expect(approveReason(sv('S2-out-of-stock'), view.approvals)).toBe('stale');
    expect(approveReason(sv('S1-buy'), view.approvals)).toBeUndefined();
    for (const status of ['missing', 'invalid', 'unknown-signer'] as const) {
      expect(approveReason(sv('S1-buy'), { 'S1-buy': { by: 'b', at: 't', sigStatus: status } })).toBe(sigText(status));
    }
    expect(approveReason(sv('S1-buy'), {})).toBe('not signed');
    // An older server sends no approvals: an approved scenario stays approved.
    expect(approveReason(sv('S1-buy'), undefined)).toBeUndefined();
  });
});

describe('finding → stories (S8, S9-A1)', () => {
  it('from refs (story, requirement, criterion), scenario file and box path with ancestors', () => {
    expect(findingStories(view, f('prd.yaml', 'x', ['R1']))).toEqual(['S1']);
    expect(findingStories(view, f('prd.yaml', 'x', ['S2-A1']))).toEqual(['S2']);
    expect(findingStories(view, f('scenarios/S2.yaml', 'S2-out-of-stock'))).toEqual(['S2']);
    expect(findingStories(view, f('flow.yaml', 'ship/pack'))).toEqual(['S2']);
    expect(findingStories(view, f('flow.yaml', 'in-stock'))).toEqual([]);
    expect(findingStories(view, f('prd.yaml', 'requirements[2]', ['R3']))).toEqual([]);
  });

  it('S9-A1: findings about a selected story or the whole EPIC block; a re-sign finding of a selected story does not', () => {
    const s1 = f('flow.yaml', 'cart', ['S1'], 'coverage');
    const s2 = f('scenarios/S2.yaml', 'S2-out-of-stock', ['S2']);
    const epic = f('prd.yaml', 'requirements[2]', ['R3']);
    const resign = f('signoff.yaml', 'S1', ['S1']);
    expect(blockingFindings(view, [s1, s2, resign], new Set(['S1']))).toEqual([s1]);
    expect(blockingFindings(view, [s1, s2, resign], new Set(['S2']))).toEqual([s2]);
    expect(blockingFindings(view, [epic], new Set(['S2']))).toEqual([epic]);
    expect(blockingFindings(view, [s2, resign], new Set(['S1']))).toEqual([]);
  });

  it('groups by story in prd.yaml order, EPIC-wide first', () => {
    const groups = groupByStory(view, view.gate!.findings);
    expect(groups.map((g) => [g.story, g.findings.length])).toEqual([
      [undefined, 2],
      ['S1', 2],
      ['S2', 4],
    ]);
  });
});

describe('permission matrix axes (S7-A1)', () => {
  it('S7-A1: roles in lane order, entities in entities.yaml order, then any others sorted', () => {
    const matrix = { system: { Order: ['read'], Zed: ['read'] }, builder: { Order: ['write'] }, ghost: { Alpha: ['read'] } };
    expect(matrixAxes(matrix, view.flow, ['Order'])).toEqual({ roles: ['builder', 'system', 'ghost'], entities: ['Order', 'Alpha', 'Zed'] });
  });
});

describe('POST outcomes (HTTP contract)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const routes = (reply: { status: number; body: unknown }) => mockServer({ epic: () => view, approve: () => reply, signOff: () => reply });

  it('200, 409, 503 and 403 each map to their outcome', async () => {
    routes({ status: 200, body: { ok: true, approved: ['S1-empty'] } });
    expect(await postApprove(['S1-empty'])).toEqual({ kind: 'ok', body: { ok: true, approved: ['S1-empty'] } });
    const finding = f('prd.yaml', 'S2', ['S2']);
    routes({ status: 409, body: { ok: false, findings: [finding] } });
    expect(await postSignOff(['S2'])).toEqual({ kind: 'findings', findings: [finding] });
    routes({ status: 503, body: { ok: false, reason: 'no key' } });
    expect(await postApprove(['x'])).toEqual({ kind: 'unavailable', reason: 'no key' });
    routes({ status: 403, body: 'forbidden' });
    expect(await postSignOff(['S1'])).toMatchObject({ kind: 'forbidden' });
    routes({ status: 405, body: { error: 'method' } });
    expect(await postApprove(['x'])).toEqual({ kind: 'error', message: 'POST api/approve: HTTP 405: method' });
  });

  it('a 403 with a body that is not JSON still gives a forbidden outcome; a network error is an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === 'api/session' ? { ok: true, status: 200, json: async () => SESSION } : { ok: false, status: 403, json: async () => { throw new SyntaxError('not json'); } })));
    expect(await postApprove(['x'])).toMatchObject({ kind: 'forbidden', message: expect.stringContaining('token') });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('connection refused'); }));
    expect(await postApprove(['x'])).toEqual({ kind: 'error', message: 'POST api/approve: connection refused' });
  });
});
