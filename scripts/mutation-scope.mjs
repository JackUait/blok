// Works out what a mutation run should cover, and keeps the survivor ledger
// between runs. See docs: the run mutates only what moved, but Stryker's
// incremental file still reports the whole repository, so a survivor found in an
// older commit stays visible until someone kills it.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SURVIVING_STATUSES = new Set(['Survived', 'NoCoverage']);
// Source bytes per run. The first four measured files came to ~60 bytes per
// mutant at ~0.6 s each, so this is roughly a thousand mutants, ten minutes.
const DEFAULT_BUDGET = 60000;
const SOURCE_PREFIX = 'src/';
const TEST_PREFIX = 'test/unit/';
const TEST_SUFFIX = /\.test\.tsx?$/;
const SOURCE_SUFFIX = /\.tsx?$/;

// `src/a/b.ts` and `test/unit/a/b.test.ts` are the same stem-and-directory pair.
// Blok has three sanitizer.ts and two sanitize-url tests, so the mirrored path
// is the only thing that says which file belongs to which.
const mirrorTestsOf = (source) => {
  const rest = source.slice(SOURCE_PREFIX.length).replace(SOURCE_SUFFIX, '');

  return [`${TEST_PREFIX}${rest}.test.ts`, `${TEST_PREFIX}${rest}.test.tsx`];
};

const mirrorSourcesOf = (test) => {
  const rest = test.slice(TEST_PREFIX.length).replace(TEST_SUFFIX, '');

  return [`${SOURCE_PREFIX}${rest}.ts`, `${SOURCE_PREFIX}${rest}.tsx`];
};

const stemOf = (path) => path.split('/').pop().replace(TEST_SUFFIX, '').replace(SOURCE_SUFFIX, '');

const groupByStem = (paths) => {
  const groups = new Map();

  for (const path of paths) {
    const stem = stemOf(path);

    groups.set(stem, [...(groups.get(stem) ?? []), path]);
  }

  return groups;
};

/**
 * Picks the commit the diff is measured from.
 *
 * The recorded commit, not `github.event.before`: pushes to main carry several
 * commits and `ci.yml` cancels a superseded run, so a range anchored on the push
 * event drops every commit of the cancelled run. A rewritten history makes the
 * recorded commit unreachable, and then only a full sweep is honest.
 */
export const resolveDiffBase = (state, isReachable) => {
  const sha = state.lastCheckedSha;

  if (typeof sha !== 'string' || sha === '' || !isReachable(sha)) {
    return { from: null, mode: 'full' };
  }

  return { from: sha, mode: 'incremental' };
};

/**
 * Turns a list of changed paths into the files to mutate and the tests to run
 * them against. A changed test pulls in its source: otherwise weakening a test
 * without touching the source would go unmeasured.
 */
export const buildScope = ({ changedPaths, sourceFiles, testFiles }) => {
  const sources = new Set(sourceFiles);
  const sourcesByStem = groupByStem(sourceFiles);
  const testsByStem = groupByStem(testFiles);

  const candidates = new Set();
  const skipped = [];

  for (const path of changedPaths) {
    if (sources.has(path)) {
      candidates.add(path);
      continue;
    }

    if (!TEST_SUFFIX.test(path) || !path.startsWith(TEST_PREFIX)) {
      continue;
    }

    const mirrored = mirrorSourcesOf(path).find((candidate) => sources.has(candidate));

    if (mirrored !== undefined) {
      candidates.add(mirrored);
      continue;
    }

    const owners = sourcesByStem.get(stemOf(path)) ?? [];

    if (owners.length === 1) {
      candidates.add(owners[0]);
    } else if (owners.length > 1) {
      skipped.push({ file: path, reason: 'ambiguous-source' });
    }
  }

  const mutate = [];
  const tests = new Set();
  const knownTests = new Set(testFiles);

  for (const source of [...candidates].sort()) {
    const mirrored = mirrorTestsOf(source).find((candidate) => knownTests.has(candidate));

    if (mirrored !== undefined) {
      mutate.push(source);
      tests.add(mirrored);
      continue;
    }

    const matches = testsByStem.get(stemOf(source)) ?? [];

    if (matches.length === 0) {
      skipped.push({ file: source, reason: 'no-test' });
      continue;
    }

    if (matches.length > 1) {
      skipped.push({ file: source, reason: 'ambiguous-test' });
      continue;
    }

    mutate.push(source);
    tests.add(matches[0]);
  }

  return { mutate, testFiles: [...tests].sort(), skipped };
};

/**
 * Turns a scope into Stryker CLI arguments. A full sweep passes no selection at
 * all — the config file's own defaults cover the repository, and listing every
 * path would blow the command line length.
 */
export const buildStrykerArgs = ({ mode, mutate, testFiles, allowFull = false }) => {
  if (mode === 'full') {
    if (!allowFull) {
      throw new Error(
        'No mutation baseline: seed .mutation-state locally, or pass --full to sweep everything',
      );
    }

    return ['run'];
  }

  if (mutate.length === 0) {
    return null;
  }

  return ['run', '--mutate', mutate.join(','), '--testFiles', testFiles.join(',')];
};

