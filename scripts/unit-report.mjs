// `pnpm test:report` (T53, box read-unit-report): runs each package's unit tests with vitest's JSON
// reporter, one package at a time, and merges the reports into .rehearse/unit-report.json, the file
// `rehearse present` reads by default. Failing tests are in the report; the exit code says so too.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.rehearse', 'unit-report.json');
const scratch = mkdtempSync(join(tmpdir(), 'rehearse-unit-'));
const merged = { startTime: Date.now(), numTotalTests: 0, numPassedTests: 0, numFailedTests: 0, testResults: [] };
let failed = false;

for (const name of readdirSync(join(root, 'packages')).sort()) {
  const dir = join(root, 'packages', name);
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  } catch {
    continue;
  }
  if (!/\bvitest\b/.test(pkg.scripts?.test ?? '')) continue;
  const file = join(scratch, `${name}.json`);
  process.stdout.write(`${pkg.name ?? name}: `);
  const run = spawnSync('pnpm', ['exec', 'vitest', 'run', '--reporter=json', `--outputFile=${file}`], { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] });
  let report;
  try {
    report = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    process.stdout.write('no report (vitest did not finish)\n');
    failed = true;
    continue;
  }
  if (run.status !== 0) failed = true;
  merged.startTime = Math.min(merged.startTime, report.startTime ?? merged.startTime);
  merged.numTotalTests += report.numTotalTests ?? 0;
  merged.numPassedTests += report.numPassedTests ?? 0;
  merged.numFailedTests += report.numFailedTests ?? 0;
  for (const r of report.testResults ?? []) merged.testResults.push({ ...r, name: typeof r.name === 'string' ? relative(root, r.name) : r.name });
  process.stdout.write(`${report.numPassedTests ?? 0} of ${report.numTotalTests ?? 0} passed\n`);
}

rmSync(scratch, { recursive: true, force: true });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(merged)}\n`);
console.log(`${relative(process.cwd(), out) || out}: ${merged.numPassedTests} of ${merged.numTotalTests} unit tests passed${merged.numFailedTests > 0 ? `, ${merged.numFailedTests} failed` : ''}`);
process.exit(failed ? 1 : 0);
