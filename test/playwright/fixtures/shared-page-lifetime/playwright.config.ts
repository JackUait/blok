import { tmpdir } from 'node:os';
import path from 'node:path';

import { defineConfig } from '@playwright/test';

// Run by shared-page-lifetime.spec.ts. One worker, so both files share it.
export default defineConfig({
  testDir: '.',
  // Kept out of the repo's test-results, which the outer run is writing to.
  outputDir: path.join(tmpdir(), 'blok-shared-page-lifetime'),
  testMatch: '*.check.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: { headless: true, browserName: 'chromium' },
});
