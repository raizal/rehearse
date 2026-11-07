// The STE checker (T60): each rule with a hit and with no hit, the spans that it does not check,
// the word list, the allow list, and the validate information on draft text only.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { isInstruction, makeReport, reportToJson, reportToText, steFindings, steMask, STE_TECHNICAL_NAMES, STE_WORDS, validateEpic, type SteRule } from '../../src/index.js';
import { STE_ALLOW } from '../ste/allow.js';
import { makeEpic, scenario } from '../helpers.js';

const rules = (text: string): SteRule[] => steFindings(text).map((f) => f.rule);
const hitsOf = (text: string, rule: SteRule): string[] => steFindings(text).filter((f) => f.rule === rule).map((f) => f.text);
const n = (count: number, word = 'and'): string => Array.from({ length: count }, () => word).join(' ');

describe('STE sentence length', () => {
  it('allows 25 words in a description and finds 26', () => {
    expect(rules(`The box has ${n(22)}.`)).toEqual([]);
    const f = steFindings(`The box has ${n(23)}.`);
    expect(f.map((x) => x.rule)).toEqual(['sentence-length']);
    expect(f[0]!.message).toBe('This description has 26 words. The limit is 25.');
    expect(f[0]!.suggestion).toBe('Write two or more short sentences.');
  });

  it('allows 20 words in an instruction and finds 21', () => {
    expect(rules(`Open the ${n(18)}.`)).toEqual([]);
    expect(steFindings(`Open the ${n(19)}.`)[0]!.message).toBe('This instruction has 21 words. The limit is 20.');
  });

  it('counts a code span, a path or a quoted label as one word', () => {
    expect(rules(`Run \`rehearse validate docs/epics/one --json and many more words here\` on the ${n(16)}.`)).toEqual([]);
  });

  it('knows an instruction: an imperative verb, "do not", or the part after "If …,"', () => {
    expect(isInstruction('Read the findings.')).toBe(true);
    expect(isInstruction('Do not edit the record.')).toBe(true);
    expect(isInstruction('If the gate fails, read the findings.')).toBe(true);
    expect(isInstruction('The gate reads the findings.')).toBe(false);
    expect(isInstruction('If the gate fails, the page says so.')).toBe(false);
  });
});

describe('STE paragraph length', () => {
  it('allows 6 sentences and finds 7', () => {
    expect(rules('One. Two. Three. Four. Five. Six.')).toEqual([]);
    const f = steFindings('One. Two. Three. Four. Five. Six. Seven.');
    expect(f.map((x) => x.rule)).toEqual(['paragraph-length']);
    expect(f[0]!.message).toBe('This paragraph has 7 sentences. The limit is 6.');
  });

  it('counts each paragraph and each list item on its own', () => {
    expect(rules('One. Two. Three. Four.\n\nFive. Six. Seven. Eight.')).toEqual([]);
    expect(rules('- One. Two. Three. Four.\n- Five. Six. Seven. Eight.')).toEqual([]);
  });

  it('reads a numbered list item as a list item', () => {
    expect(rules('1. Open the panel.\n2. Read the brief.\n3. Run the gate.\n4. Fix the record.')).toEqual([]);
  });
});

describe('STE passive verb in an instruction', () => {
  it('finds "is shown" and "be written" in an instruction', () => {
    expect(hitsOf('Make sure the deck is shown to the owner.', 'passive-instruction')).toEqual(['is shown']);
    expect(hitsOf('Do not let the file be written twice.', 'passive-instruction')).toEqual(['be written']);
    expect(hitsOf('Make sure the file is used here.', 'passive-instruction')).toEqual(['is used']);
    expect(steFindings('Make sure the deck is shown.')[0]!.suggestion).toBe('Use the active voice: say who does the action.');
  });

  it('allows a passive verb in a description and after "if", "when" or "that"', () => {
    expect(rules('The deck is shown to the owner.')).toEqual([]);
    expect(rules('Read the file that is written by the gate.')).toEqual([]);
    expect(rules('Stop when the story is signed.')).toEqual([]);
  });
});

describe('STE -ing forms', () => {
  it('finds an -ing verb form', () => {
    expect(hitsOf('Loading the EPIC record.', 'ing-form')).toEqual(['Loading']);
    expect(hitsOf('The tool is running now.', 'ing-form')).toEqual(['running']);
    // A placeholder next to the word does not hide it.
    expect(hitsOf('${n} failing${more}', 'ing-form')).toEqual(['failing']);
  });

  it('allows -ing nouns, technical names, and -ing words in code, ids and quotes', () => {
    expect(rules('Read the warning during the morning. Something is wrong with the string.')).toEqual([]);
    expect(rules('The story is seen working. The sign-off uses the signing key.')).toEqual([]);
    expect(rules('Run `rehearse loading` and open "Waiting room" at docs/missing-thing.md for box show-loading.')).toEqual([]);
  });
});

describe('STE noun clusters', () => {
  it('finds more than 3 nouns in a row', () => {
    expect(hitsOf('The story page header text is long.', 'noun-cluster')).toEqual(['story page header text']);
  });

  it('allows 3 nouns, and a run that a verb, an adjective or punctuation breaks', () => {
    expect(rules('The story page header is long.')).toEqual([]);
    expect(rules('The story page shows the header text.')).toEqual([]);
    expect(rules('The story, page, header and text are there.')).toEqual([]);
    expect(rules('The real story page header is long.')).toEqual([]);
  });
});

