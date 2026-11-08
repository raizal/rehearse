// The e2e tests of story S20 ("the deck to be a short executive summary — where we are, what is done, what is not and why, and the proof"), one for each scenario, named after the scenario id.
// `rehearse e2e-start` wrote this start file from docs/epics/2026-11-05-rehearse/scenarios/S20.yaml. Each step title
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

test('S20-summary: The deck is a short summary by default: where we are, done, not done and why, how we know, next', async ({ page }) => {
  // The main path of S20: "done" needs this test passed on the real screens.
  // Checks S20-A1: given any EPIC; when the builder runs `pnpm rehearse present <epic>`, or presses Present on the EPIC page; then the deck is a summary of at most six slides, in this order: where we are (the goal, one status sentence such as "15 of 19 parts of the plan are done; 2 of them are seen working on the real screens. 4 are not done yet." and a done / not-yet bar), what is done, what is not done yet and why, how we know, what I need from you (only when the owner asks something) and what is next (the owner's next steps, else the top three the record suggests).
  // The deck is made from the shop fixture in a new git repo: 2 stories, none signed off, no test run.
  const { repo, remove } = freshRepo();
  let sha = '';
  let file = '';
  let html = '';
  let deck: Slide[] = [];
  const slide = (key: string): Slide => deck.find((d) => d.key === key)!;
  try {
    await test.step('present-cli: Make a deck with rehearse present', async () => {
      // Step 1 of 12.
      // Example cli: given {"epic":"2026-11-05-rehearse"}; then {"epic":"2026-11-05-rehearse"}.
      git(repo, 'config', 'user.name', 'Owner E2e');
      git(repo, 'config', 'user.email', 'owner@example.com');
      cpSync(SHOP, join(repo, 'docs/epics', SLUG), { recursive: true });
      git(repo, 'add', '-A');
      git(repo, 'commit', '-q', '-m', 'the shop record');
      sha = git(repo, 'rev-parse', '--short=7', 'HEAD').trim();
      const r = rehearse(repo, 'present', SLUG);
      expect(r.err).toBe('');
      expect(r.code).toBe(0);
      const m = /^(presentations\/\S+\.html)\s+(\d+) slides/m.exec(r.out);
      expect(m, r.out).not.toBeNull();
      file = join(repo, m![1]!);
      expect(file).toContain(`${SLUG}-`);
      expect(file).toContain(sha);
      html = readFileSync(file, 'utf8');
      deck = slides(html);
      expect(deck).toHaveLength(Number(m![2]));
    });

    await test.step('gather-deck-facts: Gather what the deck shows from the record and the repo', async () => {
      // Step 2 of 12.
      // Example facts: given {"epic":"2026-11-05-rehearse"}; then {"epic":"2026-11-05-rehearse","commit":"main @ 40c1f9d, 2026-11-07","uncommitted":false,"facts":"20 stories, 5 designs, 40 tests"}.
      // The facts come from the record and the commit: the EPIC title and "main @ <sha>" on each slide.
      for (const d of deck) expect(d.text).toMatch(new RegExp(`Shop checkout · as of main @ ${sha}, \\d{4}-\\d{2}-\\d{2}`));
      expect(slide('title').text).toContain('A buyer can pay for an order, and the shop ships it.');
    });

    await test.step('read-saved-test-results: Read the e2e results Birdview knows or saved', async () => {
      // Step 3 of 12.
      // No test project and no Birdview results in this repo: nothing is called seen working.
      expect(slide('how-we-know').text).toMatch(/Tests on the real screens: no results were found for this deck .*so nothing is called seen working/);
    });

    await test.step('read-unit-report: Read the unit tests from a vitest report', async () => {
      // Step 4 of 12.
      expect(slide('how-we-know').text).toContain('Automated tests: not counted for this deck (no unit report was given)');
    });

    await test.step('last-screen-picture: Take a still of the last screen of each recording', async () => {
      // Step 5 of 12.
      // No recording, so no still of the last screen.
      expect(slide('how-we-know').text).toContain('No picture of a test run');
      expect(html).not.toMatch(/<img[^>]+src="data:image/);
    });

    await test.step('done-rule: Decide if each story is done, and how strong its proof is', async () => {
      // Step 6 of 12.
      // No story is signed off or seen working: none is done.
      expect(slide('title').text).toContain('None of the 2 parts of the plan is done yet.');
      expect(slide('how-we-know').text).toContain('Done means: every part is built and the owner signed it off.');
    });

    await test.step('group-done-by-area: Group the done stories by area', async () => {
      // Step 7 of 12.
      expect(slide('done').label).toContain("What's done");
      expect(slide('done').text).toContain('Nothing is done yet');
    });

    await test.step('group-not-done-by-reason: Group the stories not done by reason', async () => {
      // Step 8 of 12.
      // One reason for the 2 stories: the checks wait for the owner's approval.
      const notDone = slide('not-done');
      expect(notDone.label).toContain("What's not done yet, and why");
      expect(notDone.text).toContain('Waiting for my approval: 3 checks');
      expect(notDone.text).toMatch(/Pay for my cart — 2 checks to approve S1/);
      expect(notDone.text).toMatch(/Ship paid orders — 1 check to approve S2/);
      expect(notDone.text).toContain('Who acts: me.');
    });

    await test.step('how-we-know: Show how we know, with pictures of passed tests', async () => {
      // Step 9 of 12.
      expect(slide('how-we-know').label).toContain('How we know');
      expect(slide('how-we-know').text).toContain('The plan simulates clean');
      expect(slide('how-we-know').text).toContain(`the plan as committed at ${sha}`);
    });

    await test.step('summary-deck: Build the executive summary slides', async () => {
      // Step 10 of 12.
      // Example deck: given {}; then {"epic":"2026-11-05-rehearse","slides":5,"deck":"where we are: 15 of 20 parts of the plan are done; 2 of them are seen working on the real screens. 5 are not done yet.; what's done; what's not done yet, and why; how we know; what's next"}.
      // Where we are, done, not done and why, how we know, next: at most 6 slides, no asks slide (the owner asks nothing).
      expect(deck.map((d) => d.key)).toEqual(['title', 'done', 'not-done', 'how-we-know', 'next']);
      expect(deck.length).toBeLessThanOrEqual(6);
      const where = slide('title');
      expect(where.text).toContain('Where we are with "Shop checkout"');
      expect(where.html).toMatch(/class="bar"[^>]*aria-label="2 not done yet"/);
      expect(where.html).toContain('seg-todo');
      expect(slide('next').label).toContain("What's next");
      expect(slide('next').text).toContain('I approve the 3 open checks of "Pay for my cart" and "Ship paid orders", and sign them off.');
    });

    await test.step('render-deck-html: Write the deck as one self-contained HTML file', async () => {
      // Step 11 of 12.
      // Example html: given {}; then {"epic":"2026-11-05-rehearse","html":"presentations/2026-11-05-rehearse-2026-11-07-40c1f9d.html","bytes":900000}.
      // One self-contained file: no link to another file or host.
      expect(html.startsWith('<!doctype html') || html.startsWith('<!DOCTYPE html')).toBe(true);
      expect(html).not.toMatch(/<(script|link|img)[^>]+(src|href)="(?!data:|#)[^"]+"/);
      expect(statSync(file).size).toBeGreaterThan(5_000);
    });

    await test.step('deck-file: The deck the owner sends', async () => {
      // Step 12 of 12.
      // The owner opens the deck in a browser: it shows slide 1 of 5, and the arrow key goes to the next slide.
      expect(existsSync(file)).toBe(true);
      await page.goto(pathToFileURL(file).href);
      await expect(page.locator('section.slide.current h1')).toHaveText('Shop checkout');
      await expect(page.locator('.deck-nav .count')).toHaveText('1 / 5');
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('.deck-nav .count')).toHaveText('2 / 5');
      await expect(page.locator('section.slide.current')).toHaveAttribute('data-key', 'done');
    });
  } finally {
    remove();
  }
  // Expect at the end: {"slides":["where we are","what's done","what's not done yet, and why","how we know","what's next"],"atMost":6,"asksSlide":"only with asks","bar":["seen working","done checked by automated tests","not done yet"]}.
});
