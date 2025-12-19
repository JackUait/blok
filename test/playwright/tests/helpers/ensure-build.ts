import { spawnSync } from 'node:child_process';
import path from 'node:path';

let didBuild = false;

const PROJECT_ROOT = path.resolve(__dirname, '../../../..');

/**
 * Test page URL served by Playwright's webServer on port 3333.
 */
export const TEST_PAGE_URL = 'http://localhost:3333/test/playwright/fixtures/test.html';

/**
 * Ensure the Blok bundle is freshly built before running Playwright tests.
 *
 * Necessary because the Playwright fixtures load the ES module bundle from the dist folder.
 * Without rebuilding we might exercise stale code that doesn't match the current TypeScript sources.
 *
 * Note: The Header tool is bundled as part of Blok and accessible via Blok.Header
 */
export const ensureBlokBundleBuilt = (): void => {
  if (didBuild || process.env.BLOK_BUILT === 'true') {
    return;
  }

  console.log('Building Blok for tests...');

  const result = spawnSync('yarn', [ 'build:test' ], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Building Blok for Playwright failed with exit code ${result.status ?? 'unknown'}.`);
  }

  didBuild = true;
};

