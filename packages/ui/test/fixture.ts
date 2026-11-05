// The fixture EPIC view for UI tests. test/global-setup.ts builds it in Node,
// because jsdom has no file URLs; tests get a fresh copy here.

import { inject } from 'vitest';
import type { ReviewEpicView } from '../src/contract.js';

declare module 'vitest' {
  export interface ProvidedContext {
    reviewEpic: ReviewEpicView;
  }
}

/** Signer key of the fixture builder (D41). */
export const FIXTURE_KEY = 'SHA256:fixtureKeyOfTheBuilder000000000000000000000';

export function reviewEpic(): ReviewEpicView {
  return structuredClone(inject('reviewEpic'));
}
