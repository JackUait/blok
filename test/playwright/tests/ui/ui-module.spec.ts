import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`;
const REDACTOR_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="redactor"]`;

type CreateBlokOptions = {
  data?: OutputData;
  readOnly?: boolean;
};

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

const createBlok = async (page: Page, options: CreateBlokOptions = {}): Promise<void> => {
  const { data, readOnly } = options;

  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, blokData, readOnlyMode }) => {
      const blokConfig: Record<string, unknown> = {
        holder: holder,
      };

      if (blokData !== null) {
        blokConfig.data = blokData;
      }

      if (readOnlyMode !== null) {
        blokConfig.readOnly = readOnlyMode;
      }

      const blok = new window.Blok(blokConfig);

      window.blokInstance = blok;
      await blok.isReady;
    },
    {
      holder: HOLDER_ID,
      blokData: data ?? null,
      readOnlyMode: typeof readOnly === 'boolean' ? readOnly : null,
    }
  );
};

const ensureBottomPadding = async (page: Page): Promise<void> => {
  await page.evaluate(({ selector }) => {
    const redactor = document.querySelector(selector);

    if (!redactor) {
      throw new Error('Redactor element not found');
    }

    (redactor as HTMLElement).style.paddingBottom = '200px';
  }, { selector: REDACTOR_SELECTOR });
};

const clickBottomZone = async (page: Page): Promise<void> => {
  const clickPoint = await page.evaluate(({ selector }) => {
    const redactor = document.querySelector(selector);

    if (!redactor) {
      throw new Error('Redactor element not found');
    }

    const rect = redactor.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = Math.min(rect.bottom - 4, rect.top + rect.height - 4);

    return {
      x: clientX,
      y: clientY,
    };
  }, { selector: REDACTOR_SELECTOR });

  await page.mouse.click(clickPoint.x, clickPoint.y);
};

