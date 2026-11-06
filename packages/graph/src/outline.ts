// Box `code-view` (S9-A1, D19): the AST outline the review panel shows below a leaf box. The file is
// parsed again with its tree-sitter grammar and the syntax node on the graph node's lines is the root.
// Named nodes only, cut at a node limit, so an outline stays small enough to send and read.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Parser, type Language, type Node } from 'web-tree-sitter';
import { loadGrammars } from './readers/reader.js';
import type { GraphNode } from './types.js';

export interface AstOutlineNode {
  /** The tree-sitter node type, e.g. `function_declaration`, `if_statement`. */
  type: string;
  /** The text of its `name` field, or of a leaf: an identifier, a string, a number. */
  name?: string;
  /** First and last line, 1-based, as `12-20`. */
  lines: string;
  children: AstOutlineNode[];
}

export interface AstOutline {
  root: AstOutlineNode;
  /** Nodes in the outline. */
  nodes: number;
  /** True when the tree had more nodes than the limit. */
  cut: boolean;
}

export interface OutlineOptions {
  /** Most nodes in the outline; default 300. */
  maxNodes?: number;
}

const MAX_TEXT = 40;
/** Nodes that wrap a declaration and take its name. */
const WRAPPERS = new Set(['decorated_definition', 'export_statement']);

/** The AST outline of a code node, or undefined for a node with no file and lines, or a file that is gone. */
export async function outlineNode(root: string, node: GraphNode, opts: OutlineOptions = {}): Promise<AstOutline | undefined> {
  if (!node.file || !node.range || (node.language !== 'typescript' && node.language !== 'python')) return undefined;
  let text: string;
  try {
    text = readFileSync(join(root, node.file), 'utf8');
  } catch {
    return undefined;
  }
  const grammars = await loadGrammars();
  const language: Language = node.language === 'python' ? grammars.python : node.file.endsWith('.tsx') ? grammars.tsx : grammars.typescript;
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(text);
  try {
    if (!tree) return undefined;
    const [start, end] = node.range.split('-').map((n) => Number(n) - 1) as [number, number];
    const found = spanning(tree.rootNode, start, end);
    if (!found) return undefined;
    const budget = { left: opts.maxNodes ?? 300, cut: false };
    const out = outline(found, budget);
    return { root: out, nodes: (opts.maxNodes ?? 300) - budget.left, cut: budget.cut };
  } finally {
    tree?.delete();
    parser.delete();
  }
}

/** The outermost named node on exactly these rows; through a wrapper with no name (`export`) to the declaration. */
function spanning(n: Node, start: number, end: number): Node | undefined {
  const same = (c: Node) => c.startPosition.row === start && c.endPosition.row === end;
  let found: Node | undefined;
  const walk = (c: Node): void => {
    if (found) return;
    if (c.type !== 'program' && c.type !== 'module' && same(c)) {
      found = c;
      return;
    }
    if (c.startPosition.row <= start && c.endPosition.row >= end) for (const k of c.namedChildren) walk(k);
  };
  walk(n);
  while (found && !found.childForFieldName('name')) {
    const inner = found.namedChildren.find(same);
    if (!inner) break;
    found = inner;
  }
  return found;
}

function outline(n: Node, budget: { left: number; cut: boolean }): AstOutlineNode {
  budget.left--;
  const out: AstOutlineNode = { type: n.type, lines: `${n.startPosition.row + 1}-${n.endPosition.row + 1}`, children: [] };
  const name = nameOf(n);
  if (name !== undefined) out.name = name;
  for (const c of n.namedChildren) {
    if (budget.left <= 0) {
      budget.cut = true;
      break;
    }
    out.children.push(outline(c, budget));
  }
  return out;
}

function nameOf(n: Node): string | undefined {
  const inner = WRAPPERS.has(n.type) ? n.namedChildren.find((c) => c.childForFieldName('name')) : undefined;
  const field = n.childForFieldName('name') ?? inner?.childForFieldName('name');
  const text = field?.text ?? (n.namedChildCount === 0 ? n.text : undefined);
  if (text === undefined || text === '') return undefined;
  const line = text.split('\n')[0]!;
  return line.length > MAX_TEXT || line !== text ? `${line.slice(0, MAX_TEXT)}…` : line;
}
