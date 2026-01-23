import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const BLOCK_WRAPPER_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const TOOLBAR_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="toolbar"]`;

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const getBlockByIndex = (page: Page, index: number): Locator => {
  return page.locator(`:nth-match(${BLOCK_WRAPPER_SELECTOR}, ${index + 1})`);
};


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

const createBlokWithBlocks = async (
  page: Page,
  blocks: OutputData['blocks']
): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(async ({ holder, blocks: blokBlocks }: {
    holder: string;
    blocks: OutputData['blocks'];
  }) => {
    const blok = new window.Blok({
      holder: holder,
      data: { blocks: blokBlocks },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, {
    holder: HOLDER_ID,
    blocks,
  });
};

const getRequiredBoundingBox = async (locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
  const box = await locator.boundingBox();

  if (!box) {
    throw new Error('Unable to determine element bounds');
  }

  return box;
};

test.describe('ui.toolbar-rubber-band-hover', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('should move toolbar to hovered block after rubber band selection', async ({ page }) => {
    /**
     * Test for the bug where toolbar always stays at first block
     * when hovering over blocks in rubber band selection
     */
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'First block',
        },
      },
      {
        type: 'paragraph',
        data: {
          text: 'Second block',
        },
      },
      {
        type: 'paragraph',
        data: {
          text: 'Third block',
        },
      },
      {
        type: 'paragraph',
        data: {
          text: 'Fourth block',
        },
      },
    ]);

    const firstBlock = getBlockByIndex(page, 0);
    const fourthBlock = getBlockByIndex(page, 3);
    const firstBox = await getRequiredBoundingBox(firstBlock);
    const fourthBox = await getRequiredBoundingBox(fourthBlock);

    // Perform cross-block selection by dragging from center of first to center of fourth
    const firstCenter = { x: firstBox.x + firstBox.width / 2, y: firstBox.y + firstBox.height / 2 };
    const fourthCenter = { x: fourthBox.x + fourthBox.width / 2, y: fourthBox.y + fourthBox.height / 2 };

    await page.mouse.move(firstCenter.x, firstCenter.y);
    await page.mouse.down();
    await page.mouse.move(fourthCenter.x, fourthCenter.y, { steps: 10 });
    await page.mouse.up();

    // Verify all blocks are selected
    await expect(getBlockByIndex(page, 0)).toHaveAttribute('data-blok-selected', 'true');
    await expect(getBlockByIndex(page, 1)).toHaveAttribute('data-blok-selected', 'true');
    await expect(getBlockByIndex(page, 2)).toHaveAttribute('data-blok-selected', 'true');
    await expect(getBlockByIndex(page, 3)).toHaveAttribute('data-blok-selected', 'true');

    // Wait for toolbar to appear after rubber band selection
    const toolbar = page.locator(TOOLBAR_SELECTOR);
    await expect(toolbar).toBeVisible();

    // Move mouse below all blocks (outside editor) to clear any hover state
    // Using a position well below the fourth block to ensure hover zone doesn't find any block
    await page.mouse.move(fourthBox.x + fourthBox.width / 2, fourthBox.y + fourthBox.height + 100);

    // Now hover over the fourth (last) block
    await fourthBlock.hover();

    // Wait for toolbar to settle after hover
    await page.waitForFunction(() => {
      const toolbar = document.querySelector('[data-blok-testid="toolbar"]');
      if (!toolbar) return false;
      const rect = toolbar.getBoundingClientRect();
      return rect.top > 0 && rect.top < 1000; // Toolbar has a valid position
    }, { timeout: 2000 });

    // Get the toolbar position after hovering fourth block
    const toolbarAfterFourthHover = await getRequiredBoundingBox(toolbar);

    // Get the fourth block's position (might have changed)
    const fourthBlockBox = await getRequiredBoundingBox(fourthBlock);

    /**
     * The toolbar should be positioned near the fourth (last) block, not the first block.
     * We check this by verifying the toolbar's Y position is closer to the fourth block's Y
     * than to the first block's Y.
     */
    const distanceToFirstBlock = Math.abs(toolbarAfterFourthHover.y - firstBox.y);
    const distanceToFourthBlock = Math.abs(toolbarAfterFourthHover.y - fourthBlockBox.y);

    // The toolbar should be closer to the hovered block (fourth) than to the first block
    expect(distanceToFourthBlock).toBeLessThan(distanceToFirstBlock);

    // Now hover over the second block
    const secondBlock = getBlockByIndex(page, 1);
    await secondBlock.hover();

    // Wait for toolbar to settle after hover
    await page.waitForFunction(() => {
      const toolbar = document.querySelector('[data-blok-testid="toolbar"]');
      if (!toolbar) return false;
      const rect = toolbar.getBoundingClientRect();
      return rect.top > 0 && rect.top < 1000; // Toolbar has a valid position
    }, { timeout: 2000 });

    // Get the toolbar position after hovering second block
    const toolbarAfterSecondHover = await getRequiredBoundingBox(toolbar);
    const secondBlockBox = await getRequiredBoundingBox(secondBlock);

    /**
     * The toolbar should now be positioned near the second block.
     * Check that it moved from the fourth block position.
     */
    const distanceFromToolbarToSecond = Math.abs(toolbarAfterSecondHover.y - secondBlockBox.y);
    const distanceFromToolbarToFourth = Math.abs(toolbarAfterSecondHover.y - fourthBlockBox.y);

    // The toolbar should be closer to the second (hovered) block than to the fourth block
    expect(distanceFromToolbarToSecond).toBeLessThan(distanceFromToolbarToFourth);
  });

  test('should position toolbar at first block after rubber band selection completes', async ({ page }) => {
    /**
     * Verify the initial behavior: toolbar should appear at first block
     * when rubber band selection completes (before any hover)
     */
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'First block',
        },
      },
      {
        type: 'paragraph',
        data: {
          text: 'Second block',
        },
      },
      {
        type: 'paragraph',
        data: {
          text: 'Third block',
        },
      },
    ]);

    const firstBlock = getBlockByIndex(page, 0);
    const thirdBlock = getBlockByIndex(page, 2);
    const firstBox = await getRequiredBoundingBox(firstBlock);
    const thirdBox = await getRequiredBoundingBox(thirdBlock);

    // Perform cross-block selection by dragging from center of first to center of third
    const firstCenter = { x: firstBox.x + firstBox.width / 2, y: firstBox.y + firstBox.height / 2 };
    const thirdCenter = { x: thirdBox.x + thirdBox.width / 2, y: thirdBox.y + thirdBox.height / 2 };

    await page.mouse.move(firstCenter.x, firstCenter.y);
    await page.mouse.down();
    await page.mouse.move(thirdCenter.x, thirdCenter.y, { steps: 10 });
    await page.mouse.up();

    // Verify all blocks are selected
    await expect(getBlockByIndex(page, 0)).toHaveAttribute('data-blok-selected', 'true');
    await expect(getBlockByIndex(page, 1)).toHaveAttribute('data-blok-selected', 'true');
    await expect(getBlockByIndex(page, 2)).toHaveAttribute('data-blok-selected', 'true');

    // Wait for toolbar to appear and be positioned
    const toolbar = page.locator(TOOLBAR_SELECTOR);
    await expect(toolbar).toBeVisible();

    // Wait for toolbar to be positioned (has a non-zero Y position)
    await page.waitForFunction(() => {
      const toolbar = document.querySelector('[data-blok-testid="toolbar"]');
      if (!toolbar) return false;
      const rect = toolbar.getBoundingClientRect();
      return rect.top > 0 && rect.top < 1000; // Reasonable Y position
    }, { timeout: 2000 });

    // Get the toolbar position
    const toolbarBox = await getRequiredBoundingBox(toolbar);

    // The toolbar should be positioned near the first block
    const distanceToFirstBlock = Math.abs(toolbarBox.y - firstBox.y);
    const distanceToThirdBlock = Math.abs(toolbarBox.y - thirdBox.y);

    // Toolbar should be closer to first block (initial position)
    expect(distanceToFirstBlock).toBeLessThan(distanceToThirdBlock);
  });
});
