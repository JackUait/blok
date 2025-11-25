import './test/playwright/support/suppress-css-import';
import { defineConfig } from '@playwright/test';

const AMOUNT_OF_LOCAL_WORKERS = 3;

/**
 * Playwright Configuration
 *
 * Recommended plugins installed:
 * - @axe-core/playwright: For accessibility testing
 *   Usage in tests: import { injectAxe, checkA11y } from '@axe-core/playwright';
 *                   await injectAxe(page);
 *                   await checkA11y(page);
 *
 * - eslint-plugin-playwright: For linting Playwright tests
 *   Configured in eslint.config.mjs
 */
export default defineConfig({
  globalSetup: './test/playwright/global-setup.ts',
  testDir: 'test/playwright/tests',
  timeout: 15_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  reporter: [ [ 'list' ] ],
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    testIdAttribute: 'data-blok-testid',
  },
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : AMOUNT_OF_LOCAL_WORKERS,
});