describe('STE word list', () => {
  it('finds a word that STE does not approve, with the approved word', () => {
    const f = steFindings('Utilize the panel to initiate a run via the CLI and ensure it ends, e.g. now.');
    expect(f.map((x) => [x.text, x.suggestion])).toEqual([
      ['Utilize', 'Use "use".'],
      ['initiate', 'Use "start".'],
      ['via', 'Use "through".'],
      ['ensure', 'Use "make sure".'],
      ['e.g.', 'Use "for example".'],
    ]);
    expect(f[0]!.message).toBe('"Utilize" is not an approved STE word.');
  });

  it('finds the forms of a word and the phrases', () => {
    expect(hitsOf('The run terminated. It is utilised in order to start prior to the gate.', 'word')).toEqual(['terminated', 'utilised', 'in order to', 'prior to']);
  });

  it('does not find a word inside another word, a code span or a hyphenated name', () => {
    expect(rules('The viaduct is open. Run `ensure`. Open box ensure-ready.')).toEqual([]);
  });

  it('has one entry for each word, an approved word and a source', () => {
    expect(STE_WORDS.length).toBe(58);
    expect(new Set(STE_WORDS.map((w) => w.word)).size).toBe(STE_WORDS.length);
    for (const w of STE_WORDS) {
      expect(w.use.length).toBeGreaterThan(0);
      expect(['public', 'guidance']).toContain(w.source);
    }
    expect(STE_WORDS.filter((w) => w.source === 'public').map((w) => w.word)).toEqual(['utilize', 'initiate', 'commence', 'begin', 'originate']);
  });

  it('keeps the plan terms as technical names', () => {
    expect(STE_TECHNICAL_NAMES).toContain('seen working');
    expect(STE_TECHNICAL_NAMES).toContain('sign-off');
  });
});

describe('STE spans that the checker does not read', () => {
  it('masks code, quotes, ids, box ids, paths, commands, flags and placeholders', () => {
    const masked = steMask('Run `x y` on S12, R33 and S3-A1 in box status-view at packages/core/src/plain.ts with --json, "Loading" and <epic> or ${n} via {name}.');
    expect(masked).not.toMatch(/S12|R33|S3-A1|status-view|plain\.ts|--json|Loading|<epic>|\$\{n\}|\{name\}/);
    expect(masked).toContain('via');
  });
});

describe('STE allow list', () => {
  it('gives each entry a file, a rule and a reason', () => {
    const known: SteRule[] = ['sentence-length', 'paragraph-length', 'passive-instruction', 'ing-form', 'noun-cluster', 'word'];
    for (const a of STE_ALLOW) {
      expect(a.file).toMatch(/^(?:packages|docs)\//);
      expect(known).toContain(a.rule);
      expect(a.text.length).toBeGreaterThan(0);
      expect(a.in).toContain(a.text);
      expect(a.reason.length).toBeGreaterThan(10);
    }
    expect(STE_ALLOW.length).toBeLessThanOrEqual(25);
  });
});

describe('validate: STE information on draft text only', () => {
  const draftText = (docs: Record<string, any>) => {
    docs['prd.yaml'].stories[0].want = 'to utilize the cart';
    scenario(docs, docs['scenarios/S1.yaml'].scenarios[0].id).title = 'Buyer is paying for the cart';
  };

  it('reports draft stories and draft scenarios as information, and the report stays OK', () => {
    const report = validateEpic(makeEpic({ edit: draftText }));
    expect(report.ok).toBe(true);
    expect(report.findings).toEqual([]);
    expect(report.information?.map((f) => [f.kind, f.file, f.path, f.message])).toEqual([
      ['ste', 'prd.yaml', 'S1: want', 'STE word: "utilize" is not an approved STE word. Use "use".'],
      ['ste', 'scenarios/S1.yaml', 'S1-buy: title', 'STE ing-form: "paying" is an -ing form. Use the simple present, the infinitive or a noun.'],
    ]);
    const text = reportToText(report);
    expect(text).toContain('prd.yaml: S1: want: information: STE word:');
    expect(text.trimEnd().split('\n').at(-1)).toBe('validate: OK, no findings (2 STE notes on draft text: information only)');
    expect(JSON.parse(reportToJson(report)).information).toHaveLength(2);
  });

  it('does not check a signed story or an approved scenario', () => {
    const dir = makeEpic({
      edit: (docs) => {
        draftText(docs);
        const sc = docs['scenarios/S1.yaml'].scenarios[0];
        sc.status = 'approved';
        sc.approval = { by: 'owner', at: '2026-11-05T00:00:00Z', hash: 'sha256:0' };
      },
    });
    writeFileSync(join(dir, 'signoff.yaml'), stringify({ signOffs: [{ by: 'owner', at: '2026-11-05T00:00:00Z', storyHashes: { S1: 'sha256:0' } }] }));
    const info = validateEpic(dir).information ?? [];
    expect(info.filter((f) => f.path.startsWith('S1:') || f.path.startsWith('S1-buy'))).toEqual([]);
  });

  it('leaves out the information field and the note when there is none', () => {
    const report = makeReport('validate', []);
    expect(report.information).toBeUndefined();
    expect(reportToText(report)).toBe('validate: OK, no findings\n');
  });
});
