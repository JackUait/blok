#!/usr/bin/env node
// Queries recent GitHub Actions CI runs via `gh` and reports per-job timing statistics.
// Usage: node scripts/ci-timing-probe.mjs [--workflow ci.yml] [--branch master] [--limit 5]
import { execFileSync } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const workflow = args.get('--workflow') ?? 'ci.yml';
const branch = args.get('--branch') ?? 'master';
const limit = Number(args.get('--limit') ?? 5);

const runs = JSON.parse(execFileSync('gh', [
  'run', 'list',
  '--workflow', workflow,
  '--branch', branch,
  '--status', 'success',
  '--limit', String(limit),
  '--json', 'databaseId,displayTitle,createdAt,conclusion',
], { encoding: 'utf8' }));

if (runs.length === 0) {
  console.error(`No successful runs found for workflow=${workflow} branch=${branch}`);
  process.exit(1);
}

const byJob = new Map(); // name -> durationsMs[]
for (const run of runs) {
  const detail = JSON.parse(execFileSync('gh', [
    'run', 'view', String(run.databaseId),
    '--json', 'jobs',
  ], { encoding: 'utf8' }));
  for (const job of detail.jobs) {
    if (!job.startedAt || !job.completedAt) continue;
    const ms = new Date(job.completedAt) - new Date(job.startedAt);
    if (!byJob.has(job.name)) byJob.set(job.name, []);
    byJob.get(job.name).push(ms);
  }
}

const fmt = (ms) => `${(ms / 1000).toFixed(0)}s`;
const rows = [...byJob.entries()]
  .map(([name, durs]) => ({
    name,
    n: durs.length,
    mean: Math.round(durs.reduce((a, b) => a + b, 0) / durs.length),
    min: Math.min(...durs),
    max: Math.max(...durs),
  }))
  .sort((a, b) => b.mean - a.mean);

console.log(`\nCI timing probe — workflow=${workflow} branch=${branch} runs=${runs.length}\n`);
console.log('| Job | n | Mean | Min | Max |');
console.log('|---|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.name} | ${r.n} | ${fmt(r.mean)} | ${fmt(r.min)} | ${fmt(r.max)} |`);
}
console.log();
