// The e2e tests of story S25 ("the product text and new plan text in Simplified Technical English, with a checker"), one for each scenario, named after the scenario id.
// `rehearse e2e-start` wrote this start file from docs/epics/2026-11-05-rehearse/scenarios/S25.yaml. Each step title
// starts with its flow box, so Birdview maps steps to boxes. Each step fails until you write it: replace the throw.
// Work only from the scenarios and the product that runs (the UI and the CLI), not from the code of the boxes.

import { spawnSync } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from './serve.js';
import { rehearse, git, freshRepo } from './cli.js';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const SHOP = join(REPO, 'packages/core/test/fixtures/shop');
const SLUG = '2026-11-05-shop';

type Note = { kind: string; file: string; path: string; message: string };

// New plan text with one break of each STE rule: S1-A2 "given" is a long sentence, "when" has an
// unapproved word, an -ing form, a noun cluster and a passive verb in an instruction, and "then" is a
// long paragraph. S1-A3 has only text that the checker must not read.
const LONG_SENTENCE =
  'The buyer opens the cart page and then the buyer checks each item and the price and the count of each item in the cart before the buyer pays for the order.';
const WORD_ING_CLUSTER_PASSIVE = 'Utilize the panel. Loading the story page header text. Make sure the record is checked.';
const LONG_PARAGRAPH =
  'The buyer pays. The shop ships. The buyer waits. The shop packs. The shop sends. The buyer gets the box. The buyer opens the box.';
const NOT_READ =
  'Run `utilize --loading` in docs/utilizing/loading-file.yaml for S1-A1 and S1-buy. Open the box utilizing-shipping. Run rehearse validate --utilizing. Click "Utilize the loading page".';

