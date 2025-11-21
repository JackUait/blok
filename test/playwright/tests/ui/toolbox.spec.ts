import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type EditorJS from '@/types';
import type { ConversionConfig, ToolboxConfig, OutputData } from '@/types';
import type { BlockToolConstructable } from '@/types/tools';
import { EDITOR_INTERFACE_SELECTOR, MODIFIER_KEY } from '../../../../src/components/constants';
import { ensureEditorBundleBuilt } from '../helpers/ensure-build';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'editorjs';
const PARAGRAPH_BLOCK_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} .ce-block[data-block-tool="paragraph"]`;
const POPOVER_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} .ce-popover`;
const POPOVER_ITEM_SELECTOR = `${POPOVER_SELECTOR} .ce-popover-item`;
const SECONDARY_TITLE_SELECTOR = '.ce-popover-item__secondary-title';

/**
 * Reset the editor holder and destroy any existing instance
 *
 * @param page - The Playwright page object
 */
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

/**
 * Create editor with custom tools
 *
 * @param page - The Playwright page object
 * @param tools - Tools configuration
 * @param data - Optional initial editor data
 */
type SerializedToolConfig = {
  name: string;
  classSource: string;
  config: Record<string, unknown>;
};

const registerToolClasses = async (page: Page, tools: SerializedToolConfig[]): Promise<void> => {
  if (tools.length === 0) {
    return;
  }

  const scriptContent = tools
    .map(({ name, classSource }) => {
      return `
(function registerTool(){
  window.__playwrightToolRegistry = window.__playwrightToolRegistry || {};
  window.__playwrightToolRegistry[${JSON.stringify(name)}] = (${classSource});
}());
`;
    })
    .join('\n');

  await page.addScriptTag({ content: scriptContent });
};

const serializeTools = (
  tools: Record<string, { class: BlockToolConstructable; shortcut?: string }>
): SerializedToolConfig[] => {
  return Object.entries(tools).map(([name, toolConfig]) => {
    const { class: toolClass, ...config } = toolConfig;

    return {
      name,
      classSource: toolClass.toString(),
      config,
    };
  });
};

const createEditorWithTools = async (
  page: Page,
  tools: Record<string, { class: BlockToolConstructable; shortcut?: string }>,
  data?: OutputData
): Promise<void> => {
  await resetEditor(page);

  const serializedTools = serializeTools(tools);

  await registerToolClasses(page, serializedTools);

  const registeredToolNames = await page.evaluate(
    async ({ holderId, editorTools, editorData }) => {
      const registry = window.__playwrightToolRegistry ?? {};

      const toolsMap = editorTools.reduce<
      Record<string, { class: BlockToolConstructable } & Record<string, unknown>>
      >((accumulator, { name, config }) => {
        const toolClass = registry[name];

        if (!toolClass) {
          throw new Error(`Tool class "${name}" was not registered in the page context.`);
        }

        return {
          ...accumulator,
          [name]: {
            class: toolClass as BlockToolConstructable,
            ...config,
          },
        };
      }, {});

      const editor = new window.EditorJS({
        holder: holderId,
        tools: toolsMap,
        ...(editorData ? { data: editorData } : {}),
      });

      window.editorInstance = editor;
      await editor.isReady;

      return Object.keys(toolsMap);
    },
    {
      holderId: HOLDER_ID,
      editorTools: serializedTools.map(({ name, config }) => ({
        name,
        config,
      })),
      editorData: data ?? null,
    }
  );

  const missingTools = Object.keys(tools).filter((toolName) => !registeredToolNames.includes(toolName));

  if (missingTools.length > 0) {
    throw new Error(`Failed to register tools: ${missingTools.join(', ')}`);
  }
};

/**
 * Save editor data
 *
 * @param page - The Playwright page object
 * @returns The saved output data
 */
const saveEditor = async (page: Page): Promise<OutputData> => {
  return await page.evaluate(async () => {
    if (!window.editorInstance) {
      throw new Error('Editor instance not found');
    }

    return await window.editorInstance.save();
  });
};

const runShortcutBehaviour = async (page: Page, toolName: string): Promise<void> => {
  await page.evaluate(
    async ({ toolName: shortcutTool }) => {
      const editor =
        window.editorInstance ??
        (() => {
          throw new Error('Editor instance not found');
        })();

      const { blocks, caret } = editor;
      const currentBlockIndex = blocks.getCurrentBlockIndex();
      const currentBlock =
        blocks.getBlockByIndex(currentBlockIndex) ??
        (() => {
          throw new Error('Current block not found');
        })();

      try {
        const newBlock = await blocks.convert(currentBlock.id, shortcutTool);

        const newBlockId = newBlock?.id ?? currentBlock.id;

        caret.setToBlock(newBlockId, 'end');
      } catch (error) {
        const insertionIndex = currentBlockIndex + Number(!currentBlock.isEmpty);

        blocks.insert(shortcutTool, undefined, undefined, insertionIndex, undefined, currentBlock.isEmpty);
      }
    },
    { toolName }
  );
};

