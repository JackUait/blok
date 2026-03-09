import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TOGGLE_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="toggle"]`;
const TOGGLE_CONTENT_SELECTOR = '[data-blok-toggle-content]';
const TOGGLE_BODY_PLACEHOLDER_SELECTOR = '[data-blok-toggle-body-placeholder]';
const TOGGLE_CHILDREN_SELECTOR = '[data-blok-toggle-children]';
const TOGGLE_CHILDREN_PARAGRAPH_SELECTOR = `${TOGGLE_CHILDREN_SELECTOR} [data-blok-component="paragraph"]`;

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page, data?: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, initialData }) => {
      const config: Record<string, unknown> = { holder };

      if (initialData) {
        config.data = initialData;
      }

      const blok = new window.Blok(config);

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data ?? null }
  );
};

const createToggleData = (text: string, extra: Record<string, unknown> = {}): OutputData => ({
  blocks: [
    {
      type: 'toggle',
      data: { text, ...extra },
    },
  ],
});

/**
 * Returns true when the active element (or its ancestor) is inside [data-blok-toggle-children].
 * Used to assert that focus landed in a child block after placeholder click / Enter.
 */
const isFocusInsideToggleChildren = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const container = document.querySelector('[data-blok-toggle-children]');

    return container !== null && container.contains(document.activeElement);
  });

test.describe('Toggle focus behavior', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('body placeholder click focuses new child block', () => {
    test('clicking body placeholder creates a child paragraph with focus', async ({ page }) => {
      await createBlok(page, createToggleData('Toggle title'));

      // The body placeholder should be visible for an open toggle with no children
      const placeholder = page.locator(TOGGLE_BODY_PLACEHOLDER_SELECTOR);

      await expect(placeholder).toBeVisible();

      // Click the body placeholder to create a child paragraph
      await placeholder.click();

      // A new paragraph should appear inside the toggle children container
      await expect(page.locator(TOGGLE_CHILDREN_PARAGRAPH_SELECTOR)).toBeVisible();

      // Focus (activeElement) should be inside the toggle children container
      await page.waitForFunction(() => {
        const container = document.querySelector('[data-blok-toggle-children]');

        return container !== null && container.contains(document.activeElement);
      });

      expect(await isFocusInsideToggleChildren(page)).toBe(true);
    });

    test('clicking body placeholder: typing immediately enters text in new child block', async ({ page }) => {
      await createBlok(page, createToggleData('Toggle title'));

      const placeholder = page.locator(TOGGLE_BODY_PLACEHOLDER_SELECTOR);

      await expect(placeholder).toBeVisible();
      await placeholder.click();

      // Type text immediately — if focus was set correctly, this will land in the new block
      await page.keyboard.type('hello');

      await expect(page.locator(TOGGLE_CHILDREN_PARAGRAPH_SELECTOR)).toHaveText('hello');
    });
  });

  test.describe('Enter at end of open toggle title focuses new child block', () => {
    test('pressing Enter at end of open toggle title creates a focused child paragraph', async ({ page }) => {
      await createBlok(page, createToggleData('Parent toggle'));

      // Confirm toggle is open
      await expect(page.locator('[data-blok-toggle-open]')).toHaveAttribute('data-blok-toggle-open', 'true');

      const content = page.locator(TOGGLE_CONTENT_SELECTOR);

      await content.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');

      // A child paragraph should be inside the toggle children container
      await expect(page.locator(TOGGLE_CHILDREN_PARAGRAPH_SELECTOR)).toBeVisible();

      // Focus (activeElement) should be inside the toggle children container
      await page.waitForFunction(() => {
        const container = document.querySelector('[data-blok-toggle-children]');

        return container !== null && container.contains(document.activeElement);
      });

      expect(await isFocusInsideToggleChildren(page)).toBe(true);
    });

    test('pressing Enter at end of open toggle title: typing immediately enters text in child block', async ({ page }) => {
      await createBlok(page, createToggleData('Parent toggle'));

      await expect(page.locator('[data-blok-toggle-open]')).toHaveAttribute('data-blok-toggle-open', 'true');

      const content = page.locator(TOGGLE_CONTENT_SELECTOR);

      await content.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');

      // Type immediately — focus should be in the new child block
      await page.keyboard.type('child text');

      // The toggle title should still be unchanged
      await expect(page.locator(TOGGLE_BLOCK_SELECTOR).locator(TOGGLE_CONTENT_SELECTOR)).toHaveText('Parent toggle');

      // The typed text should be in the child paragraph inside the toggle
      await expect(page.locator(TOGGLE_CHILDREN_PARAGRAPH_SELECTOR)).toHaveText('child text');
    });
  });
});
