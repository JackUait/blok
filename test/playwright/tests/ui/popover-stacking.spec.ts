import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"] [contenteditable]`;
const PLUS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="plus-button"]`;
const POPOVER_CONTAINER_SELECTOR = '[data-blok-testid="toolbox-popover"] [data-blok-testid="popover-container"]';
const OVERLAY_ID = 'blok-stacking-test-overlay';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder, overlayId }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();
    document.getElementById(overlayId)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holder: HOLDER_ID, overlayId: OVERLAY_ID });
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

/**
 * Injects a full-viewport overlay with the given z-index. Hit-testable so
 * elementFromPoint returns it unless the popover escapes the stacking
 * contest via CSS Top Layer.
 */
const injectOverlay = async (page: Page, zIndex: number): Promise<void> => {
  await page.evaluate(({ id, z }) => {
    const overlay = document.createElement('div');

    overlay.id = id;
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.zIndex = String(z);
    overlay.style.background = 'rgba(255, 0, 0, 0.01)';
    document.body.appendChild(overlay);
  }, { id: OVERLAY_ID, z: zIndex });
};

const openToolbox = async (page: Page): Promise<void> => {
  const firstBlock = page.locator(PARAGRAPH_SELECTOR, { hasText: 'Hello world' });

  await firstBlock.hover();

  const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

  await expect(plusButton).toBeVisible();
  await plusButton.click();

  await expect(page.locator(POPOVER_CONTAINER_SELECTOR)).toBeVisible();
};

/**
 * Returns true if the DOM element at popover center is the popover or its descendant.
 */
const popoverIsOnTop = async (page: Page): Promise<boolean> => {
  return await page.evaluate((selector) => {
    const popover = document.querySelector(selector);

    if (!(popover instanceof HTMLElement)) {
      return false;
    }

    const rect = popover.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);

    if (!(hit instanceof Element)) {
      return false;
    }

    return popover.contains(hit) || hit.contains(popover);
  }, POPOVER_CONTAINER_SELECTOR);
};

test.describe('Popover always renders above all other UI', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('popover wins over z-index 9999 overlay injected after open', async ({ page }) => {
    await createBlok(page, [{ type: 'paragraph', data: { text: 'Hello world' } }]);
    await openToolbox(page);
    await injectOverlay(page, 9999);

    expect(await popoverIsOnTop(page)).toBe(true);
  });

  test('popover wins over z-index 99999 overlay injected after open', async ({ page }) => {
    await createBlok(page, [{ type: 'paragraph', data: { text: 'Hello world' } }]);
    await openToolbox(page);
    await injectOverlay(page, 99999);

    expect(await popoverIsOnTop(page)).toBe(true);
  });

  test('popover wins over 2147483647 (max 32-bit z-index)', async ({ page }) => {
    await createBlok(page, [{ type: 'paragraph', data: { text: 'Hello world' } }]);
    await openToolbox(page);
    await injectOverlay(page, 2147483647);

    expect(await popoverIsOnTop(page)).toBe(true);
  });
});
