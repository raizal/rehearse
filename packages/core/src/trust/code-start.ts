// "Code you start from" (T49, box `code-start-section`): the section of the build brief and the test
// brief that hands an agent the code that already builds each box, from the code graph. Per box: the
// functions that build it (path:line and coverage badge), its earlier Flow-Box commits, the main
// callers and callees, the unit tests that call it, and the commands to dig deeper; a box with no
// code gets the nearest existing code, marked as guesses. Pure: the server and the CLI gather the
// facts (`gatherBriefCode`, box `gather-box-code`) and pass them in. Caps keep the brief compact.

/** A piece of code: a function, a test, a helper. */
export interface CodeRef {
  name: string;
  /** Repo path, `/`-separated. */
  file: string;
  /** First line, 1-based. */
  line?: number;
}

/** Unit test coverage of some code, as the coverage badge shows it. */
export interface CodeCoverage {
  /** Lines covered in whole percent; null: no coverage data. */
  percent: number | null;
  /** Tests that call it. */
  tests: number;
}

export interface CodeFunction extends CodeRef {
  coverage?: CodeCoverage;
}

/** An earlier commit whose Flow-Box trailer names the box. */
export interface CodeCommit {
  short: string;
  subject: string;
  /** The branch it is on (`git name-rev`), when known. */
  branch?: string;
}

/** The code facts of one box. */
export interface BoxCode {
  box: string;
  /** Coverage of all its code. */
  coverage?: CodeCoverage;
  /** Its code, most relevant first; the section shows the first few. */
  functions: CodeFunction[];
  /** How many functions it has in all; default `functions.length`. */
  total?: number;
  /** Its code is all in the boxes inside it (listed under them). */
  inChildren?: boolean;
  /** Earlier Flow-Box commits, newest first. */
  commits: CodeCommit[];
  /** Code outside the box that calls its functions, by graph rank. */
  callers: CodeRef[];
  /** Code outside the box its functions call, by graph rank. */
  callees: CodeRef[];
  /** Unit tests that call its functions ("Tested by"). */
  testedBy: CodeRef[];
  /** A box with no code: the top graph matches for its title and contract terms. Guesses. */
  guesses?: CodeRef[];
  /** The words the guesses were found with. */
  guessWords?: string;
  /** What `context` and `coverage` take for this box; default the box path. */
  target?: string;
  /** What `show` takes for its first function; default that function's name. */
  show?: string;
}

/** What the briefs take: the facts per box, or why there are none. */
export interface CodeStartOptions {
  /** Per box of the story; a box missing here gets no block. */
  code?: BoxCode[];
  /** The code graph could not answer: the one line the section says instead. */
  codeUnavailable?: string;
  /** The rehearse command as it runs in this repo, e.g. `pnpm rehearse`. Default `rehearse`. */
  cli?: string;
}

export const MAX_CODE_FUNCTIONS = 8;
export const MAX_CODE_COMMITS = 5;
export const MAX_CODE_NEIGHBOURS = 5;
export const MAX_CODE_GUESSES = 5;
/** Functions per box in the test brief. */
export const MAX_TEST_BRIEF_FUNCTIONS = 5;
export const MAX_E2E_HELPERS = 8;

export const CODE_START_HEADING = 'Code you start from';

/**
 * The most the section takes. The build brief gives it less when the rest of the brief leaves less
 * room under its budget (`MAX_BRIEF_CHARS`). Over it, the section prints fewer lines per box, then
 * one line per box, then one line in all.
 */
export const MAX_CODE_SECTION_CHARS = 9_000;

/** How much of each box the section prints: the caps, then two smaller steps. */
interface Detail {
  functions: number;
  commits: number;
  neighbours: number;
}
const DETAILS: Detail[] = [
  { functions: MAX_CODE_FUNCTIONS, commits: MAX_CODE_COMMITS, neighbours: MAX_CODE_NEIGHBOURS },
  { functions: 5, commits: 2, neighbours: 3 },
  { functions: 3, commits: 1, neighbours: 0 },
];

/** The coverage badge: `72% · 3 tests`, or `no coverage data`. */
export function coverageBadge(s: CodeCoverage): string {
  if (s.percent === null) return 'no coverage data';
  return `${s.percent}% · ${s.tests} ${s.tests === 1 ? 'test' : 'tests'}`;
}

