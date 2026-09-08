// Splits a source file's recorded live mutants by whether the given tests
// execute the line they sit on.
//
// Usage:
//   node scripts/mutant-coverage.mjs --report=<report.json> --source=<file> \
//     --tests=<a.test.ts,b.test.ts> --out=<covered-ids.json>
//
// A mutant on a line no test executes cannot already be dead, so it needs no
// per-mutant run. Only the covered ones have to be swept to tell "already dead"
// from "still alive" — which is what makes a stale sweep affordable.
//
// The run's exit code is checked first: a coverage run that fails reports every
// line as zero-hit, which would silently claim the whole file is unreached.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const argOf = (name) => {
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`));

  return hit === undefined ? undefined : hit.slice(name.length + 3);
};

const main = () => {
  const reportPath = argOf('report');
  const source = argOf('source');
  const tests = (argOf('tests') ?? '').split(',').filter(Boolean);
  const outPath = argOf('out');

  if (!reportPath || !source || tests.length === 0 || !outPath) {
    throw new Error('Usage: --report= --source= --tests= --out=');
  }

  const scratch = mkdtempSync(join(tmpdir(), 'mutant-coverage-'));

  execFileSync(
    'node_modules/.bin/vitest',
    [
      'run',
      '--config=vitest.mutation.config.ts',
      '--coverage.enabled',
      '--coverage.provider=v8',
      '--coverage.all=false',
      `--coverage.include=${source}`,
      '--coverage.reporter=json',
      `--coverage.reportsDirectory=${scratch}`,
      ...tests,
    ],
    { encoding: 'utf8', stdio: 'pipe', timeout: 300_000 },
  );

  const coverage = JSON.parse(readFileSync(join(scratch, 'coverage-final.json'), 'utf8'));
  const entry = Object.entries(coverage).find(([path]) => path.endsWith(source));

  if (entry === undefined) {
    throw new Error(`No coverage recorded for ${source}; the tests may not import it`);
  }

  const [, fileCoverage] = entry;
  const hitLines = new Set();
  const measuredLines = new Set();

  // The START line only. A top-level `export const fn = () => {…}` is ONE
  // statement spanning the whole function, so expanding its range would mark
  // every line of an unreached function as executed.
  const note = (line, count) => {
    measuredLines.add(line);

    if (count > 0) {
      hitLines.add(line);
    }
  };

  for (const [id, count] of Object.entries(fileCoverage.s)) {
    note(fileCoverage.statementMap[id].start.line, count);
  }

  for (const [id, counts] of Object.entries(fileCoverage.b)) {
    counts.forEach((count, index) => {
      note(fileCoverage.branchMap[id].locations[index].start.line, count);
    });
  }

  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const live = report.files[source].mutants
    .filter((mutant) => mutant.status === 'Survived' || mutant.status === 'NoCoverage');
  // Three answers, not two. A line carrying no statement and no branch was
  // never MEASURED — every property of one big object literal belongs to the
  // single assignment statement above it — so "not hit" would be a lie there.
  // Unmeasured lines go to the sweep with the executed ones.
  const unreached = live.filter((mutant) => (
    measuredLines.has(mutant.location.start.line) && !hitLines.has(mutant.location.start.line)
  ));
  const toSweep = live.filter((mutant) => !unreached.includes(mutant));

  writeFileSync(outPath, `${JSON.stringify(toSweep.map((mutant) => mutant.id), null, 2)}\n`);

  process.stdout.write(
    `${live.length} live mutants: ${unreached.length} on lines these tests provably never execute `
    + `(already alive, no run needed); ${toSweep.length} to sweep.\n`,
  );
};

main();
