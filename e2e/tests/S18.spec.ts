// The e2e tests of story S18 ("to send my supervisor a deck of an EPIC made from its record"), one for each scenario, named after the scenario id.
// `rehearse e2e-start` wrote this start file from docs/epics/2026-11-05-rehearse/scenarios/S18.yaml. Each step title
// starts with its flow box, so Birdview maps steps to boxes. Each step fails until you write it: replace the throw.
// Work only from the scenarios and the product that runs (the UI and the CLI), not from the code of the boxes.

import { cpSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from './serve.js';
import { rehearse, git, freshRepo } from './cli.js';

const SHOP = fileURLToPath(new URL('../../packages/core/test/fixtures/shop', import.meta.url));
const SLUG = '2026-11-05-shop';

type Slide = { key: string; label: string; text: string; html: string };

/** The slides of a deck: the data-key, the aria-label and the plain text of each section. */
function slides(html: string): Slide[] {
  return [...html.matchAll(/<section class="slide[^"]*"[^>]*data-key="([^"]+)"[^>]*aria-label="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g)].map((m) => ({
    key: m[1]!,
    label: m[2]!.replace(/&#39;/g, "'"),
    html: m[3]!,
    text: m[3]!.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim(),
  }));
}

test('S18-opening: The deck opens with the title, why it exists and the map of who does what', async ({ page }) => {
  // The main path of S18: "done" needs this test passed on the real screens.
  // Checks S18-A1: given an EPIC with a goal, a brainstorm, roles and stories; when the builder makes its deck; then it opens with a title slide (the EPIC's title, its goal in one sentence, the owner, the date and one status line such as "15 of 17 stories signed off"), then why it exists and for whom with the requirements as a short plain list, then one map of the roles and what each of them can do.

  // The deck is made from the shop fixture in a new git repo: 2 stories, none signed off, no test run.
  // --full: the deck with every story slide.
  const { repo, remove } = freshRepo();
  let sha = '';
  let file = '';
  let html = '';
  let deck: Slide[] = [];
  const slide = (key: string): Slide => deck.find((d) => d.key === key)!;
  try {
    await test.step('present-cli: Make a deck with rehearse present', async () => {
      // Step 1 of 5.
      // Example cli: given {"epic":"2026-11-05-rehearse"}; then {"epic":"2026-11-05-rehearse"}.
      git(repo, 'config', 'user.name', 'Owner E2e');
      git(repo, 'config', 'user.email', 'owner@example.com');
      cpSync(SHOP, join(repo, 'docs/epics', SLUG), { recursive: true });
      git(repo, 'add', '-A');
      git(repo, 'commit', '-q', '-m', 'the shop record');
      sha = git(repo, 'rev-parse', '--short=7', 'HEAD').trim();
      const r = rehearse(repo, 'present', SLUG, '--full');
      expect(r.err).toBe('');
      expect(r.code).toBe(0);
      const m = /^(presentations\/\S+\.html)\s+(\d+) slides/m.exec(r.out);
      expect(m, r.out).not.toBeNull();
      file = join(repo, m![1]!);
      expect(file).toContain(sha);
      html = readFileSync(file, 'utf8');
      deck = slides(html);
      expect(deck).toHaveLength(Number(m![2]));
    });

    await test.step('gather-deck-facts: Gather what the deck shows from the record and the repo', async () => {
      // Step 2 of 5.
      // Example facts: given {"epic":"2026-11-05-rehearse"}; then {"epic":"2026-11-05-rehearse","commit":"main @ 6cc5a4a, 2026-11-07","uncommitted":false,"facts":"18 stories, 5 designs, 40 tests"}.
      // The facts come from the record and the commit: the EPIC title and "main @ <sha>" on each slide.
      for (const d of deck) expect(d.text).toMatch(new RegExp(`Shop checkout · as of main @ ${sha}, \\d{4}-\\d{2}-\\d{2}`));
      // The record has a goal, roles, requirements and stories: the deck has a slide for each.
      for (const key of ['title', 'why', 'requirements', 'big-picture']) expect(deck.map((d) => d.key)).toContain(key);
    });

    await test.step('build-deck: Build the slides in plain words', async () => {
      // Step 3 of 5.
      // Example deck: given {}; then {"epic":"2026-11-05-rehearse","slides":40,"deck":"title: rehearse v1, 15 of 18 stories signed off; the summary: what's done, what's not done yet and why, how we know, what's next; with --full, then: details, story by story; recap; why; requirements; big picture"}.
      // The deck opens with the title and the summary of S20. The shop has no asks, so the summary has no asks slide.
      expect(deck.slice(0, 5).map((d) => d.key)).toEqual(['title', 'done', 'not-done', 'how-we-know', 'next']);
      // With --full, the details come next: the recap, why it exists, the requirements, then the map of the roles.
      expect(deck.slice(5, 10).map((d) => d.key)).toEqual(['details', 'recap', 'why', 'requirements', 'big-picture']);
      const title = slide('title');
      expect(title.text).toContain('Shop checkout');
      expect(title.text).toContain('A buyer can pay for an order, and the shop ships it.');
      expect(title.text).toMatch(/Presented by Owner E2e · \d{4}-\d{2}-\d{2}/);
      // One status line on the 2 stories. The scenario gives "15 of 17 stories signed off" only as an example.
      expect(title.text).toMatch(/\b(\d+ of 2 stories|None of the 2 parts of the plan|\d+ of 2 parts of the plan)\b/);
      expect(slide('why').text).toContain('Buyer');
      expect(slide('big-picture').text).toMatch(/Buyer[\s\S]*Pay for my cart[\s\S]*Shop[\s\S]*Ship paid orders/);
    });

    await test.step('render-deck-html: Write the deck as one self-contained HTML file', async () => {
      // Step 4 of 5.
      // Example html: given {}; then {"epic":"2026-11-05-rehearse","html":"presentations/2026-11-05-rehearse-2026-11-07-6cc5a4a.html","bytes":3900000}.
      // One self-contained file: no link to another file or host.
      expect(html.toLowerCase().startsWith('<!doctype html')).toBe(true);
      expect(html).not.toMatch(/<(script|link|img)[^>]+(src|href)="(?!data:|#)[^"]+"/);
      expect(statSync(file).size).toBeGreaterThan(5_000);
    });

    await test.step('deck-file: The deck the owner sends', async () => {
      // Step 5 of 5.
      // The owner opens the deck in a browser: slide 1 shows the EPIC title.
      expect(existsSync(file)).toBe(true);
      await page.goto(pathToFileURL(file).href);
      await expect(page.locator('section.slide.current h1')).toHaveText('Shop checkout');
      await expect(page.locator('.deck-nav .count')).toHaveText(`1 / ${deck.length}`);
    });
  } finally {
    remove();
  }
  // Expect at the end: {"firstSlides":["title","why","big-picture"],"statusLine":"15 of 18 stories signed off · 3 waiting for review"}.
});
