// `rehearse find | show | near | path`: the code graph verbs (code-graph EPIC, box `run-query`).
// Each one first brings .rehearse/graph.db at the git top-level up to date (box `update-graph`).
// Exit 1 with "not found" or "no path"; neither changes a file (G27, G28).

import { answerToJson, answerToText, openGraph, type QueryAnswer } from '@rehearse/graph';
import { EXIT, USAGE, type Io } from '../index.js';
import { repoRoot } from './new.js';

export const GRAPH_VERBS = ['find', 'show', 'near', 'path'] as const;
export type GraphVerb = (typeof GRAPH_VERBS)[number];

export function isGraphVerb(command: string | undefined): command is GraphVerb {
  return (GRAPH_VERBS as readonly string[]).includes(command ?? '');
}

const SHAPE: Record<GraphVerb, string> = {
  find: '<words> [--json] [--rebuild]',
  show: '<target> [--json] [--rebuild]',
  near: '<target> [--depth n] [--json] [--rebuild]',
  path: '<from> <to> [--json] [--rebuild]',
};

export async function runGraph(verb: GraphVerb, args: string[], io: Io): Promise<number> {
  let json = false;
  let rebuild = false;
  let depth: number | undefined;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--json') json = true;
    else if (a === '--rebuild') rebuild = true;
    else if (verb === 'near' && (a === '--depth' || a.startsWith('--depth='))) {
      const value = a === '--depth' ? args[++i] : a.slice('--depth='.length);
      if (value === undefined || !/^\d+$/.test(value) || Number(value) < 1) return usage(io, verb, '--depth needs a whole number of 1 or more');
      depth = Number(value);
    } else if (a.startsWith('-')) return usage(io, verb, `unknown option ${a}`);
    else positional.push(a);
  }
  const want = verb === 'path' ? 2 : 1;
  if (verb === 'find' ? positional.length === 0 : positional.length !== want) return usage(io, verb, `expected ${SHAPE[verb]}`);

  const graph = openGraph(repoRoot(io.cwd));
  let answer: QueryAnswer;
  try {
    if (verb === 'find') answer = await graph.find(positional.join(' '), { rebuild });
    else if (verb === 'show') answer = await graph.show(positional[0]!, { rebuild });
    else if (verb === 'near') answer = await graph.near(positional[0]!, { rebuild, ...(depth !== undefined ? { depth } : {}) });
    else answer = await graph.path(positional[0]!, positional[1]!, { rebuild });
  } catch (e) {
    io.stderr(`rehearse ${verb}: internal error: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.internal;
  } finally {
    graph.close();
  }
  if (json) io.stdout(answerToJson(answer));
  else if (answer.ok) io.stdout(answerToText(answer));
  if (!answer.ok) {
    const what = verb === 'path' ? `${positional[0]} -> ${positional[1]}` : positional.join(' ');
    io.stderr(`rehearse ${verb}: ${answer.notes.join('; ')}: ${what}\n`);
  }
  return answer.ok ? EXIT.ok : EXIT.findings;
}

function usage(io: Io, verb: GraphVerb, message: string): number {
  io.stderr(`rehearse ${verb}: ${message}\n\n${USAGE}`);
  return EXIT.usage;
}
