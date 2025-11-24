import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EDITOR_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureEditorBundleBuilt } from '../helpers/ensure-build';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'editorjs';
const BLOCK_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} .ce-block`;
const BLOCK_SELECTED_CLASS = 'ce-block--selected';

type ToolDefinition = {
  name: string;
  classSource: string;
  config?: Record<string, unknown>;
};

type EditorSetupOptions = {
  data?: Record<string, unknown>;
  config?: Record<string, unknown>;
  tools?: ToolDefinition[];
};

const resetEditor = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holderId }) => {
    if (window.editorInstance) {
      await window.editorInstance.destroy?.();
      window.editorInstance = undefined;
    }

    document.getElementById(holderId)?.remove();

    const container = document.createElement('div');

    container.id = holderId;
    container.dataset.testid = holderId;
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holderId: HOLDER_ID });
};

const createEditor = async (page: Page, options: EditorSetupOptions = {}): Promise<void> => {
  const { data, config, tools = [] } = options;

  await resetEditor(page);

  await page.evaluate(
    async ({ holderId, rawData, rawConfig, serializedTools }) => {
      const reviveToolClass = (classSource: string): unknown => {
        return new Function(`return (${classSource});`)();
      };

      const revivedTools = serializedTools.reduce<Record<string, unknown>>((accumulator, toolConfig) => {
        const revivedClass = reviveToolClass(toolConfig.classSource);

        return {
          ...accumulator,
          [toolConfig.name]: toolConfig.config
            ? {
              ...toolConfig.config,
              class: revivedClass,
            }
            : revivedClass,
        };
      }, {});

      const editorConfig = {
        holder: holderId,
        ...rawConfig,
        ...(serializedTools.length > 0 ? { tools: revivedTools } : {}),
        ...(rawData ? { data: rawData } : {}),
      };

      const editor = new window.EditorJS(editorConfig);

      window.editorInstance = editor;
      await editor.isReady;
    },
    {
      holderId: HOLDER_ID,
      rawData: data ?? null,
      rawConfig: config ?? {},
      serializedTools: tools,
    }
  );
};

const clearSelection = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    window.getSelection()?.removeAllRanges();

    const activeElement = document.activeElement as HTMLElement | null;

    activeElement?.blur?.();
  });
};

const createParagraphBlock = (id: string, text: string): Record<string, unknown> => {
  return {
    id,
    type: 'paragraph',
    data: { text },
  };
};

const NonFocusableBlockTool = class {
  /**
   *
   */
  public static get toolbox(): { title: string } {
    return {
      title: 'Static',
    };
  }

  /**
   *
   */
  public render(): HTMLElement {
    const wrapper = document.createElement('div');

    wrapper.textContent = 'Static block without inputs';

    return wrapper;
  }

  /**
   *
   */
  public save(): Record<string, never> {
    return {};
  }
};

const NON_FOCUSABLE_TOOL_SOURCE = NonFocusableBlockTool.toString();

test.describe('caret API', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test.describe('.setToBlock', () => {
    test('sets caret to a block when block index is passed', async ({ page }) => {
      const blockId = 'block-index';
      const paragraphBlock = createParagraphBlock(blockId, 'The first block content mock.');

      await createEditor(page, {
        data: {
          blocks: [ paragraphBlock ],
        },
      });

      await clearSelection(page);

      const result = await page.evaluate(({ blockSelector }) => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        const returnedValue = window.editorInstance.caret.setToBlock(0);
        const selection = window.getSelection();
        const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
        const blockElement = document.querySelectorAll(blockSelector).item(0) as HTMLElement | null;

        return {
          returnedValue,
          rangeExists: !!range,
          selectionInBlock: !!(range && blockElement && blockElement.contains(range.startContainer)),
        };
      }, { blockSelector: BLOCK_SELECTOR });

      expect(result.returnedValue).toBe(true);
      expect(result.rangeExists).toBe(true);
      expect(result.selectionInBlock).toBe(true);
    });

    test('sets caret to a block when block id is passed', async ({ page }) => {
      const blockId = 'block-id';
      const paragraphBlock = createParagraphBlock(blockId, 'Paragraph content.');

      await createEditor(page, {
        data: {
          blocks: [ paragraphBlock ],
        },
      });

      await clearSelection(page);

      const result = await page.evaluate(({ blockSelector, id }) => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        const returnedValue = window.editorInstance.caret.setToBlock(id);
        const selection = window.getSelection();
        const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
        const blockElement = document.querySelectorAll(blockSelector).item(0) as HTMLElement | null;

        return {
          returnedValue,
          rangeExists: !!range,
          selectionInBlock: !!(range && blockElement && blockElement.contains(range.startContainer)),
        };
      }, { blockSelector: BLOCK_SELECTOR,
        id: blockId });

      expect(result.returnedValue).toBe(true);
      expect(result.rangeExists).toBe(true);
      expect(result.selectionInBlock).toBe(true);
    });

    test('sets caret to a block when Block API is passed', async ({ page }) => {
      const blockId = 'block-api';
      const paragraphBlock = createParagraphBlock(blockId, 'Paragraph api block.');

      await createEditor(page, {
        data: {
          blocks: [ paragraphBlock ],
        },
      });

      await clearSelection(page);

      const result = await page.evaluate(({ blockSelector }) => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        const block = window.editorInstance.blocks.getBlockByIndex(0);

        if (!block) {
          throw new Error('Block not found');
        }

        const returnedValue = window.editorInstance.caret.setToBlock(block);
        const selection = window.getSelection();
        const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
        const blockElement = document.querySelectorAll(blockSelector).item(0) as HTMLElement | null;

        return {
          returnedValue,
          rangeExists: !!range,
          selectionInBlock: !!(range && blockElement && blockElement.contains(range.startContainer)),
        };
      }, { blockSelector: BLOCK_SELECTOR });

      expect(result.returnedValue).toBe(true);
      expect(result.rangeExists).toBe(true);
      expect(result.selectionInBlock).toBe(true);
    });

    test('sets caret at specific offset in text content', async ({ page }) => {
      const blockId = 'offset-text';
      const paragraphBlock = createParagraphBlock(blockId, 'Plain text content.');

      await createEditor(page, {
        data: {
          blocks: [ paragraphBlock ],
        },
      });

      await clearSelection(page);

      const result = await page.evaluate(({ id, offset }) => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        const block = window.editorInstance.blocks.getById(id);

        if (!block) {
          throw new Error('Block not found');
        }

        window.editorInstance.caret.setToBlock(block, 'default', offset);

        const selection = window.getSelection();

        if (!selection || selection.rangeCount === 0) {
          throw new Error('Selection was not set');
        }

        const range = selection.getRangeAt(0);

        return {
          startOffset: range.startOffset,
          startContainerText: range.startContainer.textContent,
        };
      }, { id: blockId,
        offset: 5 });

      expect(result.startOffset).toBe(5);
      expect(result.startContainerText).toBe('Plain text content.');
    });

    test('sets caret at correct offset when text contains HTML elements', async ({ page }) => {
      const blockId = 'offset-html';
      const paragraphBlock = createParagraphBlock(blockId, '1234<b>567</b>!');

      await createEditor(page, {
        data: {
          blocks: [ paragraphBlock ],
        },
      });

      await clearSelection(page);

      const result = await page.evaluate(({ id, offset }) => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        const block = window.editorInstance.blocks.getById(id);

        if (!block) {
          throw new Error('Block not found');
        }

        window.editorInstance.caret.setToBlock(block, 'default', offset);

        const selection = window.getSelection();

        if (!selection || selection.rangeCount === 0) {
          throw new Error('Selection was not set');
        }

        const range = selection.getRangeAt(0);

        return {
          startOffset: range.startOffset,
          startContainerText: range.startContainer.textContent,
        };
      }, { id: blockId,
        offset: 6 });

      expect(result.startContainerText).toBe('567');
      expect(result.startOffset).toBe(2);
    });

    test('limits caret position to the end when offset exceeds content length', async ({ page }) => {
      const blockId = 'offset-beyond';
      const paragraphBlock = createParagraphBlock(blockId, '1234567890');

      await createEditor(page, {
        data: {
          blocks: [ paragraphBlock ],
        },
      });

      await clearSelection(page);

      const contentLength = '1234567890'.length;

      const result = await page.evaluate(({ id, offset }) => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        const block = window.editorInstance.blocks.getById(id);

        if (!block) {
          throw new Error('Block not found');
        }

        window.editorInstance.caret.setToBlock(block, 'default', offset);

        const selection = window.getSelection();

        if (!selection || selection.rangeCount === 0) {
          throw new Error('Selection was not set');
        }

        const range = selection.getRangeAt(0);

        return {
          startOffset: range.startOffset,
        };
      }, { id: blockId,
        offset: contentLength + 10 });

      expect(result.startOffset).toBe(contentLength);
    });

    test('handles offsets within nested HTML structure', async ({ page }) => {
      const blockId = 'offset-nested';
      const paragraphBlock = createParagraphBlock(blockId, '123<b>456<i>789</i></b>!');

      await createEditor(page, {
        data: {
          blocks: [ paragraphBlock ],
        },
      });

      await clearSelection(page);

      const result = await page.evaluate(({ id, offset }) => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        const block = window.editorInstance.blocks.getById(id);

        if (!block) {
          throw new Error('Block not found');
        }

        window.editorInstance.caret.setToBlock(block, 'default', offset);

        const selection = window.getSelection();

        if (!selection || selection.rangeCount === 0) {
          throw new Error('Selection was not set');
        }

        const range = selection.getRangeAt(0);

        return {
          startOffset: range.startOffset,
          startContainerText: range.startContainer.textContent,
        };
      }, { id: blockId,
        offset: 8 });

      expect(result.startContainerText).toBe('789');
      expect(result.startOffset).toBe(2);
    });

    test('respects "start" position regardless of provided offset', async ({ page }) => {
      const blockId = 'position-start';
      const paragraphBlock = createParagraphBlock(blockId, 'Starts at the beginning.');

      await createEditor(page, {
        data: {
          blocks: [ paragraphBlock ],
        },
      });

      await clearSelection(page);

      const result = await page.evaluate(({ id, offset }) => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        const block = window.editorInstance.blocks.getById(id);

        if (!block) {
          throw new Error('Block not found');
        }

        window.editorInstance.caret.setToBlock(block, 'start', offset);

        const selection = window.getSelection();

        if (!selection || selection.rangeCount === 0) {
          throw new Error('Selection was not set');
        }

        const range = selection.getRangeAt(0);

        return {
          startOffset: range.startOffset,
          startContainerText: range.startContainer.textContent,
        };
      }, { id: blockId,
        offset: 10 });

      expect(result.startOffset).toBe(0);
      expect(result.startContainerText).toBe('Starts at the beginning.');
    });

    test('places caret at the last text node when "end" position is used', async ({ page }) => {
      const blockId = 'position-end';
      const paragraphBlock = createParagraphBlock(blockId, 'Hello <b>world</b>!');

      await createEditor(page, {
        data: {
          blocks: [ paragraphBlock ],
        },
      });

      await clearSelection(page);

      const result = await page.evaluate(({ id }) => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        const block = window.editorInstance.blocks.getById(id);

        if (!block) {
          throw new Error('Block not found');
        }

        window.editorInstance.caret.setToBlock(block, 'end');

        const selection = window.getSelection();

        if (!selection || selection.rangeCount === 0) {
          throw new Error('Selection was not set');
        }

        const range = selection.getRangeAt(0);

        return {
          startOffset: range.startOffset,
          startContainerText: range.startContainer.textContent,
        };
      }, { id: blockId });

      expect(result.startContainerText).toBe('world');
      expect(result.startOffset).toBe('world'.length);
    });

    test('does not change selection when block index cannot be resolved', async ({ page }) => {
      const blockId = 'invalid-index';
      const paragraphBlock = createParagraphBlock(blockId, 'Block index invalid.');

      await createEditor(page, {
        data: {
          blocks: [ paragraphBlock ],
        },
      });

      await clearSelection(page);

      const result = await page.evaluate(({ blockSelector, selectedClass }) => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        window.getSelection()?.removeAllRanges();

        const returnedValue = window.editorInstance.caret.setToBlock(99);
        const selection = window.getSelection();
        const selectedBlocks = document.querySelectorAll(`${blockSelector}.${selectedClass}`).length;

        return {
          returnedValue,
          rangeCount: selection?.rangeCount ?? 0,
          selectedBlocks,
        };
      }, { blockSelector: BLOCK_SELECTOR,
        selectedClass: BLOCK_SELECTED_CLASS });

      expect(result.returnedValue).toBe(false);
      expect(result.rangeCount).toBe(0);
      expect(result.selectedBlocks).toBe(0);
    });

    test('does not change selection when block id cannot be resolved', async ({ page }) => {
      const blockId = 'invalid-id';
      const paragraphBlock = createParagraphBlock(blockId, 'Block id invalid.');

      await createEditor(page, {
        data: {
          blocks: [ paragraphBlock ],
        },
      });

      await clearSelection(page);

      const result = await page.evaluate(({ blockSelector, selectedClass }) => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        window.getSelection()?.removeAllRanges();

        const returnedValue = window.editorInstance.caret.setToBlock('missing-block-id');
        const selection = window.getSelection();
        const selectedBlocks = document.querySelectorAll(`${blockSelector}.${selectedClass}`).length;

        return {
          returnedValue,
          rangeCount: selection?.rangeCount ?? 0,
          selectedBlocks,
        };
      }, { blockSelector: BLOCK_SELECTOR,
        selectedClass: BLOCK_SELECTED_CLASS });

      expect(result.returnedValue).toBe(false);
      expect(result.rangeCount).toBe(0);
      expect(result.selectedBlocks).toBe(0);
    });

    test('does not change selection when Block API instance is stale', async ({ page }) => {
      const paragraphBlock = createParagraphBlock('stale-block', 'Block api stale.');

      await createEditor(page, {
        data: {
          blocks: [paragraphBlock, createParagraphBlock('second-block', 'Second block')],
        },
      });

      await clearSelection(page);

      const result = await page.evaluate(({ blockSelector, selectedClass }) => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        const block = window.editorInstance.blocks.getBlockByIndex(0);

        if (!block) {
          throw new Error('Block not found');
        }

        window.editorInstance.blocks.delete(0);
        window.getSelection()?.removeAllRanges();

        const returnedValue = window.editorInstance.caret.setToBlock(block);
        const selection = window.getSelection();
        const selectedBlocks = document.querySelectorAll(`${blockSelector}.${selectedClass}`).length;

        return {
          returnedValue,
          rangeCount: selection?.rangeCount ?? 0,
          selectedBlocks,
        };
      }, { blockSelector: BLOCK_SELECTOR,
        selectedClass: BLOCK_SELECTED_CLASS });

      expect(result.returnedValue).toBe(false);
      expect(result.rangeCount).toBe(0);
      expect(result.selectedBlocks).toBe(0);
    });

    test('highlights non-focusable blocks instead of placing a caret', async ({ page }) => {
      const paragraphBlock = createParagraphBlock('focusable-block', 'Focusable content');
      const staticBlockId = 'static-block';
      const staticBlock = {
        id: staticBlockId,
        type: 'nonFocusable',
        data: {},
      };

      await createEditor(page, {
        data: {
          blocks: [paragraphBlock, staticBlock],
        },
        tools: [
          {
            name: 'nonFocusable',
            classSource: NON_FOCUSABLE_TOOL_SOURCE,
          },
        ],
      });

      await clearSelection(page);

      const result = await page.evaluate(({ blockSelector, selectedClass }) => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        const returnedValue = window.editorInstance.caret.setToBlock(1);
        const selection = window.getSelection();
        const blocks = document.querySelectorAll(blockSelector);
        const secondBlock = blocks.item(1) as HTMLElement | null;
        const firstBlock = blocks.item(0) as HTMLElement | null;

        return {
          returnedValue,
          rangeCount: selection?.rangeCount ?? 0,
          secondBlockSelected: !!secondBlock && secondBlock.classList.contains(selectedClass),
          firstBlockSelected: !!firstBlock && firstBlock.classList.contains(selectedClass),
        };
      }, { blockSelector: BLOCK_SELECTOR,
        selectedClass: BLOCK_SELECTED_CLASS });

      expect(result.returnedValue).toBe(true);
      expect(result.rangeCount).toBe(0);
      expect(result.secondBlockSelected).toBe(true);
      expect(result.firstBlockSelected).toBe(false);
    });
  });

  test.describe('.setToFirstBlock', () => {
    test('moves caret to the first block and places it at the start', async ({ page }) => {
      const blocks = [
        createParagraphBlock('first-block', 'First block content'),
        createParagraphBlock('second-block', 'Second block content'),
      ];

      await createEditor(page, {
        data: {
          blocks,
        },
      });

      await clearSelection(page);

      const result = await page.evaluate(({ blockSelector }) => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        const returnedValue = window.editorInstance.caret.setToFirstBlock('start');
        const selection = window.getSelection();
        const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
        const firstBlock = document.querySelectorAll(blockSelector).item(0) as HTMLElement | null;

        return {
          returnedValue,
          rangeExists: !!range,
          selectionInFirstBlock: !!(range && firstBlock && firstBlock.contains(range.startContainer)),
          startOffset: range?.startOffset ?? null,
        };
      }, { blockSelector: BLOCK_SELECTOR });

      expect(result.returnedValue).toBe(true);
      expect(result.rangeExists).toBe(true);
      expect(result.selectionInFirstBlock).toBe(true);
      expect(result.startOffset).toBe(0);
    });
  });

  test.describe('.setToLastBlock', () => {
    test('moves caret to the last block and places it at the end', async ({ page }) => {
      const blocks = [
        createParagraphBlock('first-block', 'First block content'),
        createParagraphBlock('last-block', 'Last block text'),
      ];

      await createEditor(page, {
        data: {
          blocks,
        },
      });

      await clearSelection(page);

      const result = await page.evaluate(({ blockSelector }) => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        const returnedValue = window.editorInstance.caret.setToLastBlock('end');
        const selection = window.getSelection();
        const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
        const blocksCollection = document.querySelectorAll(blockSelector);
        const lastBlock = blocksCollection.item(blocksCollection.length - 1) as HTMLElement | null;

        return {
          returnedValue,
          rangeExists: !!range,
          selectionInLastBlock: !!(range && lastBlock && lastBlock.contains(range.startContainer)),
          startContainerTextLength: range?.startContainer?.textContent?.length ?? null,
          startOffset: range?.startOffset ?? null,
        };
      }, { blockSelector: BLOCK_SELECTOR });

      expect(result.returnedValue).toBe(true);
      expect(result.rangeExists).toBe(true);
      expect(result.selectionInLastBlock).toBe(true);
      expect(result.startOffset).toBe(result.startContainerTextLength);
    });
  });

  test.describe('.setToPreviousBlock', () => {
    test('moves caret to the previous block relative to the current one', async ({ page }) => {
      const blocks = [
        createParagraphBlock('first-block', 'First block'),
        createParagraphBlock('middle-block', 'Middle block'),
        createParagraphBlock('last-block', 'Last block'),
      ];

      await createEditor(page, {
        data: {
          blocks,
        },
      });

      const result = await page.evaluate(({ blockSelector }) => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        const currentSet = window.editorInstance.caret.setToBlock(2);

        if (!currentSet) {
          throw new Error('Failed to set initial caret position');
        }

        const returnedValue = window.editorInstance.caret.setToPreviousBlock('default');
        const selection = window.getSelection();
        const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
        const middleBlock = document.querySelectorAll(blockSelector).item(1) as HTMLElement | null;

        const currentBlockIndex = window.editorInstance.blocks.getCurrentBlockIndex();
        const currentBlockId = currentBlockIndex !== undefined
          ? window.editorInstance.blocks.getBlockByIndex(currentBlockIndex)?.id ?? null
          : null;

        return {
          returnedValue,
          rangeExists: !!range,
          selectionInMiddleBlock: !!(range && middleBlock && middleBlock.contains(range.startContainer)),
          currentBlockId,
        };
      }, { blockSelector: BLOCK_SELECTOR });

      expect(result.returnedValue).toBe(true);
      expect(result.rangeExists).toBe(true);
      expect(result.selectionInMiddleBlock).toBe(true);
      expect(result.currentBlockId).toBe('middle-block');
    });
  });

  test.describe('.setToNextBlock', () => {
    test('moves caret to the next block relative to the current one', async ({ page }) => {
      const blocks = [
        createParagraphBlock('first-block', 'First block'),
        createParagraphBlock('middle-block', 'Middle block'),
        createParagraphBlock('last-block', 'Last block'),
      ];

      await createEditor(page, {
        data: {
          blocks,
        },
      });

      const result = await page.evaluate(({ blockSelector }) => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        const currentSet = window.editorInstance.caret.setToBlock(0);

        if (!currentSet) {
          throw new Error('Failed to set initial caret position');
        }

        const returnedValue = window.editorInstance.caret.setToNextBlock('default');
        const selection = window.getSelection();
        const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
        const middleBlock = document.querySelectorAll(blockSelector).item(1) as HTMLElement | null;

        const currentBlockIndex = window.editorInstance.blocks.getCurrentBlockIndex();
        const currentBlockId = currentBlockIndex !== undefined
          ? window.editorInstance.blocks.getBlockByIndex(currentBlockIndex)?.id ?? null
          : null;

        return {
          returnedValue,
          rangeExists: !!range,
          selectionInMiddleBlock: !!(range && middleBlock && middleBlock.contains(range.startContainer)),
          currentBlockId,
        };
      }, { blockSelector: BLOCK_SELECTOR });

      expect(result.returnedValue).toBe(true);
      expect(result.rangeExists).toBe(true);
      expect(result.selectionInMiddleBlock).toBe(true);
      expect(result.currentBlockId).toBe('middle-block');
    });
  });

  test.describe('.focus', () => {
    test('focuses the first block when called without arguments', async ({ page }) => {
      const blocks = [
        createParagraphBlock('focus-first', 'First block content'),
        createParagraphBlock('focus-second', 'Second block content'),
      ];

      await createEditor(page, {
        data: {
          blocks,
        },
      });

      await clearSelection(page);

      const result = await page.evaluate(({ blockSelector }) => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        const returnedValue = window.editorInstance.focus();
        const selection = window.getSelection();
        const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
        const firstBlock = document.querySelectorAll(blockSelector).item(0) as HTMLElement | null;

        return {
          returnedValue,
          rangeExists: !!range,
          selectionInFirstBlock: !!(range && firstBlock && firstBlock.contains(range.startContainer)),
          startOffset: range?.startOffset ?? null,
        };
      }, { blockSelector: BLOCK_SELECTOR });

      expect(result.returnedValue).toBe(true);
      expect(result.rangeExists).toBe(true);
      expect(result.selectionInFirstBlock).toBe(true);
      expect(result.startOffset).toBe(0);
    });

    test('focuses the last block when called with atEnd = true', async ({ page }) => {
      const blocks = [
        createParagraphBlock('focus-first', 'First block'),
        createParagraphBlock('focus-last', 'Last block content'),
      ];

      await createEditor(page, {
        data: {
          blocks,
        },
      });

      await clearSelection(page);

      const result = await page.evaluate(({ blockSelector }) => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        const returnedValue = window.editorInstance.focus(true);
        const selection = window.getSelection();
        const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
        const blocksCollection = document.querySelectorAll(blockSelector);
        const lastBlock = blocksCollection.item(blocksCollection.length - 1) as HTMLElement | null;

        return {
          returnedValue,
          rangeExists: !!range,
          selectionInLastBlock: !!(range && lastBlock && lastBlock.contains(range.startContainer)),
          startContainerTextLength: range?.startContainer?.textContent?.length ?? null,
          startOffset: range?.startOffset ?? null,
        };
      }, { blockSelector: BLOCK_SELECTOR });

      expect(result.returnedValue).toBe(true);
      expect(result.rangeExists).toBe(true);
      expect(result.selectionInLastBlock).toBe(true);
      expect(result.startOffset).toBe(result.startContainerTextLength);
    });

    test('autofocus configuration moves caret to the first block after initialization', async ({ page }) => {
      const blocks = [ createParagraphBlock('autofocus-block', 'Autofocus content') ];

      await createEditor(page, {
        data: {
          blocks,
        },
        config: {
          autofocus: true,
        },
      });

      const result = await page.evaluate(({ blockSelector }) => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        const selection = window.getSelection();
        const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
        const firstBlock = document.querySelectorAll(blockSelector).item(0) as HTMLElement | null;

        const currentBlockIndex = window.editorInstance.blocks.getCurrentBlockIndex();
        const currentBlockId = currentBlockIndex !== undefined
          ? window.editorInstance.blocks.getBlockByIndex(currentBlockIndex)?.id ?? null
          : null;

        return {
          rangeExists: !!range,
          selectionInFirstBlock: !!(range && firstBlock && firstBlock.contains(range.startContainer)),
          currentBlockId,
        };
      }, { blockSelector: BLOCK_SELECTOR });

      expect(result.rangeExists).toBe(true);
      expect(result.selectionInFirstBlock).toBe(true);
      expect(result.currentBlockId).toBe('autofocus-block');
    });

    test('focus can be restored after editor operations clear the selection', async ({ page }) => {
      const blocks = [
        createParagraphBlock('restore-first', 'First block'),
        createParagraphBlock('restore-second', 'Second block'),
      ];

      await createEditor(page, {
        data: {
          blocks,
        },
      });

      const result = await page.evaluate(({ blockSelector }) => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        const initialFocusResult = window.editorInstance.focus();
        const initialSelection = window.getSelection();
        const initialRangeCount = initialSelection?.rangeCount ?? 0;

        window.editorInstance.blocks.insert('paragraph', { text: 'Inserted block' }, undefined, 1, false);
        window.getSelection()?.removeAllRanges();

        const selectionAfterOperation = window.getSelection();
        const afterRangeCount = selectionAfterOperation?.rangeCount ?? 0;

        const returnedValue = window.editorInstance.focus();
        const selection = window.getSelection();
        const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
        const firstBlock = document.querySelectorAll(blockSelector).item(0) as HTMLElement | null;

        return {
          initialFocusResult,
          initialRangeCount,
          afterRangeCount,
          returnedValue,
          rangeExists: !!range,
          selectionInFirstBlock: !!(range && firstBlock && firstBlock.contains(range.startContainer)),
          blocksCount: window.editorInstance.blocks.getBlocksCount(),
        };
      }, { blockSelector: BLOCK_SELECTOR });

      expect(result.initialFocusResult).toBe(true);
      expect(result.initialRangeCount).toBeGreaterThan(0);
      expect(result.afterRangeCount).toBe(0);
      expect(result.returnedValue).toBe(true);
      expect(result.rangeExists).toBe(true);
      expect(result.selectionInFirstBlock).toBe(true);
      expect(result.blocksCount).toBe(3);
    });
  });
});

