import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type Blok from '@/types';
import type { ConversionConfig, ToolboxConfig, OutputData } from '@/types';
import type { BlockToolConstructable } from '@/types/tools';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'blok';
const PARAGRAPH_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`;
const POPOVER_SELECTOR = '[data-blok-testid="toolbox-popover"]';
const POPOVER_ITEM_SELECTOR = `${POPOVER_SELECTOR} [data-blok-testid="popover-item"]`;
const SECONDARY_TITLE_SELECTOR = '[data-blok-testid="popover-item-secondary-title"]';

/**
 * Reset the blok holder and destroy any existing instance
 * @param page - The Playwright page object
 */
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

/**
 * Create blok with custom tools
 * @param page - The Playwright page object
 * @param tools - Tools configuration
 * @param data - Optional initial blok data
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

const createBlokWithTools = async (
  page: Page,
  tools: Record<string, { class: BlockToolConstructable; shortcut?: string }>,
  data?: OutputData
): Promise<void> => {
  await resetBlok(page);

  const serializedTools = serializeTools(tools);

  await registerToolClasses(page, serializedTools);

  const registeredToolNames = await page.evaluate(
    async ({ holder, blokTools, blokData }) => {
      const registry = window.__playwrightToolRegistry ?? {};

      const toolsMap = blokTools.reduce<
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

      const blok = new window.Blok({
        holder: holder,
        tools: toolsMap,
        ...(blokData ? { data: blokData } : {}),
      });

      window.blokInstance = blok;
      await blok.isReady;

      return Object.keys(toolsMap);
    },
    {
      holder: HOLDER_ID,
      blokTools: serializedTools.map(({ name, config }) => ({
        name,
        config,
      })),
      blokData: data ?? null,
    }
  );

  const missingTools = Object.keys(tools).filter((toolName) => !registeredToolNames.includes(toolName));

  if (missingTools.length > 0) {
    throw new Error(`Failed to register tools: ${missingTools.join(', ')}`);
  }
};

/**
 * Save blok data
 * @param page - The Playwright page object
 * @returns The saved output data
 */
const saveBlok = async (page: Page): Promise<OutputData> => {
  return await page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('Blok instance not found');
    }

    return await window.blokInstance.save();
  });
};

const runShortcutBehaviour = async (page: Page, toolName: string): Promise<void> => {
  await page.evaluate(
    async ({ toolName: shortcutTool }) => {
      const blok =
        window.blokInstance ??
        (() => {
          throw new Error('Blok instance not found');
        })();

      const { blocks, caret } = blok;
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
      } catch (_error) {
        const insertionIndex = currentBlockIndex + Number(!currentBlock.isEmpty);

        blocks.insert(shortcutTool, undefined, undefined, insertionIndex, undefined, currentBlock.isEmpty);
      }
    },
    { toolName }
  );
};

/**
 * Check if caret is within a block element
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
    const blockElement = document.querySelector(`[data-blok-element][data-blok-id="${id}"]`);

    if (!blockElement) {
      return false;
    }

    return blockElement.contains(range.startContainer);
  }, { blockId });
};

test.describe('toolbox', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
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
         * @param data - Tool data
         */
        constructor({ data }: { data: { text: string } }) {
          this.data = data;
        }

        /**
         * Render tool element
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

      await createBlokWithTools(page, {
        convertableTool: {
          class: ConvertableTool as unknown as BlockToolConstructable,
          shortcut: 'CMD+SHIFT+H',
        },
      });

      // Wait for toolbox to be initialized (it is created in requestIdleCallback)
      await page.evaluate(() => {
        return new Promise<void>((resolve) => {
          const check = (): void => {
            type BlokJSInternal = Blok & {
              module: {
                toolbar: {
                  toolboxInstance: unknown;
                };
              };
            };

            if ((window.blokInstance as unknown as BlokJSInternal)?.module?.toolbar?.toolboxInstance) {
              resolve();
            } else {
              requestAnimationFrame(check);
            }
          };

          check();
        });
      });

      const paragraphBlock = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await expect(paragraphBlock).toHaveCount(1);

      const paragraphContent = paragraphBlock.locator('[contenteditable]');

      await paragraphContent.fill('Some text');

      await runShortcutBehaviour(page, 'convertableTool');

      /**
       * Check that block was converted
       */
      const blokData = await saveBlok(page);

      expect(blokData.blocks).toHaveLength(1);
      expect(blokData.blocks[0].type).toBe('convertableTool');
      expect(blokData.blocks[0].data.text).toBe('Some text');

      /**
       * Check that caret belongs to the new block after conversion
       */
      const blockId = blokData.blocks[0]?.id;

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
         * @param data - Tool data
         */
        constructor({ data }: { data: { text: string } }) {
          this.data = data;
        }

        /**
         * Render tool element
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

      await createBlokWithTools(page, {
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
      const blokData = await saveBlok(page);

      expect(blokData.blocks).toHaveLength(2);
      expect(blokData.blocks[1].type).toBe('nonConvertableTool');
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
         * @param data - Tool data
         */
        constructor({ data }: { data: { text: string } }) {
          this.data = data;
        }

        /**
         * Render tool element
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

      await createBlokWithTools(page, {
        severalToolboxItemsTool: {
          class: ToolWithSeveralToolboxItems as unknown as BlockToolConstructable,
          shortcut: 'CMD+SHIFT+L',
        },
      });

      const paragraphBlock = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await expect(paragraphBlock).toHaveCount(1);

      await paragraphBlock.click();
      await paragraphBlock.locator('[contenteditable]').fill('Some text');
      await paragraphBlock.locator('[contenteditable]').fill('');
      await paragraphBlock.locator('[contenteditable]').focus();
      // Trigger backspace to ensure Blok.js internal state is clean
      await page.keyboard.press('Backspace');

      // Wait for Blok.js to mark it as empty
      await expect(paragraphBlock.locator('[contenteditable]')).toHaveAttribute('data-blok-empty', 'true');

      // Open toolbox with "/" shortcut
      await page.keyboard.type('/');

      const popover = page.locator(POPOVER_SELECTOR);

      await popover.waitFor({ state: 'attached' });
      await expect(popover).toHaveAttribute('data-blok-popover-opened', 'true');

      /**
       * Secondary title (shortcut) should exist for first toolbox item of the tool
       */
      const severalToolboxItems = page.locator(
        `${POPOVER_ITEM_SELECTOR}[data-blok-item-name="severalToolboxItemsTool"]`
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
         * @param data - Tool data
         */
        constructor({ data }: { data: { text: string } }) {
          this.data = data;
        }

        /**
         * Render tool element
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

      await createBlokWithTools(page, {
        oneToolboxItemTool: {
          class: ToolWithOneToolboxItems as unknown as BlockToolConstructable,
          shortcut: 'CMD+SHIFT+L',
        },
      });

      const paragraphBlock = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await expect(paragraphBlock).toHaveCount(1);

      await paragraphBlock.click();
      await paragraphBlock.locator('[contenteditable]').fill('Some text');
      await paragraphBlock.locator('[contenteditable]').fill('');
      await paragraphBlock.locator('[contenteditable]').focus();
      // Trigger backspace to ensure Blok.js internal state is clean
      await page.keyboard.press('Backspace');

      // Wait for Blok.js to mark it as empty
      await expect(paragraphBlock.locator('[contenteditable]')).toHaveAttribute('data-blok-empty', 'true');

      // Open toolbox with "/" shortcut
      await page.keyboard.type('/');

      const popover = page.locator(POPOVER_SELECTOR);

      await popover.waitFor({ state: 'attached' });
      await expect(popover).toHaveAttribute('data-blok-popover-opened', 'true');

      /**
       * Secondary title (shortcut) should exist for toolbox item of the tool
       */
      const item = page.locator(`${POPOVER_ITEM_SELECTOR}[data-blok-item-name="oneToolboxItemTool"]`);

      await expect(item).toHaveCount(1);
      const secondaryTitle = item.locator(SECONDARY_TITLE_SELECTOR);

      await expect(secondaryTitle).toBeVisible();
    });
  });
});

declare global {
  interface Window {

    __playwrightToolRegistry?: Record<string, BlockToolConstructable>;
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

/**
 * Opens the toolbox by typing "/" in an empty block
 * Following the same pattern as the working test at lines 588-604
 * @param page - The Playwright page object
 */
const openToolbox = async (page: Page): Promise<void> => {
  const paragraphBlock = page.locator(PARAGRAPH_BLOCK_SELECTOR);

  await expect(paragraphBlock).toHaveCount(1);

  await paragraphBlock.click();
  await paragraphBlock.locator('[contenteditable]').fill('Some text');
  await paragraphBlock.locator('[contenteditable]').fill('');
  await paragraphBlock.locator('[contenteditable]').focus();
  // Trigger backspace to ensure Blok.js internal state is clean
  await page.keyboard.press('Backspace');

  // Wait for Blok.js to mark it as empty
  await expect(paragraphBlock.locator('[contenteditable]')).toHaveAttribute('data-blok-empty', 'true');

  // Open toolbox with "/" shortcut
  await page.keyboard.type('/');

  const popover = page.locator(POPOVER_SELECTOR);

  await popover.waitFor({ state: 'attached' });
  await expect(popover).toHaveAttribute('data-blok-popover-opened', 'true');
};

test.describe('toolbox keyboard navigation', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  /**
   * Note: Toolbox keyboard navigation tests are skipped on Firefox.
   *
   * The toolbox popover's Flipper does not enable `handleContentEditableTargets`,
   * which means keyboard events from contenteditable elements are not handled.
   * After typing "/" to open the toolbox, focus remains in the contenteditable.
   * In Chromium/WebKit, pressing Tab moves focus out and allows Flipper to catch
   * subsequent keyboard events. In Firefox, Tab doesn't move focus in a way that
   * allows Flipper to catch events, so arrow key navigation doesn't work.
   *
   * This is a known limitation of the toolbox keyboard navigation in Firefox.
   */

  /**
   * Simple test tool for keyboard navigation tests
   */
  const SimpleTestTool = class {
    /**
     * Specify how to display Tool in a Toolbox
     */
    public static get toolbox(): ToolboxConfig {
      return {
        icon: '⚡',
        title: 'Simple Tool',
      };
    }

    private data: { text: string };

    /**
     * Constructor
     * @param options - Tool options
     */
    constructor({ data }: { data: { text: string } }) {
      this.data = data ?? { text: '' };
    }

    /**
     * Render tool element
     * @returns Rendered HTML element
     */
    public render(): HTMLElement {
      const element = document.createElement('div');

      element.contentEditable = 'true';
      element.textContent = this.data.text;

      return element;
    }

    /**
     * Save tool data
     * @param el - HTML element to save from
     * @returns Saved data
     */
    public save(el: HTMLElement): { text: string } {
      return {
         
        text: el.textContent ?? '',
      };
    }
  };

  /**
   * Another simple test tool to have multiple items
   */
  const AnotherTestTool = class {
    /**
     * Specify how to display Tool in a Toolbox
     */
    public static get toolbox(): ToolboxConfig {
      return {
        icon: '🔧',
        title: 'Another Tool',
      };
    }

    private data: { text: string };

    /**
     * Constructor
     * @param options - Tool options
     */
    constructor({ data }: { data: { text: string } }) {
      this.data = data ?? { text: '' };
    }

    /**
     * Render tool element
     * @returns Rendered HTML element
     */
    public render(): HTMLElement {
      const element = document.createElement('div');

      element.contentEditable = 'true';
      element.textContent = this.data.text;

      return element;
    }

    /**
     * Save tool data
     * @param el - HTML element to save from
     * @returns Saved data
     */
    public save(el: HTMLElement): { text: string } {
      return {
         
        text: el.textContent ?? '',
      };
    }
  };

  test('navigates through toolbox items with ArrowDown and ArrowUp', async ({ page, browserName }) => {
    // eslint-disable-next-line playwright/no-skipped-test -- Firefox doesn't support keyboard nav from contenteditable
    test.skip(browserName === 'firefox', 'Firefox has different Tab behavior when focus is in contenteditable');
    await createBlokWithTools(page, {
      simpleTool: {
        class: SimpleTestTool as unknown as BlockToolConstructable,
      },
      anotherTool: {
        class: AnotherTestTool as unknown as BlockToolConstructable,
      },
    });

    await openToolbox(page);

    const popoverItems = page.locator(`${POPOVER_ITEM_SELECTOR}:not([data-blok-hidden="true"])`);
    const itemsCount = await popoverItems.count();

    expect(itemsCount).toBeGreaterThan(1);

    // First item should be focused after toolbox opens (focusFirst called)
    // eslint-disable-next-line playwright/no-nth-methods -- Testing keyboard navigation requires checking specific indices
    await expect(popoverItems.first()).toHaveAttribute('data-blok-focused', 'true');

    // Tab moves focus out of contenteditable, allowing Flipper to catch keyboard events
    await page.keyboard.press('Tab');

    // Arrow down should navigate to the second item
    await page.keyboard.press('ArrowDown');

    // eslint-disable-next-line playwright/no-nth-methods -- Testing keyboard navigation requires checking specific indices
    await expect(popoverItems.first()).not.toHaveAttribute('data-blok-focused', 'true');
    // eslint-disable-next-line playwright/no-nth-methods -- Testing keyboard navigation requires checking specific indices
    await expect(popoverItems.nth(1)).toHaveAttribute('data-blok-focused', 'true');

    // Navigate back up
    await page.keyboard.press('ArrowUp');

    // eslint-disable-next-line playwright/no-nth-methods -- Testing keyboard navigation requires checking specific indices
    await expect(popoverItems.first()).toHaveAttribute('data-blok-focused', 'true');
  });

  test('navigates through toolbox items with Tab and Shift+Tab after initial focus', async ({ page, browserName }) => {
    // eslint-disable-next-line playwright/no-skipped-test -- Firefox doesn't support keyboard nav from contenteditable
    test.skip(browserName === 'firefox', 'Firefox has different Tab behavior when focus is in contenteditable');
    await createBlokWithTools(page, {
      simpleTool: {
        class: SimpleTestTool as unknown as BlockToolConstructable,
      },
      anotherTool: {
        class: AnotherTestTool as unknown as BlockToolConstructable,
      },
    });

    await openToolbox(page);

    const popoverItems = page.locator(`${POPOVER_ITEM_SELECTOR}:not([data-blok-hidden="true"])`);
    const itemsCount = await popoverItems.count();

    expect(itemsCount).toBeGreaterThan(2);

    // First item should be focused after toolbox opens
    // eslint-disable-next-line playwright/no-nth-methods -- Testing keyboard navigation requires checking specific indices
    await expect(popoverItems.first()).toHaveAttribute('data-blok-focused', 'true');

    // First Tab moves focus out of contenteditable (browser default)
    await page.keyboard.press('Tab');

    // Now Tab navigates Flipper items - move to second item
    await page.keyboard.press('Tab');

    // eslint-disable-next-line playwright/no-nth-methods -- Testing keyboard navigation requires checking specific indices
    await expect(popoverItems.nth(1)).toHaveAttribute('data-blok-focused', 'true');

    // Another Tab - move to third item
    await page.keyboard.press('Tab');

    // eslint-disable-next-line playwright/no-nth-methods -- Testing keyboard navigation requires checking specific indices
    await expect(popoverItems.nth(2)).toHaveAttribute('data-blok-focused', 'true');

    // Navigate back with Shift+Tab
    await page.keyboard.press('Shift+Tab');

    // eslint-disable-next-line playwright/no-nth-methods -- Testing keyboard navigation requires checking specific indices
    await expect(popoverItems.nth(1)).toHaveAttribute('data-blok-focused', 'true');
  });

  test('inserts tool with Enter key on focused item', async ({ page, browserName }) => {
    // eslint-disable-next-line playwright/no-skipped-test -- Firefox doesn't support keyboard nav from contenteditable
    test.skip(browserName === 'firefox', 'Firefox has different Tab behavior when focus is in contenteditable');
    /**
     * Mock tool for testing
     */
    const TestTool = class {
      /**
       * Specify how to display Tool in a Toolbox
       */
      public static get toolbox(): ToolboxConfig {
        return {
          icon: '⚡',
          title: 'Test Tool',
        };
      }

      private data: { text: string };

      /**
       * Constructor
       * @param options - Tool options
       */
      constructor({ data }: { data: { text: string } }) {
        this.data = data;
      }

      /**
       * Render tool element
       * @returns Rendered HTML element
       */
      public render(): HTMLElement {
        const element = document.createElement('div');

        element.setAttribute('data-blok-testid', 'test-tool-block');
        element.contentEditable = 'true';
        element.textContent = this.data.text;

        return element;
      }

      /**
       * Save tool data
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

    await createBlokWithTools(page, {
      testTool: {
        class: TestTool as unknown as BlockToolConstructable,
      },
    });

    await openToolbox(page);

    // Find and focus the test tool item
    const testToolItem = page.locator(`${POPOVER_ITEM_SELECTOR}[data-blok-item-name="testTool"]`);

    await expect(testToolItem).toBeVisible();

    // Tab first to enable Flipper keyboard handling (focus is in contenteditable after "/")
    await page.keyboard.press('Tab');

    // Navigate to test tool using arrow keys
    while (!await testToolItem.getAttribute('data-blok-focused')) {
      await page.keyboard.press('ArrowDown');
    }

    await expect(testToolItem).toHaveAttribute('data-blok-focused', 'true');

    // Press Enter to insert the tool
    await page.keyboard.press('Enter');

    // Toolbox should close
    const popover = page.locator(POPOVER_SELECTOR);

    await expect(popover).not.toHaveAttribute('data-blok-popover-opened', 'true');

    // New block should be inserted
    const testToolBlock = page.locator('[data-blok-testid="test-tool-block"]');

    await expect(testToolBlock).toBeVisible();
  });

  test('@smoke closes toolbox with Escape key', async ({ page }) => {
    await createBlokWithTools(page, {
      simpleTool: {
        class: SimpleTestTool as unknown as BlockToolConstructable,
      },
    });

    await openToolbox(page);

    const popover = page.locator(POPOVER_SELECTOR);

    await expect(popover).toHaveAttribute('data-blok-popover-opened', 'true');

    await page.keyboard.press('Escape');

    await expect(popover).not.toHaveAttribute('data-blok-popover-opened', 'true');
  });

  test('wraps focus around when reaching end of list with ArrowDown', async ({ page, browserName }) => {
    // eslint-disable-next-line playwright/no-skipped-test -- Firefox doesn't support keyboard nav from contenteditable
    test.skip(browserName === 'firefox', 'Firefox has different Tab behavior when focus is in contenteditable');
    await createBlokWithTools(page, {
      simpleTool: {
        class: SimpleTestTool as unknown as BlockToolConstructable,
      },
      anotherTool: {
        class: AnotherTestTool as unknown as BlockToolConstructable,
      },
    });

    await openToolbox(page);

    const popoverItems = page.locator(`${POPOVER_ITEM_SELECTOR}:not([data-blok-hidden="true"])`);
    const itemsCount = await popoverItems.count();

    expect(itemsCount).toBeGreaterThan(0);

    // Tab first to enable Flipper keyboard handling (focus is in contenteditable after "/")
    await page.keyboard.press('Tab');

    // Navigate to the last item
    for (let i = 0; i < itemsCount - 1; i++) {
      await page.keyboard.press('ArrowDown');
    }

    // eslint-disable-next-line playwright/no-nth-methods -- Testing keyboard navigation requires checking specific indices
    await expect(popoverItems.last()).toHaveAttribute('data-blok-focused', 'true');

    // Press ArrowDown one more time - should wrap to first item
    await page.keyboard.press('ArrowDown');

    // eslint-disable-next-line playwright/no-nth-methods -- Testing keyboard navigation requires checking specific indices
    await expect(popoverItems.first()).toHaveAttribute('data-blok-focused', 'true');
  });
});
