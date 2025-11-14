import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ToolboxConfig, ToolboxConfigEntry, BlockToolData, OutputData } from '@/types';
import type { BlockToolConstructable } from '@/types/tools';
import { EDITOR_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureEditorBundleBuilt } from '../helpers/ensure-build';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'editorjs';
const BLOCK_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} .cdx-block`;
const PLUS_BUTTON_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} .ce-toolbar__plus`;
const POPOVER_ITEM_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} .ce-popover-item`;
const POPOVER_ITEM_ICON_SELECTOR = '.ce-popover-item__icon';

const ICON = '<svg width="17" height="15" viewBox="0 0 336 276" xmlns="http://www.w3.org/2000/svg"><path d="M291 150V79c0-19-15-34-34-34H79c-19 0-34 15-34 34v42l67-44 81 72 56-29 42 30zm0 52l-43-30-56 30-81-67-66 39v23c0 19 15 34 34 34h178c17 0 31-13 34-29zM79 0h178c44 0 79 35 79 79v118c0 44-35 79-79 79H79c-44 0-79-35-79-79V79C0 35 35 0 79 0z"></path></svg>';

const getLocatorOrThrow = (locators: Locator[], index: number, errorMessage: string): Locator => {
  const locator = locators[index];

  if (!locator) {
    throw new Error(errorMessage);
  }

  return locator;
};

const getFirstBlock = async (page: Page): Promise<Locator> => {
  const blocks = await page.locator(BLOCK_SELECTOR).all();
  const firstBlock = blocks[0];

  if (!firstBlock) {
    throw new Error('No editor blocks were rendered');
  }

  return firstBlock;
};

const getLastBlock = async (page: Page): Promise<Locator> => {
  const blocks = await page.locator(BLOCK_SELECTOR).all();
  const lastBlock = blocks[blocks.length - 1];

  if (!lastBlock) {
    throw new Error('No editor blocks were rendered');
  }

  return lastBlock;
};

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
 */
type ToolRegistrationOptions = {
  globals?: Record<string, unknown>;
};

type SerializedToolConfig = {
  name: string;
  classSource: string;
  config?: Record<string, unknown>;
};

const serializeTools = (
  tools: Record<string, BlockToolConstructable | { class: BlockToolConstructable }>
): SerializedToolConfig[] => {
  return Object.entries(tools).map(([name, tool]) => {
    if (typeof tool === 'function') {
      return {
        name,
        classSource: tool.toString(),
      };
    }

    const { class: toolClass, ...config } = tool;

    return {
      name,
      classSource: toolClass.toString(),
      config,
    };
  });
};

const createEditorWithTools = async (
  page: Page,
  tools: Record<string, BlockToolConstructable | { class: BlockToolConstructable }>,
  options: ToolRegistrationOptions = {}
): Promise<void> => {
  await resetEditor(page);
  const serializedTools = serializeTools(tools);

  const registeredToolNames = await page.evaluate(
    async ({ holderId, editorTools, globals }) => {
      const reviveToolClass = (classSource: string, classGlobals: Record<string, unknown>): BlockToolConstructable => {
        const globalKeys = Object.keys(classGlobals);
        const factoryBody = `${globalKeys
          .map((key) => `const ${key} = globals[${JSON.stringify(key)}];`)
          .join('\n')}
