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
    container.dataset.cy = holderId;
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
});

