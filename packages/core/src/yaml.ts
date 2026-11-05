// YAML parsing for record files: a syntax error gives a finding, never a throw.

import { LineCounter, parseDocument, visit } from 'yaml';
import type { Finding } from './types.js';

/** Parse YAML text. Returns the value, or a `yaml-syntax` finding for `file`. */
export function parseYaml(text: string, file: string): { value?: unknown; finding?: Finding } {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { prettyErrors: false, uniqueKeys: true, lineCounter });
  const err = doc.errors[0];
  if (err) {
    const pos = lineCounter.linePos(err.pos[0]);
    const where = ` (line ${pos.line}, column ${pos.col})`;
    const reason = err.message.split('\n')[0] ?? err.message;
    return {
      finding: {
        kind: 'schema',
        file,
        path: `line ${pos.line}`,
        message: `yaml-syntax: ${reason}${where}`,
        refs: [],
      },
    };
  }
  // An alias can make a cycle or share one object between two places. Record files do not need them.
  let alias: string | undefined;
  let aliasAt = 0;
  visit(doc, {
    Alias(_key, node) {
      alias = node.source;
      aliasAt = node.range?.[0] ?? 0;
      return visit.BREAK;
    },
  });
  if (alias !== undefined) {
    const pos = lineCounter.linePos(aliasAt);
    return {
      finding: {
        kind: 'schema',
        file,
        path: `line ${pos.line}`,
        message: `yaml-syntax: alias *${alias} is not allowed in record files (line ${pos.line}, column ${pos.col})`,
        refs: [],
      },
    };
  }
  return { value: doc.toJS() };
}
