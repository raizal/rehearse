// T51: linking a design without YAML. The picker (files → pages → frames with pictures; one click
// links), Change and Unlink, the top 3 suggestions with their reason and a one-click Link (never
// linked by themselves), "linked by frame name", the refresh of pictures and its messages, and the
// same picker and suggestions for a box in the box drawer.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesignFileIndex, DesignSuggestion } from '@rehearse/core';
import { App } from '../src/App.js';
import type { DesignInfo } from '../src/design-api.js';
import { pictureSrc, sourceWords, suggestionWords } from '../src/model/design.js';
import { reviewEpic, seeAll } from './fixture.js';
import { mockServer, SESSION, type MockRoutes } from './mock-server.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

const FILE = 'design/shop.figcraft';
const INDEX: DesignFileIndex[] = [
  {
    file: FILE,
    thumbnail: true,
    pages: [
      { number: 1, id: '1', name: 'Home', frames: [] },
      { number: 2, id: '2', name: 'Pay', png: 'design/2-pay.png', frames: [{ id: '20', name: 'Pay form', png: 'design/frames/pay-form.png' }] },
    ],
  },
  { file: 'design/other.figcraft', thumbnail: false, pages: [{ number: 1, id: 'p', name: 'Other', frames: [] }] },
];
const SUGGESTED: DesignSuggestion[] = [
  { file: FILE, page: 2, pageName: 'Pay', frame: { ref: 'Pay form', name: 'Pay form' }, matches: ['Pay'], reason: 'matches: pay', picture: { kind: 'frame', png: 'design/frames/pay-form.png' } },
  { file: FILE, page: 2, pageName: 'Pay', matches: ['Pay'], reason: 'matches: pay', picture: { kind: 'page', png: 'design/2-pay.png' } },
  { file: FILE, page: 1, pageName: 'Home', matches: ['Home'], reason: 'matches: home', picture: { kind: 'file thumbnail', file: FILE } },
  { file: FILE, page: 1, pageName: 'Home', frame: { ref: 'x', name: 'Fourth' }, matches: ['Home'], reason: 'matches: home' },
];

function design(over: Partial<DesignInfo> = {}): DesignInfo {
  return {
    ok: true,
    slug: 'shop-checkout',
    story: null,
    boxes: {},
    findings: [],
    linksFile: 'design/links.yaml',
    linkLine: 'S1: { file: design/<name>.figcraft, page: <page number or name>, png: design/<page>.png }',
    figcraft: { fetched: true, version: '0.9.0', url: '/figcraft/', command: 'pnpm rehearse figcraft fetch' },
    author: 'Builder Example',
    boxSources: {},
    boxPictures: {},
    storyBoxes: { cart: 'Check out the cart', pay: 'Pay' },
    suggestions: SUGGESTED,
    boxSuggestions: { cart: [SUGGESTED[2]!] },
    index: INDEX,
    ...over,
  };
}

const ok = (body: unknown) => ({ status: 200, body });

async function start(hash: string, routes: Partial<MockRoutes>) {
  window.history.replaceState(null, '', hash);
  const view = reviewEpic();
  seeAll(view);
  const server = mockServer({ epic: () => view, ...routes });
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId('epic-slug');
  return { server, user };
}

describe('T51 the model', () => {
  it('pictures, suggestion words and where a link comes from', () => {
    expect(pictureSrc({ kind: 'page', png: 'design/2-pay.png' })).toBe('design/2-pay.png');
    expect(pictureSrc({ kind: 'frame', png: 'design/frames/pay-form.png' }, 3)).toBe('design/frames/pay-form.png?v=3');
    expect(pictureSrc({ kind: 'file thumbnail', file: 'design/a b.figcraft' })).toBe('design-thumbnail?file=design%2Fa%20b.figcraft');
    expect(suggestionWords(SUGGESTED[0]!)).toBe('Frame “Pay form” on page 2 “Pay”');
    expect(suggestionWords(SUGGESTED[1]!)).toBe('Page 2 “Pay”');
    expect(sourceWords({ source: 'frame name', frameName: '[S1] Pay' })).toBe('linked by frame name “[S1] Pay”');
    expect(sourceWords({ source: 'links.yaml' })).toBeUndefined();
    expect(sourceWords(undefined)).toBeUndefined();
  });
});

