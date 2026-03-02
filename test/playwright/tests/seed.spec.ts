import { test, expect } from '@playwright/test';

test.describe('Test group', () => {
  test('seed', async ({ page: _page }) => {
    expect(true).toBe(true);
  });
});
