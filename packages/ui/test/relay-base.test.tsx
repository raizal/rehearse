// T67: through the relay of the bb plugin, the page has `<meta name="rehearse-base">`. Each
// request of the UI then goes to that base, with the serve path as an encoded query value. Without
// the meta, the paths stay relative. FigCraft cannot open through the relay: a note says what to do.

import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { at, relayed } from '../src/base.js';
import type { DesignInfo } from '../src/design-api.js';
import { pictureSrc } from '../src/model/design.js';
import { reviewEpic, seeAll } from './fixture.js';
import { mockServer } from './mock-server.js';

const BASE = '/api/v1/plugins/rehearse/http/relay?lease=L1&path=';

function setBase(content: string | null): void {
  document.querySelector('meta[name="rehearse-base"]')?.remove();
  if (content === null) return;
  const meta = document.createElement('meta');
  meta.name = 'rehearse-base';
  meta.content = content;
  document.head.append(meta);
}

afterEach(() => {
  setBase(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('T67 the relay base of the UI', () => {
  it('without the meta, a path stays the same', () => {
    expect(relayed()).toBe(false);
    expect(at('api/epic')).toBe('api/epic');
    expect(pictureSrc({ kind: 'page', png: 'design/14.png' })).toBe('design/14.png');
  });

  it('with the meta, a path goes to the base as one encoded query value', () => {
    setBase(BASE);
    expect(relayed()).toBe(true);
    expect(at('api/graph?verb=coverage&x=1')).toBe(`${BASE}${encodeURIComponent('/api/graph?verb=coverage&x=1')}`);
    expect(at('./design/a b.png')).toBe(`${BASE}${encodeURIComponent('/design/a b.png')}`);
    expect(pictureSrc({ kind: 'file thumbnail', file: 'design/x.figcraft' })).toBe(`${BASE}${encodeURIComponent('/design-thumbnail?file=design%2Fx.figcraft')}`);
    expect(pictureSrc({ kind: 'page', png: 'design/14.png' }, 2)).toBe(`${BASE}${encodeURIComponent('/design/14.png?v=2')}`);
  });

  it('the app sends its requests through the relay, and FigCraft shows a note in place of the editor', async () => {
    setBase(BASE);
    window.history.replaceState(null, '', '#/stories/S1/design');
    const view = reviewEpic();
    seeAll(view);
    const info: DesignInfo = {
      ok: true,
      slug: 'shop-checkout',
      story: { file: 'design/rehearse-review.figcraft', page: 14, png: 'design/14-story-tests.png' },
      boxes: {},
      findings: [],
      linksFile: 'design/links.yaml',
      linkLine: '',
      figcraft: { fetched: true, version: '0.9.0', url: '/figcraft/', command: 'pnpm rehearse figcraft fetch' },
      author: 'Builder Example',
    };
    mockServer({ epic: () => view, design: () => ({ status: 200, body: info }) });
    // The mock server knows serve paths: this fetch reads the path back from the relay address.
    const serve = globalThis.fetch;
    const urls: string[] = [];
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      urls.push(url);
      expect(url.startsWith(BASE)).toBe(true);
      return serve(decodeURIComponent(url.slice(BASE.length)).replace(/^\//, ''), init);
    });
    render(<App />);
    await screen.findByTestId('epic-slug');
    expect(await screen.findByTestId('design-story-png')).toHaveAttribute('src', `${BASE}${encodeURIComponent('/design/14-story-tests.png')}`);
    expect(urls).toContain(`${BASE}${encodeURIComponent('/api/epic')}`);
    expect(urls).toContain(`${BASE}${encodeURIComponent('/api/session')}`);
    expect(screen.getByTestId('design-relay-note')).toHaveTextContent('FigCraft cannot open through the bb connect relay');
    expect(screen.getByTestId('design-relay-note')).toHaveTextContent('bb connect expose <port>');
    expect(screen.getByTestId('design-edit')).toBeDisabled();
  });
});