describe('T51 link a design from the Design tab', () => {
  it('an unlinked story shows the top 3 suggestions with their reason; nothing is linked by itself', async () => {
    const link = vi.fn(() => ok({ ok: true, link: null, linksFile: 'design/links.yaml' }));
    const { server } = await start('#/stories/S1/design', { design: () => ok(design()), designLink: link });
    const list = await screen.findByTestId('design-suggested');
    expect(within(list).getByRole('heading', { name: 'Suggested' })).toBeInTheDocument();
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByTestId('design-suggested-0')).toHaveTextContent('Frame “Pay form” on page 2 “Pay”');
    expect(screen.getByTestId('design-suggested-0')).toHaveTextContent('matches: pay');
    expect(screen.getByTestId('design-suggested-0-picture')).toHaveAttribute('src', 'design/frames/pay-form.png');
    expect(screen.getByTestId('design-suggested-2-picture')).toHaveAttribute('src', `design-thumbnail?file=${encodeURIComponent(FILE)}`);
    expect(screen.getByTestId('design-suggested-2')).toHaveTextContent('file thumbnail');
    expect(screen.queryByTestId('design-suggested-3')).toBeNull();
    expect(server.posts('api/design/link')).toHaveLength(0);
    expect(link).not.toHaveBeenCalled();
    // The hand-written line stays, folded away.
    expect(screen.getByTestId('design-link-line')).toHaveTextContent('S1: { file: design/<name>.figcraft');
  });

  it('one click on a suggestion links it (token sent) and reads the links again', async () => {
    let linked = false;
    const { server, user } = await start('#/stories/S1/design', {
      design: () => ok(linked ? design({ story: { file: FILE, page: 2, frame: 'Pay form', png: 'design/frames/pay-form.png' }, suggestions: [], storySource: { source: 'links.yaml' } }) : design()),
      designLink: () => {
        linked = true;
        return ok({ ok: true, link: { file: FILE, page: 2, frame: 'Pay form', png: 'design/frames/pay-form.png' }, linksFile: 'design/links.yaml' });
      },
    });
    await user.click(await screen.findByTestId('design-suggested-0-link'));
    const post = server.posts('api/design/link');
    expect(post).toHaveLength(1);
    expect(post[0]!.body).toEqual({ epic: 'shop-checkout', story: 'S1', file: FILE, page: 2, frame: 'Pay form' });
    expect(post[0]!.headers['x-rehearse-token']).toBe(SESSION.token);
    expect(await screen.findByTestId('design-msg')).toHaveTextContent('Linked S1 to design/shop.figcraft · page 2 · frame “Pay form”.');
    expect(await screen.findByTestId('design-story-png')).toHaveAttribute('src', 'design/frames/pay-form.png');
    expect(screen.getByTestId('design-story-caption')).toHaveTextContent('frame “Pay form”');
    expect(server.gets('api/design?story=S1').length).toBeGreaterThanOrEqual(2);
  });

  it('the picker lists files, then pages and frames with their pictures; one click links a page or a frame', async () => {
    const { server, user } = await start('#/stories/S1/design', { design: () => ok(design()), designLink: () => ok({ ok: true, link: { file: FILE, page: 1 }, linksFile: 'design/links.yaml' }) });
    await user.click(await screen.findByTestId('design-link-open'));
    const picker = screen.getByTestId('design-picker');
    expect(within(picker).getByTestId('design-picker-file-0')).toHaveTextContent(FILE);
    expect(within(picker).getByTestId('design-picker-file-1')).toHaveTextContent('design/other.figcraft');
    expect(within(picker).queryByTestId('design-picker-pages')).toBeNull();
    await user.click(within(picker).getByTestId('design-picker-file-0'));
    expect(within(picker).getByTestId('design-picker-file-0')).toHaveAttribute('aria-pressed', 'true');
    expect(within(picker).getByTestId('design-picker-page-1')).toHaveTextContent('1. Home');
    expect(within(picker).getByTestId('design-picker-page-1-picture')).toHaveAttribute('src', `design-thumbnail?file=${encodeURIComponent(FILE)}`);
    expect(within(picker).getByTestId('design-picker-page-2-picture')).toHaveAttribute('src', 'design/2-pay.png');
    expect(within(picker).getByTestId('design-picker-frame-20-picture')).toHaveAttribute('src', 'design/frames/pay-form.png');
    expect(within(picker).getByTestId('design-picker-link-frame-20')).toHaveTextContent('Link frame “Pay form”');
    await user.click(within(picker).getByTestId('design-picker-link-page-1'));
    expect(server.posts('api/design/link')[0]!.body).toEqual({ epic: 'shop-checkout', story: 'S1', file: FILE, page: 1 });
    await waitFor(() => expect(screen.queryByTestId('design-picker')).toBeNull());
    expect(screen.getByTestId('design-msg')).toHaveTextContent('Linked S1 to design/shop.figcraft · page 1.');
  });

  it('a frame in the picker links with its id; Cancel closes the picker; a refusal is said', async () => {
    const { server, user } = await start('#/stories/S1/design', {
      design: () => ok(design({ index: [INDEX[0]!] })),
      designLink: () => ({ status: 404, body: { ok: false, reason: 'file not in design/', error: 'design/shop.figcraft is not a FigCraft file the design index has under design/' } }),
    });
    await user.click(await screen.findByTestId('design-link-open'));
    // One file: its pages show at once.
    await user.click(screen.getByTestId('design-picker-link-frame-20'));
    expect(server.posts('api/design/link')[0]!.body).toEqual({ epic: 'shop-checkout', story: 'S1', file: FILE, page: 2, frame: '20' });
    expect(await screen.findByTestId('design-msg')).toHaveTextContent('Could not link S1: design/shop.figcraft is not a FigCraft file the design index has under design/');
    expect(screen.getByTestId('design-picker')).toBeInTheDocument();
    await user.click(screen.getByTestId('design-picker-cancel'));
    expect(screen.queryByTestId('design-picker')).toBeNull();
  });

  it('a linked story: Change opens the picker, Unlink posts unlink:true', async () => {
    let linked = true;
    const { server, user } = await start('#/stories/S1/design', {
      design: () => ok(linked ? design({ story: { file: FILE, page: 2, png: 'design/2-pay.png' }, storySource: { source: 'links.yaml' }, suggestions: [] }) : design()),
      designLink: () => {
        linked = false;
        return ok({ ok: true, link: null, linksFile: 'design/links.yaml' });
      },
    });
    await user.click(await screen.findByTestId('design-change'));
    expect(screen.getByTestId('design-picker')).toBeInTheDocument();
    await user.click(screen.getByTestId('design-change'));
    expect(screen.queryByTestId('design-picker')).toBeNull();
    expect(screen.queryByTestId('design-source')).toBeNull();
    await user.click(screen.getByTestId('design-unlink'));
    expect(server.posts('api/design/link')[0]!.body).toEqual({ epic: 'shop-checkout', story: 'S1', unlink: true });
    expect(await screen.findByTestId('design-msg')).toHaveTextContent('Unlinked S1.');
    expect(await screen.findByTestId('design-none')).toBeInTheDocument();
  });

  it('a link by frame name says so, offers Change (a links.yaml entry wins) and no Unlink', async () => {
    await start('#/stories/S1/design', {
      design: () => ok(design({ story: { file: FILE, page: 2, frame: 'Pay form' }, storySource: { source: 'frame name', frameName: '[S1] Pay form' }, storyPicture: { kind: 'file thumbnail', file: FILE }, suggestions: [] })),
    });
    expect(await screen.findByTestId('design-source')).toHaveTextContent('linked by frame name “[S1] Pay form”');
    expect(screen.getByTestId('design-change')).toBeInTheDocument();
    expect(screen.queryByTestId('design-unlink')).toBeNull();
    expect(screen.getByTestId('design-story-png')).toHaveAttribute('src', `design-thumbnail?file=${encodeURIComponent(FILE)}`);
    expect(screen.getByTestId('design-story-thumbnail')).toHaveTextContent('file thumbnail');
  });

  it('a T50 server (no index): no picker and no suggestions, the line to add as before', async () => {
    const { suggestions: _s, index: _i, storyBoxes: _b, boxSuggestions: _bs, ...t50 } = design();
    await start('#/stories/S1/design', { design: () => ok(t50) });
    expect(await screen.findByTestId('design-none')).toHaveTextContent('To link one, add this line');
    expect(screen.queryByTestId('design-link-open')).toBeNull();
    expect(screen.queryByTestId('design-suggested')).toBeNull();
  });
});

