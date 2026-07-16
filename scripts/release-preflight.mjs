/**
 * Parallel release preflight — the exact same three checks the former serial
 * `yarn lint && yarn test` ran (eslint ., tsc --noEmit, vitest unit projects),
 * but concurrently: wall-clock drops from the SUM of the three to the MAX
 * (eslint alone takes ~3 min).
 *
 * All three always run to completion so a failure yields the full report
 * (lint AND type AND test results) in one pass instead of aborting at the
 * first failing check.
 *
 * The child processes inherit a bumped V8 heap: full-repo eslint/tsc OOM-crash
 * at the default heap size (a recurring release-killer — see the
 * release-mechanics memory).
 *
 * Usage: node scripts/release-preflight.mjs
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

import { runTaskGraph } from './task-runner.mjs';

/**
 * @returns {Array<{name: string, cmd: string, deps: string[]}>}
 */
export function preflightTasks() {
  return [
    // Same rule set and file coverage as `eslint .`, split across 4 worker
    // threads (single-threaded it is the slowest check at ~3m16s; 4 threads
    // bring it to ~1m40s without starving vitest's forks).
    { name: 'eslint', cmd: 'npx eslint . --concurrency=4', deps: [] },
    // --incremental via CLI (tsconfig.json is off-limits): tsc self-invalidates
    // the buildinfo cache, so repeat preflights type-check in seconds.
    { name: 'tsc', cmd: 'npx tsc --noEmit --incremental --tsBuildInfoFile node_modules/.cache/blok-preflight.tsbuildinfo', deps: [] },
    // Preflight-only 20s per-test timeout: under the deliberate eslint/tsc
    // contention (and generally under load) heavy-but-healthy tests spike past
    // the default 5s and flaked whole releases (see release-mechanics memory).
    // Every test still runs and must pass; a genuinely hung test still fails.
    { name: 'vitest', cmd: 'npx vitest run --project=unit --project=unit-angular --testTimeout=20000', deps: [] },
  ];
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const heapBumpedEnv = {
    ...process.env,
    NODE_OPTIONS: process.env.NODE_OPTIONS ?? '--max-old-space-size=8192',
  };

  const runCheck = (task) => new Promise((resolve, reject) => {
    const chunks = [];
    const startedAt = Date.now();
    const child = spawn(task.cmd, { shell: true, stdio: ['ignore', 'pipe', 'pipe'], env: heapBumpedEnv });

    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => chunks.push(c));

    child.on('close', (code) => {
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

      if (code === 0) {
        console.log(`✓ ${task.name} (${seconds}s)`);
        resolve(undefined);
      } else {
        console.error(`\n✗ ${task.name} failed (exit ${code}) — output:\n${Buffer.concat(chunks)}`);
        reject(new Error(`${task.name} failed with exit code ${code}`));
      }
    });
    child.on('error', reject);
  });

  const startedAt = Date.now();
  const result = await runTaskGraph(preflightTasks(), runCheck);
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  if (!result.ok) {
    console.error(`\nPreflight failed after ${seconds}s — failed: ${result.failed.join(', ')}`);
    process.exit(1);
  }

  console.log(`\nPreflight passed in ${seconds}s`);
}
