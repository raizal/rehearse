// The resolvers of a real run (G10, G15): ts-morph for TypeScript; scip-python in bulk on a cold index
// and a warm basedpyright on an update for Python. A test can pass its own list to openGraph.

import type { Resolver } from '../extend.js';
import { basedpyrightResolver, scipPythonResolver } from './python.js';
import { tsMorphResolver } from './typescript.js';

export function defaultResolvers(): Resolver[] {
  return [tsMorphResolver(), scipPythonResolver(), basedpyrightResolver()];
}

export { lspStats } from './lsp.js';
export { basedpyrightResolver, resolveFromScip, scipPythonResolver } from './python.js';
export { readScip, type ScipIndex } from './scip.js';
export { tsMorphResolver } from './typescript.js';
