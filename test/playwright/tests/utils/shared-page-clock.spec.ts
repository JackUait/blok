import type { Page } from '@playwright/test';

import { expect, gotoTestPage, test } from '../helpers/shared-page';

// Serial: each check must run right after the test that faked the clock, on the same worker.
test.describe.configure({ mode: 'serial' });

const FAKE_TIME = Date.parse('2026-10-09T12:00:00Z');

const fakes: Record<string, (page: Page) => Promise<void>> = {
  setFixedTime: (page) => page.clock.setFixedTime(FAKE_TIME),
  'install + pauseAt': async (page) => {
    await page.clock.install({ time: FAKE_TIME });
    await page.clock.pauseAt(FAKE_TIME + 1000);
  },
  install: (page) => page.clock.install({ time: FAKE_TIME }),
};

for (const [name, fake] of Object.entries(fakes)) {
  test(`a test may fake the page clock with ${name}`, async ({ page }) => {
    await fake(page);
    await gotoTestPage(page);

    expect(await page.evaluate(() => Date.now())).toBeLessThan(FAKE_TIME + 60_000);
  });

  test(`the test after ${name} runs on the real clock`, async ({ page }) => {
    await gotoTestPage(page);

    // A real clock reads the runner's time and keeps timers firing.
    expect(Math.abs(await page.evaluate(() => Date.now()) - Date.now())).toBeLessThan(60_000);
    await page.evaluate(() => new Promise<void>((resolve) => {
      window.setTimeout(resolve, 10);
    }));
  });
}
