/**
 * Parallel production build — runs the exact same steps as the former serial
 * `yarn build` chain, but as a dependency graph so independent builds overlap:
 *
 *   fonts ─→ main ─→ iife / umd / locales / angular   (dist/ writers: main
 *                                                       empties dist/, so they
 *                                                       must follow it)
 *   react, vue, cli                                    (own out dirs, core is
 *                                                       external — fully
 *                                                       independent)
 *
 * Every step gets a wall-clock timeout + one retry: under heavy machine load
 * a later vite build occasionally hangs silently forever (see
 * release-mechanics memory — this once stalled a release for ~2 hours). A
 * kill-and-retry bounds that failure mode to minutes.
 *
 * Usage: node scripts/build-all.mjs [--with-cli] [--mode <mode>]
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

import { runTaskGraph, runWithTimeoutRetry } from './task-runner.mjs';

const BUILD_TIMEOUT_MS = Number(process.env.BLOK_BUILD_TIMEOUT_MS ?? 10 * 60 * 1000);

/**
 * @param {{mode?: string, withCli?: boolean}} [opts]
 * @returns {Array<{name: string, cmd: string, deps: string[], timeoutMs: number}>}
 */
export function buildTasks({ mode = 'production', withCli = false } = {}) {
  const tasks = [
    { name: 'fonts', cmd: 'node scripts/generate-fonts.mjs', deps: [] },
    { name: 'main', cmd: `npx vite build --mode ${mode}`, deps: ['fonts'] },
    { name: 'iife', cmd: `npx vite build --config vite.config.iife.mjs --mode ${mode}`, deps: ['main'] },
    { name: 'umd', cmd: `npx vite build --config vite.config.umd.mjs --mode ${mode}`, deps: ['main'] },
    { name: 'locales', cmd: 'node scripts/build-locales.mjs', deps: ['main'] },
    { name: 'angular', cmd: 'node scripts/build-angular.mjs', deps: ['main'] },
    { name: 'react', cmd: 'yarn workspace @bloklabs/react build', deps: ['fonts'] },
    { name: 'vue', cmd: 'yarn workspace @bloklabs/vue build', deps: ['fonts'] },
  ];

  if (withCli) {
    tasks.push({ name: 'cli', cmd: 'node scripts/build-cli.mjs', deps: ['fonts'] });
  }

  return tasks.map((t) => ({ ...t, timeoutMs: BUILD_TIMEOUT_MS }));
}

/**
 * Spawns `task.cmd`, buffering output so concurrent tasks don't interleave;
 * the buffer is flushed with a `[name]` header when the task settles.
 *
 * @param {{name: string, cmd: string, timeoutMs?: number}} task
 * @returns {Promise<void>}
 */
export function runShellTask(task) {
  let child;

  const attempt = () => new Promise((resolve, reject) => {
    const chunks = [];
    const startedAt = Date.now();

    child = spawn(task.cmd, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
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

  if (!task.timeoutMs) {
    return attempt();
  }

  return runWithTimeoutRetry(attempt, {
    timeoutMs: task.timeoutMs,
    retries: 1,
    onKill: () => {
      console.error(`\n⏱ ${task.name} produced a hung process (> ${task.timeoutMs}ms) — killing and retrying`);
      child?.kill('SIGKILL');
    },
  });
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const args = process.argv.slice(2);
  const modeIndex = args.indexOf('--mode');
  const mode = modeIndex !== -1 ? args[modeIndex + 1] : 'production';
  const withCli = args.includes('--with-cli');
  const startedAt = Date.now();

  const result = await runTaskGraph(buildTasks({ mode, withCli }), runShellTask);

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  if (!result.ok) {
    console.error(`\nBuild failed after ${seconds}s — failed: ${result.failed.join(', ')}`
      + (result.skipped.length ? `; skipped: ${result.skipped.join(', ')}` : ''));
    process.exit(1);
  }

  console.log(`\nBuild complete in ${seconds}s`);
}
