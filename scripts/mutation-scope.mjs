// Works out what a mutation run should cover, and keeps the survivor ledger
// between runs. See docs: the run mutates only what moved, but Stryker's
// incremental file still reports the whole repository, so a survivor found in an
// older commit stays visible until someone kills it.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const SURVIVING_STATUSES = new Set(['Survived', 'NoCoverage']);
// Seconds of dry run per push run. Stryker's dry run runs a batch's covering
// suites one file at a time, and CI wants the whole job under 7 minutes. The
// deadline below is what guarantees that; this only keeps a run from reaching it.
const DEFAULT_BUDGET = 110;
// Stryker's dry run spends this long loading each test file on top of its
// tests. Measured in CI: 112s over 98 files, and 152s over 129 for src/blok.ts.
const PER_FILE_OVERHEAD = 1.15;
// Source bytes per push run, for the mutants the ledger cannot reuse. CI
// measured about 65 bytes and 2 seconds per fresh mutant, so this is about 140
// seconds when nothing is reused. With the dry run budget it fits the deadline.
const DEFAULT_BYTE_BUDGET = 4500;
// The scheduled sweep has a 330-minute job timeout. A sweep that hit its
// deadline would send the same batch back to the next sweep, so its batch must
// stay small enough to finish even when no mutant is reused.
const SWEEP_BUDGET = 60 * 60;
const SWEEP_BYTE_BUDGET = 200000;
// Seconds Stryker may run before it is stopped. Setup, the plan and the upload
// take about a minute of the 7.
const DEFAULT_DEADLINE = 300;
const SWEEP_DEADLINE = 5 * 60 * 60;
// Per-test-file seconds from CI. Regenerate with scripts/mutation-test-seconds.mjs.
const TEST_SECONDS_FILE = 'scripts/mutation-test-seconds.json';
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

// The specifiers the unit suite reaches core through; vitest.mutation.config.ts
// declares the same aliases, and a test importing one of these is protecting the
// file it points at just as much as one using a relative path.
const IMPORT_ALIASES = {
  '@bloklabs/core/adapters': 'src/adapters.ts',
  '@bloklabs/core': 'src/blok.ts',
};

const IMPORT_PATTERN = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

const RESOLUTION_SUFFIXES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

const BARREL_PATTERN = /(?:^|\/)index\.tsx?$/;

// `import type X from '...'` and `export type * from '...'`, across lines. The
// `[^;]` body cannot cross a statement boundary, so a `type` import with no
// `from` clause cannot swallow the next statement's specifier.
const TYPE_ONLY_STATEMENT = /(?:^|\n)[ \t]*(?:import|export)[ \t]+type\b[^;]*?from[ \t]*['"][^'"]*['"]/g;

/**
 * Drops the imports that never load anything.
 *
 * A type-only import is erased, so the module is not loaded and no mutant in it
 * can die in that file. Four of the seven suites listed against
 * `src/components/modules/i18n.ts` imported the type and mocked the module;
 * counting them made 73 already-dead mutants read as a gap the run could close.
 * `import { type Foo }` is deliberately left alone: TypeScript erases that
 * statement only when EVERY binding is type-only, and keeping it costs at worst
 * one suite that kills nothing.
 */
const withoutTypeOnlyImports = (text) => text.replace(TYPE_ONLY_STATEMENT, '');

const relativeImportsOf = (file, sources, readFile) => {
  const deps = [];

  for (const [, specifier] of withoutTypeOnlyImports(readFile(file)).matchAll(IMPORT_PATTERN)) {
    if (!specifier.startsWith('.')) {
      continue;
    }

    const base = relative('.', resolve(dirname(file), specifier));
    const resolved = RESOLUTION_SUFFIXES
      .map((suffix) => base + suffix)
      .find((candidate) => sources.has(candidate));

    if (resolved !== undefined) {
      deps.push(resolved);
    }
  }

  return deps;
};

/**
 * Maps every source to the test files that import it.
 *
 * A source is only as measured as the tests the run actually loads. Pairing by
 * path alone measured `src/view/sanitize.ts` against one of its three suites and
 * called 205 mutants survivors where 141 were real. Reading the imports says
 * which tests protect a file instead of guessing it from its name.
 */
