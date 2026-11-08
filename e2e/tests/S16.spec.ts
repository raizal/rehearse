// The e2e tests of story S16 ("to see and edit a story's design from inside rehearse"), one for each scenario, named after the scenario id.
// `rehearse e2e-start` wrote this start file from docs/epics/2026-11-05-rehearse/scenarios/S16.yaml. Each step title
// starts with its flow box, so Birdview maps steps to boxes. Each step fails until you write it: replace the throw.
// Work only from the scenarios and the product that runs (the UI and the CLI), not from the code of the boxes.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';
import { test as base, expect, serve, stop } from './serve.js';

const SHOP = fileURLToPath(new URL('../../packages/core/test/fixtures/shop', import.meta.url));
const SLUG = '2026-11-05-shop';
const WASM = 'figcraft-web-abc_bg.wasm';
// A PNG of 1 x 1 pixel: the picture of the linked design page.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** A zip file without compression: a `.figcraft` file is a zip with a document.json. */
function storeZip(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const n = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(n.length, 28);
    cen.writeUInt32LE(offset, 42);
    parts.push(local, n, data);
    central.push(cen, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

/**
 * A git repo in a temp folder with the shop record, a design link for story S1 and a fetched
 * FigCraft web build (a small one, made here: the test does not use the network). Serve runs on it.
 */
const test = base.extend<{ designUrl: string }>({
  designUrl: async ({}, use) => {
    const repo = mkdtempSync(join(tmpdir(), 'rehearse-e2e-s16-'));
    execFileSync('git', ['init', '-q', repo]);
    cpSync(SHOP, join(repo, 'docs/epics', SLUG), { recursive: true });
    mkdirSync(join(repo, 'design'));
    writeFileSync(join(repo, 'design/links.yaml'), `epics:\n  ${SLUG}:\n    S1: { file: design/shop.figcraft, page: 1, png: design/1-pay.png }\n`);
    writeFileSync(join(repo, 'design/1-pay.png'), PNG);
    const page = { id: 1, name: '1 Pay', type: 'page', children: [] };
    writeFileSync(join(repo, 'design/shop.figcraft'), storeZip({ 'document.json': JSON.stringify({ format: 'figcraft', version: 1, name: 'shop', pages: [1], nodes: { 1: page } }) }));
    const web = join(repo, '.rehearse/figcraft-web/0.16.0');
    mkdirSync(web, { recursive: true });
    writeFileSync(join(web, 'index.html'), '<!doctype html><title>FigCraft</title><p id="figcraft-test-build">The FigCraft test build</p>');
    writeFileSync(join(web, WASM), Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
    const { child, url } = await serve(join(repo, 'docs/epics', SLUG));
    try {
      await use(url);
    } finally {
      await stop(child);
      rmSync(repo, { recursive: true, force: true });
    }
  },
});

test('S16-host: Serve hosts FigCraft web under /figcraft/ on its own origin, framed by its own pages only', async ({ page, designUrl }) => {
  // The main path of S16: "done" needs this test passed on the real screens.
  // Checks S16-A3: given the web build is fetched; when the builder opens rehearse serve; then serve hosts it under `/figcraft/` on its own origin, `.wasm` as application/wasm, and only serve's own pages may frame it; not fetched, the Design tab says so in plain words with the command to run and a button that fetches it.
  const origin = new URL(designUrl).origin;

  await test.step('review/readiness: Readiness chain and correction counts', async () => {
    // Step 1 of 5.
    // The builder opens rehearse serve and the story S1.
    await page.goto(designUrl);
    await expect(page.getByTestId('epic-title')).toHaveText('Shop checkout');
    await page.getByTestId('nav-bigpicture').click();
    await page.getByTestId('bp-story-S1').click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('to pay for my cart');
  });

  await test.step('design-links: Read and check design/links.yaml', async () => {
    // Step 2 of 5.
    // The link of S1 is good: validate stays OK.
    await expect(page.getByTestId('report-status')).toHaveText(/validate: OK/);
  });

  await test.step('design-tab: The story\'s Design tab, and Edit in FigCraft', async () => {
    // Step 3 of 5.
    // The Design tab shows the PNG of the linked page.
    await page.getByTestId('story-tab-design').click();
    const picture = page.locator('img[src*="1-pay.png"]');
    await expect(picture).toBeVisible();
  });

  await test.step('host-figcraft: Serve hosts FigCraft web under /figcraft/, same origin', async () => {
    // Step 4 of 5.
    // Example wasm: given {"file":"/figcraft/figcraft-web-abc_bg.wasm"}; then {"url":"/figcraft/","version":"0.16.0","contentType":"application/wasm","csp":"frame-ancestors 'self'"}.
    const index = await page.request.get(`${origin}/figcraft/`);
    expect(index.status()).toBe(200);
    expect(await index.text()).toContain('The FigCraft test build');
    expect(index.headers()['content-security-policy']).toContain("frame-ancestors 'self'");
    const wasm = await page.request.get(`${origin}/figcraft/${WASM}`);
    expect(wasm.status()).toBe(200);
    expect(wasm.headers()['content-type']).toBe('application/wasm');
    expect(wasm.headers()['content-security-policy']).toContain("frame-ancestors 'self'");
    expect(index.headers()['x-frame-options'] ?? '').not.toMatch(/deny/i);
  });

  await test.step('design-tab: The story\'s Design tab, and Edit in FigCraft', async () => {
    // Step 5 of 5.
    // "Edit in FigCraft" opens the hosted build in a frame of serve's own page, on the same origin.
    await page.getByRole('button', { name: /Edit in FigCraft/ }).click();
    const frame = page.getByTestId('figcraft-frame'); // The src is relative to the page: the checks below resolve it.
    await expect(frame).toBeVisible();
    const src = new URL((await frame.getAttribute('src'))!, page.url());
    expect(src.origin).toBe(origin);
    expect(src.pathname.startsWith('/figcraft/')).toBe(true);
    await expect(page.frameLocator('[data-testid="figcraft-frame"]').locator('#figcraft-test-build')).toHaveText('The FigCraft test build');
  });

  // Expect at the end: {"sameOrigin":true,"xFrameOptionsDeny":false}.
});
