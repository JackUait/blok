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
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, existsSync, rmSync, readdirSync, mkdirSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyMutant, assertSourceMatchesReport, isEntryPoint } from './mutant-apply.mjs';

const RUN_TIMEOUT_MS = 180_000;

/**
 * Pristine copies of every file a sweep has mutated, so a sweep that dies
 * without running its `finally` still leaves the cure behind.
 *
 * The repository is shared with other sessions: a mutant left in the tree is
 * their problem, not just ours, and `kill -9` skips both the finally block and
 * the signal handlers. A stale file here is the alarm AND the fix — recover with
 * `node scripts/mutant-sweep.mjs --restore`.
 */
const BACKUP_DIR = '.mutation-state/sweep-backups';

/**
 * A file another process can create to stop a running sweep.
 *
 * SIGTERM cannot do this. The sweep loop is synchronous — `spawnSync` blocks
 * the event loop, so a queued signal handler does not run until the whole loop
 * finishes, which is exactly never when you want to stop it. The only way out
 * of a sync loop is a check the loop itself performs, so it reads this path
 * before every mutant. `--stop` writes it; a stopped sweep deletes it.
 */
const STOP_FILE = '.mutation-state/sweep-stop';

const backupPathFor = (source) => join(BACKUP_DIR, `${source.replace(/[/\\]/g, '__')}.orig`);

/**
 * Forces vite's transform cache to miss after a mutant is written.
 *
 * Many mutant splices preserve the file's byte length (`&&` -> `||`,
 * `?? false` -> `?? true`, `''` -> `""`), and a rewrite that lands in the same
 * clock second as the previous transform keeps the cache key identical — the
 * next vitest run then executes the PREVIOUS source and scores a live verdict
 * for a mutant the tests actually kill (measured on keyboard-handler.ts:
 * 2026-09-10). An index-derived mtime cannot collide with any earlier key.
 */
const bustTransformCache = (source, index) => {
  const stat = statSync(source);

  utimesSync(source, stat.atime, stat.mtimeMs / 1000 - (index + 2) * 2);
};

const restoreAll = () => {
  if (!existsSync(BACKUP_DIR)) {
    process.stdout.write('No sweep backups; nothing to restore.\n');

    return;
  }

  const backups = readdirSync(BACKUP_DIR).filter((name) => name.endsWith('.orig'));

  for (const name of backups) {
    const backup = join(BACKUP_DIR, name);
    const { source, contents } = JSON.parse(readFileSync(backup, 'utf8'));

    if (readFileSync(source, 'utf8') === contents) {
      process.stdout.write(`${source} is already pristine.\n`);
    } else {
      writeFileSync(source, contents);
      process.stdout.write(`Restored ${source}.\n`);
    }

    rmSync(backup);
  }

  if (backups.length === 0) {
    process.stdout.write('No sweep backups; nothing to restore.\n');
  }
};