describe('T51 refresh pictures', () => {
  const linked = () => ok(design({ story: { file: FILE, page: 2, png: 'design/2-pay.png' }, storySource: { source: 'links.yaml' }, storyPicture: { kind: 'page', png: 'design/2-pay.png' }, suggestions: [] }));

  it('says what it wrote and reads the PNG again', async () => {
    const { server, user } = await start('#/stories/S1/design', { design: linked, designRefresh: () => ok({ ok: true, wrote: ['design/2-pay.png'], items: [], message: 'Wrote design/2-pay.png.' }) });
    expect(await screen.findByTestId('design-story-png')).toHaveAttribute('src', 'design/2-pay.png');
    await user.click(screen.getByTestId('design-refresh'));
    expect(server.posts('api/design/refresh')[0]!.body).toEqual({ story: 'S1' });
    expect(server.posts('api/design/refresh')[0]!.headers['x-rehearse-token']).toBe(SESSION.token);
    expect(await screen.findByTestId('design-msg')).toHaveTextContent('Wrote design/2-pay.png.');
    await waitFor(() => expect(screen.getByTestId('design-story-png')).toHaveAttribute('src', 'design/2-pay.png?v=1'));
  });

  it('FigCraft not running: open the file in FigCraft (port 4800)', async () => {
    const { user } = await start('#/stories/S1/design', {
      design: linked,
      designRefresh: () => ({ status: 503, body: { ok: false, reason: 'FigCraft not running', error: 'Open the file in FigCraft (port 4800) to refresh pictures' } }),
    });
    await user.click(await screen.findByTestId('design-refresh'));
    const msg = await screen.findByTestId('design-msg');
    expect(msg).toHaveTextContent('Open the file in FigCraft (port 4800) to refresh pictures');
    expect(msg).toHaveClass('warn');
    expect(screen.getByTestId('design-story-png')).toHaveAttribute('src', 'design/2-pay.png');
  });

  it('the file is not the active tab: says which tab is', async () => {
    const { user } = await start('#/stories/S1/design', {
      design: linked,
      designRefresh: () => ({ status: 409, body: { ok: false, reason: 'file not the active tab', error: 'design/shop.figcraft is not the active tab in FigCraft (the active tab is other.figcraft); open it there, then refresh pictures' } }),
    });
    await user.click(await screen.findByTestId('design-refresh'));
    expect(await screen.findByTestId('design-msg')).toHaveTextContent('is not the active tab in FigCraft (the active tab is other.figcraft)');
  });
});