/**
 * Check if caret is within a block element
 *
 * @param page - The Playwright page object
 * @param blockId - Block ID to check
 * @returns True if caret is within the block
 */
const isCaretInBlock = async (page: Page, blockId: string): Promise<boolean> => {
  return await page.evaluate(({ blockId: id }) => {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return false;
    }

    const range = selection.getRangeAt(0);
    const blockElement = document.querySelector(`.ce-block[data-id="${id}"]`);

    if (!blockElement) {
      return false;
    }

    return blockElement.contains(range.startContainer);
  }, { blockId });
};

test.describe('toolbox', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test.describe('shortcuts', () => {
    test('should convert current Block to the Shortcuts\'s Block if both tools provides a "conversionConfig". Caret should be restored after conversion.', async ({ page }) => {
      /**
       * Mock of Tool with conversionConfig
       */
      const ConvertableTool = class {
        /**
         * Specify how to import string data to this Tool
         */
        public static get conversionConfig(): ConversionConfig {
          return {
            import: 'text',
          };
        }

        /**
         * Specify how to display Tool in a Toolbox
         */
        public static get toolbox(): ToolboxConfig {
          return {
            icon: '',
            title: 'Convertable tool',
          };
        }

        private data: { text: string };

        /**
         * Constructor
         *
         * @param data - Tool data
         */
        constructor({ data }: { data: { text: string } }) {
          this.data = data;
        }

        /**
         * Render tool element
         *
         * @returns Rendered HTML element
         */
        public render(): HTMLElement {
          const contenteditable = document.createElement('div');

          contenteditable.contentEditable = 'true';
          contenteditable.textContent = this.data.text;

          return contenteditable;
        }

        /**
         * Save tool data
         *
         * @param el - HTML element to save from
         * @returns Saved data
         */
        public save(el: HTMLElement): { text: string } {
          return {
            // eslint-disable-next-line playwright/no-conditional-in-test
            text: el.textContent ?? '',
          };
        }
      };

      await createEditorWithTools(page, {
        convertableTool: {
          class: ConvertableTool as unknown as BlockToolConstructable,
          shortcut: 'CMD+SHIFT+H',
        },
      });

      const paragraphBlock = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await expect(paragraphBlock).toHaveCount(1);

      const paragraphContent = paragraphBlock.locator('[contenteditable]');

      await paragraphContent.fill('Some text');

      await runShortcutBehaviour(page, 'convertableTool');

      /**
       * Check that block was converted
       */
      const editorData = await saveEditor(page);

      expect(editorData.blocks).toHaveLength(1);
      expect(editorData.blocks[0].type).toBe('convertableTool');
      expect(editorData.blocks[0].data.text).toBe('Some text');

      /**
       * Check that caret belongs to the new block after conversion
       */
      const blockId = editorData.blocks[0]?.id;

      expect(blockId).toBeDefined();

      const caretInBlock = await isCaretInBlock(page, blockId!);

      expect(caretInBlock).toBe(true);
    });

    test('should insert a Shortcuts\'s Block below the current if some (original or target) tool does not provide a "conversionConfig"', async ({ page }) => {
      /**
       * Mock of Tool without conversionConfig
       */
      const ToolWithoutConversionConfig = class {
        /**
         * Specify how to display Tool in a Toolbox
         */
        public static get toolbox(): ToolboxConfig {
          return {
            icon: '',
            title: 'Convertable tool',
          };
        }

        private data: { text: string };

        /**
         * Constructor
         *
         * @param data - Tool data
         */
        constructor({ data }: { data: { text: string } }) {
          this.data = data;
        }

        /**
         * Render tool element
         *
         * @returns Rendered HTML element
         */
        public render(): HTMLElement {
          const contenteditable = document.createElement('div');

          contenteditable.contentEditable = 'true';
          contenteditable.textContent = this.data.text;

          return contenteditable;
        }

        /**
         * Save tool data
         *
         * @param el - HTML element to save from
         * @returns Saved data
         */
        public save(el: HTMLElement): { text: string } {
          return {
            // eslint-disable-next-line playwright/no-conditional-in-test
            text: el.textContent ?? '',
          };
        }
      };

      await createEditorWithTools(page, {
        nonConvertableTool: {
          class: ToolWithoutConversionConfig as unknown as BlockToolConstructable,
          shortcut: 'CMD+SHIFT+H',
        },
      });

      const paragraphBlock = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await expect(paragraphBlock).toHaveCount(1);

      await paragraphBlock.click();
      await paragraphBlock.type('Some text');

      await runShortcutBehaviour(page, 'nonConvertableTool');

      /**
       * Check that the new block was appended
       */
      const editorData = await saveEditor(page);

      expect(editorData.blocks).toHaveLength(2);
      expect(editorData.blocks[1].type).toBe('nonConvertableTool');
    });

    test('should display shortcut only for the first toolbox item if tool exports toolbox with several items', async ({ page }) => {
      /**
       * Mock of Tool with several toolbox items
       */
      const ToolWithSeveralToolboxItems = class {
        /**
         * Specify toolbox with several items related to one tool
         */
        public static get toolbox(): ToolboxConfig {
          return [
            {
              icon: '',
              title: 'first tool',
            },
            {
              icon: '',
              title: 'second tool',
            },
          ];
        }

        private data: { text: string };

        /**
         * Constructor
         *
         * @param data - Tool data
         */
        constructor({ data }: { data: { text: string } }) {
          this.data = data;
        }

        /**
         * Render tool element
         *
         * @returns Rendered HTML element
         */
        public render(): HTMLElement {
          const contenteditable = document.createElement('div');

          contenteditable.contentEditable = 'true';
          contenteditable.textContent = this.data.text;

          return contenteditable;
        }

        /**
         * Save tool data
         *
         * @param el - HTML element to save from
         * @returns Saved data
         */
        public save(el: HTMLElement): { text: string } {
          return {
            // eslint-disable-next-line playwright/no-conditional-in-test
            text: el.textContent ?? '',
          };
        }
      };

      await createEditorWithTools(page, {
        severalToolboxItemsTool: {
          class: ToolWithSeveralToolboxItems as unknown as BlockToolConstructable,
          shortcut: 'CMD+SHIFT+L',
        },
      });

      const paragraphBlock = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await expect(paragraphBlock).toHaveCount(1);

      await paragraphBlock.click();
      await paragraphBlock.type('Some text');
      await page.keyboard.press(`${MODIFIER_KEY}+A`);
      await page.keyboard.press('Backspace');

      // Open toolbox with "/" shortcut
      await page.keyboard.type('/');

      const popover = page.locator(POPOVER_SELECTOR);

      await popover.waitFor({ state: 'attached' });
      await expect(popover).toHaveAttribute('data-popover-opened', 'true');

      /**
       * Secondary title (shortcut) should exist for first toolbox item of the tool
       */
      const severalToolboxItems = page.locator(
        `${POPOVER_ITEM_SELECTOR}[data-item-name="severalToolboxItemsTool"]`
      );
      const firstItem = severalToolboxItems.filter({ hasText: 'first tool' });
      const firstSecondaryTitle = firstItem.locator(SECONDARY_TITLE_SELECTOR);

      await expect(firstSecondaryTitle).toBeVisible();

      /**
       * Secondary title (shortcut) should not exist for second toolbox item of the same tool
       */
      const secondItem = severalToolboxItems.filter({ hasText: 'second tool' });
      const secondSecondaryTitle = secondItem.locator(SECONDARY_TITLE_SELECTOR);

      await expect(secondSecondaryTitle).toBeHidden();
    });

    test('should display shortcut for the item if tool exports toolbox as an one item object', async ({ page }) => {
      /**
       * Mock of Tool with one toolbox item
       */
      const ToolWithOneToolboxItems = class {
        /**
         * Specify toolbox with one item
         */
        public static get toolbox(): ToolboxConfig {
          return {
            icon: '',
            title: 'tool',
          };
        }

        private data: { text: string };

        /**
         * Constructor
         *
         * @param data - Tool data
         */
        constructor({ data }: { data: { text: string } }) {
          this.data = data;
        }

        /**
         * Render tool element
         *
         * @returns Rendered HTML element
         */
        public render(): HTMLElement {
          const contenteditable = document.createElement('div');

          contenteditable.contentEditable = 'true';
          contenteditable.textContent = this.data.text;

          return contenteditable;
        }

        /**
         * Save tool data
         *
         * @param el - HTML element to save from
         * @returns Saved data
         */
        public save(el: HTMLElement): { text: string } {
          return {
            // eslint-disable-next-line playwright/no-conditional-in-test
            text: el.textContent ?? '',
          };
        }
      };

      await createEditorWithTools(page, {
        oneToolboxItemTool: {
          class: ToolWithOneToolboxItems as unknown as BlockToolConstructable,
          shortcut: 'CMD+SHIFT+L',
        },
      });

      const paragraphBlock = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await expect(paragraphBlock).toHaveCount(1);

      await paragraphBlock.click();
      await paragraphBlock.type('Some text');
      await page.keyboard.press(`${MODIFIER_KEY}+A`);
      await page.keyboard.press('Backspace');

      // Open toolbox with "/" shortcut
      await page.keyboard.type('/');

      const popover = page.locator(POPOVER_SELECTOR);

      await popover.waitFor({ state: 'attached' });
      await expect(popover).toHaveAttribute('data-popover-opened', 'true');

      /**
       * Secondary title (shortcut) should exist for toolbox item of the tool
       */
      const item = page.locator(`${POPOVER_ITEM_SELECTOR}[data-item-name="oneToolboxItemTool"]`);

      await expect(item).toHaveCount(1);
      const secondaryTitle = item.locator(SECONDARY_TITLE_SELECTOR);

      await expect(secondaryTitle).toBeVisible();
    });
  });
});

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- test-specific property
    __playwrightToolRegistry?: Record<string, BlockToolConstructable>;
    editorInstance?: EditorJS;
    EditorJS: new (...args: unknown[]) => EditorJS;
  }
}

