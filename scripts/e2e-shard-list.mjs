// Picks the spec files one E2E shard job runs, balanced by how long each file
// took in CI (scripts/e2e-shard-seconds.json). Playwright's own --shard takes
// contiguous runs of tests, so one slow folder lands in a single shard.
//
// Usage: node scripts/e2e-shard-list.mjs --project <name> --shard <i/n> --out <file>
// Writes a --test-list file. The files come from Playwright's own listing, so a
// spec missing from the timings still runs, weighted as the median spec.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SECONDS_FILE = 'scripts/e2e-shard-seconds.json';

export const parseShard = (value) => {
  const match = /^(\d+)\/(\d+)$/.exec(value);
  const index = Number(match?.[1]);
  const total = Number(match?.[2]);

  if (match === null || index < 1 || index > total) {
    throw new Error(`Bad shard "${value}": expected i/n with 1 <= i <= n`);
  }

  return { index, total };
};

const median = (values) => {
  if (values.length === 0) {
    return 1;
  }

  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.floor(sorted.length / 2)];
};

/** Longest-first greedy split. Ties break by name so every shard job agrees. */
export const assignShards = (files, seconds, total) => {
  const fallback = median(files.filter((file) => file in seconds).map((file) => seconds[file]));
  const weight = (file) => seconds[file] ?? fallback;
  const ordered = [...files].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b));
  const shards = Array.from({ length: total }, () => []);
  const loads = new Array(total).fill(0);

  for (const file of ordered) {
    const lightest = loads.indexOf(Math.min(...loads));

    shards[lightest].push(file);
    loads[lightest] += weight(file);
  }

  return shards;
};

const listSpecFiles = (project) => {
  const report = JSON.parse(execFileSync(
    'npx',
    ['playwright', 'test', '--list', `--project=${project}`, '--reporter=json'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  ));

  return [...new Set(report.suites.map((suite) => suite.file))];
};

const main = () => {
  const { values } = parseArgs({ options: { project: { type: 'string' }, shard: { type: 'string' }, out: { type: 'string' } } });

  if (values.project === undefined || values.shard === undefined || values.out === undefined) {
    throw new Error('Usage: e2e-shard-list.mjs --project <name> --shard <i/n> --out <file>');
  }

  const { index, total } = parseShard(values.shard);
  const seconds = JSON.parse(readFileSync(SECONDS_FILE, 'utf8'))[values.project] ?? {};
  const files = listSpecFiles(values.project);
  const mine = assignShards(files, seconds, total)[index - 1];

  writeFileSync(values.out, `${mine.join('\n')}\n`);
  process.stdout.write(`Shard ${values.shard} of ${values.project}: ${mine.length} of ${files.length} spec file(s).\n${mine.join('\n')}\n`);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