describe('T51 the box drawer links a box', () => {
  it('an unlinked box of the story: its suggestion links the box in one click', async () => {
    const { server, user } = await start('#/stories/S1/how?box=cart', { design: () => ok(design()), designLink: () => ok({ ok: true, link: { file: FILE, page: 1 }, linksFile: 'design/links.yaml' }) });
    const d = await screen.findByTestId('box-drawer');
    const section = await within(d).findByTestId('drawer-design');
    expect(within(section).getByTestId('drawer-design-S1-none')).toHaveTextContent('No design linked to this box for S1');
    expect(within(section).getByTestId('drawer-design-S1-suggested-0')).toHaveTextContent('Page 1 “Home”');
    await user.click(within(section).getByTestId('drawer-design-S1-suggested-0-link'));
    expect(server.posts('api/design/link')[0]!.body).toEqual({ epic: 'shop-checkout', story: 'S1', box: 'cart', file: FILE, page: 1 });
    expect(await within(section).findByTestId('drawer-design-S1-msg')).toHaveTextContent('Linked box cart of S1 to design/shop.figcraft · page 1.');
  });

  it('the picker in the drawer; a linked box offers Change and Unlink', async () => {
    const { server, user } = await start('#/stories/S1/how?box=pay', {
      design: () => ok(design({ boxes: { pay: { file: FILE, page: 2, png: 'design/2-pay.png' } }, boxSources: { pay: { source: 'links.yaml' } } })),
      designLink: () => ok({ ok: true, link: null, linksFile: 'design/links.yaml' }),
    });
    const d = await screen.findByTestId('box-drawer');
    const section = await within(d).findByTestId('drawer-design');
    expect(within(section).getByTestId('drawer-design-S1-png')).toHaveAttribute('src', 'design/2-pay.png');
    await user.click(within(section).getByTestId('drawer-design-S1-change'));
    expect(within(section).getByTestId('drawer-design-S1-picker')).toBeInTheDocument();
    await user.click(within(section).getByTestId('drawer-design-S1-unlink'));
    expect(server.posts('api/design/link')[0]!.body).toEqual({ epic: 'shop-checkout', story: 'S1', box: 'pay', unlink: true });
  });

  it('a box linked by frame name says so and has no Unlink', async () => {
    await start('#/stories/S1/how?box=pay', {
      design: () => ok(design({ boxes: { pay: { file: FILE, page: 2, frame: 'Pay form' } }, boxSources: { pay: { source: 'frame name', frameName: '[S1/pay] Pay form' } } })),
    });
    const d = await screen.findByTestId('box-drawer');
    expect(await within(d).findByTestId('drawer-design-S1-source')).toHaveTextContent('linked by frame name “[S1/pay] Pay form”');
    expect(within(d).queryByTestId('drawer-design-S1-unlink')).toBeNull();
  });
});