const argOf = (name) => {
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`));

  return hit === undefined ? undefined : hit.slice(name.length + 3);
};

const scratch = mkdtempSync(join(tmpdir(), 'mutant-sweep-'));

const killProcessGroup = (pid) => {
  if (typeof pid !== 'number') {
    return;
  }

  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // The group is already gone. Nothing to reap.
  }
};

/**
 * Runs a command in its own process group and returns the `spawnSync` result.
 *
 * `detached: true` makes the child a group leader, so everything it starts
 * inherits that group.
 *
 * On timeout only the DIRECT child is signalled. vitest's `forks.js` workers
 * are grandchildren: they survive, reparent to PID 1, and spin with no
 * supervisor left to reap them. Measured 2026-09-11 — eight such orphans from
 * one campaign, nineteen hours, about 640% of an eleven-core machine. Signalling
 * the group is what reaches them.
 */
export const runInOwnProcessGroup = (command, args, timeout) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout,
    detached: true,
  });

  if (result.signal !== null) {
    killProcessGroup(result.pid);
  }

  return result;
};

const WORKER_SIGNATURE = join('vitest', 'dist', 'workers', 'forks.js');

/**
 * PIDs of vitest workers whose parent process has died.
 *
 * Reparenting to PID 1 is the whole signal. A worker with a live vitest above it
 * is running, and reaping it would abort a run in progress.
 *
 * The match is on the worker's own command line, not on the checkout it belongs
 * to. A sweep runs in a worktree whose `scripts/` is a real directory but whose
 * `node_modules` is a symlink to the main checkout's, and Node resolves that
 * symlink into the worker's argv — so the command line names the MAIN repo while
 * the sweep runs in the worktree. Comparing the two would find nothing exactly
 * where sweeps happen. Measured 2026-09-11 on sweep-wt.
 */
export const findOrphanedWorkers = (psOutput) => {
  const pids = [];

  for (const line of psOutput.split('\n')) {
    const columns = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);

    if (columns === null) {
      continue;
    }

    const [, pid, ppid, command] = columns;

    if (ppid === '1' && command.includes(WORKER_SIGNATURE)) {
      pids.push(Number(pid));
    }
  }

  return pids;
};

/**
 * Reaps workers left behind by a sweep that died without cleaning up after
 * itself, so the next run does not inherit them.
 *
 * `kill -9` on a sweep skips both its `finally` block and its signal handlers,
 * and the vitest workers survive it.
 */
export const reapOrphanedWorkers = () => {
  const { stdout } = spawnSync('ps', ['-Ao', 'pid=,ppid=,command='], { encoding: 'utf8' });
  const pids = findOrphanedWorkers(stdout ?? '');

  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }

  return pids;
};

/**
 * Runs the tests once and returns the full names of every failing test.
 *
 * Per test, never the exit code: jsdom routes a throw inside `dispatchEvent` to
 * window's error event, so vitest can exit non-zero with every assertion passing.
 */
const runTests = (tests) => {
  const outFile = join(scratch, `run-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

  // A failing suite exits non-zero; the report file is what we read, so the
  // exit status carries nothing we need.
  runInOwnProcessGroup(
    'node_modules/.bin/vitest',
    ['run', '--config=vitest.mutation.config.ts', '--reporter=json', `--outputFile=${outFile}`, ...tests],
    RUN_TIMEOUT_MS,
  );

  let report;

  try {
    report = JSON.parse(readFileSync(outFile, 'utf8'));
  } catch {
    return { failures: null, crashed: true };
  }

  const failures = new Set();
  let assertions = 0;

  for (const suite of report.testResults ?? []) {
    for (const assertion of suite.assertionResults ?? []) {
      assertions += 1;

      if (assertion.status === 'failed') {
        failures.add(`${assertion.ancestorTitles.join(' > ')} > ${assertion.title}`);
      }
    }
  }

  // A report with no assertions at all means the module never loaded, and
  // "nothing failed" would read that as a survivor. Stryker parenthesizes its
  // replacements; this script splices raw text, so a LogicalOperator mutant can
  // produce `a && b ?? c` — a SyntaxError, and a silent false-alive.
  if (assertions === 0) {
    return { failures: null, crashed: true, note: '<no assertions ran: unparseable mutant or empty suite>' };
  }

  return { failures, crashed: false };
};

const main = () => {
  if (process.argv.includes('--restore')) {
    restoreAll();

    return;
  }

  if (process.argv.includes('--stop')) {
    mkdirSync(BACKUP_DIR, { recursive: true });
    writeFileSync(STOP_FILE, `${new Date().toISOString()}\n`);
    process.stdout.write(`Asked every running sweep to stop after its current mutant (${STOP_FILE}).\n`);

    return;
  }

  // Clearing it here, not when a sweep stops: one `--stop` must halt EVERY
  // running sweep, and starting a new one is the explicit intent that cancels it.
  rmSync(STOP_FILE, { force: true });

  const reaped = reapOrphanedWorkers();

  if (reaped.length > 0) {
    process.stdout.write(`Reaped ${reaped.length} orphaned vitest worker(s) from an earlier run.\n`);
  }

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

  const backup = backupPathFor(source);

  mkdirSync(BACKUP_DIR, { recursive: true });
  writeFileSync(backup, JSON.stringify({ source, contents: original }));

  const verdicts = [];
  const restore = () => {
    writeFileSync(source, original);
    rmSync(backup, { force: true });
  };

  process.on('SIGINT', () => { restore(); process.exit(130); });
  process.on('SIGTERM', () => { restore(); process.exit(143); });

  try {
    for (const [index, mutant] of live.entries()) {
      if (existsSync(STOP_FILE)) {
        process.stdout.write(`Stopped at ${index + 1}/${live.length} on request.\n`);
        break;
      }

      writeFileSync(source, applyMutant(original, mutant));
      bustTransformCache(source, index);

      const run = runTests(tests);
      const fresh = run.crashed
        ? [run.note ?? '<no report: crash or timeout>']
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
    restore();
  }

  writeFileSync(outPath, `${JSON.stringify(verdicts, null, 2)}\n`);

  const killed = verdicts.filter((verdict) => verdict.killed).length;

  process.stdout.write(`\n${killed}/${verdicts.length} killed. Verdicts: ${outPath}\n`);
};

if (isEntryPoint(process.argv[1], fileURLToPath(import.meta.url))) {
  main();
}
