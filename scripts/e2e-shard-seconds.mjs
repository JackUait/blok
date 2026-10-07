// Writes scripts/e2e-shard-seconds.json: how long each spec file took per
// Playwright project in the last green CI run on main. e2e-shard-list.mjs
// balances the E2E shards with it. A stale file only makes shards less even.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUTPUT = 'scripts/e2e-shard-seconds.json';
const ANSI = /\u001b\[[\d;]*m/g;
const TEST_LINE = /\s[✓✘]\s+\d+\s+\[([^\]]+)\] › test\/playwright\/tests\/(\S+?):\d+:\d+ › .*\(([\d.]+)(ms|s|m)\)\s*$/;
const UNIT_SECONDS = { ms: 0.001, s: 1, m: 60 };

/** Sums `✓ N [project] › <file>:line:col › title (time)` lines per project and file. */
export const parseSpecSeconds = (log) => {
  const seconds = {};

  for (const line of log.split('\n')) {
    const match = TEST_LINE.exec(line.replace(ANSI, ''));

    if (match !== null) {
      const [, project, file, value, unit] = match;
      const byFile = (seconds[project] ??= {});

      byFile[file] = Math.round(((byFile[file] ?? 0) + Number(value) * UNIT_SECONDS[unit]) * 1000) / 1000;
    }
  }

  return seconds;
};

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

const main = () => {
  const runId = process.argv[2] ?? gh(
    'run', 'list', '--workflow', 'ci.yml', '--branch', 'main', '--status', 'success',
    '--limit', '1', '--json', 'databaseId', '-q', '.[0].databaseId',
  ).trim();
  const jobIds = gh(
    'api', `repos/{owner}/{repo}/actions/runs/${runId}/jobs?per_page=100`, '--paginate',
    '-q', '.jobs[] | select(.name | startswith("E2E Tests (")) | .id',
  ).trim().split('\n').filter(Boolean);
  const seconds = {};

  for (const jobId of jobIds) {
    for (const [project, byFile] of Object.entries(parseSpecSeconds(gh('api', `repos/{owner}/{repo}/actions/jobs/${jobId}/logs`)))) {
      Object.assign((seconds[project] ??= {}), byFile);
    }
  }

  const sorted = Object.fromEntries(Object.keys(seconds).sort().map((project) => [
    project,
    Object.fromEntries(Object.keys(seconds[project]).sort().map((file) => [file, seconds[project][file]])),
  ]));

  writeFileSync(OUTPUT, `${JSON.stringify(sorted, null, 2)}\n`);
  process.stdout.write(`Wrote spec times for ${Object.keys(sorted).length} project(s) from CI run ${runId}.\n`);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
