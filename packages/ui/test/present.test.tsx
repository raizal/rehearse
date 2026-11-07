// T52: the Present button of the EPIC page. It asks the server for the deck (token sent), shows it
// in a sandboxed frame focused for the arrow keys, and downloads the HTML and the PDF; no Chromium
// shows the server's plain words. T53: the third download, the HTML and its recordings as one zip.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { reviewEpic } from './fixture.js';
import { mockServer, type MockRoutes } from './mock-server.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

const DECK = '<!doctype html><html><body><section class="slide">Hello</section></body></html>';
const NO_CHROMIUM = 'Chromium is not available here, so rehearse cannot make the PDF.';

async function setup(present: MockRoutes['present']) {
  const view = reviewEpic();
  const server = mockServer({ epic: () => view, present });
  const saved: { name: string; type: string }[] = [];
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:deck'), revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ name: this.download, type: this.href });
  });
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId('epic-slug');
  return { server, user, saved, slug: view.slug };
}

describe('T52 Present', () => {
  it('the EPIC page has a Present button that opens the deck in a sandboxed, focused frame', async () => {
    const { server, user, slug } = await setup(() => ({ status: 200, data: DECK, headers: { 'content-disposition': 'inline; filename="shop-2026-11-07-abc1234.html"', 'x-deck-slides': '12' } }));
    await user.click(screen.getByTestId('present'));
    const frame = await screen.findByTestId('present-frame');
    expect(frame.getAttribute('srcdoc')).toBe(DECK);
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(screen.getByTestId('present-count').textContent).toContain('12 slides');
    expect(screen.getByTestId('present-count').textContent).toContain('shop-2026-11-07-abc1234.html');
    const get = server.calls.find((c) => c.url.startsWith('api/present?'))!;
    expect(get.url).toBe(`api/present?epic=${encodeURIComponent(slug)}`);
    expect(get.headers['x-rehearse-token']).toBe('tok-123');
    frame.dispatchEvent(new Event('load'));
    expect(document.activeElement).toBe(frame);
  });

  it('Download HTML saves the deck under its name; Download PDF fetches the PDF and saves it', async () => {
    const { server, user, saved } = await setup((format) =>
      format === 'pdf'
        ? { status: 200, data: '%PDF', headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="shop.pdf"' } }
        : { status: 200, data: DECK, headers: { 'content-disposition': 'inline; filename="shop.html"', 'x-deck-slides': '3' } },
    );
    await user.click(screen.getByTestId('present'));
    await screen.findByTestId('present-frame');
    await user.click(screen.getByTestId('present-download-html'));
    expect(saved).toEqual([{ name: 'shop.html', type: 'blob:deck' }]);
    await user.click(screen.getByTestId('present-download-pdf'));
    await waitFor(() => expect(saved).toHaveLength(2));
    expect(saved[1]!.name).toBe('shop.pdf');
    expect(server.calls.some((c) => /^api\/present\?epic=.+&format=pdf$/.test(c.url) && c.headers['x-rehearse-token'] === 'tok-123')).toBe(true);
  });

  it('no Chromium: the plain words, and the HTML download still works', async () => {
    const { user, saved } = await setup((format) =>
      format === 'pdf' ? { status: 503, body: { ok: false, error: NO_CHROMIUM } } : { status: 200, data: DECK, headers: { 'x-deck-slides': '3' } },
    );
    await user.click(screen.getByTestId('present'));
    await screen.findByTestId('present-frame');
    await user.click(screen.getByTestId('present-download-pdf'));
    expect((await screen.findByTestId('present-file-error')).textContent).toBe(NO_CHROMIUM);
    await user.click(screen.getByTestId('present-download-html'));
    expect(saved).toHaveLength(1);
  });

  it('HTML + recordings (zip): fetches the zip, saves it, and says how many recordings it holds', async () => {
    const { server, user, saved } = await setup((format) =>
      format === 'zip'
        ? { status: 200, data: 'PK', headers: { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="shop.zip"', 'x-deck-videos': '2' } }
        : { status: 200, data: DECK, headers: { 'x-deck-slides': '3' } },
    );
    await user.click(screen.getByTestId('present'));
    await screen.findByTestId('present-frame');
    expect(screen.getByTestId('present-download-zip').textContent).toBe('HTML + recordings (zip)');
    await user.click(screen.getByTestId('present-download-zip'));
    await waitFor(() => expect(saved).toEqual([{ name: 'shop.zip', type: 'blob:deck' }]));
    expect(screen.getByTestId('present-zip-note').textContent).toMatch(/^shop\.zip: the deck and 2 recordings\. Unzip it/);
    expect(server.calls.some((c) => /^api\/present\?epic=.+&format=zip$/.test(c.url) && c.headers['x-rehearse-token'] === 'tok-123')).toBe(true);
  });

  it('a zip without recordings says it holds the deck only; a failed zip shows the error', async () => {
    let fail = false;
    const { user } = await setup((format) =>
      format !== 'zip'
        ? { status: 200, data: DECK, headers: { 'x-deck-slides': '3' } }
        : fail
          ? { status: 500, body: { ok: false, error: 'the recordings are too big for one zip (over 4 GB)' } }
          : { status: 200, data: 'PK', headers: { 'content-disposition': 'attachment; filename="shop.zip"', 'x-deck-videos': '0' } },
    );
    await user.click(screen.getByTestId('present'));
    await screen.findByTestId('present-frame');
    await user.click(screen.getByTestId('present-download-zip'));
    expect((await screen.findByTestId('present-zip-note')).textContent).toContain('no recording of these tests, so the zip holds the deck only');
    fail = true;
    await user.click(screen.getByTestId('present-download-zip'));
    expect((await screen.findByTestId('present-file-error')).textContent).toMatch(/too big/);
    expect(screen.queryByTestId('present-zip-note')).toBeNull();
  });

  it('a deck that cannot be made says why; Close and Escape close the preview', async () => {
    const { user } = await setup(() => ({ status: 500, body: { ok: false, error: 'broken record' } }));
    await user.click(screen.getByTestId('present'));
    expect((await screen.findByTestId('present-error')).textContent).toContain('broken record');
    await user.click(screen.getByTestId('present-close'));
    expect(screen.queryByTestId('present-dialog')).toBeNull();
    await user.click(screen.getByTestId('present'));
    await screen.findByTestId('present-error');
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('present-dialog')).toBeNull();
  });
});
