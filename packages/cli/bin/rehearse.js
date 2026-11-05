#!/usr/bin/env node
import { run } from '../dist/index.js';

process.exitCode = run(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: (t) => process.stdout.write(t),
  stderr: (t) => process.stderr.write(t),
});
