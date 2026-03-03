import { expect, test } from '@playwright/test';
import type { Blok } from '../../../../types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const HOLDER_ID = 'blok';
const CONTENT_EDITABLE_SELECTOR = '[contenteditable="true"]';

test.describe('slash search placeholder', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');

    await page.evaluate(async (holder) => {
      const container = document.createElement('div');
      container.id = holder;
      document.body.appendChild(container);

      const blok = new window.Blok({ holder });
      window.blokInstance = blok;
      await blok.isReady;
    }, HOLDER_ID);
  });

  test('should show placeholder when slash is typed and hide it when query is entered', async ({ page }) => {
    const paragraph = page.locator(CONTENT_EDITABLE_SELECTOR);
    await paragraph.click();

    // Type "/" to open toolbox
    await page.keyboard.type('/');

    // Attribute should be set with placeholder text
    await expect(paragraph).toHaveAttribute('data-blok-slash-search', /.+/);

    // Should have search input styling (background color)
    const bgColor = await paragraph.evaluate(
      (el) => window.getComputedStyle(el).backgroundColor
    );
    expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');

    // Type a query — placeholder value should become empty
    await page.keyboard.type('head');
    await expect(paragraph).toHaveAttribute('data-blok-slash-search', '');

    // Clear query back to just "/" — placeholder should return
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await expect(paragraph).toHaveAttribute('data-blok-slash-search', /.+/);
  });

  test('should remove slash search styling when toolbox closes', async ({ page }) => {
    const paragraph = page.locator(CONTENT_EDITABLE_SELECTOR);
    await paragraph.click();

    await page.keyboard.type('/');
    await expect(paragraph).toHaveAttribute('data-blok-slash-search', /.+/);

    // Press Escape to close toolbox
    await page.keyboard.press('Escape');

    // Attribute should be removed
    await expect(paragraph).not.toHaveAttribute('data-blok-slash-search');
  });
});
