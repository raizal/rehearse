// T23: every place in the UI is a URL hash, and the hash round-trips.

import { describe, expect, it } from 'vitest';
import { boxOfHash, depthOf, depthState, fromHash, toHash, type Loc } from '../src/model/nav.js';

describe('the place as a URL hash (T23)', () => {
  const places: [Loc, string][] = [
    [{ tab: 'bigpicture' }, '#/bigpicture'],
    [{ tab: 'bigpicture', view: 'architecture' }, '#/bigpicture/architecture'],
    [{ tab: 'stories', list: true }, '#/stories'],
    [{ tab: 'stories', story: 'S6', storyTab: 'how' }, '#/stories/S6/how'],
    [{ tab: 'stories', story: 'S6', card: 'S6-approve' }, '#/stories/S6/board/S6-approve'],
    [{ tab: 'prd', focus: 'box:approve' }, '#/prd/box%3Aapprove'],
    [{ tab: 'techspec' }, '#/techspec'],
    [{ tab: 'readiness', requirement: 'R3' }, '#/readiness/R3'],
    [{ tab: 'usecases' }, '#/usecases'],
    [{ tab: 'signoff' }, '#/signoff'],
  ];

  it.each(places)('%j is %s and back', (loc, hash) => {
    expect(toHash(loc)).toBe(hash);
    expect(fromHash(hash)).toEqual(loc);
  });

  it('the default big picture view leaves the hash short', () => {
    expect(toHash({ tab: 'bigpicture', view: 'features' })).toBe('#/bigpicture');
  });

  it('T38 deep link: an open box drawer adds ?box= to the place under it, and the place still reads', () => {
    expect(toHash({ tab: 'stories', story: 'S4', storyTab: 'how' }, 'review/panel')).toBe('#/stories/S4/how?box=review/panel');
    expect(fromHash('#/stories/S4/how?box=review/panel')).toEqual({ tab: 'stories', story: 'S4', storyTab: 'how' });
    expect(boxOfHash('#/stories/S4/how?box=review/panel')).toBe('review/panel');
    expect(toHash({ tab: 'bigpicture', view: 'userflow' }, 'in-stock')).toBe('#/bigpicture/userflow?box=in-stock');
    expect(boxOfHash('#/bigpicture/userflow')).toBeUndefined();
    expect(toHash({ tab: 'readiness' }, undefined)).toBe('#/readiness');
  });

  it('T38 old #/flow redirect: an old flow URL is the big picture with its box in the drawer', () => {
    expect(fromHash('#/flow')).toEqual({ tab: 'bigpicture' });
    expect(boxOfHash('#/flow')).toBeUndefined();
    expect(fromHash('#/flow/ship/pack')).toEqual({ tab: 'bigpicture' });
    expect(boxOfHash('#/flow/ship/pack')).toBe('ship/pack');
  });

  it('an empty or unknown hash names no place; an unknown story tab is WHAT', () => {
    expect(fromHash('')).toBeUndefined();
    expect(fromHash('#')).toBeUndefined();
    expect(fromHash('#/nowhere')).toBeUndefined();
    expect(fromHash('#/stories/S2/nope')).toEqual({ tab: 'stories', story: 'S2', storyTab: 'what' });
    expect(fromHash('#/stories/S2')).toEqual({ tab: 'stories', story: 'S2', storyTab: 'what' });
  });

  it('the history depth lives in the history entry', () => {
    expect(depthOf(null)).toBe(0);
    expect(depthOf({ other: 1 })).toBe(0);
    expect(depthOf(depthState(3))).toBe(3);
  });
});
