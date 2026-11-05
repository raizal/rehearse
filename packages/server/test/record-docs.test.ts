// T15 feature 5: the decision log (brainstorm.md) and the corrections (corrections.md) in
// `GET /api/epic`, parsed by pure functions. Exact shapes on small texts; the real EPIC checks
// that every decision and correction the record cites is there.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeEpic, REAL_EPIC } from '../../core/test/helpers.js';
import { buildEpicView, parseCorrectionLog, parseDecisions } from '../src/index.js';

const BRAINSTORM = `# shop — brainstorm

## Decisions

### Payments
- **D1 Card only**: The shop takes cards.
  It does not take cash.
- **D2/D3 Two steps**: Pay, then ship.

Not a decision line.

## Version 1 scope (D4, D5)

1. Cart and pay.
2. Ship.

## Later
- **D6 Refunds**: After v1.
`;

const CORRECTIONS = `# Corrections — shop

## 2026-11-05 — first run

- **C1** \`caught-in-simulation\` · box \`pay\`
  - What: pay read a field cart never writes.
  - Why: The order id comes from cart.
  - Fix: cart writes \`Order.id\`.
- **C2** \`caught-after-build\` · R1 · DONE in T2
  - What: R1 was vague.
  - Also: one more note
    that goes on.
- **C3** \`odd-tag\`
`;

describe('T15 feature 5: decision log', () => {
  it('T15 5 parses each bold decision bullet and each heading that names decisions, with its section', () => {
    expect(parseDecisions(BRAINSTORM)).toEqual([
      { ids: ['D1'], title: 'Card only', text: 'The shop takes cards. It does not take cash.', section: 'Payments' },
      { ids: ['D2', 'D3'], title: 'Two steps', text: 'Pay, then ship.', section: 'Payments' },
      { ids: ['D4', 'D5'], title: 'Version 1 scope', text: '1. Cart and pay. 2. Ship.', section: 'Version 1 scope' },
      { ids: ['D6'], title: 'Refunds', text: 'After v1.', section: 'Later' },
    ]);
  });

  it('T15 5 an empty or missing text gives no decisions', () => {
    expect(parseDecisions('')).toEqual([]);
    expect(parseDecisions('# Title\n\nNo decisions here.\n')).toEqual([]);
  });
});

describe('T15 feature 5: corrections', () => {
  it('T15 5 parses each entry: id, tag, what it is about, status, and its notes in order', () => {
    expect(parseCorrectionLog(CORRECTIONS)).toEqual([
      {
        id: 'C1',
        tag: 'caught-in-simulation',
        about: 'box `pay`',
        section: '2026-11-05 — first run',
        notes: [
          { label: 'What', text: 'pay read a field cart never writes.' },
          { label: 'Why', text: 'The order id comes from cart.' },
          { label: 'Fix', text: 'cart writes `Order.id`.' },
        ],
      },
      {
        id: 'C2',
        tag: 'caught-after-build',
        about: 'R1',
        status: 'DONE in T2',
        section: '2026-11-05 — first run',
        notes: [
          { label: 'What', text: 'R1 was vague.' },
          { label: 'Also', text: 'one more note that goes on.' },
        ],
      },
      { id: 'C3', tag: 'odd-tag', about: '', section: '2026-11-05 — first run', notes: [] },
    ]);
  });
});

describe('T15 feature 5: the real EPIC', () => {
  const brainstorm = readFileSync(join(REAL_EPIC, 'brainstorm.md'), 'utf8');
  const corrections = readFileSync(join(REAL_EPIC, 'corrections.md'), 'utf8');
  const cited = (re: RegExp) =>
    new Set(['prd.yaml', 'flow.yaml', 'entities.yaml'].flatMap((f) => [...readFileSync(join(REAL_EPIC, f), 'utf8').matchAll(re)].map((m) => m[0])));

  it('T15 5 every decision id that prd.yaml, flow.yaml or entities.yaml cites is in the decision log', () => {
    const ids = new Set(parseDecisions(brainstorm).flatMap((d) => d.ids));
    for (const id of cited(/\bD\d+\b/g)) expect(ids, id).toContain(id);
    expect(ids).toContain('D42');
  });

  it('T15 5 every correction C1…C31 is there with a known tag, and every cited correction resolves', () => {
    const log = parseCorrectionLog(corrections);
    const ids = log.map((c) => c.id);
    for (let n = 1; n <= 31; n++) expect(ids).toContain(`C${n}`);
    expect(log.every((c) => c.tag === 'caught-in-simulation' || c.tag === 'caught-after-build')).toBe(true);
    for (const id of cited(/\bC\d+\b/g)) expect(ids, id).toContain(id);
    expect(log.find((c) => c.id === 'C27')).toMatchObject({ about: 'R13, box `approve`, box `sign-off`', status: 'OPEN' });
  });

  it('T15 5 GET /api/epic (buildEpicView) carries both; a folder without the files gives empty lists', () => {
    const real = buildEpicView(REAL_EPIC);
    expect(real.decisions?.length).toBeGreaterThan(30);
    expect(real.corrections?.length).toBeGreaterThanOrEqual(31);
    const shop = buildEpicView(makeEpic());
    expect(shop.decisions).toEqual([]);
    expect(shop.corrections).toEqual([]);
  });
});
