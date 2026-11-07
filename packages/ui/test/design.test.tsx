// T50: the story Design tab (the linked page as a PNG, the line to add when there is no link, the
// FigCraft web build not fetched), the embedded FigCraft editor in host mode (the file goes in on
// ready, a Save comes back to the repo, other saves are downloads, unsaved changes are guarded),
// the box drawer's design, and the design beside the latest test run where the owner approves and
// signs off.

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BirdviewInfo } from '@rehearse/server';
import { App } from '../src/App.js';
import { SignOffPreview } from '../src/components/SignOffPreview.js';
import type { DesignInfo } from '../src/design-api.js';
import { reviewEpic, seeAll } from './fixture.js';
import { mockServer, SESSION, type MockRoutes } from './mock-server.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

const LINK = { file: 'design/rehearse-review.figcraft', page: 14, png: 'design/14-story-tests.png' };

function design(over: Partial<DesignInfo> = {}): DesignInfo {
  return {
    ok: true,
    slug: 'shop-checkout',
    story: LINK,
    boxes: {},
    findings: [],
    linksFile: 'design/links.yaml',
    linkLine: 'S1: { file: design/<name>.figcraft, page: <page number or name>, png: design/<page>.png }',
    figcraft: { fetched: true, version: '0.9.0', url: '/figcraft/', command: 'pnpm rehearse figcraft fetch' },
    author: 'Builder Example',
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
  return { server, user, view };
}

describe('T50 the story Design tab', () => {
  it('a linked story: the Design tab shows the PNG, the file and page, and which page to open', async () => {
    const { server } = await start('#/stories/S1/design', { design: () => ok(design()) });
    expect(screen.getByTestId('story-tab-design')).toHaveTextContent('Design');
    expect(screen.getByTestId('story-tab-design')).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByTestId('design-story-png')).toHaveAttribute('src', 'design/14-story-tests.png');
    expect(screen.getByTestId('design-story-caption')).toHaveTextContent('design/rehearse-review.figcraft · page 14');
    expect(screen.getByTestId('design-hint')).toHaveTextContent('Open page 14 of design/rehearse-review.figcraft');
    expect(screen.getByTestId('design-edit')).toBeEnabled();
    expect(screen.queryByTestId('design-not-fetched')).toBeNull();
    expect(server.gets('api/design?story=S1')[0]!.headers['x-rehearse-token']).toBe(SESSION.token);
  });

  it('a link without a PNG says so; bad links are listed in words', async () => {
    const finding = { kind: 'reference' as const, file: 'design/links.yaml', path: 'epics.shop-checkout.S1.file', message: 'design/gone.figcraft does not exist', refs: ['S1'] };
    await start('#/stories/S1/design', { design: () => ok(design({ story: { file: LINK.file, page: 'Story code' }, findings: [finding] })) });
    expect(await screen.findByTestId('design-story-no-png')).toHaveTextContent('No PNG of this page is linked');
    expect(screen.getByTestId('design-story-caption')).toHaveTextContent('page “Story code”');
    expect(screen.getByTestId('design-findings')).toHaveTextContent('design/gone.figcraft does not exist');
  });

  it('no link: "No design linked" and the line to add to design/links.yaml; no Edit button', async () => {
    await start('#/stories/S1/design', { design: () => ok(design({ story: null })) });
    const none = await screen.findByTestId('design-none');
    expect(none).toHaveTextContent('No design linked');
    expect(none).toHaveTextContent('design/links.yaml');
    expect(none).toHaveTextContent('epics: shop-checkout:');
    expect(screen.getByTestId('design-link-line')).toHaveTextContent('S1: { file: design/<name>.figcraft, page: <page number or name>, png: design/<page>.png }');
    expect(screen.queryByTestId('design-edit')).toBeNull();
  });

  it('FigCraft web not fetched: the command in words, and "Fetch FigCraft web" POSTs and reads the links again', async () => {
    let fetched = false;
    const { server, user } = await start('#/stories/S1/design', {
      design: () => ok(design({ figcraft: { fetched, url: '/figcraft/', command: 'pnpm rehearse figcraft fetch' } })),
      figcraftFetch: () => {
        fetched = true;
        return ok({ ok: true, version: '0.9.0' });
      },
    });
    const notice = await screen.findByTestId('design-not-fetched');
    expect(notice).toHaveTextContent('The FigCraft web build is not fetched');
    expect(notice).toHaveTextContent('pnpm rehearse figcraft fetch');
    expect(screen.getByTestId('design-edit')).toBeDisabled();
    await user.click(screen.getByTestId('design-fetch'));
    await waitFor(() => expect(screen.queryByTestId('design-not-fetched')).toBeNull());
    expect(server.posts('api/figcraft/fetch')).toHaveLength(1);
    expect(server.posts('api/figcraft/fetch')[0]!.headers['x-rehearse-token']).toBe(SESSION.token);
    expect(server.gets('api/design?story=S1').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId('design-msg')).toHaveTextContent('Fetched FigCraft web 0.9.0.');
    expect(screen.getByTestId('design-edit')).toBeEnabled();
  });

  it('a failed fetch says the server error', async () => {
    const { user } = await start('#/stories/S1/design', {
      design: () => ok(design({ figcraft: { fetched: false, url: '/figcraft/', command: 'pnpm rehearse figcraft fetch' } })),
      figcraftFetch: () => ({ status: 502, body: { ok: false, reason: 'network', error: 'github.com did not answer' } }),
    });
    await user.click(await screen.findByTestId('design-fetch'));
    expect(await screen.findByText('Could not fetch FigCraft web: github.com did not answer')).toBeInTheDocument();
  });
});

