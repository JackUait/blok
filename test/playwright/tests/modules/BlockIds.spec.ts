import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { nanoid } from 'nanoid';

import type EditorJS from '@/types';
import type { OutputData } from '@/types';
import { ensureEditorBundleBuilt } from '../helpers/ensure-build';
import { EDITOR_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HEADER_TOOL_UMD_PATH = path.resolve(
  __dirname,
  '../../../../node_modules/@editorjs/header/dist/header.umd.js'
);

const HOLDER_ID = 'editorjs';
const BLOCK_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} .ce-block`;
const PLUS_BUTTON_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} .ce-toolbar__plus`;
const TOOLBOX_ITEM_SELECTOR = (itemName: string): string =>
  `.ce-popover-item[data-item-name=${itemName}]`;

type SerializableToolConfig = {
  className?: string;
  classCode?: string;
  config?: Record<string, unknown>;
};

type CreateEditorOptions = {
  data?: OutputData;
  tools?: Record<string, SerializableToolConfig>;
};

declare global {
  interface Window {
    editorInstance?: EditorJS;
  }
}

const resetEditor = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holderId }) => {
    if (window.editorInstance) {
      await window.editorInstance.destroy?.();
      window.editorInstance = undefined;
    }

    document.getElementById(holderId)?.remove();

    const container = document.createElement('div');

    container.id = holderId;
    container.dataset.cy = holderId;
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holderId: HOLDER_ID });
};

const createEditor = async (page: Page, options: CreateEditorOptions = {}): Promise<void> => {
  const { data = null, tools = {} } = options;

  await resetEditor(page);
  await page.waitForFunction(() => typeof window.EditorJS === 'function');

  const serializedTools = Object.entries(tools).map(([name, tool]) => {
    return {
      name,
      className: tool.className ?? null,
      classCode: tool.classCode ?? null,
      config: tool.config ?? {},
    };
  });

  await page.evaluate(
    async ({ holderId, data: initialData, serializedTools: toolsConfig }) => {
      const editorConfig: Record<string, unknown> = {
        holder: holderId,
      };

      if (initialData) {
        editorConfig.data = initialData;
      }

      if (toolsConfig.length > 0) {
        const resolvedTools = toolsConfig.reduce<Record<string, { class: unknown } & Record<string, unknown>>>(
          (accumulator, { name, className, classCode, config }) => {
            let toolClass: unknown = null;

            if (className) {
              toolClass = (window as unknown as Record<string, unknown>)[className] ?? null;
            }

            if (!toolClass && classCode) {
              // eslint-disable-next-line no-new-func -- evaluated in browser context to reconstruct tool class
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

        editorConfig.tools = resolvedTools;
      }

      const editor = new window.EditorJS(editorConfig);

      window.editorInstance = editor;
      await editor.isReady;
    },
    {
      holderId: HOLDER_ID,
      data,
      serializedTools,
    }
  );
};

const saveEditor = async (page: Page): Promise<OutputData> => {
  return await page.evaluate(async () => {
    if (!window.editorInstance) {
      throw new Error('Editor instance not found');
    }

    return await window.editorInstance.save();
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
    const editor = window.editorInstance;

    if (!editor) {
      throw new Error('Editor instance not found');
    }

    const block = editor.blocks.getBlockByIndex(index);

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
    const editor = window.editorInstance;

    if (!editor) {
      throw new Error('Editor instance not found');
    }

    return editor.blocks.getBlocksCount();
  });

  if (blocksCount <= 0) {
    throw new Error('Editor does not contain any blocks');
  }

  return await getBlockIdByIndex(page, blocksCount - 1);
};

test.describe('block ids', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('generates unique ids for new blocks', async ({ page }) => {
    await page.addScriptTag({ path: HEADER_TOOL_UMD_PATH });

    await createEditor(page, {
      tools: {
        header: {
          className: 'Header',
        },
      },
    });

    const firstParagraphId = await getBlockIdByIndex(page, 0);
    const firstParagraph = page.locator(
      `${EDITOR_INTERFACE_SELECTOR} [data-id="${firstParagraphId}"] [data-block-tool="paragraph"]`
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
      `${EDITOR_INTERFACE_SELECTOR} [data-id="${headerBlockId}"] [data-block-tool="header"]`
    );

    await headerBlock.click();
    await page.keyboard.type('Header');

    const { blocks } = await saveEditor(page);
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

    await createEditor(page, {
      data: {
        blocks,
      },
    });

    const { blocks: savedBlocks } = await saveEditor(page);

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

    await createEditor(page, {
      data: {
        blocks,
      },
    });

    const firstParagraphId = blocks[0]?.id;

    assertIsString(firstParagraphId, 'First block id was not provided');

    const firstParagraph = page.locator(
      `${EDITOR_INTERFACE_SELECTOR} [data-id="${firstParagraphId}"] [data-block-tool="paragraph"]`
    );

    await firstParagraph.click();
    await page.keyboard.press('Enter');
    await page.keyboard.type('Middle block');

    const { blocks: savedBlocks } = await saveEditor(page);

    expect(savedBlocks).toHaveLength(3);
    expect(savedBlocks[0]?.id).toBe(blocks[0]?.id);
    expect(savedBlocks[2]?.id).toBe(blocks[1]?.id);
  });

  test('exposes block id on wrapper via data-id attribute', async ({ page }) => {
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

    await createEditor(page, {
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

          const dataId = element.getAttribute('data-id');

          if (dataId !== expectedId) {
            throw new Error(`Expected block data-id to equal "${expectedId}", but received "${dataId}"`);
          }
        }, blocks[index]?.id);
      })
    );
  });
});


