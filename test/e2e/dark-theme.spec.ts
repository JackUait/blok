import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { BLOK_INTERFACE_SELECTOR } from '../../src/components/constants';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../playwright/tests/helpers/ensure-build';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"] [contenteditable]`;
const PLUS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="plus-button"]`;
const POPOVER_SELECTOR = '[data-blok-popover]:not([data-blok-popover-inline])';

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page, blocks: OutputData['blocks'], extraConfig: Record<string, unknown> = {}): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, blokBlocks, config }) => {
      const blok = new window.Blok({
        holder,
        data: { blocks: blokBlocks },
        ...config,
      });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, blokBlocks: blocks, config: extraConfig }
  );
};

const openToolbox = async (page: Page): Promise<void> => {
  const firstBlock = page.locator(PARAGRAPH_SELECTOR).first();

  await firstBlock.hover();

  const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

  await expect(plusButton).toBeVisible();
  await plusButton.click();
  await page.waitForSelector(`${POPOVER_SELECTOR}[data-blok-popover-opened]`, { state: 'attached' });
};

const getCustomProperty = async (page: Page, property: string): Promise<string> => {
  return page.locator(BLOK_INTERFACE_SELECTOR).evaluate(
    (el, prop) => window.getComputedStyle(el).getPropertyValue(prop).trim(),
    property
  );
};

const getPopoverCustomProperty = async (page: Page, property: string): Promise<string> => {
  return page.locator(POPOVER_SELECTOR).first().evaluate(
    (el, prop) => window.getComputedStyle(el).getPropertyValue(prop).trim(),
    property
  );
};

/**
 * These tests verify that Blok's dark theme CSS variable system works correctly.
 *
 * Four theme scenarios are tested for both the editor wrapper and the body-mounted
 * popover element (which is outside [data-blok-interface] in the DOM):
 * 1. Default light mode (no theme attribute, no system dark preference)
 * 2. Explicit dark mode via data-blok-theme="dark" on <html>
 * 3. System dark preference via colorScheme: 'dark' browser context
 * 4. System dark preference overridden by explicit data-blok-theme="light"
 */
test.describe('Dark theme', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.describe('Default light mode', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(TEST_PAGE_URL);
      await createBlok(page, [{ type: 'paragraph', data: { text: 'Hello world' } }]);
    });

    test('--blok-popover-bg resolves to light value (#ffffff)', async ({ page }) => {
      const value = await getCustomProperty(page, '--blok-popover-bg');

      // Browsers may normalize #ffffff to #fff
      expect(value.toLowerCase()).toMatch(/^#fff(fff)?$/);
    });

    test('body-mounted popover --blok-popover-bg resolves to light value (#ffffff)', async ({ page }) => {
      await openToolbox(page);

      const value = await getPopoverCustomProperty(page, '--blok-popover-bg');

      // Browsers may normalize #ffffff to #fff
      expect(value.toLowerCase()).toMatch(/^#fff(fff)?$/);
    });
  });

  test.describe('Explicit dark mode (data-blok-theme="dark")', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(TEST_PAGE_URL);
      await createBlok(page, [{ type: 'paragraph', data: { text: 'Hello world' } }], { theme: 'dark' });
    });

    test('--blok-popover-bg resolves to dark value (#252525)', async ({ page }) => {
      const value = await getCustomProperty(page, '--blok-popover-bg');

      expect(value).toBe('#252525');
    });

    test('--blok-text-primary resolves to dark value (#e2e0dc)', async ({ page }) => {
      const value = await getCustomProperty(page, '--blok-text-primary');

      expect(value).toBe('#e2e0dc');
    });

    test('body-mounted popover --blok-popover-bg resolves to dark value (#252525)', async ({ page }) => {
      await openToolbox(page);

      const value = await getPopoverCustomProperty(page, '--blok-popover-bg');

      expect(value).toBe('#252525');
    });
  });

  test.describe('System dark preference', () => {
    test.use({ colorScheme: 'dark' });

    test.beforeEach(async ({ page }) => {
      await page.goto(TEST_PAGE_URL);
      await createBlok(page, [{ type: 'paragraph', data: { text: 'Hello world' } }]);
    });

    test('--blok-popover-bg resolves to dark value (#252525)', async ({ page }) => {
      const value = await getCustomProperty(page, '--blok-popover-bg');

      expect(value).toBe('#252525');
    });

    test('body-mounted popover --blok-popover-bg resolves to dark value (#252525)', async ({ page }) => {
      await openToolbox(page);

      const value = await getPopoverCustomProperty(page, '--blok-popover-bg');

      expect(value).toBe('#252525');
    });

    test('explicit data-blok-theme="light" overrides system dark preference', async ({ page }) => {
      await page.evaluate(() => {
        document.documentElement.setAttribute('data-blok-theme', 'light');
      });

      const value = await getCustomProperty(page, '--blok-popover-bg');

      // Browsers may normalize #ffffff to #fff
      expect(value.toLowerCase()).toMatch(/^#fff(fff)?$/);
    });

    test('body-mounted popover explicit data-blok-theme="light" overrides system dark preference', async ({ page }) => {
      await page.evaluate(() => {
        document.documentElement.setAttribute('data-blok-theme', 'light');
      });
      await openToolbox(page);

      const value = await getPopoverCustomProperty(page, '--blok-popover-bg');

      // Browsers may normalize #ffffff to #fff
      expect(value.toLowerCase()).toMatch(/^#fff(fff)?$/);
    });
  });
});
