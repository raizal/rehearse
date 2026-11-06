// The bench command: `pnpm --filter @rehearse/graph bench [-- --files 1000 --seed 1 --resolvers wave1]`.
// Prints the timings table (or JSON) and returns 1 when a time misses its target (S10), 2 on a usage
// error or when the bench cannot run, so a crash is not read as "too slow".

import { parseArgs } from 'node:util';
import { BENCH_RESOLVER_SETS, DEFAULT_RESOLVER_SET } from './resolvers.js';
import { benchTable, runBench } from './run.js';

const usage = () =>
  `usage: bench [--files n] [--seed n] [--resolvers ${Object.keys(BENCH_RESOLVER_SETS).join('|')}] [--runs n] [--dir path] [--json]\n`;

export async function benchMain(argv: string[], out: (s: string) => void, err: (s: string) => void): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv.filter((a) => a !== '--'),
      options: {
        files: { type: 'string', default: '1000' },
        seed: { type: 'string', default: '1' },
        resolvers: { type: 'string', default: DEFAULT_RESOLVER_SET },
        runs: { type: 'string', default: '5' },
        dir: { type: 'string' },
        json: { type: 'boolean', default: false },
      },
    }));
  } catch (e) {
    err(`${(e as Error).message}\n${usage()}`);
    return 2;
  }
  const [files, seed, runs] = [values.files, values.seed, values.runs].map(Number) as [number, number, number];
  if (![files, seed, runs].every(Number.isInteger) || files < 20 || runs < 1 || seed < 0 || seed >= 2 ** 32) {
    err(`--files (20 or more), --seed (0 to 2^32 - 1) and --runs (1 or more) take whole numbers\n${usage()}`);
    return 2;
  }
  if (!Object.hasOwn(BENCH_RESOLVER_SETS, values.resolvers)) {
    err(`no resolver set "${values.resolvers}"\n${usage()}`);
    return 2;
  }
  let result;
  try {
    result = await runBench({ files, seed, runs, resolvers: values.resolvers, ...(values.dir !== undefined ? { dir: values.dir } : {}) });
  } catch (e) {
    err(`bench could not run: ${(e as Error).message}\n`);
    return 2;
  }
  out(values.json ? `${JSON.stringify(result, null, 2)}\n` : benchTable(result));
  return result.exitCode;
}
