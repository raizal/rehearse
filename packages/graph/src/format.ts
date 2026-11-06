// The text form of a QueryAnswer (the CLI without --json). `--json` prints the answer as it is.

import type { AnswerEdge, AnswerNode, QueryAnswer } from './types.js';

export function answerToJson(answer: QueryAnswer): string {
  return `${JSON.stringify(answer, null, 2)}\n`;
}

export function answerToText(answer: QueryAnswer): string {
  const lines: string[] = [];
  if (answer.verb === 'find') {
    for (const n of answer.nodes) lines.push(`${(n.score ?? 0).toFixed(4)}  ${nodeLine(n)}`);
  } else if (answer.verb === 'show') {
    for (const n of answer.nodes) {
      lines.push(nodeLine(n), `  ${n.id}`);
      if (n.code !== undefined) lines.push('', ...n.code.split('\n').map((l) => `  ${l}`), '');
    }
    for (const e of answer.edges) lines.push(edgeLine(e));
  } else if (answer.verb === 'near') {
    for (const n of answer.nodes) lines.push(`${n.distance ?? 0}  ${nodeLine(n)}`);
    if (answer.edges.length > 0) lines.push('');
    for (const e of answer.edges) lines.push(edgeLine(e));
  } else if (answer.verb === 'context' && answer.bundle) {
    const b = answer.bundle;
    lines.push(`context ${b.target.name}: ${b.tokens} of ${b.budget} tokens, ${b.items.length} items`);
    for (const i of b.items) lines.push('', `== ${i.distance} ${i.role}: ${nodeLine(i.node)}`, i.code);
  } else {
    for (const e of answer.edges) lines.push(edgeLine(e));
  }
  for (const note of answer.ok ? answer.notes : []) lines.push(`note: ${note}`);
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}

function nodeLine(n: AnswerNode): string {
  const where = n.file ? `  ${n.file}${n.range ? `:${n.range}` : ''}` : '  (outside the repo)';
  return `${n.kind} ${n.name}${n.route ? ` [${n.route}]` : ''}${where}`;
}

function edgeLine(e: AnswerEdge): string {
  return `${e.fromName} -${e.kind}-> ${e.toName}  (${e.trust}, ${e.source})`;
}
