// Sweeps a source file's live mutants: applies each one, runs the given tests,
// and records whether anything noticed.
//
// Usage:
//   node scripts/mutant-sweep.mjs --report=<report.json> --source=<file> \
//     --tests=<a.test.ts,b.test.ts> [--out=<verdicts.json>] [--only=<id-file>]
//
// A kill is a test that fails OUTSIDE the baseline's failing set: a timeout-based
// assertion fails on its own under machine load, and scoring on the process exit
// code alone turns that into a kill nobody asserted.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyMutant, assertSourceMatchesReport } from './mutant-apply.mjs';

const RUN_TIMEOUT_MS = 180_000;

const argOf = (name) => {
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`));

  return hit === undefined ? undefined : hit.slice(name.length + 3);
};

const scratch = mkdtempSync(join(tmpdir(), 'mutant-sweep-'));

/**
 * Runs the tests once and returns the full names of every failing test.
 *
 * Per test, never the exit code: jsdom routes a throw inside `dispatchEvent` to
 * window's error event, so vitest can exit non-zero with every assertion passing.
 */
const runTests = (tests) => {
  const outFile = join(scratch, `run-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

  try {
    execFileSync(
      'node_modules/.bin/vitest',
      ['run', '--config=vitest.mutation.config.ts', '--reporter=json', `--outputFile=${outFile}`, ...tests],
      { encoding: 'utf8', stdio: 'pipe', timeout: RUN_TIMEOUT_MS },
    );
  } catch {
    // A failing suite exits non-zero; the report file is what we read.
  }

  let report;

  try {
    report = JSON.parse(readFileSync(outFile, 'utf8'));
  } catch {
    return { failures: null, crashed: true };
  }

  const failures = new Set();

  for (const suite of report.testResults ?? []) {
    for (const assertion of suite.assertionResults ?? []) {
      if (assertion.status === 'failed') {
        failures.add(`${assertion.ancestorTitles.join(' > ')} > ${assertion.title}`);
      }
    }
  }

  return { failures, crashed: false };
};

const main = () => {
  const reportPath = argOf('report');
  const source = argOf('source');
  const tests = (argOf('tests') ?? '').split(',').filter(Boolean);
  const outPath = argOf('out') ?? join(scratch, 'verdicts.json');
  const onlyPath = argOf('only');

  if (!reportPath || !source || tests.length === 0) {
    throw new Error('Usage: --report=<report.json> --source=<file> --tests=<a,b> [--out=] [--only=]');
  }

  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const entry = report.files[source];

  if (entry === undefined) {
    throw new Error(`No entry for ${source} in ${reportPath}`);
  }

  const original = readFileSync(source, 'utf8');

  assertSourceMatchesReport(original, entry, source);

  const only = onlyPath === undefined
    ? null
    : new Set(JSON.parse(readFileSync(onlyPath, 'utf8')));

  const live = entry.mutants.filter((mutant) => (
    (mutant.status === 'Survived' || mutant.status === 'NoCoverage')
    && (only === null || only.has(mutant.id))
  ));

  process.stdout.write(`Baseline over ${tests.length} test file(s)…\n`);

  const baseline = runTests(tests);

  if (baseline.crashed) {
    throw new Error('Baseline run produced no report; fix the suite before sweeping');
  }

  process.stdout.write(`Baseline failing tests: ${baseline.failures.size}\n`);

  const verdicts = [];
  const restore = () => writeFileSync(source, original);

  process.on('SIGINT', () => { restore(); process.exit(130); });
  process.on('SIGTERM', () => { restore(); process.exit(143); });

  try {
    for (const [index, mutant] of live.entries()) {
      writeFileSync(source, applyMutant(original, mutant));

      const run = runTests(tests);
      const fresh = run.crashed
        ? ['<no report: crash or timeout>']
        : [...run.failures].filter((name) => !baseline.failures.has(name));

      verdicts.push({
        id: mutant.id,
        mutator: mutant.mutatorName,
        line: mutant.location.start.line,
        replacement: mutant.replacement,
        killed: fresh.length > 0,
        killedBy: fresh.slice(0, 3),
      });

      writeFileSync(outPath, `${JSON.stringify(verdicts, null, 2)}\n`);

      process.stdout.write(
        `[${index + 1}/${live.length}] ${fresh.length > 0 ? 'KILLED ' : 'alive  '} `
        + `${mutant.mutatorName}@${mutant.location.start.line} ${JSON.stringify(mutant.replacement).slice(0, 50)}\n`,
      );
    }
  } finally {
    writeFileSync(source, original);
  }

  writeFileSync(outPath, `${JSON.stringify(verdicts, null, 2)}\n`);

  const killed = verdicts.filter((verdict) => verdict.killed).length;

  process.stdout.write(`\n${killed}/${verdicts.length} killed. Verdicts: ${outPath}\n`);
};

main();