/**
 * Splits a list of files into what this run measures and what waits for the
 * next one. Weight stands in for mutant count, and source bytes track it
 * closely enough: the first four measured files came to ~60 bytes per mutant.
 * A file heavier than the whole budget still goes in alone, or it would sit in
 * the queue for ever and hold up everything behind it.
 */
export const splitByBudget = ({ files, weightOf, budget }) => {
  const batch = [];
  let spent = 0;

  for (const file of files) {
    const weight = weightOf(file);

    if (batch.length > 0 && spent + weight > budget) {
      break;
    }

    batch.push(file);
    spent += weight;
  }

  return { batch, pending: files.slice(batch.length) };
};

/**
 * Reads the survivors out of a Stryker JSON report. Uncovered mutants count as
 * survivors: a branch no test enters is the same gap as one no test asserts on.
 */
export const collectSurvivors = (report) => {
  const survivors = [];

  for (const [file, entry] of Object.entries(report.files ?? {})) {
    for (const mutant of entry.mutants ?? []) {
      if (!SURVIVING_STATUSES.has(mutant.status)) {
        continue;
      }

      const { line, column } = mutant.location.start;
      const end = mutant.location.end ?? {};
      // Start position alone is not an identity. A ternary yields a `true` and a
      // `false` mutant at the same spot, so the replacement is part of the key;
      // `a && b && c` yields three `true` mutants from the same column, so the
      // end position is too. Both cases were measured on the first real run.
      const replacement = createHash('sha1')
        .update(mutant.replacement ?? '')
        .digest('hex')
        .slice(0, 8);

      survivors.push({
        key: `${file}|${mutant.mutatorName}|${line}:${column}-${end.line}:${end.column}|${replacement}`,
        file,
        mutator: mutant.mutatorName,
        line,
        status: mutant.status,
      });
    }
  }

  return survivors;
};

/** Carries the commit a survivor first appeared in across runs. */
export const updateSurvivorAges = ({ previousAges, survivors, sha, timestamp }) => {
  const ages = {};

  for (const survivor of survivors) {
    ages[survivor.key] = previousAges[survivor.key] ?? {
      firstSeenSha: sha,
      firstSeenAt: timestamp,
    };
  }

  return ages;
};

/**
 * The gate. Absolute scores would be red from the first day, so the rule is that
 * the survivor count may not grow. Fixing old ones lowers the bar for good.
 */
export const checkRatchet = ({ previousTotal, currentTotal, seeding = false }) => {
  if (previousTotal === null || previousTotal === undefined) {
    return { ok: true, delta: 0 };
  }

  const delta = currentTotal - previousTotal;

  // Seeding walks the repository a batch at a time, so every batch brings files
  // the ledger has never seen. Growth there is the work, not a regression.
  return { ok: seeding || delta <= 0, delta };
};

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const gitLines = (...args) => git(...args).split('\n').filter(Boolean);

const readJson = (path, fallback) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
};

const isReachable = (sha) => {
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { stdio: 'ignore' });

    return true;
  } catch {
    return false;
  }
};

const trackedFiles = () => {
  const tracked = gitLines('ls-files');

  return {
    sourceFiles: tracked.filter(
      (path) => path.startsWith(SOURCE_PREFIX) && SOURCE_SUFFIX.test(path) && !path.endsWith('.d.ts'),
    ),
    testFiles: tracked.filter((path) => TEST_SUFFIX.test(path)),
  };
};

const sizeOf = (path) => {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
};

const plan = (stateDir, budget) => {
  const state = readJson(join(stateDir, 'state.json'), {});
  const base = resolveDiffBase(state, isReachable);
  const { sourceFiles, testFiles } = trackedFiles();

  if (base.mode === 'full') {
    return { ...base, mutate: sourceFiles, testFiles, skipped: [], pending: [] };
  }

  // Files parked by an earlier run join this run's diff. Both are plain source
  // paths, so buildScope pairs them the same way and drops any that went away.
  const queued = Array.isArray(state.pending) ? state.pending : [];
  const wanted = buildScope({
    changedPaths: [...gitLines('diff', '--name-only', base.from, 'HEAD'), ...queued],
    sourceFiles,
    testFiles,
  });
  const { batch, pending } = splitByBudget({ files: wanted.mutate, weightOf: sizeOf, budget });

  return {
    ...base,
    ...buildScope({ changedPaths: batch, sourceFiles, testFiles }),
    skipped: wanted.skipped,
    pending,
  };
};

/**
 * Parks every source the pairing rule can measure, so the baseline can be built
 * one budgeted batch at a time instead of as one sweep that a sleeping laptop
 * would lose.
 */
