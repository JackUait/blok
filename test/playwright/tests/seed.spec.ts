import { test, expect } from '@playwright/test';
import { TEST_PAGE_URL } from './helpers/ensure-build';

test.describe('Test group', () => {
  test('seed', async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await expect(page).toHaveURL(TEST_PAGE_URL);
  });
});