export const buildImporterIndex = ({ testFiles, sourceFiles, readFile }) => {
  const sources = new Set(sourceFiles);
  const index = new Map();

  const add = (source, test) => {
    const seen = index.get(source);

    if (seen === undefined) {
      index.set(source, [test]);
    } else if (!seen.includes(test)) {
      seen.push(test);
    }
  };

  for (const test of testFiles) {
    for (const [, specifier] of withoutTypeOnlyImports(readFile(test)).matchAll(IMPORT_PATTERN)) {
      const aliased = IMPORT_ALIASES[specifier];

      if (aliased !== undefined) {
        if (sources.has(aliased)) {
          add(aliased, test);
        }
        continue;
      }

      if (!specifier.startsWith('.')) {
        continue;
      }

      const base = relative('.', resolve(dirname(test), specifier));
      const resolved = RESOLUTION_SUFFIXES
        .map((suffix) => base + suffix)
        .find((candidate) => sources.has(candidate));

      if (resolved !== undefined) {
        add(resolved, test);
      }
    }
  }

  // A test names the barrel; the files behind it are what actually run. CI
  // skipped two changed popover files as untested because their only suite
  // imports `.../popover-item` and the leaves hang off that index. Barrel chains
  // are followed to the end because an index only re-exports.
  for (const barrel of [...index.keys()].filter((path) => BARREL_PATTERN.test(path))) {
    const tests = [...index.get(barrel)];
    const seen = new Set([barrel]);
    const stack = [barrel];

    while (stack.length > 0) {
      for (const dep of relativeImportsOf(stack.pop(), sources, readFile)) {
        if (seen.has(dep)) {
          continue;
        }
        seen.add(dep);

        for (const test of tests) {
          add(dep, test);
        }

        if (BARREL_PATTERN.test(dep)) {
          stack.push(dep);
        }
      }
    }
  }

  // Loading a module loads what it imports, so its tests protect its direct
  // dependencies too. The dialog proved the cost of stopping short: all 25 of its
  // already-dead mutants died only in a suite one hop further out, and every one
  // of them was reported as a survivor.
  //
  // One hop, not the closure. Measured over this repo, one hop takes the widest
  // source to 309 test files with a median of 17 and doubles the run's test
  // entries; the closure would pair `blok.ts` with the entire suite.
  for (const [source, tests] of [...index].map(([key, value]) => [key, [...value]])) {
    for (const dep of relativeImportsOf(source, sources, readFile)) {
      for (const test of tests) {
        add(dep, test);
      }
    }
  }

  return index;
};

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
 *
 * @param {object} scope - what changed and what the repository holds
 * @param {string[]} scope.changedPaths - paths touched since the diff base
 * @param {string[]} scope.sourceFiles - every tracked source file
 * @param {string[]} scope.testFiles - every tracked test file
 * @param {Map<string, string[]>} [scope.importers] - source to the tests that
 *   import it; without it the pairing falls back to the mirrored path
 */
