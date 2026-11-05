// R17 / S10-A2 for validate: 200 boxes and 100 approved scenarios in less than 2 seconds.
// Simulate gets the same check with this generator after thread T2 merges.

import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { indexBoxes, loadEpic, scenarioHash, validateEpic } from '../../src/index.js';
import { generateBenchEpic } from './generate.js';

describe('R17: validate time limit on a generated record', () => {
  const bench = generateBenchEpic();

  it('the generator makes 200 boxes (some nested) and 100 approved scenarios with correct hashes', () => {
    expect(bench).toMatchObject({ boxes: 200, scenarios: 100 });
    expect(bench.parents).toBeGreaterThan(0);
    const { record, findings } = loadEpic(bench.dir);
    expect(findings).toEqual([]);
    expect(indexBoxes(record.flow).size).toBe(200);
    const scenarios = record.scenarioFiles.flatMap((f) => f.scenarios);
    expect(scenarios).toHaveLength(100);
    for (const s of scenarios) {
      expect(s.status).toBe('approved');
      expect(s.approval?.hash).toBe(scenarioHash(s));
    }
    // Some scenarios end through the error exit, the rest through each decision branch.
    const ends = scenarios.map((s) => s.steps.at(-2)?.branch);
    expect(new Set(ends)).toEqual(new Set(['broken', 'yes', 'no']));
  });

  it('S10-A2 validate finishes in less than 2 s for 200 boxes and 100 scenarios, with no findings', () => {
    const t0 = performance.now();
    const report = validateEpic(bench.dir);
    const ms = performance.now() - t0;
    expect(report.findings).toEqual([]);
    expect(ms).toBeLessThan(2000);
  });

  it('the generator scales: other sizes are valid too', () => {
    for (const opts of [{ boxes: 5, scenarios: 1, stories: 1 }, { boxes: 50, scenarios: 20, stories: 3 }]) {
      const b = generateBenchEpic(opts);
      expect(b.boxes).toBe(opts.boxes);
      expect(validateEpic(b.dir).findings).toEqual([]);
    }
  });
});
