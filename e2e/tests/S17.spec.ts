// The e2e tests of story S17 ("to link a story to its design by picking it, not by editing YAML"), one for each scenario, named after the scenario id.
// `rehearse e2e-start` wrote this start file from docs/epics/2026-11-05-rehearse/scenarios/S17.yaml. Each step title
// starts with its flow box, so Birdview maps steps to boxes. Each step fails until you write it: replace the throw.
// Work only from the scenarios and the product that runs (the UI and the CLI), not from the code of the boxes.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';
import { test as base, expect, serve, stop } from './serve.js';

const SHOP = fileURLToPath(new URL('../../packages/core/test/fixtures/shop', import.meta.url));
const SLUG = '2026-11-05-shop';
// A PNG of 1 x 1 pixel: the picture of a design page.
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
 * A git repo in a temp folder with the shop record and one design file, but no design link. Five
 * pages and frames share words with story S1 ("to pay for my cart"); one page shares none.
 */
const test = base.extend<{ repo: string; designUrl: string }>({
  repo: async ({}, use) => {
    const repo = mkdtempSync(join(tmpdir(), 'rehearse-e2e-s17-'));
    execFileSync('git', ['init', '-q', repo]);
    cpSync(SHOP, join(repo, 'docs/epics', SLUG), { recursive: true });
    mkdirSync(join(repo, 'design'));
    const nodes = {
      1: { id: 1, name: 'Cart checkout', type: 'page', children: [10, 11] },
      10: { id: 10, name: 'Pay for the cart', type: 'frame', parent: 1, children: [], width: 800, height: 600 },
      11: { id: 11, name: 'Charge the buyer', type: 'frame', parent: 1, children: [], width: 800, height: 600 },
      2: { id: 2, name: 'Ship the order', type: 'page', children: [20] },
      20: { id: 20, name: 'Order shipped', type: 'frame', parent: 2, children: [], width: 800, height: 600 },
      3: { id: 3, name: 'Settings', type: 'page', children: [30] },
      30: { id: 30, name: 'Profile', type: 'frame', parent: 3, children: [], width: 800, height: 600 },
    };
    const doc = { format: 'figcraft', version: 1, name: 'shop', pages: [1, 2, 3], nodes };
    writeFileSync(join(repo, 'design/shop.figcraft'), storeZip({ 'document.json': JSON.stringify(doc) }));
    writeFileSync(join(repo, 'design/1-cart-checkout.png'), PNG);
    writeFileSync(join(repo, 'design/2-ship-the-order.png'), PNG);
    writeFileSync(join(repo, 'design/3-settings.png'), PNG);
    try {
      await use(repo);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  },
  designUrl: async ({ repo }, use) => {
    const { child, url } = await serve(join(repo, 'docs/epics', SLUG));
    try {
      await use(url);
    } finally {
      await stop(child);
    }
  },
});

test('S17-suggest: An unlinked story shows the top 3 suggested pages and frames with their reason', async ({ page, repo, designUrl }) => {
  // The main path of S17: "done" needs this test passed on the real screens.
  // Checks S17-A3: given a story or box with no design link; when the builder opens its Design tab or box drawer; then the top 3 pages and frames whose names share words with the story's title, criteria and box titles show as "Suggested", each with its reason ("matches: tests, birdview") and a Link button; a suggestion is never linked by itself.

  await test.step('design-tab: The story\'s Design tab, and Edit in FigCraft', async () => {
    // Step 1 of 5.
    // The builder opens story S1, which has no design link, and its Design tab.
    await page.goto(designUrl);
    await page.getByTestId('nav-bigpicture').click();
    await page.getByTestId('bp-story-S1').click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('to pay for my cart');
    await page.getByTestId('story-tab-design').click();
    await expect(page.getByText('Suggested', { exact: false }).first()).toBeVisible();
  });

  await test.step('design-index: Index the design files under design/', async () => {
    // Step 2 of 5.
    // The design index reads design/shop.figcraft: its pages and frames are the suggestions.
    await expect(page.getByText('Pay for the cart').first()).toBeVisible();
    await expect(page.getByText('Profile')).toHaveCount(0);
  });

  await test.step('suggest-design: Suggest pages and frames for an unlinked story or box', async () => {
    // Step 3 of 5.
    // Example tests-story: given {"storyId":"S9"}; then {"storyId":"S9","suggestions":["User flow, frame Builder reviews and signs (matches: review, sign)"]}.
    // The top 3 show, each with its reason and a Link button.
    // `rehearse design suggest` gives the same 3 for this fixture: "Pay for the cart", "Charge the buyer", "Order shipped".
    await expect(page.getByText(/matches: /)).toHaveCount(3);
    await expect(page.getByText(/matches: pay, cart/)).toBeVisible();
    await expect(page.getByText(/matches: charge, buyer/)).toBeVisible();
    await expect(page.getByText(/matches: order, shipped/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Link', exact: true })).toHaveCount(3);
    await expect(page.getByText('Settings')).toHaveCount(0);
  });

  await test.step('link-design: Link, change or unlink a design in one click', async () => {
    // Step 4 of 5.
    // A suggestion is never linked by itself: no link until the builder presses Link.
    expect(existsSync(join(repo, 'design/links.yaml')) ? readFileSync(join(repo, 'design/links.yaml'), 'utf8') : '').not.toContain('S1');
    await page.getByRole('button', { name: 'Link', exact: true }).first().click();
    await expect.poll(() => (existsSync(join(repo, 'design/links.yaml')) ? readFileSync(join(repo, 'design/links.yaml'), 'utf8') : '')).toMatch(/S1:[\s\S]*design\/shop\.figcraft/);
  });

  await test.step('design-tab: The story\'s Design tab, and Edit in FigCraft', async () => {
    // Step 5 of 5.
    // The Design tab now shows the linked design and its picture, not the suggestions.
    await expect(page.locator('img[src*=".png"]').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Link', exact: true })).toHaveCount(0);
  });

  // Expect at the end: {"shown":3,"linkedByThemselves":false}.
});