export const buildScope = ({ changedPaths, sourceFiles, testFiles, importers }) => {
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

    if (importers !== undefined) {
      for (const [source, importing] of importers) {
        if (importing.includes(path)) {
          candidates.add(source);
        }
      }
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
  // A test that mirrors its own source is spoken for, and must not be lent to an
  // unrelated source that merely shares a file name.
  const claimedTests = new Set(
    sourceFiles.flatMap((file) => mirrorTestsOf(file).filter((candidate) => knownTests.has(candidate))),
  );

  for (const source of [...candidates].sort()) {
    const importing = importers?.get(source) ?? [];

    if (importing.length > 0) {
      mutate.push(source);
      for (const test of importing) {
        tests.add(test);
      }
      continue;
    }

    if (importers !== undefined) {
      skipped.push({ file: source, reason: 'no-test' });
      continue;
    }

    const mirrored = mirrorTestsOf(source).find((candidate) => knownTests.has(candidate));

    if (mirrored !== undefined) {
      mutate.push(source);
      tests.add(mirrored);
      continue;
    }

    const matches = (testsByStem.get(stemOf(source)) ?? []).filter(
      (candidate) => !claimedTests.has(candidate),
    );

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
        'No mutation baseline: run `yarn mutate:seed` and drain the queue, or pass --full',
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
 * Splits a list of files into what this run measures, what waits for the next
 * run, and what only the scheduled sweep can afford. Cost is the seconds of
 * covering test files the dry run must add, since it runs each one once, and
 * the source bytes, which stand in for the mutants that may need re-testing
 * after it (about 60-83 bytes per mutant, measured). A file
 * that alone exceeds the budget goes to the sweep: taking it anyway made every
 * run measure src/blok.ts and nothing else.
 */
export const splitByTime = ({
  files,
  testsOf,
  secondsOf,
  budget,
  bytesOf = () => 0,
  byteBudget = Infinity,
}) => {
  const batch = [];
  const pending = [];
  const heavy = [];
  const paid = new Set();
  let spent = 0;
  let bytes = 0;

  for (const file of files) {
    const tests = testsOf(file);
    const alone = tests.reduce((sum, test) => sum + secondsOf(test), 0);
    const size = bytesOf(file);

    if (alone > budget || size > byteBudget) {
      heavy.push(file);
      continue;
    }

    const extra = tests
      .filter((test) => !paid.has(test))
      .reduce((sum, test) => sum + secondsOf(test), 0);

    if (spent + extra > budget || bytes + size > byteBudget) {
      pending.push(file);
      continue;
    }

    batch.push(file);
    spent += extra;
    bytes += size;
    for (const test of tests) {
      paid.add(test);
    }
  }

  return { batch, pending, heavy };
};

/** Files parked by earlier runs go first, so a sorted list cannot starve the tail. */
export const orderQueue = ({ queued, mutate }) => {
  const measurable = new Set(mutate);
  const first = queued.filter((file) => measurable.has(file));
  const parked = new Set(first);

  return [...first, ...mutate.filter((file) => !parked.has(file))];
};

/**
 * Seconds Stryker may run. CI sets `stopAt` from the job's first step, so a
 * slow install shortens the run instead of pushing the job past 7 minutes.
 */
export const deadlineSeconds = ({ deadline, stopAt, now }) =>
  (stopAt === undefined ? deadline : Math.max(1, Math.min(deadline, stopAt - now)));

/**
 * The ledger after Stryker was stopped at the deadline. Stryker writes its
 * incremental file only when it finishes, so the ledger is untouched and the
 * bar stays. The batch goes to the sweep, and the diff counts as accounted for.
 */
export const stateAfterDeadline = ({ state, sha, scope }) => ({
  lastCheckedSha: sha,
  survivorTotal: state.survivorTotal ?? null,
  measuredHash: state.measuredHash,
  pending: scope.pending,
  heavy: [...scope.heavy, ...scope.mutate],
  seeding: state.seeding === true,
});

/**
 * Reads the survivors out of a Stryker JSON report. Uncovered mutants count as
 * survivors: a branch no test enters is the same gap as one no test asserts on.
 *
 * `measurable` drops files this run could not have measured. Stryker copies
 * results for files outside `--mutate` into every later report, so a file that
 * lost its pairing keeps whatever it last scored for ever, and nothing can
 * re-measure or fix it. The trade is that deleting a test lowers the bar by
 * whatever its source was carrying — visible in review as a deleted test.
 */
export const collectSurvivors = (report, measurable) => {
  const survivors = [];

  for (const [file, entry] of Object.entries(report.files ?? {})) {
    if (measurable !== undefined && !measurable.has(file)) {
      continue;
    }

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
export const checkRatchet = ({ previousTotal, currentTotal, partial = false }) => {
  if (previousTotal === null || previousTotal === undefined) {
    return { ok: true, delta: 0 };
  }

  const delta = currentTotal - previousTotal;

  // A run that parked files measured part of its scope, and the seed parks the
  // whole repository a batch at a time. Neither total is a verdict.
  return { ok: partial || delta <= 0, delta };
};

/**
 * Whether this run's total is a verdict at all. A run that parked files measured
 * part of its scope, and every batch of a seed is part of one long measurement —
 * including the batch that empties the queue, which is why the flag is read as
 * well as the queue.
 */
export const isPartialRun = ({ pending, seeding }) => pending.length > 0 || seeding === true;

/**
 * Which total the ledger keeps as the bar. A run that parked files must not
 * raise the bar to include its own new survivors, or the regression the muted
 * ratchet let through would never be caught afterwards either. Two exceptions:
 * the seed, where the growing ledger IS the new bar, and a run whose measurable
 * set moved, where the old bar counted a different set of files.
 */
export const nextTotal = ({ previousTotal, currentTotal, parked, seeding, scopeChanged = false }) => {
  if (parked && !seeding && !scopeChanged && previousTotal !== null && previousTotal !== undefined) {
    return previousTotal;
  }

  return currentTotal;
};

/**
 * Identifies the set of files the bar was measured over. Two totals are only
 * comparable when this matches: widening the pairing rule made 43 files
 * measurable in one commit, and the survivors they had been carrying unseen
 * would have read as a regression on whichever commit drained the queue.
 */
export const scopeFingerprint = (files) =>
  createHash('sha1').update([...files].sort().join('\n')).digest('hex');

/**
 * Whether the bar was measured over a different set of files than this run. A
 * ledger written before the fingerprint existed cannot prove it covered the same
 * set, so it counts as moved and costs one un-enforced run.
 */
export const scopeMoved = (previousHash, currentHash) => previousHash !== currentHash;

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

// A test file CI has not timed yet costs the median, so it neither blocks a
// batch nor rides along for free.
const loadTestSeconds = () => {
  const seconds = readJson(TEST_SECONDS_FILE, {});
  const known = Object.values(seconds).sort((a, b) => a - b);
  const median = known.length > 0 ? known[Math.floor(known.length / 2)] : 3;

  return (test) => (seconds[test] ?? median) + PER_FILE_OVERHEAD;
};

const readSource = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
};

const plan = (stateDir, { budget, sweep }) => {
  const state = readJson(join(stateDir, 'state.json'), {});
  const base = resolveDiffBase(state, isReachable);
  const { sourceFiles, testFiles } = trackedFiles();
  const importers = buildImporterIndex({ testFiles, sourceFiles, readFile: readSource });

  if (base.mode === 'full') {
    return { ...base, mutate: sourceFiles, testFiles, skipped: [], pending: [], heavy: [] };
  }

  // Files parked by an earlier run join this run's diff. Both are plain source
  // paths, so buildScope pairs them the same way and drops any that went away.
  // Only the sweep takes the heavy files.
  const queued = Array.isArray(state.pending) ? state.pending : [];
  const heavyQueued = Array.isArray(state.heavy) ? state.heavy : [];
  const wanted = buildScope({
    changedPaths: [
      ...gitLines('diff', '--name-only', base.from, 'HEAD'),
      ...queued,
      ...(sweep ? heavyQueued : []),
    ],
    sourceFiles,
    testFiles,
    importers,
  });
  const split = splitByTime({
    files: orderQueue({ queued: sweep ? [...heavyQueued, ...queued] : queued, mutate: wanted.mutate }),
    testsOf: (file) => importers.get(file) ?? [],
    secondsOf: loadTestSeconds(),
    budget,
    bytesOf: sizeOf,
    byteBudget: sweep ? SWEEP_BYTE_BUDGET : DEFAULT_BYTE_BUDGET,
  });
  const scheduled = new Set([...split.batch, ...split.pending]);
  const heavy = [...new Set([...(sweep ? [] : heavyQueued), ...split.heavy])]
    .filter((file) => !scheduled.has(file) && (importers.get(file) ?? []).length > 0);

  return {
    ...base,
    ...buildScope({ changedPaths: split.batch, sourceFiles, testFiles, importers }),
    skipped: wanted.skipped,
    pending: split.pending,
    heavy,
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
    importers: buildImporterIndex({ testFiles, sourceFiles, readFile: readSource }),
  });
  const state = readJson(join(stateDir, 'state.json'), {});

  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    join(stateDir, 'state.json'),
    `${JSON.stringify({
      lastCheckedSha: git('rev-parse', 'HEAD'),
      survivorTotal: state.survivorTotal ?? null,
      pending: mutate,
      heavy: [],
      // Tells the batches that follow that this queue is the ledger filling up,
      // not one wide push that ran out of budget. It clears when the queue does.
      seeding: true,
    }, null, 2)}\n`,
  );

  process.stdout.write(
    `Parked ${mutate.length} of ${sourceFiles.length} source file(s); ` +
    `${skipped.length} cannot be paired with a test.\n`,
  );
};

/** Every source the pairing rule can measure right now. */
const measurableSources = () => {
  const { sourceFiles, testFiles } = trackedFiles();
  const importers = buildImporterIndex({ testFiles, sourceFiles, readFile: readSource });

  return new Set(buildScope({ changedPaths: sourceFiles, sourceFiles, testFiles, importers }).mutate);
};

const record = (stateDir, reportPath, pending, heavy) => {
  const state = readJson(join(stateDir, 'state.json'), {});
  const previousAges = readJson(join(stateDir, 'ages.json'), {});
  const report = readJson(reportPath, null);

  if (report === null) {
    throw new Error(`No mutation report at ${reportPath}`);
  }

  const measurable = measurableSources();
  const survivors = collectSurvivors(report, measurable);
  const sha = git('rev-parse', 'HEAD');
  const previousTotal = state.survivorTotal ?? null;
  const measuredHash = scopeFingerprint(measurable);
  const scopeChanged = scopeMoved(state.measuredHash, measuredHash);
  const parked = pending.length > 0 || heavy.length > 0;
  // Seeding survives only as long as its queue does, so a wide push after the
  // baseline is built is parked work, not seeding.
  const seeding = state.seeding === true && parked;
  const ratchet = checkRatchet({
    previousTotal,
    currentTotal: survivors.length,
    partial: isPartialRun({ pending: [...pending, ...heavy], seeding: state.seeding }) || scopeChanged,
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
      survivorTotal: nextTotal({
        previousTotal,
        currentTotal: survivors.length,
        parked,
        seeding,
        scopeChanged,
      }),
      measuredHash,
      pending,
      heavy,
      seeding,
    }, null, 2)}\n`,
  );

  return { survivors, ages, ratchet, pending, heavy, scopeChanged };
};

const reportParked = ({ pending, heavy }) => {
  if (pending.length > 0) {
    process.stdout.write(`${pending.length} file(s) parked for the next run.\n`);
  }

  if (heavy.length > 0) {
    process.stdout.write(`${heavy.length} file(s) wait for the scheduled sweep.\n`);
  }
};

const summarise = ({ survivors, ages, ratchet, pending, heavy, scopeChanged }) => {
  const oldest = survivors
    .map((survivor) => ({ ...survivor, ...ages[survivor.key] }))
    .sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt))
    .slice(0, 20);

  process.stdout.write(
    `Survivors: ${survivors.length} (${ratchet.delta >= 0 ? '+' : ''}${ratchet.delta})\n`,
  );

  if (scopeChanged) {
    process.stdout.write('Measurable scope moved; the bar is re-baselined and this total is not a verdict.\n');
  }

  reportParked({ pending, heavy });

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
// Stryker's default sandbox root; stryker.config.json does not move it.
const SANDBOX_ROOT = '.stryker-tmp';

const sandboxes = () => (existsSync(SANDBOX_ROOT) ? readdirSync(SANDBOX_ROOT) : []);

/**
 * Runs Stryker in its own process group and kills the whole group at the
 * deadline. Killing only Stryker left a test runner worker running on without
 * a parent, and its sandbox behind.
 */
const runStryker = (args, seconds) => new Promise((resolvePromise, reject) => {
  const before = new Set(sandboxes());
  const child = spawn(process.execPath, ['node_modules/@stryker-mutator/core/bin/stryker.js', ...args], {
    stdio: 'inherit',
    detached: true,
  });
  const killGroup = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch {
      // The group already exited.
    }
  };
  // A detached child does not get the terminal's Ctrl+C.
  const forwardInterrupt = () => killGroup('SIGINT');
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killGroup('SIGKILL');
  }, seconds * 1000);

  process.on('SIGINT', forwardInterrupt);
  child.on('error', reject);
  child.on('exit', (code, signal) => {
    clearTimeout(timer);
    process.off('SIGINT', forwardInterrupt);

    if (timedOut) {
      for (const sandbox of sandboxes().filter((name) => !before.has(name))) {
        rmSync(join(SANDBOX_ROOT, sandbox), { recursive: true, force: true });
      }
      resolvePromise('deadline');

      return;
    }

    if (code === 0) {
      resolvePromise('done');

      return;
    }

    reject(new Error(`Stryker exited with ${code ?? signal}`));
  });
});

const writeState = (stateDir, state) => {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
};

const run = async (stateDir, { allowFull, budget, deadline, sweep }) => {
  const scope = plan(stateDir, { budget, sweep });
  const args = buildStrykerArgs({ ...scope, allowFull });

  process.stdout.write(
    `Mutation scope: ${scope.mode}` +
    (scope.from === null ? '' : ` from ${scope.from.slice(0, 8)}`) +
    `, ${scope.mode === 'full' ? 'all sources' : `${scope.mutate.length} file(s)`}\n`,
  );

  for (const { file, reason } of scope.skipped) {
    process.stdout.write(`  skipped ${file} (${reason})\n`);
  }

  const state = readJson(join(stateDir, 'state.json'), {});
  const stopAt = process.env.MUTATION_STOP_AT;
  const seconds = deadlineSeconds({
    deadline,
    stopAt: stopAt === undefined ? undefined : Number(stopAt),
    now: Math.floor(Date.now() / 1000),
  });

  if (args === null) {
    process.stdout.write('Nothing to mutate.\n');
    reportParked(scope);
    // The diff may have sent files to the sweep, and they must not be lost.
    writeState(stateDir, stateAfterDeadline({ state, sha: git('rev-parse', 'HEAD'), scope }));

    return;
  }

  if (await runStryker(args, seconds) === 'deadline') {
    const next = stateAfterDeadline({ state, sha: git('rev-parse', 'HEAD'), scope });

    process.stdout.write(
      `Stryker passed the ${seconds}s deadline; ${scope.mutate.length} file(s) moved to the scheduled sweep.\n`,
    );
    reportParked(next);
    writeState(stateDir, next);

    return;
  }

  const result = record(stateDir, join(stateDir, 'report.json'), scope.pending, scope.heavy);

  summarise(result);

  if (!result.ratchet.ok) {
    throw new Error(`Mutation ratchet broken: ${result.ratchet.delta} new survivor(s)`);
  }
};

const main = async () => {
  const args = process.argv.slice(2);
  const allowFull = args.includes('--full');
  const sweep = args.includes('--sweep');
  const numberArg = (name, fallback) => {
    const arg = args.find((value) => value.startsWith(`--${name}=`));

    return arg === undefined ? fallback : Number(arg.slice(name.length + 3));
  };
  const budget = numberArg('budget', sweep ? SWEEP_BUDGET : DEFAULT_BUDGET);
  const deadline = numberArg('deadline', sweep ? SWEEP_DEADLINE : DEFAULT_DEADLINE);
  const [command, ...rest] = args.filter((arg) => !arg.startsWith('--'));
  const stateDir = rest[0] ?? '.mutation-state';

  if (command === 'run') {
    await run(stateDir, { allowFull, budget, deadline, sweep });

    return;
  }

  if (command === 'plan') {
    process.stdout.write(`${JSON.stringify(plan(stateDir, { budget, sweep }), null, 2)}\n`);

    return;
  }

  if (command === 'seed') {
    seed(stateDir);

    return;
  }

  throw new Error(
    'Usage: node scripts/mutation-scope.mjs <run|plan|seed> [stateDir] [--sweep] [--budget=S] [--deadline=S]',
  );
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
