// Box `review/readiness`, data only (R11, R16, S8-A1..A3).

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { countCorrectionTags, gateEpic, loadEpic, parseCorrections, readiness } from '../../src/index.js';
import { BOOTSTRAP_EPIC, makeEpic, REAL_EPIC } from '../helpers.js';
import { approvedEpic } from './helpers.js';

describe('readiness', () => {
  it('gives the chain requirement → stories → boxes → scenarios → status', () => {
    const dir = approvedEpic();
    const view = readiness(loadEpic(dir).record, gateEpic(dir));
    expect(view.requirements[1]).toEqual({
      id: 'R2',
      text: 'The shop ships a paid order.',
      proven: true,
      stories: [
        { id: 'S2', status: 'draft', trusted: false, boxes: ['ship'], scenarios: [{ id: 'S2-out-of-stock', status: 'approved' }], gateFindings: 0 },
      ],
    });
    expect(view.gateOk).toBe(true);
  });

  it('S8-A1 a requirement with no story shows "no proof" with the reason', () => {
    const dir = makeEpic({ edit: (d) => (d['prd.yaml'].stories[1].requirements = ['R1']) });
    const view = readiness(loadEpic(dir).record);
    expect(view.noProof).toContainEqual({ id: 'R2', reason: 'no-story', message: 'no story links R2' });
    expect(view.requirements.find((r) => r.id === 'R2')).toMatchObject({ proven: false, reason: 'no-story' });
    // R1 has stories, but none has an approved scenario.
    expect(view.noProof).toContainEqual({ id: 'R1', reason: 'no-approved-scenario', message: 'no approved scenario that is not stale for S1, S2' });
  });

  it('S8-A2 a box that serves no requirement is in the list "no requirement"', () => {
    const dir = makeEpic({ edit: (d) => delete d['flow.yaml'].root.boxes[2].stories }); // pay
    const view = readiness(loadEpic(dir).record);
    // Children inherit their parent's stories; start, end and decision boxes are markers.
    expect(view.noRequirement).toEqual(['pay']);
  });

  it('S8-A3 corrections.md with 3 caught-in-simulation and 1 caught-after-build gives 3 and 1', () => {
    const dir = makeEpic();
    writeFileSync(
      join(dir, 'corrections.md'),
      [
        '# Corrections',
        '- **C1** `caught-in-simulation` · box `cart`',
        '- **C2** `caught-after-build` · box `pay`',
        '- **C3** `caught-in-simulation` · box `ship`',
        '- **C4** `caught-in-simulation` · box `ship/pack`',
        'Text that mentions `caught-after-build` is not an entry.',
      ].join('\n'),
    );
    const view = readiness(loadEpic(dir).record);
    expect(view.corrections).toEqual({ 'caught-in-simulation': 3, 'caught-after-build': 1, invalid: [] });
  });

  it('flags a correction with an unknown tag', () => {
    expect(countCorrectionTags(parseCorrections('- **C1** `caught-later` · x'))).toEqual({
      'caught-in-simulation': 0,
      'caught-after-build': 0,
      invalid: [{ id: 'C1', tag: 'caught-later' }],
    });
  });

  it('counts the corrections of the frozen first EPIC', () => {
    const view = readiness(loadEpic(BOOTSTRAP_EPIC).record);
    expect(view.corrections).toEqual({ 'caught-in-simulation': 11, 'caught-after-build': 0, invalid: [] });
    expect(view.noProof).toEqual([]);
  });

  it('parses every correction of the live first EPIC', () => {
    const view = readiness(loadEpic(REAL_EPIC).record);
    expect(view.corrections.invalid).toEqual([]);
    // Under review, a requirement may wait for an approval; it must not lack a story.
    expect(view.noProof.filter((p) => p.reason !== 'no-approved-scenario')).toEqual([]);
  });
});
