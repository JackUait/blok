import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { nanoid } from 'nanoid';

import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const PLUS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="plus-button"]`;
const TOOLBOX_ITEM_SELECTOR = (itemName: string): string =>
  `[data-blok-testid="popover-item"][data-blok-item-name=${itemName}]`;

type SerializableToolConfig = {
  className?: string;
  classCode?: string;
  config?: Record<string, unknown>;
};

type CreateBlokOptions = {
  data?: OutputData;
  tools?: Record<string, SerializableToolConfig>;
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
  const { data = null, tools = {} } = options;

  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  const serializedTools = Object.entries(tools).map(([name, tool]) => {
    return {
      name,
      className: tool.className ?? null,
      classCode: tool.classCode ?? null,
      config: tool.config ?? {},
    };
  });

  await page.evaluate(
    async ({ holder, data: initialData, serializedTools: toolsConfig }) => {
      const blokConfig: Record<string, unknown> = {
        holder: holder,
      };

      if (initialData) {
        blokConfig.data = initialData;
      }

      if (toolsConfig.length > 0) {
        const resolvedTools = toolsConfig.reduce<Record<string, { class: unknown } & Record<string, unknown>>>(
          (accumulator, { name, className, classCode, config }) => {
            let toolClass: unknown = null;

            if (className) {
              // Handle dot notation (e.g., 'Blok.Header')
              toolClass = className.split('.').reduce(
                (obj: unknown, key: string) => (obj as Record<string, unknown>)?.[key],
                window
              ) ?? null;
            }

            if (!toolClass && classCode) {
               
              toolClass = new Function(`return (${classCode});`)();
            }

            if (!toolClass) {
              throw new Error(`Tool "${name}" is not available globally`);
            }

            return {
              ...accumulator,
              [name]: {
                class: toolClass,
                ...config,
              },
            };
          },
          {}
        );

        blokConfig.tools = resolvedTools;
      }

      const blok = new window.Blok(blokConfig);

      window.blokInstance = blok;
      await blok.isReady;
    },
    {
      holder: HOLDER_ID,
      data,
      serializedTools,
    }
  );
};

const saveBlok = async (page: Page): Promise<OutputData> => {
  return await page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('Blok instance not found');
    }

    return await window.blokInstance.save();
  });
};

/**
 * Ensures that the provided value is a string.
 * @param value - Value to validate.
 * @param errorMessage - Message for the thrown error when validation fails.
 */
const assertIsString: (value: unknown, errorMessage: string) => asserts value is string = (
  value,
  errorMessage
) => {
  if (typeof value !== 'string') {
    throw new Error(errorMessage);
  }
};

const getBlockIdByIndex = async (page: Page, blockIndex: number): Promise<string> => {
  return await page.evaluate((index) => {
    const blok = window.blokInstance;

    if (!blok) {
      throw new Error('Blok instance not found');
    }

    const block = blok.blocks.getBlockByIndex(index);

    if (!block) {
      throw new Error(`Block at index ${index} was not found`);
    }

    const { id } = block;

    if (typeof id !== 'string') {
      throw new Error(`Block id at index ${index} is not a string`);
    }

    return id;
  }, blockIndex);
};

const getLastBlockId = async (page: Page): Promise<string> => {
  const blocksCount = await page.evaluate(() => {
    const blok = window.blokInstance;

    if (!blok) {
      throw new Error('Blok instance not found');
    }

    return blok.blocks.getBlocksCount();
  });

  if (blocksCount <= 0) {
    throw new Error('Blok does not contain any blocks');
  }

  return await getBlockIdByIndex(page, blocksCount - 1);
};

test.describe('block ids', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('generates unique ids for new blocks', async ({ page }) => {
    await createBlok(page, {
      tools: {
        header: {
          className: 'Blok.Header',
        },
      },
    });

    const firstParagraphId = await getBlockIdByIndex(page, 0);
    const firstParagraph = page.locator(
      `${BLOK_INTERFACE_SELECTOR} [data-blok-id="${firstParagraphId}"][data-blok-component="paragraph"] [contenteditable]`
    );

    await firstParagraph.click();
    await page.keyboard.type('First block ');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second block ');
    await page.keyboard.press('Enter');

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await plusButton.click();
    await page.locator(TOOLBOX_ITEM_SELECTOR('header')).click();

    const headerBlockId = await getLastBlockId(page);
    const headerBlock = page.locator(
      `${BLOK_INTERFACE_SELECTOR} [data-blok-id="${headerBlockId}"][data-blok-component="header"] [contenteditable]`
    );

    await headerBlock.click();
    await page.keyboard.type('Header');

    const { blocks } = await saveBlok(page);
    const blockIds = blocks.map((block) => block.id);

    expect(blocks).not.toHaveLength(0);
    for (const block of blocks) {
      expect(typeof block.id).toBe('string');
    }
    expect(new Set(blockIds).size).toBe(blockIds.length);
  });

  test('preserves provided block ids', async ({ page }) => {
    const blocks: OutputData['blocks'] = [
      {
        id: nanoid(),
        type: 'paragraph',
        data: {
          text: 'First block',
        },
      },
      {
        id: nanoid(),
        type: 'paragraph',
        data: {
          text: 'Second block',
        },
      },
    ];

    await createBlok(page, {
      data: {
        blocks,
      },
    });

    const { blocks: savedBlocks } = await saveBlok(page);

    expect(savedBlocks).toHaveLength(blocks.length);
    savedBlocks.forEach((block, index) => {
      expect(block.id).toBe(blocks[index]?.id);
    });
  });

  test('preserves provided ids when new block is added', async ({ page }) => {
    const blocks: OutputData['blocks'] = [
      {
        id: nanoid(),
        type: 'paragraph',
        data: {
          text: 'First block',
        },
      },
      {
        id: nanoid(),
        type: 'paragraph',
        data: {
          text: 'Second block',
        },
      },
    ];

    await createBlok(page, {
      data: {
        blocks,
      },
    });

    const firstParagraphId = blocks[0]?.id;

    assertIsString(firstParagraphId, 'First block id was not provided');

    const firstParagraph = page.locator(
      `${BLOK_INTERFACE_SELECTOR} [data-blok-id="${firstParagraphId}"][data-blok-component="paragraph"] [contenteditable]`
    );

    await firstParagraph.click();
    await page.keyboard.press('Enter');
    await page.keyboard.type('Middle block');

    const { blocks: savedBlocks } = await saveBlok(page);

    expect(savedBlocks).toHaveLength(3);
    expect(savedBlocks[0]?.id).toBe(blocks[0]?.id);
    expect(savedBlocks[2]?.id).toBe(blocks[1]?.id);
  });

  test('exposes block id on wrapper via data-blok-id attribute', async ({ page }) => {
    const blocks: OutputData['blocks'] = [
      {
        id: nanoid(),
        type: 'paragraph',
        data: {
          text: 'First block',
        },
      },
      {
        id: nanoid(),
        type: 'paragraph',
        data: {
          text: 'Second block',
        },
      },
    ];

    await createBlok(page, {
      data: {
        blocks,
      },
    });

    const blockWrappers = page.locator(BLOCK_SELECTOR);

    await expect(blockWrappers).toHaveCount(blocks.length);

    const blockHandles = await blockWrappers.elementHandles();

    await Promise.all(
      blockHandles.map((handle, index) => {
        return handle.evaluate((element, expectedId) => {
          if (!(element instanceof HTMLElement)) {
            throw new Error('Block wrapper is not an HTMLElement');
          }

          const dataId = element.getAttribute('data-blok-id');

          if (dataId !== expectedId) {
            throw new Error(`Expected block data-blok-id to equal "${expectedId}", but received "${dataId}"`);
          }
        }, blocks[index]?.id);
      })
    );
  });
});


