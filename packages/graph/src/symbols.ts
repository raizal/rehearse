// SCIP-style symbol IDs (G10): `<scheme> <manager> <package> <version> <descriptors>`.
// A file is the namespace `src/orders.ts/`; a class ends in `#`, a function or method in `().`.
// e.g. `scip-typescript npm app 1.0 src/orders.ts/getOrderById().`
// A target-only symbol has version `.`: `scip-typescript npm lodash . lodash/get().`

import type { CodeLanguage } from './types.js';

export interface SymbolPackage {
  name: string;
  version: string;
}

const SCHEME: Record<CodeLanguage, string> = {
  typescript: 'scip-typescript npm',
  python: 'scip-python python',
};

/** A descriptor name, in backticks when it has a character outside [A-Za-z0-9_$+-] (SCIP rule). */
export function descriptorName(name: string): string {
  return /^[A-Za-z0-9_$+-]+$/.test(name) ? name : `\`${name.replace(/`/g, '``')}\``;
}

export function packagePrefix(language: CodeLanguage, pkg: SymbolPackage): string {
  return `${SCHEME[language]} ${pkg.name || '.'} ${pkg.version || '.'}`;
}

export function fileSymbol(language: CodeLanguage, pkg: SymbolPackage, path: string): string {
  return `${packagePrefix(language, pkg)} ${path}/`;
}

/** `Name#` of a class, `name().` of a function, method, test or route, below a parent symbol. */
export function memberSymbol(parent: string, name: string, kind: 'type' | 'term'): string {
  return kind === 'type' ? `${parent}${descriptorName(name)}#` : `${parent}${descriptorName(name)}().`;
}

/** The module node of a package outside the repo: `scip-typescript npm lodash . lodash/`. */
export function externalModuleSymbol(language: CodeLanguage, pkg: string, modulePath: string): string {
  return `${packagePrefix(language, { name: pkg, version: '.' })} ${modulePath}/`;
}

/** A member of a module outside the repo: `scip-python python requests . requests/get().` */
export function externalMemberSymbol(language: CodeLanguage, pkg: string, modulePath: string, member: string): string {
  return memberSymbol(externalModuleSymbol(language, pkg, modulePath), member, 'term');
}
