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

  // The START line only. A top-level `export const fn = () => {…}` is ONE
  // statement spanning the whole function, so expanding its range would mark
  // every line of an unreached function as executed.
  for (const [id, count] of Object.entries(fileCoverage.s)) {
    if (count > 0) {
      hitLines.add(fileCoverage.statementMap[id].start.line);
    }
  }

  for (const [id, counts] of Object.entries(fileCoverage.b)) {
    counts.forEach((count, index) => {
      if (count > 0) {
        hitLines.add(fileCoverage.branchMap[id].locations[index].start.line);
      }
    });
  }

  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const live = report.files[source].mutants
    .filter((mutant) => mutant.status === 'Survived' || mutant.status === 'NoCoverage');
  const covered = live.filter((mutant) => hitLines.has(mutant.location.start.line));

  writeFileSync(outPath, `${JSON.stringify(covered.map((mutant) => mutant.id), null, 2)}\n`);

  process.stdout.write(
    `${live.length} live mutants: ${covered.length} on executed lines (sweep these), `
    + `${live.length - covered.length} on lines these tests never reach (already alive).\n`,
  );
};

main();
