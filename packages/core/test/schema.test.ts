// JSON Schema findings and the loader (R2).

import { rmSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadEpic, parseYaml, reportToJson, validateEpic } from '../src/index.js';
import { box, brief, makeEpic, REAL_EPIC, scenario, validateFixture } from './helpers.js';

describe('schema (R2)', () => {
  it('names the file, the path and the reason', () => {
    const r = validateFixture({
      edit: (d) => {
        d['prd.yaml'].requirements[0].kind = 'speed';
        d['prd.yaml'].stories[0].colour = 'red';
        box(d, 'ship').children.boxes[0].kind = 'job';
        scenario(d, 'S1-buy').steps[1].brnch = 'x';
      },
    });
    expect(brief(r.findings)).toEqual([
      'schema flow.yaml ship/pack: field kind must be one of: start, end, process, decision, input, output, external (at root.boxes[4].children.boxes[0].kind)',
      'schema prd.yaml requirements[0]: missing field provenBy',
      'schema prd.yaml requirements[0].kind: field kind must be one of: functional, performance, security, permission',
      'schema prd.yaml stories[0]: unknown field colour',
      'schema scenarios/S1.yaml S1-buy/step-2: unknown field brnch (at scenarios[0].steps[1])',
    ]);
  });

  it('a non-functional requirement needs provenBy (D22)', () => {
    const r = validateFixture({ edit: (d) => (d['prd.yaml'].requirements[1].kind = 'security') });
    expect(brief(r.findings)).toEqual(['schema prd.yaml requirements[1]: missing field provenBy']);
  });

  it('a role needs kind (C9)', () => {
    const r = validateFixture({ edit: (d) => delete d['prd.yaml'].roles[0].kind });
    expect(brief(r.findings)).toEqual(['schema prd.yaml roles[0]: missing field kind']);
  });

  it('an approved scenario needs an approval', () => {
    const r = validateFixture({ edit: (d) => (scenario(d, 'S1-empty').status = 'approved') });
    expect(brief(r.findings)).toEqual(['schema scenarios/S1.yaml S1-empty: missing field approval (at scenarios[1])']);
  });

  it('a decision needs inputs only; start and end boxes need no contract', () => {
    const r = validateFixture({ edit: (d) => delete box(d, 'in-stock').inputs });
    expect(brief(r.findings)).toEqual(['schema flow.yaml in-stock: missing field inputs (at root.boxes[3])']);
  });

  it('T19 a box may name its package and its decisions; an entity may name its file (T14, T15)', () => {
    const ok = validateFixture({
      edit: (d) => {
        box(d, 'pay').package = 'core';
        box(d, 'pay').decisions = [];
        d['entities.yaml'].entities[0].file = 'prd.yaml';
      },
    });
    expect(ok.findings).toEqual([]);
    const bad = validateFixture({
      edit: (d) => {
        box(d, 'pay').package = 'Core Lib';
        box(d, 'pay').decisions = ['d4'];
      },
    });
    expect(brief(bad.findings).map((f) => f.replace(/ \(at .*\)$/, ''))).toEqual([
      'schema flow.yaml pay: field package must match ^[a-z0-9][a-z0-9-]*$',
      'schema flow.yaml pay: value must match ^[A-Z]+[0-9]+$',
    ]);
  });

  it('a missing record file is a finding', () => {
    const dir = makeEpic();
    rmSync(`${dir}/entities.yaml`);
    expect(brief(validateEpic(dir).findings)).toEqual(['schema entities.yaml : file missing']);
  });
});

describe('loader (box validate/parse)', () => {
  it('a YAML syntax error is a finding with error exit yaml-syntax; it does not throw', () => {
    const res = parseYaml('a: [1, 2\nb: c\n', 'flow.yaml');
    expect(res.value).toBeUndefined();
    expect(res.finding?.kind).toBe('schema');
    expect(res.finding?.file).toBe('flow.yaml');
    expect(res.finding?.message).toMatch(/^yaml-syntax: /);
  });

  it('a duplicate key is a YAML syntax error', () => {
    expect(parseYaml('a: 1\na: 2\n', 'prd.yaml').finding?.message).toMatch(/^yaml-syntax: /);
  });

  it('adds box paths and scenario stories', () => {
    const { record, findings } = loadEpic(makeEpic());
    expect(findings).toEqual([]);
    expect(record.flow?.root.boxes[4]?.children?.boxes[1]?.path).toBe('ship/send');
    expect(record.scenarioFiles.map((f) => f.file)).toEqual(['scenarios/S1.yaml', 'scenarios/S2.yaml']);
    expect(record.scenarioFiles[1]?.scenarios[0]?.story).toBe('S2');
    // raw keeps the file content without loader fields
    expect((record.raw['flow.yaml'] as any).root.boxes[0].path).toBeUndefined();
  });

  it('loads the real rehearse record', () => {
    const { record, findings } = loadEpic(REAL_EPIC);
    expect(findings).toEqual([]);
    expect(record.prd?.stories.map((s) => s.id)).toContain('S2');
    expect(record.scenarioFiles.length).toBe(13);
  });
});

describe('report (box validate/report, R18)', () => {
  it('findings are sorted and two runs give byte-identical JSON', () => {
    const dir = makeEpic({
      edit: (d) => {
        box(d, 'pay').stories = ['S9'];
        box(d, 'cart').lane = 'bank';
        d['prd.yaml'].stories[0].requirements.push('R9');
      },
    });
    const a = reportToJson(validateEpic(dir));
    const b = reportToJson(validateEpic(dir));
    expect(a).toBe(b);
    const paths = (JSON.parse(a).findings as any[]).map((f) => `${f.file} ${f.path}`);
    expect(paths).toEqual([...paths].sort());
  });
});
