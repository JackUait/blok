import './test/playwright/support/suppress-css-import';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  globalSetup: './test/playwright/global-setup.ts',
  testDir: 'test/playwright/tests',
  testMatch: [
    '**/table-native-copy-paste-diagnostic.spec.ts',
    '**/table-cells-handler-fix.spec.ts',
  ],
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    testIdAttribute: 'data-blok-testid',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  webServer: {
    command: 'npx serve . -l 4444 --no-clipboard',
    port: 4444,
    reuseExistingServer: true,
    timeout: 120000,
  },
});
