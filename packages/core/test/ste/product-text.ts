// The product text sources of the repo (T60): the files and the string tables that readers see.
// The repo test reads each source, finds its texts and runs the STE checker on them.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

/** The repo root. STE_REPO can name another checkout, for example the base commit to count its findings. */
export const REPO = process.env.STE_REPO ?? resolve(import.meta.dirname, '../../../..');

/** Source folders with product strings: UI, CLI, finding messages, the deck, the briefs, the server. */
export const CODE_SOURCES = ['packages/core/src', 'packages/server/src', 'packages/cli/src', 'packages/bb-plugin/src', 'packages/ui/src'] as const;

/** Prose files: the skill and the docs. */
export const DOC_SOURCES = ['packages/bb-plugin/skills/rehearse/SKILL.md', 'docs/signing.md'] as const;

/** Files that hold no product text: the checker's own word data. */
const SKIP_FILES = new Set(['packages/core/src/present/ste-words.ts']);

/** JSX attributes and call names whose strings are not for readers. */
const CODE_ATTRS = new Set(['className', 'class', 'id', 'key', 'href', 'src', 'type', 'role', 'name', 'htmlFor', 'data-testid', 'style', 'd', 'viewBox', 'fill', 'stroke', 'method', 'rel', 'target', 'lang', 'tabIndex']);
const CODE_CALLS = new Set(['querySelector', 'querySelectorAll', 'getElementById', 'require', 'import', 'join', 'resolve', 'split', 'replace', 'startsWith', 'endsWith', 'includes', 'getAttribute', 'setAttribute', 'addEventListener', 'removeEventListener', 'test', 'match', 'RegExp', 'execFileSync', 'spawn', 'spawnSync', 'execFile', 'fetch', 'setHeader', 'get', 'has', 'set', 'on', 'emit', 'createElement', 'classList', 'words']);

export interface ProductText {
  file: string;
  line: number;
  text: string;
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(?:ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
}

/**
 * A text that a reader sees, and not code (CSS classes, keys, paths). JSX text needs one word, a
 * string needs two words: a one-word string is usually a key or a state name, not a label.
 */
export function isProse(text: string, minWords = 2): boolean {
  // Read only the literal parts of a template: a placeholder is a space here, so it does not look like code.
  const t = text.replace(/\$\{x\}/g, ' ').trim();
  if (minWords > 1 && !/\s/.test(text.trim())) return false;
  const letterWords = t.split(/\s+/).filter((w) => /^[A-Za-z][a-z']*[.,:;!?)…]?$/.test(w));
  // A placeholder counts as a word, so `${n} failing` is a text of two words.
  const placeholders = (text.match(/\$\{x\}/g) ?? []).length;
  if (letterWords.length === 0 || letterWords.length + placeholders < minWords) return false;
  if (/[;{}=]\s*$|=>|^\s*[.#]?[a-z-]+\s*\{|^(?:SELECT|INSERT|UPDATE)\b/.test(t)) return false;
  // Word lists in code: many lowercase words and no punctuation.
  if (/^[a-z' \n]+$/.test(t) && t.split(/\s+/).length >= 12) return false;
  // CSS class lists and key lists: all lowercase words without punctuation, with a hyphenated word.
  if (/^[a-z0-9 _:-]+$/.test(t) && /-/.test(t)) return false;
  return true;
}

function templateText(node: ts.TemplateExpression): string {
  return node.head.text + node.templateSpans.map((s) => `\${x}${s.literal.text}`).join('');
}

function skipped(node: ts.Node): boolean {
  const p = node.parent;
  if (!p) return false;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p)) return true;
  if (ts.isLiteralTypeNode(p)) return true;
  if (ts.isPropertyAssignment(p) && p.name === node) return true;
  if (ts.isElementAccessExpression(p)) return true;
  if (ts.isJsxAttribute(p) && CODE_ATTRS.has(p.name.getText())) return true;
  if (ts.isCallExpression(p)) {
    const callee = p.expression;
    const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : '';
    if (CODE_CALLS.has(name)) return true;
  }
  if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(p.operatorToken.kind)) return true;
  if (ts.isCaseClause(p)) return true;
  return false;
}

/** The prose strings of one TS or TSX file. */
export function codeTexts(file: string, source: string): ProductText[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: ProductText[] = [];
  const add = (node: ts.Node, text: string, minWords = 2) => {
    if (!isProse(text, minWords)) return;
    // In a code string a line break is a real break: each line is a unit of its own.
    const lines = text.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter((l) => l !== '');
    out.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: lines.join('\n\n') });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!skipped(node)) add(node, node.text);
    } else if (ts.isTemplateExpression(node)) {
      if (!skipped(node)) add(node, templateText(node));
    } else if (ts.isJsxText(node)) {
      add(node, node.text, 1);
    } else if (ts.isRegularExpressionLiteral(node)) {
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** The paragraphs of one Markdown file, without code blocks. */
export function docTexts(file: string, source: string): ProductText[] {
  const out: ProductText[] = [];
  const lines = source.split('\n');
  let inCode = false;
  let block: string[] = [];
  let start = 0;
  const flush = () => {
    if (block.length) out.push({ file, line: start + 1, text: block.join('\n') });
    block = [];
  };
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      flush();
      inCode = !inCode;
      return;
    }
    if (inCode) return;
    if (line.trim() === '') return flush();
    if (block.length === 0) start = i;
    block.push(line);
  });
  flush();
  // Drop a one-line block that is a front matter fence or a lowercase YAML key, such as `name: rehearse`.
  return out.filter((t) => !/^---$|^[a-z][\w-]*:\s/.test(t.text.split('\n')[0]!) || t.text.split('\n').length > 1);
}

/** Every product text of the repo, in a fixed order. */
export function productTexts(): ProductText[] {
  const files: string[] = [];
  for (const dir of CODE_SOURCES) walk(join(REPO, dir), files);
  const out: ProductText[] = [];
  for (const abs of files) {
    const file = relative(REPO, abs);
    if (SKIP_FILES.has(file)) continue;
    out.push(...codeTexts(file, readFileSync(abs, 'utf8')));
  }
  for (const file of DOC_SOURCES) out.push(...docTexts(file, readFileSync(join(REPO, file), 'utf8')));
  return out;
}
