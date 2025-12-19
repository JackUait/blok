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
});