const at = (r: CodeRef): string => `${r.file}${r.line !== undefined ? `:${r.line}` : ''}`;
const ref = (r: CodeRef): string => `\`${r.name}\` ${at(r)}`;
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();
const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** A command argument, quoted when it holds a space or a quote. */
const arg = (s: string): string => (/^[\w./:@-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

/** The facts of the given boxes, in their order. */
function inOrder(boxes: readonly string[], code: readonly BoxCode[]): BoxCode[] {
  const byBox = new Map(code.map((c) => [c.box, c]));
  return boxes.flatMap((b) => byBox.get(b) ?? []);
}

/**
 * The "Code you start from" section of the build brief, in at most `room` characters; '' when the
 * caller gave no code facts.
 */
export function codeStartSection(boxes: readonly string[], opts: CodeStartOptions, room = MAX_CODE_SECTION_CHARS): string {
  const cli = opts.cli ?? 'rehearse';
  const lines = [`## ${CODE_START_HEADING}`, ''];
  if (opts.codeUnavailable !== undefined) {
    lines.push(`The code graph is not available (${oneLine(opts.codeUnavailable)}), so this brief lists no code; find it with \`${cli} find <words>\` once the graph opens.`);
    return lines.join('\n');
  }
  if (!opts.code) return '';
  const blocks = inOrder(boxes, opts.code);
  if (blocks.length === 0) return '';
  const intro = `From the code graph: the code that builds each box already (its builds edges, else the files of its \`Flow-Box\` commits), its earlier commits, what calls it, what it calls, and the unit tests that call it. Read these first.`;
  const less = `Many boxes, so each lists less: \`${cli} context <box>\` lists the rest.`;
  for (const [i, detail] of DETAILS.entries()) {
    const out = [...lines, intro, ...(i > 0 ? [less] : [])];
    for (const b of blocks) out.push('', ...boxBlock(b, cli, detail));
    const text = out.join('\n');
    if (text.length <= room) return text;
  }
  const short = [...lines, `From the code graph; many boxes, so one line each: \`${cli} context <box>\` lists its code, callers and tests.`, '', ...blocks.map((b) => `- ${boxLine(b)}`)].join('\n');
  if (short.length <= room) return short;
  return [...lines, `${blocks.length} boxes; ${blocks.filter((b) => b.functions.length > 0).length} have code. Ask the graph per box: \`${cli} context <box>\`.`].join('\n');
}

/** One box in one line: its size, coverage and first function, or its first guess. */
function boxLine(b: BoxCode): string {
  const total = b.total ?? b.functions.length;
  const f = b.functions[0];
  if (f) return `\`${b.box}\`: ${total} function${total === 1 ? '' : 's'}${b.coverage ? `, ${coverageBadge(b.coverage)}` : ''}; first ${ref(f)}`;
  if (b.inChildren) return `\`${b.box}\`: its code is in the boxes inside it`;
  const g = b.guesses?.[0];
  return `\`${b.box}\`: no code yet${g ? `; nearest (a guess) ${ref(g)}` : ''}`;
}

function boxBlock(b: BoxCode, cli: string, detail: Detail): string[] {
  const target = b.target ?? b.box;
  const total = b.total ?? b.functions.length;
  if (b.functions.length === 0) {
    const out = [`### \`${b.box}\`: ${b.inChildren ? 'its code is in the boxes inside it' : 'no code yet'}`];
    if (b.inChildren) return out;
    const guesses = (b.guesses ?? []).slice(0, MAX_CODE_GUESSES);
    if (guesses.length === 0) out.push('No code yet, and the graph found nothing near its title.');
    else {
      out.push(`No code yet. Nearest existing code (guesses: graph matches for ${b.guessWords ? `"${cut(b.guessWords, 80)}"` : 'its title'}, not linked to this box):`);
      for (const g of guesses) out.push(`- ${ref(g)}`);
      out.push(`- Dig deeper: \`${cli} find ${arg(b.guessWords ?? b.box)}\`, then \`${cli} context <name>\` on a match`);
    }
    out.push(...commitLines(b, detail.commits));
    return out;
  }
  const head = [`${total} function${total === 1 ? '' : 's'}`];
  if (b.coverage) head.push(coverageBadge(b.coverage));
  const out = [`### \`${b.box}\`: ${head.join(', ')}`];
  const shown = b.functions.slice(0, detail.functions);
  for (const f of shown) out.push(`- ${ref(f)}${f.coverage ? ` (${coverageBadge(f.coverage)})` : ''}`);
  if (total > shown.length) out.push(`- and ${total - shown.length} more: \`${cli} coverage box ${arg(b.box)}\``);
  out.push(...commitLines(b, detail.commits));
  const list = (label: string, refs: readonly CodeRef[]) => {
    if (refs.length > 0 && detail.neighbours > 0) out.push(`- ${label}: ${refs.slice(0, detail.neighbours).map(ref).join('; ')}`);
  };
  list('Called by', b.callers);
  list('Calls', b.callees);
  list('Tested by', b.testedBy);
  out.push(`- Dig deeper: \`${cli} context ${arg(target)}\`, \`${cli} show ${arg(b.show ?? shown[0]!.name)}\`, \`${cli} coverage box ${arg(b.box)}\``);
  return out;
}

function commitLines(b: BoxCode, max: number): string[] {
  const commits = b.commits.slice(0, max);
  if (commits.length === 0) return [];
  const more = b.commits.length > commits.length ? `, latest ${commits.length} of ${b.commits.length}` : '';
  // A branch is named once, after the last commit of a run on it.
  const text = commits.map((c, i) => {
    const branch = c.branch && c.branch !== commits[i + 1]?.branch ? ` (${c.branch})` : '';
    return `\`${c.short}\` ${cut(oneLine(c.subject), 70)}${branch}`;
  });
  return [`- Earlier commits${more}: ${text.join('; ')}`];
}

// ---------------------------------------------------------------- the test brief

/** What the test brief takes besides the per-box facts: the e2e helpers to reuse. */
export interface TestCodeOptions extends CodeStartOptions {
  /** Functions of the test project outside the spec files. */
  e2eHelpers?: CodeRef[];
}

/** `file (fn :12, fn :40)` per file of a box's code, compact. */
function filesLine(b: BoxCode): string {
  if (b.functions.length === 0) return b.inChildren ? 'its code is in the boxes inside it' : 'no code yet';
  const shown = b.functions.slice(0, MAX_TEST_BRIEF_FUNCTIONS);
  const byFile = new Map<string, string[]>();
  for (const f of shown) byFile.set(f.file, [...(byFile.get(f.file) ?? []), `${f.name}${f.line !== undefined ? ` :${f.line}` : ''}`]);
  const total = b.total ?? b.functions.length;
  const more = total > shown.length ? ` and ${total - shown.length} more` : '';
  return `${[...byFile].map(([file, fns]) => `${file} (${fns.join(', ')})`).join(', ')}${more}`;
}

/**
 * The "Code you start from" section of the test brief: per scenario, the code of the boxes it walks
 * (files and functions; a box once, at its first scenario), and the e2e helpers to reuse. '' when
 * the caller gave no code facts.
 */
export function testCodeSection(scenarios: readonly { id: string; boxes: readonly string[] }[], opts: TestCodeOptions): string {
  const cli = opts.cli ?? 'rehearse';
  const lines = [`## ${CODE_START_HEADING}`, ''];
  if (opts.codeUnavailable !== undefined) {
    lines.push(`The code graph is not available (${oneLine(opts.codeUnavailable)}), so this brief lists no code; find it with \`${cli} find <words>\` once the graph opens.`);
    return lines.join('\n');
  }
  if (!opts.code) return '';
  lines.push(`The app code each scenario walks, from the code graph (\`${cli} context <box>\` shows more), and the e2e helpers to reuse. Read them; do not change app code.`, '');
  const byBox = new Map(opts.code.map((c) => [c.box, c]));
  const seen = new Set<string>();
  for (const s of scenarios) {
    const parts: string[] = [];
    for (const box of s.boxes) {
      if (seen.has(box)) continue;
      seen.add(box);
      const c = byBox.get(box);
      if (c) parts.push(`  - \`${box}\`: ${filesLine(c)}`);
    }
    lines.push(parts.length > 0 ? `- ${s.id}:` : `- ${s.id}: its boxes are listed above`, ...parts);
  }
  const helpers = (opts.e2eHelpers ?? []).slice(0, MAX_E2E_HELPERS);
  lines.push(helpers.length > 0 ? `- E2e helpers: ${helpers.map(ref).join('; ')}` : '- E2e helpers: none yet outside the spec files.');
  return lines.join('\n');
}
