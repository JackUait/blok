import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';
import { buildTasks } from '../../../scripts/build-all.mjs';
import { preflightTasks } from '../../../scripts/release-preflight.mjs';

interface GraphTask {
  name: string;
  cmd: string;
  deps?: string[];
  timeoutMs?: number;
}

const byName = (tasks: GraphTask[]): Map<string, GraphTask> => new Map(tasks.map((t) => [t.name, t]));

describe('lint script', () => {
  it('uses full-project native caches and bounded ESLint concurrency', () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8')
    ) as { scripts?: Record<string, string> };
    const lint = manifest.scripts?.lint;

    expect(lint).toContain('ESLINT_CONCURRENCY=off');
    expect(lint).toContain(
      'if [ ! -f node_modules/.cache/blok-eslint ]; then ESLINT_CONCURRENCY=4; ESLINT_CACHE=cold; fi'
    );
    expect(lint).toContain(
      'eslint . --concurrency=$ESLINT_CONCURRENCY --cache --cache-location node_modules/.cache/blok-eslint --cache-strategy content'
    );
    expect(lint).toContain(
      'tsc --noEmit --incremental --tsBuildInfoFile node_modules/.cache/blok-lint.tsbuildinfo'
    );
    expect(lint).toContain('Lint: ESLint');
    expect(lint).toContain('Lint: TypeScript');
    expect(lint).toContain('ESLINT_SECONDS=');
    expect(lint).toContain('TSC_SECONDS=');
    expect(lint).toContain('ESLINT_EXIT=$?');
    expect(lint).toContain('TSC_EXIT=$?');
    expect(lint).toContain(
      'if [ $ESLINT_EXIT -ne 0 ] || [ $TSC_EXIT -ne 0 ]; then exit 1; fi'
    );
  });

  it('restores native lint caches in CI and saves them only after a green run', () => {
    const workflow = readFileSync(
      join(process.cwd(), '.github/workflows/ci.yml'),
      'utf8'
    );

    expect(workflow).toContain('uses: actions/cache/restore@v4');
    expect(workflow).toContain('node_modules/.cache/blok-eslint');
    expect(workflow).toContain('node_modules/.cache/blok-lint.tsbuildinfo');
    expect(workflow).toContain('restore-keys:');
    expect(workflow).toContain('uses: actions/cache/save@v4');
    // ESLint's cache persists per-file results INCLUDING errors, keyed only on
    // each file's own content — a cache saved from a red run replays stale
    // typed-lint errors on every later run, so saving must be gated on green.
    expect(workflow).toContain("if: success() && steps.lint-cache.outputs.cache-hit != 'true'");
    expect(workflow).toContain('key: ${{ steps.lint-cache.outputs.cache-primary-key }}');
  });
});

describe('buildTasks', () => {
  it('covers every step of the former serial `yarn build` chain, unchanged', () => {
    const cmds = buildTasks({ mode: 'production' }).map((t) => t.cmd);

    expect(cmds).toContain('node scripts/generate-fonts.mjs');
    expect(cmds).toContain('npx vite build --mode production');
    expect(cmds).toContain('npx vite build --config vite.config.iife.mjs --mode production');
    expect(cmds).toContain('npx vite build --config vite.config.umd.mjs --mode production');
    expect(cmds).toContain('node scripts/build-locales.mjs');
    expect(cmds).toContain('node scripts/build-angular.mjs');
    expect(cmds).toContain('yarn workspace @bloklabs/react build');
    expect(cmds).toContain('yarn workspace @bloklabs/vue build');
    expect(cmds).toHaveLength(8);
  });

  it('orders dist/ writers after the main build (which empties dist/) and everything after fonts', () => {
    const tasks = byName(buildTasks({ mode: 'production' }));

    expect(tasks.get('main')?.deps).toContain('fonts');

    for (const name of ['iife', 'umd', 'locales', 'angular']) {
      expect(tasks.get(name)?.deps, `${name} must wait for main (emptyOutDir)`).toContain('main');
    }
  });

  it('lets react and vue build independently of the core dist (core is external)', () => {
    const tasks = byName(buildTasks({ mode: 'production' }));

    expect(tasks.get('react')?.deps ?? []).not.toContain('main');
    expect(tasks.get('vue')?.deps ?? []).not.toContain('main');
  });

  it('includes the CLI build when requested, independent of the core dist', () => {
    const tasks = byName(buildTasks({ mode: 'production', withCli: true }));

    expect(tasks.get('cli')?.cmd).toBe('node scripts/build-cli.mjs');
    expect(tasks.get('cli')?.deps ?? []).not.toContain('main');
    expect(buildTasks({ mode: 'production' }).some((t) => t.name === 'cli')).toBe(false);
  });

  it('gives every build step a hang-guard timeout', () => {
    for (const task of buildTasks({ mode: 'production', withCli: true }) as GraphTask[]) {
      expect(task.timeoutMs, `${task.name} needs a timeout`).toBeGreaterThan(0);
    }
  });
});

describe('preflightTasks', () => {
  it('runs the exact same checks as the former serial preflight (eslint, tsc, vitest)', () => {
    const tasks = preflightTasks() as GraphTask[];
    const cmds = tasks.map((t) => t.cmd);

    expect(cmds).toContain('npx eslint . --concurrency=4');
    expect(cmds).toContain('npx tsc --noEmit --incremental --tsBuildInfoFile node_modules/.cache/blok-preflight.tsbuildinfo');
    expect(cmds).toContain('npx vitest run --project=unit --project=unit-angular --testTimeout=20000');
    expect(cmds).toHaveLength(3);
  });

  it('declares no dependencies so all three checks run concurrently', () => {
    for (const task of preflightTasks() as GraphTask[]) {
      expect(task.deps ?? []).toEqual([]);
    }
  });
});
