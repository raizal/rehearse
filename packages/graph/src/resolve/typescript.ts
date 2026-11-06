// Box `update-graph/bulk-index`, TypeScript (G10, G15): the ts-morph resolver. One Project per
// tsconfig (a file goes to the first tsconfig that has it, `tsconfig.json` first), kept warm in the
// process. A cold index loads every file; an update refreshes the changed files and resolves only the
// sites in them and the sites that may point into them. A site whose declaration the type checker finds
// is `exact`: in the repo, to the node of the declaration; in node_modules, to a target-only node.
// A site it cannot confirm (a computed call, an untyped package, a builtin) is left to name-match.

import { realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { Project, ts } from 'ts-morph';
import type { GraphView, Resolution, ResolveInput, Resolver } from '../extend.js';
import type { StoredRef } from '../store.js';
import type { GraphNode } from '../types.js';
import { boundTarget, externalMember, externalModule, groupBy, nodeAt, refsToResolve } from './targets.js';

interface Projects {
  /** The tsconfig paths it was made for, to make it again when they change. */
  key: string;
  /** Absolute tsconfig path, or '' for the files that no tsconfig has → its Project. */
  byConfig: Map<string, Project>;
  /** Absolute file path → its tsconfig ('' for none). */
  configOf: Map<string, string>;
}

const COMPILER_DEFAULTS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true, skipLibCheck: true, jsx: ts.JsxEmit.Preserve,
};

export function tsMorphResolver(): Resolver {
  let warm: Projects | undefined;
  return {
    name: 'ts-morph',
    language: 'typescript',
    async resolve(input: ResolveInput): Promise<Resolution[]> {
      const real = realpathSync(input.root);
      const abs = (path: string) => join(real, ...path.split('/'));
      const files = input.scope.files.filter((f) => f.language === 'typescript').map((f) => abs(f.path));
      const key = input.scope.tsconfigs.join('\n');
      if (input.mode === 'cold' || warm?.key !== key) warm = undefined;
      const refs = refsToResolve(input);
      if (refs.length === 0) return [];
      const fresh = warm === undefined;
      const state = (warm ??= { key, byConfig: new Map(), configOf: assignConfigs(real, input.scope.tsconfigs, files) });
      if (!fresh) {
        for (const path of [...input.changed, ...input.removed]) {
          const file = abs(path);
          for (const p of state.byConfig.values()) {
            const sf = p.getSourceFile(file);
            if (!sf) continue;
            if (input.removed.includes(path)) p.removeSourceFile(sf);
            else sf.refreshFromFileSystemSync();
          }
        }
        for (const f of files) if (!state.configOf.has(f)) state.configOf = assignConfigs(real, input.scope.tsconfigs, files);
      }
      // A cold index loads every file; an update in a new process loads the files it resolves in.
      const wanted = input.mode === 'cold' ? files : [...new Set([...refs.map((r) => abs(r.file)), ...input.changed.map(abs)])];
      for (const file of wanted) {
        const config = state.configOf.get(file);
        if (config === undefined) continue;
        const project = projectFor(state, config);
        if (!project.getSourceFile(file)) project.addSourceFileAtPathIfExists(file);
      }

      const out: Resolution[] = [];
      const nodes = new Map<string, GraphNode[]>();
      const nodesIn = (path: string) => {
        let list = nodes.get(path);
        if (!list) nodes.set(path, (list = input.graph.nodesInFile(path)));
        return list;
      };
      for (const [path, fileRefs] of groupBy(refs, (r) => r.file)) {
        const file = abs(path);
        const config = state.configOf.get(file);
        const project = config === undefined ? undefined : state.byConfig.get(config);
        const sf = project?.getSourceFile(file)?.compilerNode;
        if (!project || !sf) continue;
        const program = project.getProgram().compilerObject;
        const checker = program.getTypeChecker();
        const at = sites(sf);
        for (const ref of fileRefs) {
          const site = at.get(siteKey(ref));
          if (!site) continue; // not a site the type checker can see (a computed call)
          const target = targetOf(site, ref, { real, checker, program, graph: input.graph, nodesIn });
          if (target) out.push({ ref, target, trust: 'exact' });
        }
      }
      return out;
    },
  };
}

function projectFor(state: Projects, config: string): Project {
  let project = state.byConfig.get(config);
  if (!project) {
    project = config === ''
      ? new Project({ compilerOptions: COMPILER_DEFAULTS, skipAddingFilesFromTsConfig: true })
      : new Project({ tsConfigFilePath: config, skipAddingFilesFromTsConfig: true, compilerOptions: { skipLibCheck: true } });
    state.byConfig.set(config, project);
  }
  return project;
}