const seed = (stateDir) => {
  const { sourceFiles, testFiles } = trackedFiles();
  const { mutate, skipped } = buildScope({
    changedPaths: sourceFiles,
    sourceFiles,
    testFiles,
  });
  const state = readJson(join(stateDir, 'state.json'), {});

  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    join(stateDir, 'state.json'),
    `${JSON.stringify({
      lastCheckedSha: git('rev-parse', 'HEAD'),
      survivorTotal: state.survivorTotal ?? null,
      pending: mutate,
    }, null, 2)}\n`,
  );

  process.stdout.write(
    `Parked ${mutate.length} of ${sourceFiles.length} source file(s); ` +
    `${skipped.length} cannot be paired with a test.\n`,
  );
};

const record = (stateDir, reportPath, pending) => {
  const state = readJson(join(stateDir, 'state.json'), {});
  const previousAges = readJson(join(stateDir, 'ages.json'), {});
  const report = readJson(reportPath, null);

  if (report === null) {
    throw new Error(`No mutation report at ${reportPath}`);
  }

  const survivors = collectSurvivors(report);
  const sha = git('rev-parse', 'HEAD');
  // A run that parked files measured only part of its scope, so growth here
  // cannot be read as a regression. The cost is that a real one hides until the
  // queue drains, which is why the budget should stay big enough that ordinary
  // pushes never park anything.
  const ratchet = checkRatchet({
    previousTotal: state.survivorTotal ?? null,
    currentTotal: survivors.length,
    seeding: pending.length > 0,
  });

  const ages = updateSurvivorAges({
    previousAges,
    survivors,
    sha,
    timestamp: new Date().toISOString(),
  });

  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, 'ages.json'), `${JSON.stringify(ages, null, 2)}\n`);
  writeFileSync(
    join(stateDir, 'state.json'),
    `${JSON.stringify({
      lastCheckedSha: sha,
      survivorTotal: survivors.length,
      pending,
    }, null, 2)}\n`,
  );

  return { survivors, ages, ratchet, pending };
};

const summarise = ({ survivors, ages, ratchet, pending }) => {
  const oldest = survivors
    .map((survivor) => ({ ...survivor, ...ages[survivor.key] }))
    .sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt))
    .slice(0, 20);

  process.stdout.write(
    `Survivors: ${survivors.length} (${ratchet.delta >= 0 ? '+' : ''}${ratchet.delta})\n`,
  );

  if (pending.length > 0) {
    process.stdout.write(`${pending.length} file(s) parked for the next run.\n`);
  }

  for (const survivor of oldest) {
    process.stdout.write(
      `  ${survivor.file}:${survivor.line} ${survivor.mutator} ` +
      `— since ${survivor.firstSeenSha.slice(0, 8)} (${survivor.firstSeenAt.slice(0, 10)})\n`,
    );
  }
};

/**
 * Plan, mutate, then fold the result into the ledger — one command, because
 * recording separately would let a no-op push overwrite the ledger with zeroes.
 * The ledger is written even when the ratchet breaks: pushes to main have
 * already landed, so the run is an alarm, and re-baselining keeps it from
 * staying red forever.
 */
const run = (stateDir, allowFull, budget) => {
  const scope = plan(stateDir, budget);
  const args = buildStrykerArgs({ ...scope, allowFull });

  process.stdout.write(
    `Mutation scope: ${scope.mode}` +
    (scope.from === null ? '' : ` from ${scope.from.slice(0, 8)}`) +
    `, ${scope.mode === 'full' ? 'all sources' : `${scope.mutate.length} file(s)`}\n`,
  );

  for (const { file, reason } of scope.skipped) {
    process.stdout.write(`  skipped ${file} (${reason})\n`);
  }

  if (args === null) {
    process.stdout.write('Nothing to mutate.\n');

    return;
  }

  execFileSync(process.execPath, ['node_modules/@stryker-mutator/core/bin/stryker.js', ...args], {
    stdio: 'inherit',
  });

  const result = record(stateDir, join(stateDir, 'report.json'), scope.pending);

  summarise(result);

  if (!result.ratchet.ok) {
    throw new Error(`Mutation ratchet broken: ${result.ratchet.delta} new survivor(s)`);
  }
};

const main = () => {
  const args = process.argv.slice(2);
  const allowFull = args.includes('--full');
  const budgetArg = args.find((arg) => arg.startsWith('--budget='));
  const budget = budgetArg === undefined ? DEFAULT_BUDGET : Number(budgetArg.slice(9));
  const [command, ...rest] = args.filter((arg) => !arg.startsWith('--'));
  const stateDir = rest[0] ?? '.mutation-state';

  if (command === 'run') {
    run(stateDir, allowFull, budget);

    return;
  }

  if (command === 'plan') {
    process.stdout.write(`${JSON.stringify(plan(stateDir, budget), null, 2)}\n`);

    return;
  }

  if (command === 'seed') {
    seed(stateDir);

    return;
  }

  throw new Error('Usage: node scripts/mutation-scope.mjs <run|plan|seed> [stateDir] [--budget=N]');
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
