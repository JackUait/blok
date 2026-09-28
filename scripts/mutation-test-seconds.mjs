// Writes scripts/mutation-test-seconds.json: how long each unit test file took in
// the last green CI run on main. mutation-scope.mjs sizes its batches with it.
// A stale file only makes batches less even; the deadline still caps the run.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUTPUT = 'scripts/mutation-test-seconds.json';
const ANSI = /\u001b\[[\d;]*m/g;
const FILE_LINE = /\s(?:✓|×)\s+unit\s+(test\/unit\/\S+\.test\.tsx?)\s+\([^)]*\)\s+([\d.]+)(ms|s)\s*$/;

/** Reads `✓ unit <file> (N tests) <time>` lines out of a vitest CI log. */
export const parseFileSeconds = (log) => {
  const seconds = {};

  for (const line of log.split('\n')) {
    const match = FILE_LINE.exec(line.replace(ANSI, ''));

    if (match !== null) {
      const value = Number(match[2]);

      seconds[match[1]] = match[3] === 'ms' ? value / 1000 : value;
    }
  }

  return seconds;
};

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

const main = () => {
  const runId = gh(
    'run', 'list', '--workflow', 'ci.yml', '--branch', 'main', '--status', 'success',
    '--limit', '1', '--json', 'databaseId', '-q', '.[0].databaseId',
  ).trim();
  const jobIds = gh(
    'run', 'view', runId, '--json', 'jobs',
    '-q', '.jobs[] | select(.name | startswith("Unit Tests (")) | .databaseId',
  ).trim().split('\n').filter(Boolean);
  const seconds = {};

  for (const jobId of jobIds) {
    Object.assign(seconds, parseFileSeconds(gh('api', `repos/{owner}/{repo}/actions/jobs/${jobId}/logs`)));
  }

  const sorted = Object.fromEntries(
    Object.keys(seconds).sort().map((file) => [file, Math.round(seconds[file] * 1000) / 1000]),
  );

  writeFileSync(OUTPUT, `${JSON.stringify(sorted, null, 2)}\n`);
  process.stdout.write(`Wrote ${Object.keys(sorted).length} test file time(s) from CI run ${runId}.\n`);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
