import { expect, test, type Locator } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`;
const REDACTOR_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="redactor"]`;

const getRequiredBoundingBox = async (locator: Locator): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
}> => {
  const box = await locator.boundingBox();

  if (!box) {
    throw new Error('Unable to determine element bounds');
  }

  return box;
};

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

  test.describe('extended hover zone (RTL)', () => {
    const threeBlocksDataRTL: OutputData = {
      blocks: [
        {
          id: 'block-rtl-1',
          type: 'paragraph',
          data: {
            text: 'أول كتلة', // "First block" in Arabic
          },
        },
        {
          id: 'block-rtl-2',
          type: 'paragraph',
          data: {
            text: 'ثاني كتلة', // "Second block" in Arabic
          },
        },
        {
          id: 'block-rtl-3',
          type: 'paragraph',
          data: {
            text: 'ثالث كتلة', // "Third block" in Arabic
          },
        },
      ],
    };

    /**
     * Creates a Blok instance configured for RTL layout
     */
    const createBlokRTL = async (page: Page, data?: OutputData): Promise<void> => {
      await resetBlok(page);
      await page.waitForFunction(() => typeof window.Blok === 'function');

      await page.evaluate(
        async ({ holder, blokData }) => {
          const blokConfig: Record<string, unknown> = {
            holder: holder,
            // Enable RTL mode
            rtl: true,
          };

          if (blokData) {
            blokConfig.data = blokData;
          }

          const blok = new window.Blok(blokConfig);

          window.blokInstance = blok;
          await blok.isReady;
        },
        {
          holder: HOLDER_ID,
          blokData: data,
        }
      );
    };

    /**
     * Gets the position data for RTL hover zone testing
     */
    const getHoverZonePositionsRTL = async (page: Page): Promise<{
      contentLeft: number;
      contentRight: number;
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
          contentRight: contentRect.right,
          firstBlockTop: firstBlockRect.top,
          firstBlockBottom: firstBlockRect.bottom,
          secondBlockTop: secondBlockRect.top,
          secondBlockBottom: secondBlockRect.bottom,
        };
      });
    };

    test('shows toolbar when hovering in extended zone to the right of content (RTL)', async ({ page }) => {
      await createBlokRTL(page, threeBlocksDataRTL);

      // First hover directly on the second block to establish toolbar there
      const secondParagraph = page.locator(PARAGRAPH_SELECTOR).filter({
        hasText: 'ثاني كتلة',
      });

      await secondParagraph.hover();

      // eslint-disable-next-line playwright/no-wait-for-timeout -- Wait for hover event to process
      await page.waitForTimeout(100);

      // Verify toolbar is positioned at the second block
      const initialBlockId = await getToolbarBlockId(page);

      expect(initialBlockId).toBe('block-rtl-2');

      // Get positions for hover zone calculation
      const positions = await getHoverZonePositionsRTL(page);

      // Now hover in the extended zone (50px RIGHT of content for RTL) at the first block's Y position
      const hoverX = positions.contentRight + 50; // 50px right (inside 100px zone)
      const hoverY = (positions.firstBlockTop + positions.firstBlockBottom) / 2; // Middle of first block

      await page.mouse.move(hoverX, hoverY);

      // eslint-disable-next-line playwright/no-wait-for-timeout -- Wait for hover event to process
      await page.waitForTimeout(100);

      // Verify toolbar moved to the first block
      const newBlockId = await getToolbarBlockId(page);

      expect(newBlockId).toBe('block-rtl-1');
    });

    test('does not trigger hover when cursor is beyond the RTL extended zone boundary', async ({ page }) => {
      await createBlokRTL(page, threeBlocksDataRTL);

      // Get positions first
      const positions = await getHoverZonePositionsRTL(page);

      // Hover in the extended zone to verify it works
      const inZoneX = positions.contentRight + 50; // 50px right (inside 100px zone)
      const blockY = (positions.firstBlockTop + positions.firstBlockBottom) / 2;

      await page.mouse.move(inZoneX, blockY);

      // eslint-disable-next-line playwright/no-wait-for-timeout -- Wait for hover event to process
      await page.waitForTimeout(100);

      // Verify toolbar is on first block (zone hover worked)
      const zoneBlockId = await getToolbarBlockId(page);

      expect(zoneBlockId).toBe('block-rtl-1');

      // Now move far outside the zone (200px right of content, beyond the 100px limit)
      const outsideZoneX = positions.contentRight + 200;

      await page.mouse.move(outsideZoneX, blockY);

      // eslint-disable-next-line playwright/no-wait-for-timeout -- Wait for potential hover event
      await page.waitForTimeout(100);

      // Toolbar should still be on first block (no new block detected outside zone)
      const afterOutsideBlockId = await getToolbarBlockId(page);

      expect(afterOutsideBlockId).toBe('block-rtl-1');
    });

    test('switches between blocks when moving vertically in the RTL extended zone', async ({ page }) => {
      await createBlokRTL(page, threeBlocksDataRTL);

      // Get positions
      const positions = await getHoverZonePositionsRTL(page);

      // Hover in the extended zone at the first block's Y position
      const hoverX = positions.contentRight + 50; // Right side for RTL
      const firstBlockY = (positions.firstBlockTop + positions.firstBlockBottom) / 2;

      await page.mouse.move(hoverX, firstBlockY);

      // eslint-disable-next-line playwright/no-wait-for-timeout -- Wait for hover event to process
      await page.waitForTimeout(100);

      // Verify toolbar is on first block
      let currentBlockId = await getToolbarBlockId(page);

      expect(currentBlockId).toBe('block-rtl-1');

      // Move to the second block's Y position (staying in the extended zone)
      const secondBlockY = (positions.secondBlockTop + positions.secondBlockBottom) / 2;

      await page.mouse.move(hoverX, secondBlockY);

      // eslint-disable-next-line playwright/no-wait-for-timeout -- Wait for hover event to process
      await page.waitForTimeout(100);

      // Verify toolbar moved to second block
      currentBlockId = await getToolbarBlockId(page);
      expect(currentBlockId).toBe('block-rtl-2');
    });
  });

  test.describe('toolbar persistence and full-width hover', () => {
    test('toolbar remains visible when clicking outside the editor', async ({ page }) => {
      const singleBlockData: OutputData = {
        blocks: [
          { id: 'block-persist-1', type: 'paragraph', data: { text: 'Test block' } },
        ],
      };

      await createBlok(page, { data: singleBlockData });

      // First, hover over a block to show the toolbar
      const paragraph = page.locator(`${PARAGRAPH_SELECTOR}[data-blok-id="block-persist-1"]`);
      await paragraph.hover();
      // eslint-disable-next-line playwright/no-wait-for-timeout
      await page.waitForTimeout(100);

      // Verify toolbar is open and visible
      const toolbarStateBefore = await page.evaluate(() => {
        const toolbar = document.querySelector('[data-blok-testid="toolbar"]');
        if (!toolbar) {
          return { hasOpenedAttr: false, isVisible: false, displayValue: null };
        }
        const styles = window.getComputedStyle(toolbar);
        return {
          hasOpenedAttr: toolbar.hasAttribute('data-blok-opened'),
          isVisible: styles.display !== 'none' && styles.visibility !== 'hidden' && styles.opacity !== '0',
          displayValue: styles.display,
        };
      });

      expect(toolbarStateBefore.hasOpenedAttr).toBe(true);
      expect(toolbarStateBefore.isVisible).toBe(true);

      // Click outside the editor (on the body)
      await page.mouse.click(10, 10);

      // Verify toolbar is still visible (this is the desired behavior)
      const toolbarStateAfter = await page.evaluate(() => {
        const toolbar = document.querySelector('[data-blok-testid="toolbar"]');
        if (!toolbar) {
          return { hasOpenedAttr: false, isVisible: false, displayValue: null };
        }
        const styles = window.getComputedStyle(toolbar);
        return {
          hasOpenedAttr: toolbar.hasAttribute('data-blok-opened'),
          isVisible: styles.display !== 'none' && styles.visibility !== 'hidden' && styles.opacity !== '0',
          displayValue: styles.display,
        };
      });

      // The toolbar should remain visible even after clicking outside the editor
      expect(toolbarStateAfter.hasOpenedAttr).toBe(true);
      expect(toolbarStateAfter.isVisible).toBe(true);
    });

    test('toolbar remains visible when clicking to the left of the editor body', async ({ page }) => {
      const singleBlockData: OutputData = {
        blocks: [
          { id: 'block-persist-2', type: 'paragraph', data: { text: 'Test block' } },
        ],
      };

      await createBlok(page, { data: singleBlockData });

      // First, hover over a block to show the toolbar
      const paragraph = page.locator(`${PARAGRAPH_SELECTOR}[data-blok-id="block-persist-2"]`);
      await paragraph.hover();
      // eslint-disable-next-line playwright/no-wait-for-timeout
      await page.waitForTimeout(100);

      // Verify toolbar is open and visible
      const toolbarStateBefore = await page.evaluate(() => {
        const toolbar = document.querySelector('[data-blok-testid="toolbar"]');
        if (!toolbar) {
          return { hasOpenedAttr: false, isVisible: false };
        }
        const styles = window.getComputedStyle(toolbar);
        return {
          hasOpenedAttr: toolbar.hasAttribute('data-blok-opened'),
          isVisible: styles.display !== 'none' && styles.visibility !== 'hidden' && styles.opacity !== '0',
        };
      });

      expect(toolbarStateBefore.hasOpenedAttr).toBe(true);
      expect(toolbarStateBefore.isVisible).toBe(true);

      // Get the redactor's position and click to the left of it
      const clickPosition = await page.evaluate(() => {
        const redactor = document.querySelector('[data-blok-testid="redactor"]');
        if (!redactor) {
          return { x: 10, y: 100 };
        }
        const rect = redactor.getBoundingClientRect();

        // Determine click position: try to click to the left of the redactor
        // If the redactor is too close to the left edge, we'll click on the left side
        // of the redactor itself (which should still be outside the content area)
        let clickX: number;
        if (rect.left > 50) {
          clickX = rect.left - 50; // 50px to the left
        } else {
          // Redactor is close to left edge, click just to the left of its left boundary
          clickX = Math.max(5, rect.left - 10);
        }

        const clickY = rect.top + rect.height / 2; // At vertical center

        return { x: clickX, y: clickY };
      });

      // Click to the left of the editor (same vertical level as content)
      await page.mouse.click(clickPosition.x, clickPosition.y);

      // Verify toolbar is still visible after clicking to the left
      const toolbarStateAfter = await page.evaluate(() => {
        const toolbar = document.querySelector('[data-blok-testid="toolbar"]');
        if (!toolbar) {
          return { hasOpenedAttr: false, isVisible: false };
        }
        const styles = window.getComputedStyle(toolbar);
        return {
          hasOpenedAttr: toolbar.hasAttribute('data-blok-opened'),
          isVisible: styles.display !== 'none' && styles.visibility !== 'hidden' && styles.opacity !== '0',
        };
      });

      // The toolbar should remain visible even after clicking to the left of the editor
      expect(toolbarStateAfter.hasOpenedAttr).toBe(true);
      expect(toolbarStateAfter.isVisible).toBe(true);
    });

    test('toolbar follows hover across the entire editor width (both sides)', async ({ page }) => {
      const threeBlocksData: OutputData = {
        blocks: [
          { id: 'block-hover-1', type: 'paragraph', data: { text: 'First block' } },
          { id: 'block-hover-2', type: 'paragraph', data: { text: 'Second block' } },
          { id: 'block-hover-3', type: 'paragraph', data: { text: 'Third block' } },
        ],
      };

      await createBlok(page, { data: threeBlocksData });

      // Get layout information
      const positions = await page.evaluate(() => {
        const blocks = document.querySelectorAll('[data-blok-testid="block-wrapper"]');
        if (!blocks[0] || !blocks[2]) throw new Error('Blocks not found');

        const redactor = document.querySelector('[data-blok-testid="redactor"]');
        if (!redactor) throw new Error('Redactor not found');

        const redactorRect = redactor.getBoundingClientRect();
        const firstBlockRect = blocks[0].getBoundingClientRect();
        const thirdBlockRect = blocks[2].getBoundingClientRect();

        return {
          redactorLeft: redactorRect.left,
          redactorRight: redactorRect.right,
          redactorCenter: (redactorRect.left + redactorRect.right) / 2,
          firstBlockY: (firstBlockRect.top + firstBlockRect.bottom) / 2,
          thirdBlockY: (thirdBlockRect.top + thirdBlockRect.bottom) / 2,
        };
      });

      // Test 1: Hover at the far right edge of the redactor
      await page.mouse.move(positions.redactorRight - 20, positions.firstBlockY);
      // eslint-disable-next-line playwright/no-wait-for-timeout
      await page.waitForTimeout(100);

      const toolbarBlockId1 = await getToolbarBlockId(page);
      const toolbarOpened1 = await page.evaluate(() => {
        const toolbar = document.querySelector('[data-blok-testid="toolbar"]');
        return toolbar?.hasAttribute('data-blok-opened') ?? false;
      });

      // Toolbar should be shown when hovering at the right edge of the editor
      expect(toolbarOpened1).toBe(true);
      expect(toolbarBlockId1).toBe('block-hover-1');

      // Test 2: Hover at the center of the redactor (over content area)
      await page.mouse.move(positions.redactorCenter, positions.thirdBlockY);
      // eslint-disable-next-line playwright/no-wait-for-timeout
      await page.waitForTimeout(100);

      const toolbarBlockId2 = await getToolbarBlockId(page);
      const toolbarOpened2 = await page.evaluate(() => {
        const toolbar = document.querySelector('[data-blok-testid="toolbar"]');
        return toolbar?.hasAttribute('data-blok-opened') ?? false;
      });

      // Toolbar should be shown when hovering at the center
      expect(toolbarOpened2).toBe(true);
      expect(toolbarBlockId2).toBe('block-hover-3');

      // Test 3: Hover at the far right edge on the third block
      await page.mouse.move(positions.redactorRight - 20, positions.thirdBlockY);
      // eslint-disable-next-line playwright/no-wait-for-timeout
      await page.waitForTimeout(100);

      const toolbarBlockId3 = await getToolbarBlockId(page);
      const toolbarOpened3 = await page.evaluate(() => {
        const toolbar = document.querySelector('[data-blok-testid="toolbar"]');
        return toolbar?.hasAttribute('data-blok-opened') ?? false;
      });

      // Toolbar should follow to the third block when hovering at right edge
      expect(toolbarOpened3).toBe(true);
      expect(toolbarBlockId3).toBe('block-hover-3');
    });

    test('rubber band selection works and toolbar does not close when starting from left margin', async ({ page }) => {
      const threeBlocksData: OutputData = {
        blocks: [
          { id: 'block-rubber-1', type: 'paragraph', data: { text: 'First block' } },
          { id: 'block-rubber-2', type: 'paragraph', data: { text: 'Second block' } },
          { id: 'block-rubber-3', type: 'paragraph', data: { text: 'Third block' } },
        ],
      };

      await createBlok(page, { data: threeBlocksData });

      const firstBlock = page.locator(`${PARAGRAPH_SELECTOR}[data-blok-id="block-rubber-1"]`);
      const thirdBlock = page.locator(`${PARAGRAPH_SELECTOR}[data-blok-id="block-rubber-3"]`);

      const firstBox = await getRequiredBoundingBox(firstBlock);
      const thirdBox = await getRequiredBoundingBox(thirdBlock);

      // First, hover to show the toolbar
      await firstBlock.hover();
      // eslint-disable-next-line playwright/no-wait-for-timeout
      await page.waitForTimeout(100);

      const toolbarOpenedBefore = await page.evaluate(() => {
        const toolbar = document.querySelector('[data-blok-testid="toolbar"]');
        return toolbar?.hasAttribute('data-blok-opened') ?? false;
      });

      expect(toolbarOpenedBefore).toBe(true);

      // Start rubber band selection from left margin (x=10)
      const startX = 10;
      const startY = firstBox.y + firstBox.height / 2;

      await page.mouse.move(startX, startY);
      await page.mouse.down();

      // Drag across to the third block
      const endX = thirdBox.x + thirdBox.width + 50; // Well past the right edge of third block
      const endY = thirdBox.y + thirdBox.height / 2;

      await page.mouse.move(endX, endY, { steps: 10 });

      // Trigger one more single-pixel move to ensure the final position is fully processed
      await page.mouse.move(endX + 1, endY);

      // Verify blocks are selected
      await expect(firstBlock).toHaveAttribute('data-blok-selected', 'true');
      await expect(thirdBlock).toHaveAttribute('data-blok-selected', 'true');

      // Note: The toolbar might be hidden during the drag (which is expected),
      // but the key is that starting from outside doesn't break the selection

      // Release mouse - this should complete the selection
      await page.mouse.up();

      // After mouse up with multiple blocks selected, toolbar should appear for multi-block selection
      const toolbarOpenedAfter = await page.evaluate(() => {
        const toolbar = document.querySelector('[data-blok-testid="toolbar"]');
        return toolbar?.hasAttribute('data-blok-opened') ?? false;
      });

      // Toolbar should be open after completing multi-block selection
      expect(toolbarOpenedAfter).toBe(true);
    });

    test('toolbar closes when starting rubber band selection from inside editor horizontally', async ({ page }) => {
      // Create a centered editor with margins
      await page.evaluate(async ({ holder }) => {
        const existingHolder = document.getElementById(holder);
        if (existingHolder) {
          existingHolder.remove();
        }

        const container = document.createElement('div');
        container.id = holder;
        container.setAttribute('data-blok-testid', holder);
        // Center the editor with a fixed width to create left/right margins
        container.style.width = '400px';
        container.style.margin = '0 auto';
        container.style.border = '1px dotted #388AE5';

        document.body.appendChild(container);

        // Initialize Blok
        const blok = new window.Blok({
          holder: holder,
          data: {
            blocks: [
              { type: 'paragraph', data: { text: 'First block' } },
              { type: 'paragraph', data: { text: 'Second block' } },
              { type: 'paragraph', data: { text: 'Third block' } },
            ],
          },
        });

        await blok.isReady;
        window.blokInstance = blok;
      }, { holder: HOLDER_ID });

      // eslint-disable-next-line playwright/no-wait-for-timeout
      await page.waitForTimeout(200);

      // Get the first block using a specific text filter
      const firstBlock = page.locator(PARAGRAPH_SELECTOR).filter({
        hasText: 'First block',
      });

      // Hover to show the toolbar
      await firstBlock.hover();
      // eslint-disable-next-line playwright/no-wait-for-timeout
      await page.waitForTimeout(100);

      const toolbarOpenedBefore = await page.evaluate(() => {
        const toolbar = document.querySelector('[data-blok-testid="toolbar"]');
        return toolbar?.hasAttribute('data-blok-opened') ?? false;
      });

      expect(toolbarOpenedBefore).toBe(true);

      // Get the position to start selection - use the toolbar position which is inside the redactor
      // Using locators for auto-waiting and better error messages
      const toolbarLocator = page.locator('[data-blok-testid="toolbar"]');
      const redactorLocator = page.locator('[data-blok-testid="redactor"]');

      const toolbarBox = await getRequiredBoundingBox(toolbarLocator);
      const redactorBox = await getRequiredBoundingBox(redactorLocator);

      const startPos = {
        x: toolbarBox.x + toolbarBox.width / 2, // Center of toolbar (inside redactor)
        y: redactorBox.y + 50, // Near top of redactor
      };

      // Start selection from inside the redactor (toolbar position)
      await page.mouse.move(startPos.x, startPos.y);
      await page.mouse.down();

      // Move to right margin to trigger rectangle selection
      await page.mouse.move(startPos.x + 300, startPos.y + 100, { steps: 10 });

      // Trigger one more single-pixel move
      await page.mouse.move(startPos.x + 301, startPos.y + 100);

      // When starting from inside the editor horizontally, toolbar should close
      const toolbarOpenedDuring = await page.evaluate(() => {
        const toolbar = document.querySelector('[data-blok-testid="toolbar"]');
        return toolbar?.hasAttribute('data-blok-opened') ?? false;
      });

      // Toolbar should be closed when selection starts from inside horizontal bounds
      expect(toolbarOpenedDuring).toBe(false);

      await page.mouse.up();
    });
  });
});
