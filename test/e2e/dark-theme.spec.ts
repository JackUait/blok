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

const createBlok = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, blokBlocks }) => {
      const blok = new window.Blok({
        holder,
        data: { blocks: blokBlocks },
      });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, blokBlocks: blocks }
  );
};

const getCustomProperty = async (page: Page, property: string): Promise<string> => {
  return page.locator(BLOK_INTERFACE_SELECTOR).evaluate(
    (el, prop) => window.getComputedStyle(el).getPropertyValue(prop).trim(),
    property
  );
};

/**
 * These tests verify that Blok's dark theme CSS variable system works correctly.
 *
 * Three theme scenarios are tested:
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
  });

  test.describe('Explicit dark mode (data-blok-theme="dark")', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(TEST_PAGE_URL);
      await page.evaluate(() => {
        document.documentElement.setAttribute('data-blok-theme', 'dark');
      });
      await createBlok(page, [{ type: 'paragraph', data: { text: 'Hello world' } }]);
    });

    test('--blok-popover-bg resolves to dark value (#1e2330)', async ({ page }) => {
      const value = await getCustomProperty(page, '--blok-popover-bg');

      expect(value).toBe('#1e2330');
    });

    test('--blok-text-primary resolves to dark value (#e2e8f0)', async ({ page }) => {
      const value = await getCustomProperty(page, '--blok-text-primary');

      expect(value).toBe('#e2e8f0');
    });
  });

  test.describe('System dark preference', () => {
    test.use({ colorScheme: 'dark' });

    test.beforeEach(async ({ page }) => {
      await page.goto(TEST_PAGE_URL);
      await createBlok(page, [{ type: 'paragraph', data: { text: 'Hello world' } }]);
    });

    test('--blok-popover-bg resolves to dark value (#1e2330)', async ({ page }) => {
      const value = await getCustomProperty(page, '--blok-popover-bg');

      expect(value).toBe('#1e2330');
    });

    test('explicit data-blok-theme="light" overrides system dark preference', async ({ page }) => {
      await page.evaluate(() => {
        document.documentElement.setAttribute('data-blok-theme', 'light');
      });

      const value = await getCustomProperty(page, '--blok-popover-bg');

      // Browsers may normalize #ffffff to #fff
      expect(value.toLowerCase()).toMatch(/^#fff(fff)?$/);
    });
  });
});
