import type { Locator, Page } from '@playwright/test';
import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

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

/**
 * The x of the rubber band, in the page margin left of the block holders.
 *
 * The lasso MUST be anchored outside editable content. A drag anchored inside a
 * block's text is a cross-block TEXT selection and never marks blocks
 * `data-blok-selected` — `RectangleSelection.processMouseDown` arms only when
 * the mousedown target is not an input, and `startSelection` bails when it lands
 * inside `[data-blok-element-content]`. The redactor's gutter still counts as
 * the row of the block beside it, so a band drawn here selects those rows.
 */
const RUBBER_BAND_X = 10;

/**
 * Lasso every block whose row the band spans, then release.
 *
 * The pointer is re-nudged until the band has actually reached `endBlock`, and
 * only then released. RectangleSelection handles mousemove through a 10ms
 * throttle whose trailing invocation is not guaranteed: a move arriving inside
 * `wait` of a completed trailing invoke stores its args without arming a timer,
 * so the last move of a two-event synthetic tail can be dropped outright and no
 * amount of waiting brings it back. A real drag emits a continuous stream, so
 * re-dispatching is the faithful gesture, not a workaround. The y alternates so
 * no engine can coalesce two identical positions; both stay inside the end
 * block's row because `toY` is its centre.
 * @param page - page under test
 * @param fromY - viewport y the band starts at
 * @param toY - viewport y the band ends at
 * @param endBlock - the last block the band must cover before the release
 */
const rubberBandSelect = async (
  page: Page,
  fromY: number,
  toY: number,
  endBlock: Locator
): Promise<void> => {
  await page.mouse.move(RUBBER_BAND_X, fromY);
  await page.mouse.down();
  await page.mouse.move(RUBBER_BAND_X, toY, { steps: 10 });

  let nudge = 0;

  await expect.poll(async () => {
    nudge = nudge === 1 ? 2 : 1;

    await page.mouse.move(RUBBER_BAND_X, toY + nudge);

    return endBlock.getAttribute('data-blok-selected');
  }).toBe('true');

  await page.mouse.up();
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
    await gotoTestPage(page);
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

    await rubberBandSelect(page, firstBox.y + firstBox.height / 2, fourthBox.y + fourthBox.height / 2, fourthBlock);

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

    // Outlast the 50ms HOVER_COOLDOWN_MS the lasso's mouseup arms — a hover
    // inside it is ignored, so shortening this wait breaks the hover below
    // eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(100);

    // Now hover over the fourth (last) block
    await fourthBlock.hover();

    // Wait for toolbar to settle near the fourth block after hover
    const fourthBlockBoxForWait = await getRequiredBoundingBox(fourthBlock);
    await page.waitForFunction(({ fourthBlockY, firstBlockY }) => {
      const toolbar = document.querySelector('[data-blok-testid="toolbar"]');
      if (!toolbar) return false;
      const rect = toolbar.getBoundingClientRect();
      if (rect.top <= 0 || rect.top >= 1000) return false;
      // Wait until toolbar is closer to fourth block than first block
      return Math.abs(rect.top - fourthBlockY) < Math.abs(rect.top - firstBlockY);
    }, { fourthBlockY: fourthBlockBoxForWait.y, firstBlockY: firstBox.y }, { timeout: 2000 });

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

    await rubberBandSelect(page, firstBox.y + firstBox.height / 2, thirdBox.y + thirdBox.height / 2, thirdBlock);

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
