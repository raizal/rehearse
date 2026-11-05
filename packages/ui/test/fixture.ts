// The fixture EPIC view for UI tests. test/global-setup.ts builds it in Node,
// because jsdom has no file URLs; tests get a fresh copy here.

import { inject } from 'vitest';
import type { EpicView } from '@rehearse/server';

declare module 'vitest' {
  export interface ProvidedContext {
    reviewEpic: EpicView;
  }
}

export function reviewEpic(): EpicView {
  return structuredClone(inject('reviewEpic'));
}