test('S25-checker-rules: The checker gives one finding for each STE rule, with a suggestion', async () => {
  // The main path of S25: "done" needs this test passed on the real screens.
  // Checks S25-A1: given a text with a long sentence, a long paragraph, a passive verb in an instruction, an -ing form, a noun cluster and an unapproved word; when the STE checker reads the text; then it gives one finding for each rule, with the rule and a suggestion. A finding for an unapproved word gives the approved word from the word list. The checker does not read code spans, ids, box ids, file paths, commands and quoted UI labels.
  // `rehearse validate` runs the STE checker on the plan text and gives its findings as information.
  const { repo, remove } = freshRepo();
  const epic = join(repo, 'docs/epics', SLUG);
  let notes: Note[] = [];
  let unit = { code: null as number | null, out: '' };
  try {
    await test.step('start: Builder has an idea', async () => {
      // Step 1 of 7.
      cpSync(SHOP, epic, { recursive: true });
      git(repo, 'add', '-A');
      git(repo, 'commit', '-q', '-m', 'shop record');
      const r = rehearse(repo, 'validate', SLUG, '--json');
      expect(r.code, r.out + r.err).toBe(0);
      expect((JSON.parse(r.out) as { information?: Note[] }).information ?? []).toEqual([]);
    });

    await test.step('ste-text: A builder writes product text or new plan text', async () => {
      // Step 2 of 7.
      // Example rules-text: given {"text":"Utilize the panel. Loading the story page header text…"}; then {"source":"product"}.
      const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
      const prd = readFileSync(join(epic, 'prd.yaml'), 'utf8');
      const added =
        `      - id: S1-A2\n        given: ${q(LONG_SENTENCE)}\n        when: ${q(WORD_ING_CLUSTER_PASSIVE)}\n        then: ${q(LONG_PARAGRAPH)}\n` +
        `      - id: S1-A3\n        given: ${q(NOT_READ)}\n        when: the buyer pays\n        then: the order is shipped\n`;
      const next = prd.replace('then: the order is shipped }\n  - id: S2', `then: the order is shipped }\n${added}  - id: S2`);
      expect(next).not.toBe(prd);
      writeFileSync(join(epic, 'prd.yaml'), next);
      const r = rehearse(repo, 'validate', SLUG, '--json');
      expect(r.code, r.out + r.err).toBe(0);
      const report = JSON.parse(r.out) as { ok: boolean; findings: Note[]; information?: Note[] };
      expect(report.ok).toBe(true);
      notes = (report.information ?? []).filter((n) => n.kind === 'ste');
      expect(notes.length).toBeGreaterThan(0);
    });

    await test.step('ste-words: Find the words that STE does not approve, with the approved word', async () => {
      // Step 3 of 7.
      // Example rules-words: given {"text":"Utilize the panel."}; then {"words":"\"Utilize\" is not an approved STE word. Use \"use\"."}.
      expect(notes).toContainEqual(
        expect.objectContaining({ file: 'prd.yaml', path: 'S1-A2: when', message: 'STE word: "Utilize" is not an approved STE word. Use "use".' }),
      );
    });

    await test.step('ste-check: Check the sentences, the paragraphs, the verbs and the nouns', async () => {
      // Step 4 of 7.
      // Example rules-check: given {"text":"Loading the story page header text…"}; then {"findings":"ing-form: Loading; noun-cluster: story page header text"}.
      const a2 = notes.filter((n) => n.path.startsWith('S1-A2'));
      const rule = (m: string) => /^STE ([a-z-]+):/.exec(m)?.[1];
      // One finding for each rule, each with a suggestion.
      expect(a2.map((n) => rule(n.message)).sort()).toEqual(
        ['ing-form', 'noun-cluster', 'paragraph-length', 'passive-instruction', 'sentence-length', 'word'].sort(),
      );
      const byRule = new Map(a2.map((n) => [rule(n.message), n]));
      expect(byRule.get('sentence-length')).toMatchObject({ path: 'S1-A2: given', message: expect.stringMatching(/The limit is 25\. Write two or more short sentences\.$/) });
      expect(byRule.get('paragraph-length')).toMatchObject({ path: 'S1-A2: then', message: expect.stringMatching(/7 sentences\. The limit is 6\. Make two or more paragraphs\.$/) });
      expect(byRule.get('ing-form')?.message).toBe('STE ing-form: "Loading" is an -ing form. Use the simple present, the infinitive or a noun.');
      expect(byRule.get('noun-cluster')?.message).toBe(
        'STE noun-cluster: "story page header text" is a cluster of 4 nouns. Use "of", "for" or a verb to break the cluster.',
      );
      expect(byRule.get('passive-instruction')?.message).toBe(
        'STE passive-instruction: "is checked" is a passive verb in an instruction. Use the active voice: say who does the action.',
      );
      // The checker does not read code spans, ids, box ids, file paths, commands and quoted UI labels.
      expect(notes.filter((n) => n.path.startsWith('S1-A3'))).toEqual([]);
      const text = rehearse(repo, 'validate', SLUG);
      expect(text.out).toContain('validate: OK, no findings (6 STE notes on draft text: information only)');
    });

    await test.step('ste-source: Product text or plan text?', async () => {
      // Step 5 of 7, the branch "product".
      // Product text goes to the repo test, which runs the same checker on every product text source.
      const r = spawnSync(process.execPath, [join(REPO, 'node_modules/vitest/vitest.mjs'), 'run', 'test/ste/product-text.test.ts', '--reporter=verbose'], {
        cwd: join(REPO, 'packages/core'),
        encoding: 'utf8',
        env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'FORCE_COLOR')), NO_COLOR: '1' },
      });
      unit = { code: r.status, out: r.stdout + r.stderr };
      expect(unit.out).toMatch(/product text in STE > reads the product text sources/);
    });

    await test.step('ste-repo-test: The repo test checks every product text source', async () => {
      // Step 6 of 7.
      expect(unit.out).toMatch(/product text in STE > has no STE finding that is not on the allow list/);
      expect(unit.out).toMatch(/product text in STE > has no allow entry that matches no finding, and a reason for each entry/);
      expect(unit.out).toMatch(/Tests\s+3 passed \(3\)/);
      expect(unit.code, unit.out).toBe(0);
    });

    await test.step('ste-known: Every reader gets one clear meaning', async () => {
      // Step 7 of 7.
      // The rules: sentence-length, paragraph-length, passive-instruction, ing-form, noun-cluster, word. A note is information only: validate passes.
      const r = rehearse(repo, 'validate', SLUG);
      expect(r.code, r.out + r.err).toBe(0);
      expect(r.out).not.toContain('S1-A3');
    });
  } finally {
    remove();
  }

  // Expect at the end: {"rules":"sentence-length, paragraph-length, passive-instruction, ing-form, noun-cluster, word","notRead":"code spans, ids, box ids, paths, commands, quoted labels"}.
});
