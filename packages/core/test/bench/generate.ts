// Benchmark fixture for R17 / S10-A2: a valid record with many boxes (some nested)
// and many approved scenarios whose approval hashes are correct.
// Reusable by any check that needs a big record (validate now, simulate after T2).
//
// Root flow: start → u001 → u002 → … → check (decision) → ok | fail.
// About one unit in seven is a parent with 3 children (c1 → c2 → c3).
// About one unit in ten has error exit `broken` → fail.
// Scenario k starts at a leaf of the chain and walks to an end box: by the
// decision (branch yes or no), or by the first error exit after its start.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import { scenarioHash, type Scenario, type ScenarioStep } from '../../src/index.js';

export interface BenchOptions {
  /** Total boxes, nested ones included. At least 4. Default 200. */
  boxes?: number;
  /** Approved scenarios. Default 100. */
  scenarios?: number;
  /** Stories (each with one requirement and one criterion). Default 10. */
  stories?: number;
  /** Folder to write the EPIC into. Default: a new temp folder named 2026-11-05-bench. */
  dir?: string;
}

export interface BenchEpic {
  dir: string;
  slug: string;
  /** Boxes in flow.yaml, nested ones included. */
  boxes: number;
  /** Boxes that have children. */
  parents: number;
  scenarios: number;
}

// Objects are shared between boxes; write each one in full, not as a YAML alias.
const stringify = (doc: unknown) => yamlStringify(doc, { aliasDuplicateObjects: false });

export const BENCH_SLUG = '2026-11-05-bench';
const FIXED = 4; // start, check, ok, fail
const CHILDREN = ['c1', 'c2', 'c3'];

interface Unit {
  id: string;
  nested: boolean;
  errorExit: boolean;
}

