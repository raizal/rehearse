// The resolver sets the bench can run with (`--resolvers <name>`). Resolvers make a cold index
// slower (G15), so the speed targets (G11) are measured with each set. When a set of resolvers lands,
// add it here by name; `wave1` stays: the tree-sitter readers and name-match only.

import type { Resolver } from '../extend.js';
import { defaultResolvers } from '../resolve/index.js';

export const BENCH_RESOLVER_SETS: Record<string, () => Resolver[]> = {
  wave1: () => [],
  /** ts-morph, scip-python and basedpyright (T29), the default of openGraph. */
  exact: () => defaultResolvers(),
};

export const DEFAULT_RESOLVER_SET = 'wave1';

export function benchResolvers(name: string): Resolver[] {
  const make = BENCH_RESOLVER_SETS[name];
  if (!make) throw new Error(`no resolver set "${name}"; known: ${Object.keys(BENCH_RESOLVER_SETS).join(', ')}`);
  return make();
}
