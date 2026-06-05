import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  createBlok,
  ensureBlokBundleBuilt,
  TEST_PAGE_URL,
} from './_helpers';

const BLOK_INTERFACE = '[data-blok-interface=blok]';
const SETTINGS_BUTTON = `${BLOK_INTERFACE} [data-blok-testid="settings-toggler"]`;
const POPOVER_CONTAINER = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';

/**
 * Select blocks by flat index via the internal BlockSelection module, then
 * hover the last selected block so the toolbar + settings toggler become visible.
 */
const selectBlocksByIndex = async (
  page: Page,
  indices: number[]
): Promise<void> => {
  await page.evaluate((idxList: number[]) => {
    const blok = window.blokInstance;

    if (!blok) {
      throw new Error('Blok instance not found');
    }

    const blockSelection = (
      blok as unknown as {
        module: { blockSelection: { selectBlockByIndex: (i: number) => void } };
      }
    ).module.blockSelection;

    for (const idx of idxList) {
      blockSelection.selectBlockByIndex(idx);
    }
  }, indices);
};

test.describe('turn selection into columns', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await page.setViewportSize({ width: 1024, height: 800 });
  });

  test('selecting 3 blocks and choosing "Turn into columns" wraps them one-per-column', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'a', type: 'paragraph', data: { text: 'Alpha' } },
        { id: 'b', type: 'paragraph', data: { text: 'Beta' } },
        { id: 'c', type: 'paragraph', data: { text: 'Gamma' } },
      ],
    });

    // Select all three blocks by flat index
    await selectBlocksByIndex(page, [0, 1, 2]);

    // Hover the last selected block so the toolbar appears
    const lastBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Gamma' }).last();

    await lastBlock.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON);

    await expect(settingsButton).toBeVisible();
    await settingsButton.click();

    const popover = page.locator(POPOVER_CONTAINER);

    await expect(popover).toBeVisible();

    const turnIntoItem = popover.locator('[data-blok-item-name="turn-into-columns"]');

    await expect(turnIntoItem).toBeVisible();
    await turnIntoItem.click();

    // One column_list should now exist
    await expect(page.getByTestId('column-list')).toHaveCount(1);

    // Three columns inside it, one per original block
    const columnCount = await page.evaluate(() =>
      document.querySelectorAll('[data-blok-columns] > [data-blok-element]').length
    );

    expect(columnCount).toBe(3);

    await expect(page.getByText('Alpha')).toBeVisible();
    await expect(page.getByText('Beta')).toBeVisible();
    await expect(page.getByText('Gamma')).toBeVisible();
  });

  test('the command is absent for a single-block selection', async ({ page }) => {
    await createBlok(page, {
      blocks: [{ id: 'a', type: 'paragraph', data: { text: 'Solo' } }],
    });

    const soloBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Solo' }).last();

    await soloBlock.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON);

    await expect(settingsButton).toBeVisible();
    await settingsButton.click();

    const popover = page.locator(POPOVER_CONTAINER);

    await expect(popover).toBeVisible();

    await expect(popover.locator('[data-blok-item-name="turn-into-columns"]')).toHaveCount(0);
  });
});