/** Write the benchmark EPIC and return where it is and what it has. */
export function generateBenchEpic(opts: BenchOptions = {}): BenchEpic {
  const total = opts.boxes ?? 200;
  const nScenarios = opts.scenarios ?? 100;
  const nStories = opts.stories ?? 10;
  if (total < FIXED + 1) throw new RangeError(`boxes must be at least ${FIXED + 1}`);
  const dir = opts.dir ?? join(mkdtempSync(join(tmpdir(), 'rehearse-bench-')), BENCH_SLUG);

  // A nested unit uses 1 + CHILDREN.length boxes; a plain one uses 1.
  const rest = total - FIXED;
  const nested = Math.floor(rest / (2 * (1 + CHILDREN.length) - 1));
  const unitCount = rest - nested * CHILDREN.length;
  const units: Unit[] = [];
  for (let i = 0; i < unitCount; i++) {
    units.push({
      id: `u${String(i + 1).padStart(3, '0')}`,
      nested: Math.floor((i * nested) / unitCount) !== Math.floor(((i + 1) * nested) / unitCount),
      errorExit: i % 10 === 5,
    });
  }

  const storyOf = (i: number) => `S${(i % nStories) + 1}`;
  const io = { inputs: { item: 'string' }, outputs: { item: 'string' } };

  // ---- prd.yaml
  const prd = {
    epic: { slug: BENCH_SLUG, title: 'Benchmark EPIC', goal: 'A big valid record for the R17 time limit.' },
    roles: [
      { id: 'builder', name: 'Builder', kind: 'human' },
      { id: 'worker', name: 'Worker', kind: 'system' },
    ],
    requirements: Array.from({ length: nStories }, (_, i) => ({ id: `R${i + 1}`, kind: 'functional', text: `Requirement ${i + 1}.` })),
    stories: Array.from({ length: nStories }, (_, i) => ({
      id: `S${i + 1}`,
      role: 'builder',
      want: `to do task ${i + 1}`,
      soThat: `item ${i + 1} is done`,
      requirements: [`R${i + 1}`],
      acceptance: [{ id: `S${i + 1}-A1`, given: 'an item', when: 'the flow runs', then: 'the item is done' }],
    })),
  };

  // ---- entities.yaml
  const entities = {
    entities: [
      {
        id: 'Item',
        fields: { id: 'string', status: 'enum[new, done]', note: 'string?' },
        lifecycle: { field: 'status', initial: 'new', transitions: [{ from: 'new', to: 'done', by: 'worker' }] },
      },
    ],
  };

  // ---- flow.yaml
  const boxes: object[] = [{ id: 'start', kind: 'start', lane: 'builder', title: 'Start' }];
  const edges: object[] = [];
  units.forEach((u, i) => {
    const box: Record<string, unknown> = {
      id: u.id,
      kind: 'process',
      lane: i % 2 === 0 ? 'builder' : 'worker',
      title: `Unit ${u.id}`,
      stories: [storyOf(i)],
      ...io,
      reads: ['Item.status'],
      writes: i === units.length - 1 ? ['Item.status:new->done'] : ['Item.note'],
    };
    if (u.errorExit) box.errorExits = ['broken'];
    if (u.nested) {
      box.children = {
        boxes: CHILDREN.map((c) => ({ id: c, kind: 'process', lane: 'worker', title: `Unit ${u.id} part ${c}`, ...io })),
        edges: CHILDREN.slice(1).map((c, j) => ({ from: CHILDREN[j], to: c })),
      };
    }
    boxes.push(box);
    edges.push({ from: i === 0 ? 'start' : units[i - 1]!.id, to: u.id });
    if (u.errorExit) edges.push({ from: u.id, to: 'fail', label: 'broken', kind: 'error' });
  });
  boxes.push(
    { id: 'check', kind: 'decision', lane: 'worker', title: 'Item done?', inputs: { item: 'string' } },
    { id: 'ok', kind: 'end', lane: 'worker', title: 'Done' },
    { id: 'fail', kind: 'end', lane: 'builder', title: 'Failed' },
  );
  edges.push(
    { from: units[units.length - 1]!.id, to: 'check' },
    { from: 'check', to: 'ok', label: 'yes', kind: 'branch' },
    { from: 'check', to: 'fail', label: 'no', kind: 'branch' },
  );
  const flow = { version: 1, epic: BENCH_SLUG, lanes: [{ role: 'builder', order: 1 }, { role: 'worker', order: 2 }], root: { boxes, edges } };

  // ---- scenarios/
  const leaves: { name: string; unit: number }[] = [];
  units.forEach((u, i) => {
    if (u.nested) for (const c of CHILDREN) leaves.push({ name: `${u.id}/${c}`, unit: i });
    else leaves.push({ name: u.id, unit: i });
  });
  const byStory = new Map<string, Scenario[]>();
  for (let k = 0; k < nScenarios; k++) {
    const story = `S${(k % nStories) + 1}`;
    const from = (k * 7) % leaves.length;
    const steps: ScenarioStep[] = from === 0 ? [{ name: 'start' }] : [];
    const viaError = k % 5 === 4;
    let ended = false;
    for (let l = from; l < leaves.length && !ended; l++) {
      const leaf = leaves[l]!;
      const u = units[leaf.unit]!;
      const lastOfUnit = leaves[l + 1]?.unit !== leaf.unit;
      if (viaError && u.errorExit && lastOfUnit) {
        steps.push({ name: leaf.name, branch: 'broken' }, { name: 'fail' });
        ended = true;
      } else {
        steps.push({ name: leaf.name });
      }
    }
    if (!ended) {
      const yes = k % 2 === 0;
      steps.push({ name: 'check', branch: yes ? 'yes' : 'no' }, { name: yes ? 'ok' : 'fail' });
    }
    const first = steps.findIndex((s) => s.name !== 'start');
    steps[first]!.example = { id: `ex-${k + 1}`, given: { item: `i${k + 1}` }, then: { item: `i${k + 1}` } };

    const content = {
      id: `${story}-bench-${k + 1}`,
      title: `Bench scenario ${k + 1}`,
      steps,
      expect: { criterion: `${story}-A1`, state: { 'Item.status': 'done' } },
    };
    const sc: Scenario = { ...content, story, status: 'approved' };
    const approved: Scenario = {
      ...content,
      story,
      status: 'approved',
      approval: { by: 'bench@example.com', at: '2026-11-05T00:00:00Z', hash: scenarioHash(sc) },
    };
    byStory.set(story, [...(byStory.get(story) ?? []), approved]);
  }

  mkdirSync(join(dir, 'scenarios'), { recursive: true });
  writeFileSync(join(dir, 'prd.yaml'), stringify(prd));
  writeFileSync(join(dir, 'entities.yaml'), stringify(entities));
  writeFileSync(join(dir, 'flow.yaml'), stringify(flow));
  for (const [story, list] of byStory) {
    // The loader adds `story` to each scenario from the file; it is not written per scenario.
    const scenarios = list.map(({ story: _story, ...s }) => s);
    writeFileSync(join(dir, 'scenarios', `${story}.yaml`), stringify({ story, scenarios }));
  }

  const parents = units.filter((u) => u.nested).length;
  return { dir, slug: BENCH_SLUG, boxes: FIXED + units.length + parents * CHILDREN.length, parents, scenarios: nScenarios };
}
