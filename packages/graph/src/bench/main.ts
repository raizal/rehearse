// Entry of `pnpm --filter @rehearse/graph bench`: the exit code is the result (S10-too-slow).

import { benchMain } from './cli.js';

process.exitCode = await benchMain(process.argv.slice(2), (s) => process.stdout.write(s), (s) => process.stderr.write(s));
