// Birdview playlists from the record (T13): one playlist per story, one test per scenario.
// A Playwright test is named after its scenario id, and each `test.step` title starts with
// the flow box it walks ("review/swimlanes: Builder sees one lane per role"), so Birdview can
// show steps → boxes. Pure functions; the CLI reads and writes the files.

import type { Id, Prd, Scenario } from '@rehearse/core';

/** A test as Birdview reads it from a playlist file. */
export interface PlaylistTest {
  /** Relative to the test project folder (Birdview's `projectDir`). */
  file: string;
  line: number;
  /** The scenario id. */
  name: Id;
  /** The scenario title. */
  about: string;
  /** Step title → the flow box it walks. */
  steps: Record<string, string>;
}

/** One playlist file: `<story id>.json` in the playlists folder. */
export interface Playlist {
  name: string;
  tests: PlaylistTest[];
}

/** A `test(...)` found in a spec file. */
export interface SpecTest {
  file: string;
  /** Line of the `test(` call (Birdview's test key is `file:line`). */
  line: number;
  name: string;
  steps: string[];
}

const TEST_RE = /^\s*test(?:\.only)?\(\s*(['"`])((?:\\.|(?!\1).)*)\1/;
const STEP_RE = /\btest\.step\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;

/**
 * The tests of a spec file, with the step titles inside each. A test runs from its `test(` line
 * to the next one; nested describes are not needed for one test per scenario.
 */
export function parseSpec(file: string, text: string): SpecTest[] {
  const out: SpecTest[] = [];
  text.split('\n').forEach((line, i) => {
    const t = TEST_RE.exec(line);
    if (t) {
      out.push({ file, line: i + 1, name: unescape(t[2]!), steps: [] });
      return;
    }
    const current = out[out.length - 1];
    if (!current) return;
    for (const s of line.matchAll(STEP_RE)) current.steps.push(unescape(s[2]!));
  });
  return out;
}

function unescape(s: string): string {
  return s.replace(/\\(.)/g, '$1');
}

/** The box a step title names: the text before the first ": ". */
export function stepBox(title: string): string {
  const at = title.indexOf(': ');
  return at < 0 ? title : title.slice(0, at);
}

export interface PlaylistBuild {
  playlist: Playlist;
  /** Steps that name a box the scenario does not walk, and tests of no scenario of the story. */
  problems: string[];
}

/** The playlist of one story: its scenarios that have a test, in record order. */
export function buildPlaylist(storyId: Id, prd: Prd | undefined, scenarios: Scenario[], tests: SpecTest[]): PlaylistBuild {
  const want = prd?.stories.find((s) => s.id === storyId)?.want;
  const problems: string[] = [];
  const own = scenarios.filter((s) => s.story === storyId);
  const byName = new Map(tests.map((t) => [t.name, t]));
  const out: PlaylistTest[] = [];
  for (const sc of own) {
    const t = byName.get(sc.id);
    if (!t) continue;
    const boxes = new Set(sc.steps.map((s) => s.name));
    const steps: Record<string, string> = {};
    for (const title of t.steps) {
      const box = stepBox(title);
      if (!boxes.has(box)) problems.push(`${t.file}:${t.line} ${sc.id}: step "${title}" names ${box}, which is not a step of ${sc.id} (${[...boxes].join(', ')})`);
      steps[title] = box;
    }
    out.push({ file: t.file, line: t.line, name: sc.id, about: sc.title, steps });
  }
  return { playlist: { name: want ? `${storyId} · ${want}` : storyId, tests: out }, problems };
}

/** Story ids whose scenario ids name at least one test, in prd order. */
export function storiesWithTests(prd: Prd | undefined, scenarios: Scenario[], tests: SpecTest[]): Id[] {
  const names = new Set(tests.map((t) => t.name));
  const stories = new Set(scenarios.filter((s) => names.has(s.id)).map((s) => s.story));
  const order = prd?.stories.map((s) => s.id) ?? [];
  return [...stories].sort((a, b) => (order.indexOf(a) + 1 || Infinity) - (order.indexOf(b) + 1 || Infinity) || a.localeCompare(b));
}

/** A playlist file's JSON, as written to disk. */
export function playlistJson(p: Playlist): string {
  return JSON.stringify(p, null, 2) + '\n';
}

/** Read a playlist file's JSON; undefined when it is not one. */
export function parsePlaylist(text: string): Playlist | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as Playlist).tests)) return undefined;
  const r = raw as Partial<Playlist>;
  const tests = (r.tests ?? []).filter((t): t is PlaylistTest => typeof t?.file === 'string' && typeof t?.line === 'number' && typeof t?.name === 'string');
  return { name: typeof r.name === 'string' ? r.name : '', tests: tests.map((t) => ({ ...t, about: typeof t.about === 'string' ? t.about : '', steps: t.steps ?? {} })) };
}
