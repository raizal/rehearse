// The ts-morph resolver (resolve/ts-morph.ts), loaded on its first use: ts-morph and the TypeScript
// compiler take ~125 ms to import, and a query whose files did not change never needs them (S10).

import type { Resolver } from '../extend.js';

export function tsMorphResolver(): Resolver {
  let inner: Promise<Resolver> | undefined;
  return {
    name: 'ts-morph',
    language: 'typescript',
    async resolve(input) {
      inner ??= import('./ts-morph.js').then((m) => m.tsMorphResolver());
      return (await inner).resolve(input);
    },
  };
}
