import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok } from '../../../../types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"] [contenteditable]`;
const TOOLBOX_CONTAINER_SELECTOR = '[data-blok-testid="toolbox-popover"] [data-blok-testid="popover-container"]';

declare global {
  interface Window {
    blokInstance?: Blok;
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

const createBlok = async (page: Page): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(async ({ holder }) => {
    const blok = new window.Blok({
      holder,
      data: {
        blocks: [
          { type: 'paragraph', data: { text: '' } },
        ],
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

test.describe('Toolbox dynamic width', () => {
  test.beforeAll(ensureBlokBundleBuilt);

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('toolbox item titles should not be truncated', async ({ page }) => {
    await createBlok(page);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await paragraph.click();
    await paragraph.type('/');

    await expect(page.locator(TOOLBOX_CONTAINER_SELECTOR)).toBeVisible();

    // Check that no title element is truncated (scrollWidth > clientWidth means truncation)
    const truncatedCount = await page.evaluate((containerSelector) => {
      const container = document.querySelector(containerSelector);

      if (!container) {
        return -1;
      }

      const titles = Array.from(container.querySelectorAll('[data-blok-testid="popover-item-title"]'));
      let truncated = 0;

      titles.forEach((title) => {
        const el = title as HTMLElement;

        if (el.scrollWidth > el.clientWidth) {
          truncated++;
        }
      });

      return truncated;
    }, TOOLBOX_CONTAINER_SELECTOR);

    expect(truncatedCount).toBe(0);
  });

  test('toolbox should have spacing between title and shortcut', async ({ page }) => {
    await createBlok(page);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await paragraph.click();
    await paragraph.type('/');

    await expect(page.locator(TOOLBOX_CONTAINER_SELECTOR)).toBeVisible();

    // Find an item that has a secondary label (shortcut) and verify there's spacing
    const hasAdequateSpacing = await page.evaluate((containerSelector) => {
      const container = document.querySelector(containerSelector);

      if (!container) {
        return false;
      }

      const secondaryLabels = Array.from(container.querySelectorAll('[data-blok-testid="popover-item-secondary-title"]'));
      let allAdequate = true;

      secondaryLabels.forEach((label) => {
        const style = window.getComputedStyle(label);
        const paddingLeft = parseFloat(style.paddingLeft);

        // Should have at least 72px spacing between title and shortcut
        if (paddingLeft < 72) {
          allAdequate = false;
        }
      });

      return secondaryLabels.length > 0 && allAdequate;
    }, TOOLBOX_CONTAINER_SELECTOR);

    expect(hasAdequateSpacing).toBe(true);
  });
});