describe('T50 FigCraft in host mode', () => {
  const FILE_BYTES = new TextEncoder().encode('figcraft file');

  async function openEditor(routes: Partial<MockRoutes> = {}) {
    const started = await start('#/stories/S1/design', { design: () => ok(design()), designFile: () => ({ status: 200, bytes: FILE_BYTES }), ...routes });
    await started.user.click(await screen.findByTestId('design-edit'));
    const frame = screen.getByTestId('figcraft-frame') as HTMLIFrameElement;
    const win = frame.contentWindow!;
    const post = vi.spyOn(win, 'postMessage').mockImplementation(() => undefined);
    const send = (data: unknown, source: Window | null = win, origin = window.location.origin) =>
      act(() => {
        window.dispatchEvent(new MessageEvent('message', { data, origin, source }));
      });
    return { ...started, frame, post, send };
  }

  it('opens FigCraft at figcraft/ in host mode; on ready it sends the file and says which page to open', async () => {
    const { frame, post, send, server } = await openEditor();
    expect(frame).toHaveAttribute('src', 'figcraft/?host=parent&author=Builder%20Example');
    expect(screen.getByTestId('figcraft-banner')).toHaveTextContent('Open page 14: FigCraft starts on its home screen and cannot open the page itself.');
    await send({ type: 'figcraft:ready', version: '1', appVersion: '0.9.0' });
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [data, target] = post.mock.calls[0]! as [{ type: string; name: string; bytes: ArrayBuffer }, string];
    expect(target).toBe(window.location.origin);
    expect(data.type).toBe('figcraft:open');
    expect(data.name).toBe('rehearse-review.figcraft');
    expect(new TextDecoder().decode(data.bytes)).toBe('figcraft file');
    expect(server.gets('api/design/file?file=design%2Frehearse-review.figcraft')[0]!.headers['x-rehearse-token']).toBe(SESSION.token);
  });

  it('ignores a message from another window or another origin', async () => {
    const { post, send } = await openEditor();
    await send({ type: 'figcraft:ready' }, window);
    await send({ type: 'figcraft:ready' }, undefined, 'https://evil.example');
    await send({ type: 'figcraft:dirty', dirty: true }, window);
    expect(post).not.toHaveBeenCalled();
    expect(screen.queryByTestId('figcraft-dirty')).toBeNull();
  });

  it('dirty shows the unsaved dot; a Save of the sent file is written through the server with base64', async () => {
    let saved: { file: string; bytes: string } | undefined;
    const { post, send, server } = await openEditor({
      designSave: (body) => {
        saved = body;
        return ok({ ok: true, file: body.file, size: 12 });
      },
    });
    await send({ type: 'figcraft:ready' });
    await waitFor(() => expect(post).toHaveBeenCalled());
    await send({ type: 'figcraft:dirty', dirty: true });
    expect(screen.getByTestId('figcraft-dirty')).toHaveTextContent('Unsaved changes');
    const bytes = new TextEncoder().encode('new design');
    await send({ type: 'figcraft:save', name: 'rehearse-review.figcraft', saveAs: false, bytes: bytes.buffer });
    expect(await screen.findByText('Saved to design/rehearse-review.figcraft — commit it when you are happy')).toBeInTheDocument();
    expect(server.posts('api/design/save')).toHaveLength(1);
    expect(server.posts('api/design/save')[0]!.headers['x-rehearse-token']).toBe(SESSION.token);
    expect(saved).toEqual({ file: 'design/rehearse-review.figcraft', bytes: btoa('new design') });
    await send({ type: 'figcraft:dirty', dirty: false });
    expect(screen.queryByTestId('figcraft-dirty')).toBeNull();
  });

  it('a failed save says the server error', async () => {
    const { post, send } = await openEditor({ designSave: () => ({ status: 400, body: { ok: false, reason: 'bad-file', error: 'the file is not a FigCraft file' } }) });
    await send({ type: 'figcraft:ready' });
    await waitFor(() => expect(post).toHaveBeenCalled());
    await send({ type: 'figcraft:save', name: 'rehearse-review.figcraft', saveAs: false, bytes: new Uint8Array([1]) });
    expect(await screen.findByTestId('figcraft-msg')).toHaveTextContent('Could not save design/rehearse-review.figcraft: the file is not a FigCraft file');
  });

  it('Save As and exports are downloads, never written to the repo', async () => {
    const create = vi.fn(() => 'blob:figcraft');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const { post, send, server } = await openEditor({ designSave: () => ok({ ok: true, file: 'x', size: 1 }) });
    await send({ type: 'figcraft:ready' });
    await waitFor(() => expect(post).toHaveBeenCalled());
    await send({ type: 'figcraft:save', name: 'rehearse-review.figcraft', saveAs: true, bytes: new Uint8Array([1, 2]).buffer });
    expect(await screen.findByTestId('figcraft-msg')).toHaveTextContent('Saved as a download, not written to the repo: rehearse-review.figcraft.');
    await send({ type: 'figcraft:save', name: 'page-14.png', saveAs: false, bytes: new Uint8Array([3]) });
    await waitFor(() => expect(screen.getByTestId('figcraft-msg')).toHaveTextContent('page-14.png'));
    expect(create).toHaveBeenCalledTimes(2);
    expect(click).toHaveBeenCalledTimes(2);
    expect(server.posts('api/design/save')).toHaveLength(0);
  });

  it('unsaved changes: Close asks first, and leaving the page is held while dirty', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { user, send } = await openEditor();
    const unload = () => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(unload()).toBe(false);
    await send({ type: 'figcraft:dirty', dirty: true });
    expect(unload()).toBe(true);
    await user.click(screen.getByTestId('figcraft-close'));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('unsaved changes'));
    expect(screen.getByTestId('figcraft-editor')).toBeInTheDocument();
    confirm.mockReturnValue(true);
    await user.click(screen.getByTestId('figcraft-close'));
    expect(screen.queryByTestId('figcraft-editor')).toBeNull();
    expect(unload()).toBe(false);
  });

  it('unsaved changes: going back in rehearse asks first, and staying undoes the step', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => undefined);
    const { send } = await openEditor();
    await send({ type: 'figcraft:dirty', dirty: true });
    // The browser has already stepped back to the What tab when popstate fires.
    const back = () =>
      act(() => {
        window.history.replaceState(null, '', '#/stories/S1/what');
        window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
      });
    await back();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('unsaved changes'));
    expect(screen.getByTestId('figcraft-editor')).toBeInTheDocument();
    expect(go).toHaveBeenCalledTimes(1);
    // The owner drops the changes: the step back goes through and the editor closes.
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    confirm.mockReturnValue(true);
    await back();
    await waitFor(() => expect(screen.queryByTestId('figcraft-editor')).toBeNull());
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('a clean editor closes without asking', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const { user } = await openEditor();
    await user.click(screen.getByTestId('figcraft-close'));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByTestId('figcraft-editor')).toBeNull();
  });

  it('figcraft:failed is said in plain words', async () => {
    const { send } = await openEditor();
    await send({ type: 'figcraft:failed', error: 'WebGL is not available' });
    expect(screen.getByTestId('figcraft-msg')).toHaveTextContent('FigCraft could not start: WebGL is not available.');
  });
});

