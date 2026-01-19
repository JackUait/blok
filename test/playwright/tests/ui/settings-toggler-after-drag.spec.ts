import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { createSelector } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const BLOCK_SELECTOR = `${createSelector('interface')} [data-blok-testid="block-wrapper"]`;
const SETTINGS_BUTTON_SELECTOR = `${createSelector('interface')} [data-blok-testid="settings-toggler"]`;
const BLOCK_TUNES_POPOVER_SELECTOR = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';

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

const createBlok = async (page: Page, data?: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, blokData }) => {
      const blok = new window.Blok({
        holder: holder,
        ...(blokData ? { data: blokData } : {}),
      });

      window.blokInstance = blok;
      await blok.isReady;
      blok.caret.setToFirstBlock();
    },
    { holder: HOLDER_ID, blokData: data }
  );
};

const getBoundingBox = async (
  locator: ReturnType<Page['locator']>
): Promise<{ x: number; y: number; width: number; height: number }> => {
  const box = await locator.boundingBox();

  if (!box) {
    throw new Error('Could not get bounding box for element');
  }

  return box;
};

const performDragDrop = async (
  page: Page,
  sourceLocator: ReturnType<Page['locator']>,
  targetLocator: ReturnType<Page['locator']>,
  targetVerticalPosition: 'top' | 'bottom'
): Promise<void> => {
  const sourceBox = await getBoundingBox(sourceLocator);
  const targetBox = await getBoundingBox(targetLocator);

  const sourceX = sourceBox.x + sourceBox.width / 2;
  const sourceY = sourceBox.y + sourceBox.height / 2;
  const targetX = targetBox.x + targetBox.width / 2;
  const targetY = targetVerticalPosition === 'top'
    ? targetBox.y + 1
    : targetBox.y + targetBox.height - 1;

  await page.mouse.move(sourceX, sourceY);
  await page.mouse.down();

  await page.waitForTimeout(50);

  await page.mouse.move(targetX, targetY, { steps: 15 });

  await page.waitForTimeout(50);

  await page.mouse.up();

  await page.waitForTimeout(100);
};

