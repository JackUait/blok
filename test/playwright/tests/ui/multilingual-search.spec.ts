import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok } from '../../../../types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const HOLDER_ID = 'blok';
const POPOVER_SELECTOR = '[data-blok-testid="toolbox-popover"]';
const POPOVER_ITEM_SELECTOR = `${POPOVER_SELECTOR} [data-blok-testid="popover-item"]`;
const VISIBLE_ITEM_SELECTOR = `${POPOVER_ITEM_SELECTOR}:not([data-blok-hidden="true"])`;

test.describe('multilingual tool search', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  const initBlokWithFrenchLocale = async (page: Page): Promise<void> => {
    // Wait for Blok to be available
    await page.waitForFunction(() => typeof window.Blok === 'function');

    await page.evaluate(async (holder) => {
      const container = document.createElement('div');
      container.id = holder;
      document.body.appendChild(container);

      const { Blok } = window;

      const blok = new Blok({
        holder,
        i18n: {
          locale: 'fr',
        },
      });

      window.blokInstance = blok;
      await blok.isReady;
    }, HOLDER_ID);
  };

  const openToolboxAndSearch = async (page: Page, searchQuery: string): Promise<void> => {
    // Wait for the paragraph to exist and be empty
    const paragraph = page.locator('[contenteditable]');
    await paragraph.waitFor({ state: 'attached' });
    await expect(paragraph).toHaveCount(1);

    // Focus the paragraph and ensure it's truly empty
    await paragraph.click();
    await paragraph.press('Backspace'); // Ensure empty state
    await expect(paragraph).toHaveAttribute('data-blok-empty', 'true');

    // Type slash + search query
    await page.keyboard.type(`/${searchQuery}`);

    // Wait for popover to be attached and opened
    const popover = page.locator(POPOVER_SELECTOR);
    await popover.waitFor({ state: 'attached' });
    await expect(popover).toHaveAttribute('data-blok-popover-opened', 'true');
  };

  test('should find header tool by alias "h1"', async ({ page }) => {
    await initBlokWithFrenchLocale(page);
    await openToolboxAndSearch(page, 'h1');

    // Should find exactly 1 item via "h1" alias (using data-blok-hidden attribute)
    const visibleItems = page.locator(VISIBLE_ITEM_SELECTOR);
    await expect(visibleItems).toHaveCount(1);

    // The item should be Heading 1 (either English "Heading 1" or French "Titre 1")
    await expect(visibleItems).toContainText(/Heading 1|Titre 1/);
  });

  test('should find header tool by English name "heading" in French locale', async ({ page }) => {
    await initBlokWithFrenchLocale(page);
    await openToolboxAndSearch(page, 'heading');

    // Should find all heading levels via English fallback
    const visibleItems = page.locator(VISIBLE_ITEM_SELECTOR);

    // Should have multiple heading results (Heading 1-6)
    const count = await visibleItems.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should find list tool by alias "ul"', async ({ page }) => {
    await initBlokWithFrenchLocale(page);
    await openToolboxAndSearch(page, 'ul');

    // Should find bulleted list via "ul" alias
    const visibleItems = page.locator(VISIBLE_ITEM_SELECTOR);
    await expect(visibleItems).toHaveCount(1);
  });

  test('should find paragraph tool by alias "p"', async ({ page }) => {
    await initBlokWithFrenchLocale(page);
    await openToolboxAndSearch(page, 'p');

    // Should find paragraph via "p" alias
    const visibleItems = page.locator(VISIBLE_ITEM_SELECTOR);

    // Paragraph should be visible
    const count = await visibleItems.count();
    expect(count).toBeGreaterThan(0);
  });
});