const KEY = 'tests/S1.spec.ts:5';
function birdview(results: Record<string, { last?: 'passed' | 'failed' }>): BirdviewInfo {
  return {
    port: 3298,
    playerUrl: 'http://127.0.0.1:3298/',
    projectDir: '/repo/e2e',
    storyId: 'S1',
    playlist: { name: 'S1', tests: [{ file: 'tests/S1.spec.ts', line: 5, name: 'S1-buy', about: 'Buyer pays', steps: {} }] },
    player: { kind: 'ours', status: 'idle', results },
  };
}

describe('T50 the box drawer shows the box design', () => {
  it('the box of the open story has its own link: its PNG and page under "Design"', async () => {
    await start('#/stories/S1/how?box=pay', { design: () => ok(design({ boxes: { pay: { file: LINK.file, page: 15, png: 'design/15-pay.png' } } })) });
    const d = await screen.findByTestId('box-drawer');
    const section = await within(d).findByTestId('drawer-design');
    expect(within(section).getByRole('heading', { name: 'Design' })).toBeInTheDocument();
    expect(within(section).getByTestId('drawer-design-S1-png')).toHaveAttribute('src', 'design/15-pay.png');
    expect(within(section).getByTestId('drawer-design-S1-caption')).toHaveTextContent('design/rehearse-review.figcraft · page 15');
  });

  it('no box link, or no design API: the drawer works as before', async () => {
    await start('#/stories/S1/how?box=cart', { design: () => ok(design({ boxes: { pay: LINK } })) });
    const d = await screen.findByTestId('box-drawer');
    expect(within(d).getByTestId('drawer-title')).toHaveTextContent('Check out the cart');
    await waitFor(() => expect(within(d).getByTestId('drawer-scenarios')).toBeInTheDocument());
    expect(within(d).queryByTestId('drawer-design')).toBeNull();
  });
});

