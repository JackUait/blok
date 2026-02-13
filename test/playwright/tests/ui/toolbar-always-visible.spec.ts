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

test.describe('ui.toolbar-always-visible', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('should show toolbar when cursor is below all blocks', async ({ page }) => {
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
    ]);

    const firstBlock = getBlockByIndex(page, 0);
    const lastBlock = getBlockByIndex(page, 1);
    const firstBox = await getRequiredBoundingBox(firstBlock);
    const lastBox = await getRequiredBoundingBox(lastBlock);

    /**
     * Move cursor 150px below the last block.
     * This is outside any block element, so the BlockHoverController
     * should find the nearest block (the last one) by Y distance.
     */
    await page.mouse.move(
      lastBox.x + lastBox.width / 2,
      lastBox.y + lastBox.height + 150
    );

    const toolbar = page.locator(TOOLBAR_SELECTOR);

    await expect(toolbar).toHaveAttribute('data-blok-opened', 'true');

    /**
     * Wait for toolbar to settle at its final position
     */
    await page.waitForFunction(() => {
      const tb = document.querySelector('[data-blok-testid="toolbar"]');

      if (!tb) {
        return false;
      }
      const rect = tb.getBoundingClientRect();

      return rect.top > 0 && rect.top < 1000;
    }, { timeout: 2000 });

    const toolbarBox = await getRequiredBoundingBox(toolbar);

    /**
     * Toolbar should be positioned near the last block, not the first block.
     */
    const distanceToFirstBlock = Math.abs(toolbarBox.y - firstBox.y);
    const distanceToLastBlock = Math.abs(toolbarBox.y - lastBox.y);

    expect(distanceToLastBlock).toBeLessThan(distanceToFirstBlock);
  });

  test('should show toolbar when cursor is above all blocks', async ({ page }) => {
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
    ]);

    const firstBlock = getBlockByIndex(page, 0);
    const lastBlock = getBlockByIndex(page, 1);
    const firstBox = await getRequiredBoundingBox(firstBlock);
    const lastBox = await getRequiredBoundingBox(lastBlock);

    /**
     * Move cursor 50px above the first block, but stay within the page.
     * Math.max(1, ...) ensures we don't go to y=0 or negative values.
     */
    await page.mouse.move(
      firstBox.x + firstBox.width / 2,
      Math.max(1, firstBox.y - 50)
    );

    const toolbar = page.locator(TOOLBAR_SELECTOR);

    await expect(toolbar).toHaveAttribute('data-blok-opened', 'true');

    /**
     * Wait for toolbar to settle at its final position
     */
    await page.waitForFunction(() => {
      const tb = document.querySelector('[data-blok-testid="toolbar"]');

      if (!tb) {
        return false;
      }
      const rect = tb.getBoundingClientRect();

      return rect.top > 0 && rect.top < 1000;
    }, { timeout: 2000 });

    const toolbarBox = await getRequiredBoundingBox(toolbar);

    /**
     * Toolbar should be positioned near the first block, not the last block.
     */
    const distanceToFirstBlock = Math.abs(toolbarBox.y - firstBox.y);
    const distanceToLastBlock = Math.abs(toolbarBox.y - lastBox.y);

    expect(distanceToFirstBlock).toBeLessThan(distanceToLastBlock);
  });

  test('should switch toolbar to nearest block when moving between gaps', async ({ page }) => {
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
    const lastBlock = getBlockByIndex(page, 2);
    const lastBox = await getRequiredBoundingBox(lastBlock);

    /**
     * First, hover the first block to establish the toolbar on it.
     */
    await firstBlock.hover();

    const toolbar = page.locator(TOOLBAR_SELECTOR);

    await expect(toolbar).toHaveAttribute('data-blok-opened', 'true');

    /**
     * Move cursor 100px below the last block.
     * The toolbar should remain visible and move to the nearest block (the last one).
     */
    await page.mouse.move(
      lastBox.x + lastBox.width / 2,
      lastBox.y + lastBox.height + 100
    );

    /**
     * Toolbar should still be visible (opened) even though cursor is outside any block.
     */
    await expect(toolbar).toHaveAttribute('data-blok-opened', 'true');
  });
});
