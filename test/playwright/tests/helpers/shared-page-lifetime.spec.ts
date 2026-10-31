import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { expect, test } from '@playwright/test';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const CONFIG = path.resolve(REPO_ROOT, 'test/playwright/fixtures/shared-page-lifetime/playwright.config.ts');

/**
 * Playwright tracing copies a context's whole network log at every test start
 * and end, and keeps the copies until the worker exits. A context that lives
 * for a whole worker makes that disk use grow with the square of its test
 * count. One context per spec file keeps it linear.
 */
test('the shared page gets a fresh context for each spec file', () => {
  test.setTimeout(60_000);

  const run = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '-c', CONFIG], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, CI: '' },
  });

  expect(run.stdout + run.stderr).toContain('4 passed');
  expect(run.status).toBe(0);
});
