// Flow structure rules from corrections.md C1–C5 (R3).

import { describe, expect, it } from 'vitest';
import { box, brief, validateFixture } from './helpers.js';

describe('flow structure (R3, corrections C1–C5)', () => {
  it('the shop fixture is valid', () => {
    expect(brief(validateFixture().findings)).toEqual([]);
  });

  it('C1: a start box has no incoming edges (error exit back to start)', () => {
    const r = validateFixture({
      edit: (d) => {
        const e = d['flow.yaml'].root.edges.find((x: any) => x.label === 'empty-cart');
        e.to = 'start';
      },
    });
    expect(r.ok).toBe(false);
    expect(brief(r.findings)).toContain('structure flow.yaml start: start box has incoming edges (from cart)');
  });

  it('C2: an error exit does not loop to its own box', () => {
    const r = validateFixture({
      edit: (d) => {
        box(d, 'pay').errorExits = ['not-in-ui'];
        d['flow.yaml'].root.edges.push({ from: 'pay', to: 'pay', label: 'not-in-ui', kind: 'error' });
      },
    });
    expect(brief(r.findings)).toEqual(['structure flow.yaml pay: error exit not-in-ui loops to its own box']);
  });

  it('C3: an error exit has an edge with kind error', () => {
    const r = validateFixture({
      edit: (d) => {
        box(d, 'pay').errorExits = ['declined'];
      },
    });
    expect(brief(r.findings)).toEqual([
      'structure flow.yaml pay: error exit declined has no edge with kind error and label declined',
    ]);
  });

  it('C3: an error edge that is not in errorExits is a finding', () => {
    const r = validateFixture({
      edit: (d) => {
        d['flow.yaml'].root.edges.push({ from: 'pay', to: 'failed', label: 'declined', kind: 'error' });
      },
    });
    expect(brief(r.findings)).toEqual(['structure flow.yaml pay: error edge declined to failed is not in errorExits']);
  });

  it('C4: an end box has no outgoing edges', () => {
    const r = validateFixture({
      edit: (d) => {
        d['flow.yaml'].root.edges.push({ from: 'done', to: 'pay' });
      },
    });
    expect(brief(r.findings)).toContain('structure flow.yaml done: end box has outgoing edges (to pay)');
  });

  it('C5: each root box is reachable from a start box', () => {
    const r = validateFixture({
      edit: (d) => {
        // Like ci-run before C5: no incoming edge, and it feeds the flow.
        d['flow.yaml'].root.boxes.push({
          id: 'ci-run', kind: 'external', lane: 'shop', title: 'CI run', inputs: { a: 'string' }, outputs: { a: 'string' },
        });
        d['flow.yaml'].root.edges.push({ from: 'ci-run', to: 'pay' });
      },
    });
    expect(brief(r.findings)).toEqual(['structure flow.yaml ci-run: box is not reachable from a start box']);
  });

  it('C5: each root box reaches an end box', () => {
    const r = validateFixture({
      edit: (d) => {
        d['flow.yaml'].root.boxes.push({
          id: 'loop', kind: 'process', lane: 'shop', title: 'Loop', inputs: { a: 'string' }, outputs: { a: 'string' },
        });
        d['flow.yaml'].root.edges.push({ from: 'start', to: 'loop' }, { from: 'loop', to: 'loop' });
      },
    });
    expect(brief(r.findings)).toEqual(['structure flow.yaml loop: box does not reach an end box']);
  });

  it('a decision has 2 or more labeled branches to different boxes', () => {
    const r = validateFixture({
      edit: (d) => {
        const e = d['flow.yaml'].root.edges.find((x: any) => x.from === 'in-stock' && x.label === 'no');
        e.to = 'ship';
      },
    });
    expect(brief(r.findings)).toContain(
      'structure flow.yaml in-stock: decision needs 2 or more labeled branches to different boxes (has 2 to 1 box(es))',
    );
  });

  it('a decision edge without kind branch is a finding', () => {
    const r = validateFixture({
      edit: (d) => {
        const e = d['flow.yaml'].root.edges.find((x: any) => x.from === 'in-stock' && x.label === 'no');
        delete e.kind;
        delete e.label;
      },
    });
    expect(brief(r.findings)).toEqual([
      'structure flow.yaml in-stock: decision edge to failed needs kind branch and a label',
      'structure flow.yaml in-stock: decision needs 2 or more labeled branches to different boxes (has 1 to 1 box(es))',
      // The scenario that took branch `no` now has no such edge.
      'structure scenarios/S2.yaml S2-out-of-stock/step-2: branch no is not a label of an edge from in-stock (labels: yes)',
    ]);
  });

  it('a branch or error edge needs a label (schema)', () => {
    const r = validateFixture({
      edit: (d) => {
        delete d['flow.yaml'].root.edges.find((x: any) => x.label === 'empty-cart').label;
      },
    });
    expect(brief(r.findings)).toContain('schema flow.yaml root.edges[2]: missing field label');
  });
});
