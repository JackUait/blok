import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type EditorJS from '@/types';
import type { OutputData } from '@/types';
import { ensureEditorBundleBuilt } from '../helpers/ensure-build';
import {
  EDITOR_INTERFACE_SELECTOR,
  MODIFIER_KEY,
  selectionChangeDebounceTimeout
} from '../../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HEADER_TOOL_UMD_PATH = path.resolve(
  __dirname,
  '../../../../node_modules/@editorjs/header/dist/header.umd.js'
);

const HOLDER_ID = 'editorjs';
const BLOCK_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} .ce-block`;
const SETTINGS_BUTTON_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} .ce-toolbar__settings-btn`;
const CONVERT_TO_OPTION_SELECTOR = '.ce-popover-item[data-item-name="convert-to"]';
const NESTED_POPOVER_SELECTOR = '.ce-popover--nested';
const POPOVER_CONTAINER_SELECTOR = '.ce-popover.ce-popover--opened > .ce-popover__container';
const SEARCH_INPUT_SELECTOR = `${POPOVER_CONTAINER_SELECTOR} .cdx-search-field__input`;
const DEFAULT_WAIT_TIMEOUT = 5_000;
const BLOCK_TUNES_WAIT_BUFFER = 500;

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

  const serializedTools = Object.entries(tools).map(([name, tool]) => ({
    name,
    className: tool.className ?? null,
    classCode: tool.classCode ?? null,
    config: tool.config ?? {},
  }));

  await page.evaluate(
    async ({ holderId, data: initialData, serializedTools: toolsConfig }) => {
      const editorConfig: Record<string, unknown> = {
        holder: holderId,
      };

      if (initialData) {
        editorConfig.data = initialData;
      }

      if (toolsConfig.length > 0) {
        const resolvedTools = toolsConfig.reduce<
          Record<string, { class: unknown } & Record<string, unknown>>
        >((accumulator, { name, className, classCode, config }) => {
          let toolClass: unknown = null;

          if (className) {
            toolClass = (window as unknown as Record<string, unknown>)[className] ?? null;
          }

          if (!toolClass && classCode) {
            // eslint-disable-next-line no-new-func -- executed in browser context to recreate tool class
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
        }, {});

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

const waitForBlockTunesPopover = async (
  page: Page,
  timeout = DEFAULT_WAIT_TIMEOUT
): Promise<void> => {
  const popover = page.locator(POPOVER_CONTAINER_SELECTOR);

  await expect(popover).toHaveCount(1);
  await popover.waitFor({
    state: 'visible',
    timeout,
  });
};

const focusFirstBlock = async (page: Page): Promise<void> => {
  const block = page.locator(BLOCK_SELECTOR);

  await expect(block).toHaveCount(1);
  await expect(block).toBeVisible();
  await block.click();
};

const openBlockTunesViaToolbar = async (page: Page): Promise<void> => {
  await focusFirstBlock(page);

  const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

  await expect(settingsButton).toBeVisible();
  await settingsButton.click();
  await waitForBlockTunesPopover(page);
};

const openBlockTunesViaShortcut = async (page: Page): Promise<void> => {
  await focusFirstBlock(page);
  await page.keyboard.press(`${MODIFIER_KEY}+/`);
  await waitForBlockTunesPopover(
    page,
    selectionChangeDebounceTimeout + BLOCK_TUNES_WAIT_BUFFER
  );
};

const toolWithoutConversionExportClass = (): string => `
(() => {
  return class ToolWithoutConversionExport {
    constructor({ data }) {
      this.data = data ?? { text: 'Some text' };
    }

    static get conversionConfig() {
      return {
        import: 'text',
      };
    }

    render() {
      const element = document.createElement('div');

      element.contentEditable = 'true';
      element.textContent = this.data?.text ?? '';

      return element;
    }

    save(element) {
      return {
        text: element.innerHTML,
      };
    }
  };
})()
`;

const toolWithToolboxVariantsClass = (): string => `
(() => {
  return class TestTool {
    constructor({ data }) {
      this.data = data ?? { text: 'Some text', level: 1 };
    }

    static get conversionConfig() {
      return {
        import: 'text',
        export: 'text',
      };
    }

    static get toolbox() {
      return [
        {
          title: 'Title 1',
          icon: 'Icon1',
          data: {
            level: 1,
          },
        },
        {
          title: 'Title 2',
          icon: 'Icon2',
          data: {
            level: 2,
          },
        },
      ];
    }

    render() {
      const element = document.createElement('div');

      element.textContent = this.data?.text ?? 'Some text';

      return element;
    }

    save() {
      return {
        text: this.data?.text ?? 'Some text',
        level: this.data?.level ?? 1,
      };
    }
  };
})()
`;

const toolWithCustomTuneClass = (): string => `
(() => {
  return class TestTool {
    constructor({ data }) {
      this.data = data ?? { text: 'Some text', level: 1 };
    }

    static get toolbox() {
      return [
        {
          title: 'Title 1',
          icon: 'Icon1',
          data: {
            level: 1,
          },
        },
      ];
    }

    render() {
      const element = document.createElement('div');

      element.textContent = this.data?.text ?? 'Some text';

      return element;
    }

    save() {
      return {
        text: this.data?.text ?? 'Some text',
        level: this.data?.level ?? 1,
      };
    }

    renderSettings() {
      return {
        icon: 'Icon',
        title: 'Tune',
        onActivate: () => {},
      };
    }
  };
})()
`;

const isSelectionInsideBlock = async (page: Page, selector: string): Promise<boolean> => {
  return await page.evaluate(({ blockSelector }) => {
    const block = document.querySelector(blockSelector);
    const selection = window.getSelection();

    if (!block || !selection || selection.rangeCount === 0) {
      return false;
    }

    const range = selection.getRangeAt(0);

    return block.contains(range.startContainer);
  }, { blockSelector: selector });
};

test.describe('ui.block-tunes', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.EditorJS === 'function');
  });

  test.describe('keyboard interactions', () => {
    test('keeps block content when pressing Enter inside search input', async ({ page }) => {
      await createEditor(page, {
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: {
                text: 'Some text',
              },
            },
          ],
        },
      });

      await openBlockTunesViaShortcut(page);

      const searchInput = page.locator(SEARCH_INPUT_SELECTOR);

      await expect(searchInput).toHaveCount(1);
      await searchInput.waitFor({ state: 'visible' });
      await page.keyboard.press('Enter');

      const paragraph = page.locator(`${EDITOR_INTERFACE_SELECTOR} .ce-paragraph`);

      await expect(paragraph).toHaveCount(1);
      await expect(paragraph).toHaveText('Some text');
    });

    test('keeps block selection when pressing Enter on a block tune', async ({ page }) => {
      await createEditor(page, {
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: {
                text: 'Some text',
              },
            },
          ],
        },
      });

      await openBlockTunesViaShortcut(page);

      const searchInput = page.locator(SEARCH_INPUT_SELECTOR);

      await expect(searchInput).toHaveCount(1);
      await searchInput.waitFor({ state: 'visible' });
      await page.keyboard.press('Enter');

      const block = page.locator(BLOCK_SELECTOR);

      await expect(block).toHaveCount(1);
      await expect(block).toHaveClass(/ce-block--selected/);
    });
  });

  test.describe('convert to', () => {
    test('shows available tools when conversion is possible', async ({ page }) => {
      await page.addScriptTag({ path: HEADER_TOOL_UMD_PATH });
      await createEditor(page, {
        tools: {
          header: {
            className: 'Header',
          },
        },
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: {
                text: 'Some text',
              },
            },
          ],
        },
      });

      await openBlockTunesViaToolbar(page);

      const convertToOption = page
        .locator('.ce-popover-item')
        .filter({ hasText: 'Convert to' });

      await expect(convertToOption).toBeVisible();
      await convertToOption.click();

      await expect(
        page.locator(`${NESTED_POPOVER_SELECTOR} [data-item-name="header"]`)
      ).toBeVisible();
    });

    test('hides convert option when there is nothing to convert to', async ({ page }) => {
      await createEditor(page, {
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: {
                text: 'Some text',
              },
            },
          ],
        },
      });

      await openBlockTunesViaToolbar(page);

      await expect(page.locator(CONVERT_TO_OPTION_SELECTOR)).toHaveCount(0);
    });

    test('hides convert option when export is not configured', async ({ page }) => {
      await createEditor(page, {
        tools: {
          testTool: {
            classCode: toolWithoutConversionExportClass(),
          },
        },
        data: {
          blocks: [
            {
              type: 'testTool',
              data: {
                text: 'Some text',
              },
            },
          ],
        },
      });

      await openBlockTunesViaToolbar(page);

      await expect(page.locator(CONVERT_TO_OPTION_SELECTOR)).toHaveCount(0);
    });

    test('filters out options with identical data', async ({ page }) => {
      await createEditor(page, {
        tools: {
          testTool: {
            classCode: toolWithToolboxVariantsClass(),
          },
        },
        data: {
          blocks: [
            {
              type: 'testTool',
              data: {
                text: 'Some text',
                level: 1,
              },
            },
          ],
        },
      });

      await openBlockTunesViaToolbar(page);

      const convertToOption = page
        .locator('.ce-popover-item')
        .filter({ hasText: 'Convert to' });

      await convertToOption.click();

      await expect(
        page
          .locator(`${NESTED_POPOVER_SELECTOR} [data-item-name="testTool"]`)
          .filter({ hasText: 'Title 1' })
      ).toHaveCount(0);

      await expect(
        page
          .locator(`${NESTED_POPOVER_SELECTOR} [data-item-name="testTool"]`)
          .filter({ hasText: 'Title 2' })
      ).toBeVisible();
    });

    test('converts block and keeps caret inside the new block', async ({ page }) => {
      await page.addScriptTag({ path: HEADER_TOOL_UMD_PATH });
      await createEditor(page, {
        tools: {
          header: {
            className: 'Header',
          },
        },
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: {
                text: 'Some text',
              },
            },
          ],
        },
      });

      await openBlockTunesViaToolbar(page);

      const convertToOption = page
        .locator('.ce-popover-item')
        .filter({ hasText: 'Convert to' });

      await convertToOption.click();
      await page
        .locator(`${NESTED_POPOVER_SELECTOR} [data-item-name="header"]`)
        .click();

      const headerBlock = page.locator(`${EDITOR_INTERFACE_SELECTOR} .ce-header`);

      await expect(headerBlock).toHaveText('Some text');
      expect(
        await isSelectionInsideBlock(
          page,
          `${EDITOR_INTERFACE_SELECTOR} .ce-header`
        )
      ).toBe(true);
    });
  });

  test.describe('tunes order', () => {
    test('renders block-specific tunes before common tunes', async ({ page }) => {
      await createEditor(page, {
        tools: {
          testTool: {
            classCode: toolWithCustomTuneClass(),
          },
        },
        data: {
          blocks: [
            {
              type: 'testTool',
              data: {
                text: 'Some text',
                level: 1,
              },
            },
          ],
        },
      });

      await openBlockTunesViaToolbar(page);

      const popoverContainer = page.locator(POPOVER_CONTAINER_SELECTOR);

      await expect(popoverContainer).toHaveCount(1);

      const popoverItems = popoverContainer.locator('.ce-popover-item:not(.ce-popover-item--hidden)');
      const itemsCount = await popoverItems.count();

      expect(itemsCount).toBeGreaterThan(1);
      const firstPopoverItem = popoverContainer.locator('.ce-popover-item:not(.ce-popover-item--hidden):first-of-type');

      await expect(firstPopoverItem).toContainText('Tune');
    });
  });
});

