import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const HOLDER_ID = 'blok';
const BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const SETTINGS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const POPOVER_CONTAINER_SELECTOR = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';
const CONVERT_TO_OPTION_SELECTOR = '[data-blok-testid="popover-item"][data-blok-item-name="convert-to"]';
const NESTED_POPOVER_SELECTOR = '[data-blok-nested="true"] [data-blok-testid="popover-container"]';

test.beforeAll(ensureBlokBundleBuilt);

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
    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(async ({ holder }) => {
    const blok = new window.Blok({
      holder,
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: { text: 'Hello world' },
          },
        ],
      } satisfies OutputData,
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

const openBlockSettings = async (page: Page): Promise<void> => {
  const block = page.locator(BLOCK_SELECTOR).filter({ hasText: 'Hello world' });

  await block.click();

  const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

  await expect(settingsButton).toBeVisible();
  await settingsButton.click();

  const popover = page.locator(POPOVER_CONTAINER_SELECTOR);

  await expect(popover).toHaveCount(1);
  await popover.waitFor({ state: 'visible' });
};

test.describe('Block settings active state', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await createBlok(page);
  });

  test('items should not have active state when block settings opens', async ({ page }) => {
    await openBlockSettings(page);

    /**
     * No items in the block tunes popover should have the active attribute.
     * The 'Convert to' and 'Delete' items should not display as selected
     * when they are not actually in an active state.
     */
    const activeItems = page.locator(`${POPOVER_CONTAINER_SELECTOR} [data-blok-popover-item-active]`);

    await expect(activeItems).toHaveCount(0);
  });

  test('convert-to submenu items should not have active state', async ({ page }) => {
    await openBlockSettings(page);

    /**
     * Hover the 'Convert to' item to open the nested popover
     */
    const convertToItem = page.locator(CONVERT_TO_OPTION_SELECTOR);

    await convertToItem.hover();

    const nestedPopover = page.locator(NESTED_POPOVER_SELECTOR);

    await expect(nestedPopover).toBeVisible();

    /**
     * No items in the nested popover should have the active attribute.
     * These are tool options for conversion and none should be pre-selected.
     */
    const activeNestedItems = nestedPopover.locator('[data-blok-popover-item-active]');

    await expect(activeNestedItems).toHaveCount(0);
  });

  test('items should not appear focused when block settings opens without keyboard interaction', async ({ page }) => {
    await openBlockSettings(page);

    /**
     * No items should have the focused attribute immediately after opening.
     * Focus should only appear after keyboard navigation begins.
     */
    const focusedItems = page.locator(`${POPOVER_CONTAINER_SELECTOR} [data-blok-focused]`);

    await expect(focusedItems).toHaveCount(0);
  });
});
