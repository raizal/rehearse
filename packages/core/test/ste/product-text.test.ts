// The repo test for product text (T60): every product text source passes the STE checker. A new
// finding fails this test. Fix the text, or add an entry with a reason to allow.ts.

import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { steFindings, type SteFinding } from '../../src/present/plain.js';
import { STE_ALLOW, type SteAllow } from './allow.js';
import { productTexts } from './product-text.js';

interface Hit extends SteFinding {
  file: string;
  line: number;
  /** The product text that has the finding. */
  source: string;
}

function hits(): Hit[] {
  return productTexts().flatMap((t) => steFindings(t.text).map((f) => ({ ...f, file: t.file, line: t.line, source: t.text })));
}

const matches = (a: SteAllow, h: Hit) => a.file === h.file && a.rule === h.rule && a.text === h.text && h.source.includes(a.in);
const allowed = (h: Hit) => STE_ALLOW.some((a) => matches(a, h));

describe('product text in STE', () => {
  const all = hits();
  // STE_COUNT=<file> writes the count of findings, before the allow list, for the report.
  if (process.env.STE_COUNT) writeFileSync(process.env.STE_COUNT, `${JSON.stringify({ findings: all.length, rows: all.map((h) => `${h.file}:${h.line} ${h.rule} ${h.text}`) }, null, 2)}\n`);

  it('reads the product text sources', () => {
    const files = new Set(productTexts().map((t) => t.file));
    for (const f of ['packages/ui/src/App.tsx', 'packages/cli/src/index.ts', 'packages/core/src/present/deck.ts', 'packages/core/src/trust/build-brief.ts', 'packages/bb-plugin/skills/rehearse/SKILL.md', 'docs/signing.md']) expect(files).toContain(f);
  });

  it('has no STE finding that is not on the allow list', () => {
    const left = all.filter((h) => !allowed(h)).map((h) => `${h.file}:${h.line} ${h.rule}: ${h.message} ${h.suggestion} [${h.text}]`);
    expect(left).toEqual([]);
  });

  it('has no allow entry that matches no finding, and a reason for each entry', () => {
    const unused = STE_ALLOW.filter((a) => !all.some((h) => matches(a, h)));
    expect(unused).toEqual([]);
    for (const a of STE_ALLOW) expect(a.reason.length).toBeGreaterThan(10);
  });
});