test.describe('ui.settings-toggler-after-drag', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('should not open block settings menu immediately after drag-drop', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
      ],
    });

    // eslint-disable-next-line playwright/no-nth-methods
    const firstBlock = page.locator(BLOCK_SELECTOR).first();
    // eslint-disable-next-line playwright/no-nth-methods
    const secondBlock = page.locator(BLOCK_SELECTOR).nth(1);

    // Get settings buttons for each block
    const firstSettingsButton = firstBlock.locator(SETTINGS_BUTTON_SELECTOR);
    const secondSettingsButton = secondBlock.locator(SETTINGS_BUTTON_SELECTOR);

    // Perform drag-drop: move first block below second block
    await performDragDrop(page, firstSettingsButton, secondBlock, 'bottom');

    // Wait for the drag to complete and UI to settle
    await page.waitForTimeout(200);

    // The block settings menu should NOT be open
    await expect(page.locator(BLOCK_TUNES_POPOVER_SELECTOR)).toHaveCount(0);

    // Now click on the settings button - it should open the menu
    await firstSettingsButton.click();

    await expect(page.locator(BLOCK_TUNES_POPOVER_SELECTOR)).toBeVisible();
  });

  test('should open block settings menu on click after drag-drop has settled', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
        { type: 'paragraph', data: { text: 'Third block' } },
      ],
    });

    // eslint-disable-next-line playwright/no-nth-methods
    const firstBlock = page.locator(BLOCK_SELECTOR).first();
    const firstSettingsButton = firstBlock.locator(SETTINGS_BUTTON_SELECTOR);
    // eslint-disable-next-line playwright/no-nth-methods
    const secondBlock = page.locator(BLOCK_SELECTOR).nth(1);
    const secondSettingsButton = secondBlock.locator(SETTINGS_BUTTON_SELECTOR);

    // Perform drag-drop to reorder blocks
    await performDragDrop(page, secondSettingsButton, firstBlock, 'top');

    // Wait for drag to complete
    await page.waitForTimeout(200);

    // Click on the first block's settings button
    await firstSettingsButton.click();

    // Now the menu should open
    await expect(page.locator(BLOCK_TUNES_POPOVER_SELECTOR)).toBeVisible();
  });

  test('should distinguish between click and drag on settings toggler', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
      ],
    });

    // eslint-disable-next-line playwright/no-nth-methods
    const firstBlock = page.locator(BLOCK_SELECTOR).first();
    const firstSettingsButton = firstBlock.locator(SETTINGS_BUTTON_SELECTOR);
    // eslint-disable-next-line playwright/no-nth-methods
    const secondBlock = page.locator(BLOCK_SELECTOR).nth(1);

    // Perform a quick click (minimal mouse movement)
    const buttonBox = await getBoundingBox(firstSettingsButton);
    const clickX = buttonBox.x + buttonBox.width / 2;
    const clickY = buttonBox.y + buttonBox.height / 2;

    await page.mouse.move(clickX, clickY);
    await page.mouse.down();
    await page.waitForTimeout(20);
    await page.mouse.up();

    // Block settings should open on click
    await expect(page.locator(BLOCK_TUNES_POPOVER_SELECTOR)).toBeVisible();

    // Close the menu
    await page.mouse.click(clickX + 10, clickY + 10);

    // Now perform a drag (movement beyond threshold)
    await performDragDrop(page, firstSettingsButton, secondBlock, 'bottom');

    // Block settings should NOT open after drag
    await expect(page.locator(BLOCK_TUNES_POPOVER_SELECTOR)).toHaveCount(0);
  });

  test('should allow click after drag-drop has fully completed', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
      ],
    });

    // eslint-disable-next-line playwright/no-nth-methods
    const firstBlock = page.locator(BLOCK_SELECTOR).first();
    const firstSettingsButton = firstBlock.locator(SETTINGS_BUTTON_SELECTOR);
    // eslint-disable-next-line playwright/no-nth-methods
    const secondBlock = page.locator(BLOCK_SELECTOR).nth(1);

    // Perform drag-drop
    await performDragDrop(page, firstSettingsButton, secondBlock, 'bottom');

    // Wait for everything to settle
    await page.waitForTimeout(300);

    // Now click should work
    await firstSettingsButton.click();

    await expect(page.locator(BLOCK_TUNES_POPOVER_SELECTOR)).toBeVisible();
  });

  test('should handle multiple consecutive drag-drop operations correctly', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { type: 'paragraph', data: { text: 'Block 1' } },
        { type: 'paragraph', data: { text: 'Block 2' } },
        { type: 'paragraph', data: { text: 'Block 3' } },
        { type: 'paragraph', data: { text: 'Block 4' } },
      ],
    });

    const blocks = page.locator(BLOCK_SELECTOR);

    // Perform multiple drag operations
    // eslint-disable-next-line playwright/no-nth-methods
    await performDragDrop(page, blocks.nth(0).locator(SETTINGS_BUTTON_SELECTOR), blocks.nth(1), 'bottom');
    await page.waitForTimeout(150);

    // eslint-disable-next-line playwright/no-nth-methods
    await performDragDrop(page, blocks.nth(2).locator(SETTINGS_BUTTON_SELECTOR), blocks.nth(3), 'bottom');
    await page.waitForTimeout(150);

    // eslint-disable-next-line playwright/no-nth-methods
    await performDragDrop(page, blocks.nth(1).locator(SETTINGS_BUTTON_SELECTOR), blocks.nth(2), 'bottom');
    await page.waitForTimeout(200);

    // No block settings menu should be open after all the dragging
    await expect(page.locator(BLOCK_TUNES_POPOVER_SELECTOR)).toHaveCount(0);

    // But clicking should still work
    // eslint-disable-next-line playwright/no-nth-methods
    await blocks.nth(1).locator(SETTINGS_BUTTON_SELECTOR).click();

    await expect(page.locator(BLOCK_TUNES_POPOVER_SELECTOR)).toBeVisible();
  });
});
