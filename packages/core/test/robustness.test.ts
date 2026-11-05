// Drafts can be broken in any way. validate reports findings; it never throws.

import { chmodSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateEpic } from '../src/index.js';
import { brief, makeEpic, scenario, validateFixture } from './helpers.js';

describe('robustness (box validate/parse)', () => {
  it('a recursive YAML alias is a yaml-syntax finding, not a stack overflow', () => {
    const r = validateFixture({
      rawFiles: {
        'flow.yaml': [
          'version: 1',
          'epic: 2026-11-05-shop',
          'lanes: [{ role: buyer, order: 1 }]',
          'root: &r',
          '  boxes:',
          '    - { id: a, kind: start, lane: buyer, title: t, children: *r }',
          '  edges: []',
          '',
        ].join('\n'),
      },
    });
    expect(brief(r.findings)).toContain(
      'schema flow.yaml line 6: yaml-syntax: alias *r is not allowed in record files (line 6, column 62)',
    );
  });

  it('a folder in place of a record file is a finding', () => {
    const dir = makeEpic();
    rmSync(join(dir, 'prd.yaml'));
    mkdirSync(join(dir, 'prd.yaml'));
    mkdirSync(join(dir, 'scenarios', 'S3.yaml'));
    const findings = brief(validateEpic(dir).findings);
    expect(findings[0]).toBe('schema prd.yaml : cannot read file (EISDIR)');
    expect(findings.some((f) => f.includes('S3.yaml'))).toBe(false);
  });

  it('an unreadable record file is a finding', () => {
    const dir = makeEpic();
    chmodSync(join(dir, 'entities.yaml'), 0o000);
    try {
      expect(brief(validateEpic(dir).findings)).toEqual(['schema entities.yaml : cannot read file (EACCES)']);
    } finally {
      chmodSync(join(dir, 'entities.yaml'), 0o644);
    }
  });

  it('a lifecycle field with a prototype name is checked as an own field', () => {
    const r = validateFixture({ edit: (d) => (d['entities.yaml'].entities[0].lifecycle.field = 'constructor') });
    expect(brief(r.findings)).toEqual(['reference entities.yaml Order: lifecycle field constructor is not a field of Order']);
  });

  it('a step that takes an error exit must name it in branch', () => {
    const r = validateFixture({ edit: (d) => delete scenario(d, 'S1-empty').steps[1].branch });
    expect(brief(r.findings)).toEqual([
      'structure scenarios/S1.yaml S1-empty/step-2: step takes error exit empty-cart from cart: add branch: empty-cart',
    ]);
  });

  it('an error edge to an unknown box gives one finding', () => {
    const r = validateFixture({
      edit: (d) => (d['flow.yaml'].root.edges.find((e: any) => e.label === 'empty-cart').to = 'nope'),
    });
    expect(brief(r.findings).filter((f) => f.includes('flow.yaml'))).toEqual([
      'reference flow.yaml cart: edge cart -> nope: box nope unknown',
    ]);
  });
});