test.describe('ui module', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test.describe('documentKeydown', () => {
    const initialData: OutputData = {
      blocks: [
        {
          id: 'block1',
          type: 'paragraph',
          data: {
            text: 'The first block',
          },
        },
        {
          id: 'block2',
          type: 'paragraph',
          data: {
            text: 'The second block',
          },
        },
      ],
    };

    const selectBlocks = async (page: Page): Promise<void> => {
      await page.evaluate(() => {
        const blok = window.blokInstance as Blok & {
          module?: {
            blockSelection?: {
              selectBlockByIndex?: (index: number) => void;
              clearSelection?: () => void;
            };
          };
        };

        const blockSelection = blok?.module?.blockSelection;

        if (!blockSelection?.selectBlockByIndex || !blockSelection?.clearSelection) {
          throw new Error('Block selection module is not available');
        }

        blockSelection.clearSelection?.();
        blockSelection.selectBlockByIndex?.(0);
        blockSelection.selectBlockByIndex?.(1);
      });
    };

    const getSavedBlocksCount = async (page: Page): Promise<number> => {
      return await page.evaluate(async () => {
        const blok = window.blokInstance;

        if (!blok) {
          throw new Error('Blok instance not found');
        }

        const savedData = await blok.save();

        return savedData.blocks.length;
      });
    };

    test('removes selected blocks with Backspace', async ({ page }) => {
      await createBlok(page, { data: initialData });
      await selectBlocks(page);

      await page.keyboard.press('Backspace');
      await page.waitForFunction(() => {
        const blok = window.blokInstance;

        if (!blok) {
          return false;
        }

        return blok.blocks.getBlocksCount() === 1;
      });

      const savedBlocksCount = await getSavedBlocksCount(page);

      expect(savedBlocksCount).toBe(0);
    });

    test('removes selected blocks with Delete', async ({ page }) => {
      await createBlok(page, { data: initialData });
      await selectBlocks(page);

      await page.keyboard.press('Delete');
      await page.waitForFunction(() => {
        const blok = window.blokInstance;

        if (!blok) {
          return false;
        }

        return blok.blocks.getBlocksCount() === 1;
      });

      const savedBlocksCount = await getSavedBlocksCount(page);

      expect(savedBlocksCount).toBe(0);
    });
  });

  test.describe('mousedown', () => {
    const textBlocks: OutputData = {
      blocks: [
        {
          type: 'paragraph',
          data: {
            text: 'first block',
          },
        },
        {
          type: 'paragraph',
          data: {
            text: 'second block',
          },
        },
        {
          type: 'paragraph',
          data: {
            text: 'third block',
          },
        },
      ],
    };

    test('updates current block on click', async ({ page }) => {
      await createBlok(page, { data: textBlocks });

      const secondParagraph = page.locator(PARAGRAPH_SELECTOR).filter({
        hasText: 'second block',
      });

      await secondParagraph.click();
      const currentIndex = await page.evaluate(() => {
        const blok = window.blokInstance;

        if (!blok) {
          throw new Error('Blok instance not found');
        }

        return blok.blocks.getCurrentBlockIndex();
      });

      expect(currentIndex).toBe(1);
    });

    test('updates current block on click in read-only mode', async ({ page }) => {
      await createBlok(page, {
        data: textBlocks,
        readOnly: true,
      });

      const secondParagraph = page.locator(PARAGRAPH_SELECTOR).filter({
        hasText: 'second block',
      });

      await secondParagraph.click();
      const currentIndex = await page.evaluate(() => {
        const blok = window.blokInstance;

        if (!blok) {
          throw new Error('Blok instance not found');
        }

        return blok.blocks.getCurrentBlockIndex();
      });

      expect(currentIndex).toBe(1);
    });
  });

  test.describe('bottom zone interactions', () => {
    test('keeps single empty default block when clicking bottom zone', async ({ page }) => {
      await createBlok(page);
      await ensureBottomPadding(page);

      await clickBottomZone(page);

      const result = await page.evaluate(() => {
        const blok = window.blokInstance;

        if (!blok) {
          throw new Error('Blok instance not found');
        }

        return {
          blocksCount: blok.blocks.getBlocksCount(),
          currentIndex: blok.blocks.getCurrentBlockIndex(),
        };
      });

      expect(result.blocksCount).toBe(1);
      expect(result.currentIndex).toBe(0);
    });

    test('inserts new default block when clicking bottom zone with non-empty block', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: {
                text: 'The only block',
              },
            },
          ],
        },
      });
      await ensureBottomPadding(page);

      await clickBottomZone(page);
      await page.waitForFunction(() => {
        const blok = window.blokInstance;

        if (!blok) {
          return false;
        }

        return blok.blocks.getBlocksCount() === 2;
      });

      const result = await page.evaluate(() => {
        const blok = window.blokInstance;

        if (!blok) {
          throw new Error('Blok instance not found');
        }

        const blocksCount = blok.blocks.getBlocksCount();
        const currentIndex = blok.blocks.getCurrentBlockIndex();
        const lastBlock = blok.blocks.getBlockByIndex(blocksCount - 1);

        return {
          blocksCount,
          currentIndex,
          lastBlockIsEmpty: lastBlock?.isEmpty ?? false,
        };
      });

      expect(result.blocksCount).toBe(2);
      expect(result.currentIndex).toBe(1);
      expect(result.lastBlockIsEmpty).toBe(true);
    });
  });

  test.describe('extended hover zone', () => {
    const threeBlocksData: OutputData = {
      blocks: [
        {
          id: 'block-1',
          type: 'paragraph',
          data: {
            text: 'First block',
          },
        },
        {
          id: 'block-2',
          type: 'paragraph',
          data: {
            text: 'Second block',
          },
        },
        {
          id: 'block-3',
          type: 'paragraph',
          data: {
            text: 'Third block',
          },
        },
      ],
    };

    /**
     * Gets the position data needed to test hover zones
     */
    const getHoverZonePositions = async (page: Page): Promise<{
      contentLeft: number;
      firstBlockTop: number;
      firstBlockBottom: number;
      secondBlockTop: number;
      secondBlockBottom: number;
    }> => {
      return await page.evaluate(() => {
        const blocks = document.querySelectorAll('[data-blok-testid="block-wrapper"]');
        const firstBlock = blocks[0];
        const secondBlock = blocks[1];

        if (!firstBlock || !secondBlock) {
          throw new Error('Blocks not found');
        }

        const contentElement = firstBlock.querySelector('[data-blok-testid="block-content"]');

        if (!contentElement) {
          throw new Error('Content element not found');
        }

        const contentRect = contentElement.getBoundingClientRect();
        const firstBlockRect = firstBlock.getBoundingClientRect();
        const secondBlockRect = secondBlock.getBoundingClientRect();

        return {
          contentLeft: contentRect.left,
          firstBlockTop: firstBlockRect.top,
          firstBlockBottom: firstBlockRect.bottom,
          secondBlockTop: secondBlockRect.top,
          secondBlockBottom: secondBlockRect.bottom,
        };
      });
    };

    /**
     * Gets which block the toolbar is currently positioned on
     */
    const getToolbarBlockId = async (page: Page): Promise<string | null> => {
      return await page.evaluate(() => {
        const toolbar = document.querySelector('[data-blok-testid="toolbar"]');

        if (!toolbar) {
          return null;
        }

        // The toolbar is positioned next to its target block
        // We can find it by checking which block-wrapper contains/is near the toolbar
        const toolbarRect = toolbar.getBoundingClientRect();
        const blocks = Array.from(document.querySelectorAll('[data-blok-testid="block-wrapper"]'));

        for (const block of blocks) {
          const blockRect = block.getBoundingClientRect();

          // Check if toolbar's vertical center is within block bounds
          const toolbarCenterY = toolbarRect.top + toolbarRect.height / 2;

          if (toolbarCenterY >= blockRect.top && toolbarCenterY <= blockRect.bottom) {
            return block.getAttribute('data-blok-id');
          }
        }

        return null;
      });
    };

    test('shows toolbar when hovering in extended zone to the left of content (LTR)', async ({ page }) => {
      await createBlok(page, { data: threeBlocksData });

      // First hover directly on the second block to establish toolbar there
      const secondParagraph = page.locator(PARAGRAPH_SELECTOR).filter({
        hasText: 'Second block',
      });

      await secondParagraph.hover();

      // eslint-disable-next-line playwright/no-wait-for-timeout -- Wait for hover event to process
      await page.waitForTimeout(100);

      // Verify toolbar is positioned at the second block
      const initialBlockId = await getToolbarBlockId(page);

      expect(initialBlockId).toBe('block-2');

      // Get positions for hover zone calculation
      const positions = await getHoverZonePositions(page);

      // Now hover in the extended zone (50px left of content) at the first block's Y position
      const hoverX = positions.contentLeft - 50; // 50px left of content edge (within 100px zone)
      const hoverY = (positions.firstBlockTop + positions.firstBlockBottom) / 2; // Middle of first block

      await page.mouse.move(hoverX, hoverY);

      // eslint-disable-next-line playwright/no-wait-for-timeout -- Wait for hover event to process
      await page.waitForTimeout(100);

      // Verify toolbar moved to the first block
      const newBlockId = await getToolbarBlockId(page);

      expect(newBlockId).toBe('block-1');
    });

    test('does not trigger hover when cursor is beyond the extended zone boundary', async ({ page }) => {
      await createBlok(page, { data: threeBlocksData });

      // Get positions first
      const positions = await getHoverZonePositions(page);

      // Hover in the extended zone to verify it works
      const inZoneX = positions.contentLeft - 50; // 50px left (inside 100px zone)
      const blockY = (positions.firstBlockTop + positions.firstBlockBottom) / 2;

      await page.mouse.move(inZoneX, blockY);

      // eslint-disable-next-line playwright/no-wait-for-timeout -- Wait for hover event to process
      await page.waitForTimeout(100);

      // Verify toolbar is on first block (zone hover worked)
      const zoneBlockId = await getToolbarBlockId(page);

      expect(zoneBlockId).toBe('block-1');

      // Now move far outside the zone (200px left of content, beyond the 100px limit)
      // Keep same Y position - since we're outside the zone, no new hover should trigger
      const outsideZoneX = positions.contentLeft - 200;

      await page.mouse.move(outsideZoneX, blockY);

      // eslint-disable-next-line playwright/no-wait-for-timeout -- Wait for potential hover event
      await page.waitForTimeout(100);

      // Toolbar should still be on first block (no new block detected outside zone)
      const afterOutsideBlockId = await getToolbarBlockId(page);

      expect(afterOutsideBlockId).toBe('block-1');
    });

    test('switches between blocks when moving vertically in the extended zone', async ({ page }) => {
      await createBlok(page, { data: threeBlocksData });

      // Get positions
      const positions = await getHoverZonePositions(page);

      // Hover in the extended zone at the first block's Y position
      const hoverX = positions.contentLeft - 50;
      const firstBlockY = (positions.firstBlockTop + positions.firstBlockBottom) / 2;

      await page.mouse.move(hoverX, firstBlockY);

      // eslint-disable-next-line playwright/no-wait-for-timeout -- Wait for hover event to process
      await page.waitForTimeout(100);

      // Verify toolbar is on first block
      let currentBlockId = await getToolbarBlockId(page);

      expect(currentBlockId).toBe('block-1');

      // Move to the second block's Y position (staying in the extended zone)
      const secondBlockY = (positions.secondBlockTop + positions.secondBlockBottom) / 2;

      await page.mouse.move(hoverX, secondBlockY);

      // eslint-disable-next-line playwright/no-wait-for-timeout -- Wait for hover event to process
      await page.waitForTimeout(100);

      // Verify toolbar moved to second block
      currentBlockId = await getToolbarBlockId(page);
      expect(currentBlockId).toBe('block-2');
    });
  });
});

