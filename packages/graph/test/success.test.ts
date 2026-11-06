// G21 success measure: on the fixture repo, an agent answers a question with `context` in fewer tokens
// than with grep and cat, and the answer is the same and correct.
//
// The question: "What does getOrderById do, what does it read, and who calls it?"
// With grep and cat the agent runs `grep -rn getOrderById src`, cats every file of the hits, then finds
// the callee loadRow with `grep -rn "function loadRow" src` and cats its file. With the graph it runs
// `rehearse context getOrderById --budget 2000` (text, and --json).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { answerToJson, answerToText, openGraph, type Graph } from '../src/index.js';
import { copyFixture } from './helpers.js';

let graph: Graph;
afterEach(() => graph.close());

const grep = (root: string, ...args: string[]) => execFileSync('grep', ['-rn', ...args, 'src'], { cwd: root, encoding: 'utf8' });
const filesOf = (hits: string) => [...new Set(hits.split('\n').filter((l) => l !== '').map((l) => l.split(':')[0]!))].sort();

it('G21 context answers "what does getOrderById do, read, and who calls it" in fewer bytes than grep and cat', async () => {
  const root = copyFixture('context');
  graph = openGraph(root);

  const hits = grep(root, 'getOrderById');
  const callee = grep(root, 'function loadRow');
  const files = [...new Set([...filesOf(hits), ...filesOf(callee)])].sort();
  const cat = files.map((f) => readFileSync(join(root, f), 'utf8')).join('');
  const grepCatBytes = Buffer.byteLength(hits + callee + cat);

  const answer = await graph.context('getOrderById', { budget: 2000 });
  const text = answerToText(answer);
  const textBytes = Buffer.byteLength(text);
  const jsonBytes = Buffer.byteLength(answerToJson(answer));

  console.log(
    `G21 on test/fixtures/context: grep + cat of ${files.join(', ')} = ${grepCatBytes} bytes (~${Math.ceil(grepCatBytes / 4)} tokens); ` +
      `context text = ${textBytes} bytes (~${Math.ceil(textBytes / 4)} tokens, ${Math.round((100 * textBytes) / grepCatBytes)}%); ` +
      `context --json = ${jsonBytes} bytes; bundle = ${answer.bundle!.tokens} tokens of code`,
  );
  expect(textBytes).toBeLessThan(grepCatBytes);

  // The same answer: every line grep found with a call to getOrderById, the code of getOrderById and of
  // the loadRow it reads are in the bundle.
  const calls = hits.split('\n').filter((l) => /getOrderById\(/.test(l) && !l.includes('function getOrderById'));
  expect(calls.length).toBeGreaterThan(0);
  for (const line of calls) expect(text).toContain(line.split(':').slice(2).join(':'));
  const show = async (name: string) => (await graph.show(name)).nodes[0]!.code!;
  expect(text).toContain(await show('getOrderById'));
  expect(text).toContain(await show('loadRow'));
  // And nothing grep and cat gave that the question does not need: pay.ts and report.ts are not read.
  expect(text).not.toContain('src/pay.ts');
});