return (${classSource});
`;

        return new Function('globals', factoryBody)(classGlobals) as BlockToolConstructable;
      };

      const toolsMap = editorTools.reduce<Record<string, BlockToolConstructable | { class: BlockToolConstructable }>>(
        (accumulated, toolConfig) => {
          const toolClass = reviveToolClass(toolConfig.classSource, globals);

          if (toolConfig.config) {
            return {
              ...accumulated,
              [toolConfig.name]: {
                ...toolConfig.config,
                class: toolClass,
              },
            };
          }

          return {
            ...accumulated,
            [toolConfig.name]: toolClass,
          };
        },
        {}
      );

      const editor = new window.EditorJS({
        holder: holderId,
        tools: toolsMap,
      });

      window.editorInstance = editor;
      await editor.isReady;

      return Object.keys(toolsMap);
    },
    {
      holderId: HOLDER_ID,
      editorTools: serializedTools,
      globals: options.globals ?? {},
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

test.describe('editor Tools Api', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test.describe('toolbox', () => {
    test('should render a toolbox entry for tool if configured', async ({ page }) => {
      /**
       * Tool with single toolbox entry configured
       */
      const TestTool = class {
        /**
         * Returns toolbox config as list of entries
         */
        public static get toolbox(): ToolboxConfigEntry {
          return {
            title: 'Entry 1',
            icon: ICON,
          };
        }

        private data: { text: string };

        /**
         * Tool constructor
         *
         * @param root0 - Constructor parameters
         * @param root0.data - Tool data
         */
        constructor({ data }: { data: { text: string } }) {
          this.data = { text: data.text };
        }

        /**
         * Return Tool's view
         */
        public render(): HTMLElement {
          const contenteditable = document.createElement('div');

          contenteditable.contentEditable = 'true';
          contenteditable.classList.add('cdx-block');
          // Always initialize textContent to ensure it's never null
          contenteditable.textContent = this.data.text;

          return contenteditable;
        }

        /**
         * Extracts Tool's data from the view
         *
         * @param el - Tool view element
         */
        public save(el: HTMLElement): { text: string } {
          // textContent is initialized in render with this.data.text which is always a string
          const textContent = el.textContent;

          return {
            text: textContent as string,
          };
        }
      };

      await createEditorWithTools(
        page,
        {
          testTool: TestTool as unknown as BlockToolConstructable,
        },
        { globals: { ICON } }
      );

      const block = await getFirstBlock(page);

      await block.click();

      const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

      await expect(plusButton).toBeVisible();
      await plusButton.click();

      const toolboxItems = page.locator(`${POPOVER_ITEM_SELECTOR}[data-item-name="testTool"]`);

      await expect(toolboxItems).toHaveCount(1);

      const icons = await toolboxItems.locator(POPOVER_ITEM_ICON_SELECTOR).all();
      const icon = getLocatorOrThrow(icons, 0, 'Toolbox icon was not rendered');
      const iconHTML = await icon.innerHTML();

      expect(iconHTML).toContain(TestTool.toolbox.icon);
    });

    test('should render several toolbox entries for one tool if configured', async ({ page }) => {
      /**
       * Tool with several toolbox entries configured
       */
      const TestTool = class {
        /**
         * Returns toolbox config as list of entries
         */
        public static get toolbox(): ToolboxConfig {
          return [
            {
              title: 'Entry 1',
              icon: ICON,
            },
            {
              title: 'Entry 2',
              icon: ICON,
            },
          ];
        }

        private data: { text: string };

        /**
         * Tool constructor
         *
         * @param root0 - Constructor parameters
         * @param root0.data - Tool data
         */
        constructor({ data }: { data: { text: string } }) {
          this.data = { text: data.text };
        }

        /**
         * Return Tool's view
         */
        public render(): HTMLElement {
          const contenteditable = document.createElement('div');

          contenteditable.contentEditable = 'true';
          contenteditable.classList.add('cdx-block');
          // Always initialize textContent to ensure it's never null
          contenteditable.textContent = this.data.text;

          return contenteditable;
        }

        /**
         * Extracts Tool's data from the view
         *
         * @param el - Tool view element
         */
        public save(el: HTMLElement): { text: string } {
          // textContent is initialized in render with this.data.text which is always a string
          const textContent = el.textContent;

          return {
            text: textContent as string,
          };
        }
      };

      await createEditorWithTools(
        page,
        {
          testTool: TestTool as unknown as BlockToolConstructable,
        },
        { globals: { ICON } }
      );

      const block = await getFirstBlock(page);

      await block.click();

      const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

      await expect(plusButton).toBeVisible();
      await plusButton.click();

      const toolboxItems = page.locator(`${POPOVER_ITEM_SELECTOR}[data-item-name="testTool"]`);

      await expect(toolboxItems).toHaveCount(2);

      const toolboxConfig = TestTool.toolbox as ToolboxConfigEntry[];

      const toolboxEntries = await toolboxItems.all();
      const firstEntry = getLocatorOrThrow(toolboxEntries, 0, 'First toolbox entry was not rendered');
      const secondEntry = getLocatorOrThrow(toolboxEntries, 1, 'Second toolbox entry was not rendered');

      await expect(firstEntry).toContainText(toolboxConfig[0].title ?? '');
      await expect(secondEntry).toContainText(toolboxConfig[1].title ?? '');
    });

    test('should insert block with overridden data on entry click in case toolbox entry provides data overrides', async ({ page }) => {
      const text = 'Text';
      const dataOverrides = {
        testProp: 'new value',
      };

      /**
       * Tool with default data to be overridden
       */
      const TestTool = class {
        private _data: { testProp: string; text?: string };

        /**
         * Tool constructor
         *
         * @param data - previously saved data
         */
        constructor({ data }: { data: { testProp: string; text?: string } }) {
          this._data = data;
        }

        /**
         * Returns toolbox config as list of entries with overridden data
         */
        public static get toolbox(): ToolboxConfig {
          return [
            {
              title: 'Entry 1',
              icon: ICON,
              data: dataOverrides,
            },
          ];
        }

        /**
         * Return Tool's view
         */
        public render(): HTMLElement {
          const wrapper = document.createElement('div');

          wrapper.setAttribute('contenteditable', 'true');
          wrapper.classList.add('cdx-block');

          return wrapper;
        }

        /**
         * Extracts Tool's data from the view
         *
         * @param el - tool view
         */
        public save(el: HTMLElement): BlockToolData {
          return {
            ...this._data,
            text: el.innerHTML,
          };
        }
      };

      await createEditorWithTools(
        page,
        {
          testTool: TestTool as unknown as BlockToolConstructable,
        },
        {
          globals: {
            ICON,
            dataOverrides,
          },
        }
      );

      const block = await getFirstBlock(page);

      await block.click();

      const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

      await expect(plusButton).toBeVisible();
      await plusButton.click();

      const toolboxEntryLocators = await page
        .locator(`${POPOVER_ITEM_SELECTOR}[data-item-name="testTool"]`)
        .all();
      const toolboxItem = getLocatorOrThrow(
        toolboxEntryLocators,
        0,
        'Toolbox entry was not rendered'
      );

      await toolboxItem.click();

      const insertedBlock = await getLastBlock(page);

      await insertedBlock.waitFor({ state: 'visible' });
      await insertedBlock.click();
      await insertedBlock.type(text);

      const editorData = await saveEditor(page);

      expect(editorData.blocks[0].data).toStrictEqual({
        ...dataOverrides,
        text,
      });
    });
  });
});

