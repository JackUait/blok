import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type Blok from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import {
  BLOK_INTERFACE_SELECTOR,
  MODIFIER_KEY,
  selectionChangeDebounceTimeout
} from '../../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'blok';
const BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const SETTINGS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const CONVERT_TO_OPTION_SELECTOR = '[data-blok-testid="popover-item"][data-blok-item-name="convert-to"]';
const NESTED_POPOVER_SELECTOR = '[data-blok-testid="popover"][data-blok-nested="true"]';
const POPOVER_CONTAINER_SELECTOR = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';
const SEARCH_INPUT_SELECTOR = `${POPOVER_CONTAINER_SELECTOR} [data-blok-testid="popover-search-input"]`;
const DEFAULT_WAIT_TIMEOUT = 5_000;
const BLOCK_TUNES_WAIT_BUFFER = 500;

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

  const serializedTools = Object.entries(tools).map(([name, tool]) => ({
    name,
    className: tool.className ?? null,
    classCode: tool.classCode ?? null,
    config: tool.config ?? {},
  }));

  await page.evaluate(
    async ({ holder, data: initialData, serializedTools: toolsConfig }) => {
      const blokConfig: Record<string, unknown> = {
        holder: holder,
      };

      if (initialData) {
        blokConfig.data = initialData;
      }

      if (toolsConfig.length > 0) {
        const resolvedTools = toolsConfig.reduce<
          Record<string, { class: unknown } & Record<string, unknown>>
        >((accumulator, { name, className, classCode, config }) => {
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
        }, {});

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
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('keyboard interactions', () => {
    test('keeps block content when pressing Enter inside search input', async ({ page }) => {
      await createBlok(page, {
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

      const paragraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`);

      await expect(paragraph).toHaveCount(1);
      await expect(paragraph).toHaveText('Some text');
    });

    test('keeps block selection when pressing Enter on a block tune', async ({ page }) => {
      await createBlok(page, {
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
      await expect(block).toHaveAttribute('data-blok-selected', 'true');
    });
  });

  test.describe('convert to', () => {
    test('shows available tools when conversion is possible', async ({ page }) => {
      await createBlok(page, {
        tools: {
          header: {
            className: 'Blok.Header',
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
        .getByTestId('popover-item')
        .filter({ hasText: 'Convert to' });

      await expect(convertToOption).toBeVisible();
      await convertToOption.click();

      await expect(
        page.locator(`${NESTED_POPOVER_SELECTOR} [data-blok-item-name="header"]`)
      ).toBeVisible();
    });

    test('hides convert option when there is nothing to convert to', async ({ page }) => {
      await createBlok(page, {
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
      await createBlok(page, {
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
      await createBlok(page, {
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
        .getByTestId('popover-item')
        .filter({ hasText: 'Convert to' });

      await convertToOption.click();

      await expect(
        page
          .locator(`${NESTED_POPOVER_SELECTOR} [data-blok-item-name="testTool"]`)
          .filter({ hasText: 'Title 1' })
      ).toHaveCount(0);

      await expect(
        page
          .locator(`${NESTED_POPOVER_SELECTOR} [data-blok-item-name="testTool"]`)
          .filter({ hasText: 'Title 2' })
      ).toBeVisible();
    });

    test('converts block and keeps caret inside the new block', async ({ page }) => {
      await createBlok(page, {
        tools: {
          header: {
            className: 'Blok.Header',
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
        .getByTestId('popover-item')
        .filter({ hasText: 'Convert to' });

      await convertToOption.click();
      await page
        .locator(`${NESTED_POPOVER_SELECTOR} [data-blok-item-name="header"]`)
        .click();

      const headerBlock = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-component="header"]`);

      await expect(headerBlock).toHaveText('Some text');
      expect(
        await isSelectionInsideBlock(
          page,
          `${BLOK_INTERFACE_SELECTOR} [data-blok-component="header"]`
        )
      ).toBe(true);
    });
  });

  test.describe('tunes order', () => {
    test('renders block-specific tunes before common tunes', async ({ page }) => {
      await createBlok(page, {
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

      const popoverItems = popoverContainer.locator('[data-blok-testid="popover-item"]:not([data-blok-hidden="true"])');
      const itemsCount = await popoverItems.count();

      expect(itemsCount).toBeGreaterThan(1);
      const firstPopoverItem = popoverContainer.locator('[data-blok-testid="popover-item"]:not([data-blok-hidden="true"]):first-of-type');

      await expect(firstPopoverItem).toContainText('Tune');
    });
  });
});

