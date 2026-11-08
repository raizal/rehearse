// The e2e tests of story S19 ("to have the deck open with what is done and what is not, each with its proof"), one for each scenario, named after the scenario id.
// `rehearse e2e-start` wrote this start file from docs/epics/2026-11-05-rehearse/scenarios/S19.yaml. Each step title
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

test('S19-recap: The slide after the title is a recap of every story, done or not, with one sentence on top', async ({ page }) => {
  // The main path of S19: "done" needs this test passed on the real screens.
  // Checks S19-A1: given an EPIC with stories that are done, in progress and not started; when the builder makes its deck; then the slide right after the title is a recap: one sentence on top such as "12 of 19 stories are done", then every story with its name and done, in progress or not started.

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
      // Step 1 of 12.
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
      // Step 2 of 12.
      // Example facts: given {"epic":"2026-11-05-rehearse"}; then {"epic":"2026-11-05-rehearse","commit":"main @ a33f854, 2026-11-07","uncommitted":false,"facts":"19 stories, 5 designs, 40 tests"}.
      // The facts come from the record and the commit: the EPIC title and "main @ <sha>" on each slide.
      for (const d of deck) expect(d.text).toMatch(new RegExp(`Shop checkout · as of main @ ${sha}, \\d{4}-\\d{2}-\\d{2}`));
    });

    await test.step('read-saved-test-results: Read the e2e results Birdview knows or saved', async () => {
      // Step 3 of 12.
      // No test project and no Birdview results in this repo: nothing is called seen working.
      expect(slide('how-we-know').text).toMatch(/Tests on the real screens: no results were found for this deck/);
    });

    await test.step('read-unit-report: Read the unit tests from a vitest report', async () => {
      // Step 4 of 12.
      expect(slide('how-we-know').text).toContain('Automated tests: not counted for this deck (no unit report was given)');
    });

    await test.step('last-screen-picture: Take a still of the last screen of each recording', async () => {
      // Step 5 of 12.
      expect(slide('how-we-know').text).toContain('No picture of a test run');
    });

    await test.step('story-done-state: Decide if each story is done, in progress or not started', async () => {
      // Step 6 of 12.
      // Example states: given {}; then {"epic":"2026-11-05-rehearse","commit":"main @ a33f854, 2026-11-07","uncommitted":false,"facts":"19 stories, 5 designs, 40 tests","doneStates":"12 done, 4 in progress, 3 not started"}.
      // No story is signed off or built: both are not started.
      expect(slide('recap').text).toContain('0 of 2 stories are done. 2 are not started.');
    });

    await test.step('build-recap: Build the recap slide after the title', async () => {
      // Step 7 of 12.
      // Example recap: given {}; then {"epic":"2026-11-05-rehearse","commit":"main @ a33f854, 2026-11-07","uncommitted":false,"facts":"19 stories, 5 designs, 40 tests","doneStates":"12 done, 4 in progress, 3 not started","recap":"12 of 19 stories are done"}.
      // The slide right after the title is the recap: one sentence on top, then every story with its state.
      expect(deck[0]!.key).toBe('title');
      expect(deck[1]!.key).toBe('recap');
      const recap = slide('recap');
      expect(recap.text).toMatch(/^What is done, what is not 0 of 2 stories are done\./);
      expect(recap.text).toMatch(/Pay for my cart[^○]*S1/);
      expect(recap.text).toMatch(/Ship paid orders[^○]*S2/);
    });

    await test.step('proof-lines: Write a proof line per source on every story slide', async () => {
      // Step 8 of 12.
      // Each story slide has a proof line for each source.
      for (const key of ['S1', 'S2']) expect(slide(key).text).toMatch(/real screens|automated tests|signed/i);
    });

    await test.step('evidence-page: Say where each proof comes from', async () => {
      // Step 9 of 12.
      expect(slide('evidence').label).toContain('Where the proof comes from');
      expect(slide('evidence').text).toContain(sha);
    });

    await test.step('build-deck: Build the slides in plain words', async () => {
      // Step 10 of 12.
      // Example deck: given {}; then {"epic":"2026-11-05-rehearse","slides":43,"deck":"title; recap: 12 of 19 stories are done; why; big picture"}.
      expect(deck.slice(0, 2).map((d) => d.key)).toEqual(['title', 'recap']);
    });

    await test.step('render-deck-html: Write the deck as one self-contained HTML file', async () => {
      // Step 11 of 12.
      // Example html: given {}; then {"epic":"2026-11-05-rehearse","html":"presentations/2026-11-05-rehearse-2026-11-07-a33f854.html","bytes":4100000}.
      // One self-contained file: no link to another file or host.
      expect(html.toLowerCase().startsWith('<!doctype html')).toBe(true);
      expect(html).not.toMatch(/<(script|link|img)[^>]+(src|href)="(?!data:|#)[^"]+"/);
      expect(statSync(file).size).toBeGreaterThan(5_000);
    });

    await test.step('deck-file: The deck the owner sends', async () => {
      // Step 12 of 12.
      // The owner opens the deck in a browser: slide 1 shows the EPIC title.
      expect(existsSync(file)).toBe(true);
      await page.goto(pathToFileURL(file).href);
      await expect(page.locator('section.slide.current h1')).toHaveText('Shop checkout');
      await expect(page.locator('.deck-nav .count')).toHaveText(`1 / ${deck.length}`);
    });
  } finally {
    remove();
  }
  // Expect at the end: {"secondSlide":"recap","sentence":"12 of 19 stories are done","rows":19,"states":["done","in progress","not started"]}.
});