describe('T50 design beside the result, where the owner approves and signs off', () => {
  it('the approve card of a linked story shows the design PNG beside the latest test run', async () => {
    await start('#/stories/S1/board/S1-buy', { design: () => ok(design()), birdview: () => ok(birdview({ [KEY]: { last: 'passed' } })) });
    const beside = await screen.findByTestId('design-beside-S1');
    expect(within(beside).getByTestId('design-beside-picture-S1-png')).toHaveAttribute('src', 'design/14-story-tests.png');
    await waitFor(() => expect(within(beside).getByTestId('design-beside-run-S1')).toHaveTextContent('1 of 1 tests pass'));
    expect(within(beside).getByTestId('design-beside-run-S1')).toHaveTextContent('S1-buy passed');
    expect(screen.getByTestId('card-approval-state')).toBeInTheDocument();
  });

  it('no run yet says so', async () => {
    await start('#/stories/S1/board/S1-buy', { design: () => ok(design()), birdview: () => ok(birdview({})) });
    const beside = await screen.findByTestId('design-beside-S1');
    await waitFor(() => expect(within(beside).getByTestId('design-beside-run-S1')).toHaveTextContent('No run yet'));
  });

  it('an unlinked story shows nothing new on the approve card', async () => {
    const { server } = await start('#/stories/S1/board/S1-buy', { design: () => ok(design({ story: null })), birdview: () => ok(birdview({})) });
    await screen.findByTestId('card-approval-state');
    await waitFor(() => expect(server.gets('api/design?story=S1').length).toBeGreaterThan(0));
    expect(screen.queryByTestId('design-beside-S1')).toBeNull();
  });

  it('the sign-off preview of a linked story shows the design beside the run; an unlinked one does not', async () => {
    const view = reviewEpic();
    const preview = (id: string) => ({
      id,
      found: true,
      content: {
        story: { id, role: 'buyer', want: 'to pay', soThat: 'I get my items' },
        requirements: [],
        criteria: [],
        scenarios: [],
        boxes: [],
        roles: [{ id: 'buyer', name: 'Buyer' }],
      },
    });
    mockServer({
      epic: () => view,
      signOffPreview: (ids) => ok({ stories: ids.map(preview) }),
      design: (id) => ok(design(id === 'S1' ? {} : { story: null })),
      birdview: () => ok(birdview({ [KEY]: { last: 'failed' } })),
    });
    render(<SignOffPreview view={view} storyIds={['S1', 'S2']} />);
    const beside = await screen.findByTestId('design-beside-S1');
    expect(within(screen.getByTestId('signoff-preview-S1')).getByTestId('design-beside-S1')).toBe(beside);
    await waitFor(() => expect(within(beside).getByTestId('design-beside-run-S1')).toHaveTextContent('0 of 1 tests pass'));
    expect(within(screen.getByTestId('signoff-preview-S2')).queryByTestId('design-beside-S2')).toBeNull();
  });
});
