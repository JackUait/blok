import { defineConfig } from '@playwright/test';

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
  testDir: 'test/playwright/tests',
  timeout: 10_000,
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
  },
  retries: process.env.CI ? 2 : 0,
});
