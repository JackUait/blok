import { expect, test } from '@playwright/test';
import { createBlok, ensureBlokBundleBuilt, TEST_PAGE_URL } from './_helpers';

test.describe('keyboard column resize', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await page.setViewportSize({ width: 1024, height: 800 });
  });

  test('focusing a divider and pressing ArrowRight widens the left column', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['l1'] },
        { id: 'l1', type: 'paragraph', data: { text: 'Left' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['r1'] },
        { id: 'r1', type: 'paragraph', data: { text: 'Right' }, parent: 'c2' },
      ],
    });

    const resizer = page.getByTestId('column-resizer').first();

    await resizer.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');

    const valueNow = Number(await resizer.getAttribute('aria-valuenow'));

    expect(valueNow).toBeGreaterThan(50);
  });
});
