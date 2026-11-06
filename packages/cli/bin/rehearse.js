#!/usr/bin/env node
import { main } from '../dist/index.js';

process.exitCode = await main(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: (t) => process.stdout.write(t),
  stderr: (t) => process.stderr.write(t),
});
