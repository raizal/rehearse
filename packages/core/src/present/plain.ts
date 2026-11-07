// Plain words for the deck (T52): record text loses its code marks and its references, so a reader
// who has never seen the record reads sentences, not ids. Ids go to the slide's corner only.

/** Record ids: requirements, stories, criteria, decisions, gate and task ids (R12, S3, S3-A1, D4, G20, T52, C11). */
export const ID_PATTERN = /\b(?:[RSDGTC]\d+(?:-A\d+)?)\b/g;

/** Record field names that would show the YAML under a sentence. */
export const YAML_KEYS = [
  'soThat',
  'storyHashes',
  'errorExits',
  'sideEffects',
  'acceptance',
  'requirements',
  'scenarios',
  'expectedState',
  'criterion',
  'approval',
  'signOffs',
  'inputs',
  'outputs',
  'lanes',
  'boxes',
  'edges',
  'expect',
  'steps',
] as const;

/** One record text as plain words: no backticks, no `(D12, C3)` notes, no bare ids, one line. */
export function plain(text: string | undefined): string {
  if (!text) return '';
  return text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s*\((?:[^()]*\b[RSDGTC]\d+[^()]*)\)/g, '')
    .replace(/\b(?:story|stories)\s+([RSDGTC]\d+(?:-A\d+)?)(?:\s*(?:,|and|or)\s*[RSDGTC]\d+(?:-A\d+)?)*/gi, (m) => (/^stories/i.test(m) ? 'other stories' : 'another story'))
    .replace(/\b[RSDGTC]\d+-A\d+\b/g, 'a criterion')
    .replace(ID_PATTERN, '')
    .replace(/\s+([,.;:])(?=\s|$)/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The first sentences of a text, at most `max` characters, cut at a sentence end when it can. */
export function sentences(text: string, max: number): string {
  const t = plain(text);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (end > max / 3) return cut.slice(0, end + 1);
  const space = cut.lastIndexOf(' ');
  return `${cut.slice(0, space > 0 ? space : max).replace(/[,;:]$/, '')}…`;
}

/** Why a text is not plain words: record ids, YAML keys, box paths, code marks. Empty when it is. */
export function plainWordProblems(text: string, boxPaths: readonly string[] = []): string[] {
  const out: string[] = [];
  const ids = text.match(ID_PATTERN);
  if (ids) out.push(`record ids: ${[...new Set(ids)].join(', ')}`);
  // camelCase keys are never English; a plain-word key only at the start of a line or a list item.
  for (const key of YAML_KEYS) if (new RegExp(/[A-Z]/.test(key) ? `\\b${key}:` : `(?:^|\\n|- )\\s*${key}:`).test(text)) out.push(`YAML key ${key}:`);
  for (const p of boxPaths) if (p.includes('/') && text.includes(p)) out.push(`box path ${p}`);
  if (text.includes('`')) out.push('code marks (`)');
  return out;
}

// ---------------------------------------------------------------- STE checker (T60)
//
// The checker reads a text and gives findings for the main ASD-STE100 rules (see AGENTS.md): the
// sentence length, the paragraph length, a passive verb in an instruction, an "-ing" verb form, a
// noun cluster and a word that STE does not approve. It is a set of simple rules, not a parser:
// - It does not check code spans, quoted text, record ids, box ids and other hyphenated names, file
//   paths, URLs, commands, flags, placeholders (`<epic>`, `${n}`, `{name}`) and camelCase names.
// - A sentence is an instruction when it starts with an imperative verb from VERBS, with "do not"
//   or "never", or when the part after "If …," starts with such a verb. Other sentences are
//   descriptions.
// - The noun-cluster rule counts a word as a noun when it is not a function word, a known verb, a
//   known adjective, an adverb ("-ly") or a past participle ("-ed"). Thus an unknown verb or
//   adjective can make a false cluster, and a noun that is also a verb ("test", "run") stops one.

import { ING_NOUNS, STE_TECHNICAL_NAMES, STE_WORDS } from './ste-words.js';

export type SteRule = 'sentence-length' | 'paragraph-length' | 'passive-instruction' | 'ing-form' | 'noun-cluster' | 'word';

/** One STE finding: the rule, the text that breaks it, the reason and a suggestion. */
export interface SteFinding {
  rule: SteRule;
  /** The word, the words or the start of the sentence that the finding is about. */
  text: string;
  message: string;
  suggestion: string;
}

export const STE_LIMITS = { instruction: 20, description: 25, paragraph: 6, cluster: 3 } as const;

/** One masked span counts as one word and the checker does not read it. */
const MASK = 'Ⓧ';

const MASKS: readonly RegExp[] = [
  /```[\s\S]*?```/g,
  /`[^`]*`/g,
  /"[^"\n]*"/g,
  /“[^”\n]*”/g,
  /‘[^’\n]*’/g,
  /«[^»\n]*»/g,
  /https?:\/\/\S+/g,
  /\$\{[^}]*\}/g,
  /\{[^{}\n]*\}/g,
  /<[^<>\n]+>/g,
  /\[[^\][\n]*\]\([^)\n]*\)/g,
  /\brehearse\s+(?:validate|simulate|gate|new|serve|brief|progress|status|present|playlists|play|figcraft|design|find|show|near|path|context|coverage|approve|sign-off)\b(?:\s+(?:--?[\w-]+(?:=\S+)?|Ⓧ))*/g,
  /\b(?:pnpm|npm|npx|node|git|bb|curl)\s+[a-z][\w:-]*(?:\.[\w-]+)*(?:\s+(?:--?[\w-]+(?:=\S+)?|Ⓧ))*/g,
  /(?:^|(?<=\s|\())--?[a-z][\w-]*(?:=\S+)?/g,
  /[\w.@~-]*\/[\w./@~*-]*/g,
  /\b[\w-]+\.(?:ts|tsx|js|mjs|cjs|json|ya?ml|md|png|svg|html|css|txt|sh|zip)\b/g,
  /\b[RSDGTC]\d+(?:-[\w-]+)?\b/g,
  /\b\w+(?:-\w+)+\b/g,
  /\b\w*(?:[a-z][A-Z]|[A-Z]{2}|\d|_)\w*\b/g,
];

const TECHNICAL_RE = new RegExp(
  `(?<![\\w-])(?:${[...STE_TECHNICAL_NAMES].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')).join('|')})(?![\\w-])`,
  'gi',
);

/** Replace every span that the checker must not read with one mask word. */
export function steMask(text: string): string {
  // A numbered list item is a list item, not a number and a sentence: make it a "-" item.
  let out = text.replace(/^(\s*)\d+[.)]\s/gm, '$1- ').replace(TECHNICAL_RE, MASK);
  for (const re of MASKS) out = out.replace(re, (m) => (m.startsWith('\n') ? `\n${MASK}` : MASK));
  // Keep the mask word apart from a word next to it, so that "failing${n}" still gives "failing".
  return out.replace(new RegExp(`(\\w)${MASK}`, 'g'), `$1 ${MASK}`).replace(new RegExp(`${MASK}(\\w)`, 'g'), `${MASK} $1`);
}

const words = (list: string): string[] => list.trim().split(/\s+/);

/** Base verbs. With their forms they mark an instruction and are never nouns in a cluster. */
const VERBS = words(`
  accept add allow answer apply approve ask be become build call cancel change check choose clear click close collapse
  come compare connect contain continue copy count create cross decide define delete describe do draw drop edit enter
  examine expand export fail fill find finish fix follow get give go hide hold import include install keep know leave let
  link list load look make mark match measure merge move name need note open paste pick play point press print push put
  read record refresh reload remove rename repeat replace report reset return review run save say scroll see select send
  set show sign skip sort split start stay stop take tell test try turn type update use wait walk want work write
  happen has have had is are was were been am does did done mean means meant gets got goes went gave given came seen saw
  ran ran shown kept left made said told took taken wrote written read built drew drawn found held knew known let put set
  stood thought understood become began began brought chose chosen fell felt forgot hid hidden lost met paid sent spent
  belong carry depend exist lead lie live miss pass reach remain seem sit stand talk think wish win
`);

function verbForms(v: string): string[] {
  const out = [v, `${v}s`, `${v}es`, `${v}ed`, `${v}d`];
  if (v.endsWith('y')) out.push(`${v.slice(0, -1)}ies`, `${v.slice(0, -1)}ied`);
  return out;
}

const VERB_SET = new Set(VERBS.flatMap(verbForms));

const IMPERATIVE = new Set(words(`
  accept add allow answer apply approve ask build call cancel change check choose clear click close collapse compare connect
  copy count create decide define delete describe do draw drop edit enter examine expand export fill find finish fix follow
  get give go hide hold import include install keep let link list load look make mark merge move name note open paste pick
  play press print push put read record refresh reload remove rename repeat replace reset return review run save say scroll
  see select send set show sign skip sort split start stay stop take tell test try turn type update use wait write
`));

const FUNCTION_WORDS = new Set(words(`
  a an the this that these those it its it's they them their there here he she his her we us our you your i me my
  and or but nor so yet if then than when while until unless because as after before since though although whether
  of in on at to from by for with without about above below over under into onto out up down off through between among
  per via across along around behind beyond near next past toward towards within upon against during except like
  not no yes all any each every some many much more most less least few other another such same own only also just
  very too still again ever never always often now already even both either neither one two three four five six seven
  eight nine ten first second last can could will would shall should may might must who whom whose which what where
  why how ok
`));

const ADJECTIVES = new Set(words(`
  new old good bad right wrong true false full empty open closed short long large small big high low top bottom main
  real plain simple clear easy hard free safe ready valid invalid able unable possible necessary different same equal
  correct incorrect applicable whole public private local global current previous next last first final early late
  red green blue grey gray white black dark light active stale draft signed approved unknown known blank raw daily
  automated manual visible hidden live dry quick slow fast own other several certain usual
`));

const PARTICIPLES = new Set(words(`
  used shown written done given made seen taken known found built drawn kept left put set sent hidden chosen broken begun
  brought bought caught cut driven eaten fallen felt forgotten got gotten grown held hit hurt laid led lost meant met
  paid proven said sold shut spent spoken split stolen struck taught thought thrown told understood worn won read run
`));

const BE = new Set(words('is are was were be been being am'));
const SUBORDINATORS = new Set(words('if when until unless after before because while that which so whether where once'));
const ING_OK = new Set(ING_NOUNS.flatMap((w) => [w, `${w}s`]));

interface WordEntry {
  re: RegExp;
  word: string;
  use: string;
}

function wordForms(w: string): string[] {
  if (w.includes(' ') || w.includes('.')) return [w];
  const stem = w.endsWith('e') ? w.slice(0, -1) : w;
  return [w, `${w}s`, `${stem}es`, `${stem}ed`, `${stem}ing`, `${w}d`];
}

const WORD_ENTRIES: readonly WordEntry[] = STE_WORDS.map((e) => {
  const forms = [...new Set([...wordForms(e.word), ...(e.forms ?? [])])].map((f) => f.replace(/[.]/g, '\\.').replace(/ /g, '\\s+'));
  return { re: new RegExp(`(?<![\\w-])(?:${forms.join('|')})(?![\\w-])`, 'gi'), word: e.word, use: e.use };
});

/** The text units: paragraphs, and in them the lines that stand alone (list items, headings). Each unit is a paragraph for the length rule. */
function paragraphs(masked: string): string[][] {
  const out: string[][] = [];
  for (const block of masked.split(/\n\s*\n/)) {
    const units: string[] = [];
    let run: string[] = [];
    let item = false;
    for (const raw of block.split('\n')) {
      const line = raw.trim();
      if (line === '') continue;
      if (/^(?:[-*+•]\s|\d+[.)]\s|#{1,6}\s|>\s|\|)/.test(line)) {
        if (run.length) units.push(run.join(' '));
        run = [line.replace(/^(?:[-*+•]|\d+[.)]|#{1,6}|>)\s+/, '')];
        item = true;
      } else if (item && /^\s/.test(raw)) {
        run.push(line);
      } else {
        if (item && run.length) units.push(run.join(' '));
        if (item) run = [];
        item = false;
        run.push(line);
      }
    }
    if (run.length) units.push(run.join(' '));
    if (units.length) out.push(units);
  }
  return out;
}

function splitSentences(unit: string): string[] {
  return unit
    .split(/(?<=[.!?])\s+(?=[A-Z0-9Ⓧ"“(])/)
    .map((s) => s.trim())
    .filter((s) => /[A-Za-zⓍ]/.test(s));
}

function tokens(sentence: string): string[] {
  return sentence
    .split(/\s+/)
    .map((t) => t.replace(/^[^\wⓍ]+|[^\wⓍ']+$/g, ''))
    .filter((t) => /[A-Za-zⓍ]/.test(t));
}

/** Is this sentence an instruction? See the note at the top of the checker. */
export function isInstruction(sentence: string): boolean {
  const t = tokens(sentence).map((w) => w.toLowerCase());
  if (t.length === 0) return false;
  if (IMPERATIVE.has(t[0]!) || (t[0] === 'do' && t[1] === 'not') || t[0] === "don't" || t[0] === 'never' || t[0] === 'please') return true;
  if (t[0] === 'if' || t[0] === 'when' || t[0] === 'before' || t[0] === 'after') {
    const rest = sentence.slice(sentence.indexOf(',') + 1);
    if (sentence.includes(',')) return isInstruction(rest);
  }
  return false;
}

function excerpt(s: string, n = 8): string {
  const w = s.split(/\s+/);
  return w.length <= n ? s : `${w.slice(0, n).join(' ')} …`;
}

function isNounCandidate(w: string): boolean {
  const l = w.toLowerCase();
  if (!/^[a-z]+$/i.test(w) || l.length < 2) return false;
  if (FUNCTION_WORDS.has(l) || VERB_SET.has(l) || ADJECTIVES.has(l) || PARTICIPLES.has(l)) return false;
  return !/(?:ly|ed|ing|ful|ous|ive|able|ible|less)$/.test(l);
}

function checkSentence(raw: string, masked: string, out: SteFinding[]): void {
  const instruction = isInstruction(masked);
  const t = tokens(masked);
  const limit = instruction ? STE_LIMITS.instruction : STE_LIMITS.description;
  if (t.length > limit) {
    const kind = instruction ? 'instruction' : 'description';
    out.push({ rule: 'sentence-length', text: excerpt(raw), message: `This ${kind} has ${t.length} words. The limit is ${limit}.`, suggestion: 'Write two or more short sentences.' });
  }
  for (const w of t) {
    const l = w.toLowerCase();
    if (l.length > 4 && l.endsWith('ing') && !ING_OK.has(l) && /^[a-z]+$/i.test(w)) {
      out.push({ rule: 'ing-form', text: w, message: `"${w}" is an -ing form.`, suggestion: 'Use the simple present, the infinitive or a noun.' });
    }
  }
  if (instruction) {
    let clauseHasSub = false;
    const parts = masked.split(/\s+/);
    for (let i = 0; i < parts.length; i++) {
      const w = parts[i]!.toLowerCase().replace(/[^\w']/g, '');
      if (/[,;:]$/.test(parts[i]!)) clauseHasSub = false;
      if (SUBORDINATORS.has(w)) clauseHasSub = true;
      if (!BE.has(w) || clauseHasSub) continue;
      let j = i + 1;
      while (j < parts.length && /^(?:not|also|still|now|then|\w+ly)$/i.test(parts[j]!.replace(/[^\w]/g, ''))) j++;
      const next = (parts[j] ?? '').toLowerCase().replace(/[^\w]/g, '');
      if (next && (PARTICIPLES.has(next) || (/ed$/.test(next) && next.length > 4))) {
        const phrase = parts.slice(i, j + 1).join(' ').replace(/[^\w\s']/g, '');
        out.push({ rule: 'passive-instruction', text: phrase, message: `"${phrase}" is a passive verb in an instruction.`, suggestion: 'Use the active voice: say who does the action.' });
      }
    }
  }
  const run: string[] = [];
  const flush = () => {
    if (run.length > STE_LIMITS.cluster) {
      const text = run.join(' ');
      out.push({ rule: 'noun-cluster', text, message: `"${text}" is a cluster of ${run.length} nouns.`, suggestion: 'Use "of", "for" or a verb to break the cluster.' });
    }
    run.length = 0;
  };
  for (const part of masked.split(/\s+/)) {
    const w = part.replace(/^[^\w]+|[^\w']+$/g, '');
    const cleanEnd = !/[^\w']$/.test(part);
    const cleanStart = !/^[^\w]/.test(part);
    if (!cleanStart) flush();
    if (isNounCandidate(w)) run.push(w);
    else flush();
    if (!cleanEnd) flush();
  }
  flush();
}

/** The STE findings of one text. Masked spans (code, ids, paths, quotes) are not checked. */
export function steFindings(text: string): SteFinding[] {
  const out: SteFinding[] = [];
  const masked = steMask(text);
  const words = WORD_ENTRIES.flatMap((e) => [...masked.matchAll(e.re)].map((m) => ({ at: m.index, text: m[0], use: e.use })));
  for (const w of words.sort((a, b) => a.at - b.at)) {
    out.push({ rule: 'word', text: w.text, message: `"${w.text}" is not an approved STE word.`, suggestion: `Use "${w.use}".` });
  }
  for (const unit of paragraphs(masked).flat()) {
    const all = splitSentences(unit);
    if (all.length > STE_LIMITS.paragraph) {
      out.push({ rule: 'paragraph-length', text: excerpt(all[0]!.replaceAll(MASK, '…')), message: `This paragraph has ${all.length} sentences. The limit is ${STE_LIMITS.paragraph}.`, suggestion: 'Make two or more paragraphs.' });
    }
    for (const s of all) checkSentence(s.replaceAll(MASK, '…'), s, out);
  }
  return out;
}

/** One line for a finding: the rule, the reason and the suggestion. */
export function steFindingText(f: SteFinding): string {
  return `STE ${f.rule}: ${f.message} ${f.suggestion}`;
}
