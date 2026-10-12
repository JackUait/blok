import { defineConfig } from '@playwright/test';

// Same fixture server as playwright.config.ts; separate so evals never run per commit.
export default defineConfig({
  globalSetup: '../../playwright/global-setup.ts',
  testDir: './runner',
  testMatch: 'browser.eval.ts',
  timeout: 600_000,
  workers: 1,
  retries: 0,
  use: { headless: true, testIdAttribute: 'data-blok-testid', browserName: 'chromium' },
  // Reused on purpose: the workflow starts this server before the Node live surface, which needs it too.
  webServer: { command: 'npx serve . -l 4444 --no-clipboard --no-compression', port: 4444, reuseExistingServer: true, timeout: 120_000, cwd: '../../..' },
});