/** Each file → the first tsconfig whose program has it (`tsconfig.json` before the others), or '' for none. */
function assignConfigs(real: string, tsconfigs: string[], files: string[]): Map<string, string> {
  const ordered = [...tsconfigs].sort((a, b) => rankConfig(a) - rankConfig(b) || (a < b ? -1 : a > b ? 1 : 0));
  const out = new Map<string, string>();
  const host: ts.ParseConfigFileHost = { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} };
  for (const config of ordered) {
    const path = join(real, ...config.split('/'));
    const parsed = ts.getParsedCommandLineOfConfigFile(path, {}, host);
    for (const f of parsed?.fileNames ?? []) {
      const file = f.split('/').join(sep);
      if (!out.has(file)) out.set(file, path);
    }
  }
  for (const f of files) if (!out.has(f)) out.set(f, '');
  return out;
}

function rankConfig(path: string): number {
  return path.endsWith('/tsconfig.json') || path === 'tsconfig.json' ? 0 : 1;
}

interface Site {
  /** The node whose symbol is the target: the called name, the extended name, the module specifier. */
  name: ts.Node;
  kind: StoredRef['kind'];
}

function siteKey(r: { kind: string; line: number; name: string; receiver?: string }): string {
  return `${r.kind}\u0000${r.line}\u0000${r.name}\u0000${r.receiver ?? ''}`;
}

const RECEIVER = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;

/** The sites of one file by kind, line, name and receiver, the same keys the tree-sitter reader gives its refs. */
function sites(sf: ts.SourceFile): Map<string, Site> {
  const out = new Map<string, Site>();
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const split = (e: ts.Expression): { node: ts.Node; name: string; receiver?: string } | undefined => {
    if (ts.isIdentifier(e)) return { node: e, name: e.text };
    if (ts.isPropertyAccessExpression(e)) {
      const obj = e.expression.getText(sf);
      return { node: e.name, name: e.name.text, receiver: RECEIVER.test(obj) ? obj : '?' };
    }
    return undefined;
  };
  const add = (kind: Site['kind'], at: ts.Node, s: { node: ts.Node; name: string; receiver?: string } | undefined) => {
    if (!s) return;
    const key = siteKey({ kind, line: line(at), name: s.name, ...(s.receiver !== undefined ? { receiver: s.receiver } : {}) });
    if (!out.has(key)) out.set(key, { name: s.node, kind });
  };
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) add('calls', n, split(n.expression));
    else if (ts.isExpressionWithTypeArguments(n) && ts.isHeritageClause(n.parent)) {
      add(n.parent.token === ts.SyntaxKind.ExtendsKeyword ? 'extends' : 'implements', n, split(n.expression));
    } else if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      add('imports', n, { node: n.moduleSpecifier, name: n.moduleSpecifier.text });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

interface Ctx {
  real: string;
  checker: ts.TypeChecker;
  program: ts.Program;
  graph: GraphView;
  nodesIn(path: string): GraphNode[];
}

function targetOf(site: Site, ref: StoredRef, ctx: Ctx): GraphNode | undefined {
  let symbol = ctx.checker.getSymbolAtLocation(site.name);
  if (!symbol) return undefined;
  if (symbol.flags & ts.SymbolFlags.Alias) symbol = ctx.checker.getAliasedSymbol(symbol);
  const decl = symbol.valueDeclaration ?? symbol.declarations?.[0];
  if (!decl) return undefined;
  const sf = decl.getSourceFile();
  const rel = relative(ctx.real, sf.fileName).split(sep).join('/');
  const inRepo = !rel.startsWith('..') && !isAbsolute(rel) && !rel.split('/').includes('node_modules');
  if (inRepo) {
    const nodes = ctx.nodesIn(rel);
    if (site.kind === 'imports') return ts.isSourceFile(decl) ? nodes.find((n) => n.kind === 'file') : undefined;
    const nameNode = ts.getNameOfDeclaration(decl) ?? decl;
    const line = sf.getLineAndCharacterOfPosition(nameNode.getStart(sf)).line + 1;
    return nodeAt(nodes, nameNode.getText(sf), line);
  }
  if (ctx.program.isSourceFileDefaultLibrary(sf)) return undefined; // a builtin: Math.round, Array#map
  const bound = boundTarget('typescript', ref, ctx.graph.bindings(ref.file));
  if (bound) return bound;
  // A member of a package type with no import binding, e.g. `client.get()` on an axios instance.
  const pkg = packageOfPath(sf.fileName);
  if (pkg === undefined) return undefined;
  if (site.kind === 'imports') return externalModule('typescript', pkg, ref.name);
  const member = ctx.checker.getFullyQualifiedName(symbol).replace(/^"[^"]*"\.?/, '');
  return member === '' ? externalModule('typescript', pkg, pkg) : externalMember('typescript', pkg, pkg, member);
}

/** The npm package of a file in node_modules: `@types/a__b` → `@a/b`, `@types/x` → `x`. */
function packageOfPath(file: string): string | undefined {
  const parts = file.split(/[\\/]/);
  const i = parts.lastIndexOf('node_modules');
  if (i === -1 || i + 1 >= parts.length) return undefined;
  const first = parts[i + 1]!;
  if (first === '@types') {
    const name = parts[i + 2];
    return name === undefined ? undefined : name.includes('__') ? `@${name.replace('__', '/')}` : name;
  }
  return first.startsWith('@') && parts[i + 2] !== undefined ? `${first}/${parts[i + 2]}` : first;
}
