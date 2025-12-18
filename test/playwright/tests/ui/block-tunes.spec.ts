import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import {
  BLOK_INTERFACE_SELECTOR,
  MODIFIER_KEY,
  selectionChangeDebounceTimeout
} from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const SETTINGS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const CONVERT_TO_OPTION_SELECTOR = '[data-blok-testid="popover-item"][data-blok-item-name="convert-to"]';
const NESTED_POPOVER_SELECTOR = '[data-blok-nested="true"] [data-blok-testid="popover-container"]';
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
        page.locator(`[data-blok-nested="true"] [data-blok-item-name="header"]`)
      ).toBeVisible();
    });

    test('hides convert option when there is nothing to convert to', async ({ page }) => {
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
          .locator(`[data-blok-nested="true"] [data-blok-item-name="testTool"]`)
          .filter({ hasText: 'Title 1' })
      ).toHaveCount(0);

      await expect(
        page
          .locator(`[data-blok-nested="true"] [data-blok-item-name="testTool"]`)
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
        .locator(`[data-blok-nested="true"] [data-blok-item-name="header"]`)
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

      // eslint-disable-next-line playwright/no-nth-methods -- Testing that block-specific tunes appear first requires checking the first item
      await expect(popoverItems.first()).toContainText('Tune');
    });
  });

  test.describe('keyboard navigation', () => {
    test('navigates through tune options with ArrowDown and ArrowUp', async ({ page }) => {
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

      await openBlockTunesViaShortcut(page);

      const popoverItems = page.locator(`${POPOVER_CONTAINER_SELECTOR} [data-blok-testid="popover-item"]:not([data-blok-hidden="true"])`);
      const itemsCount = await popoverItems.count();

      expect(itemsCount).toBeGreaterThan(1);

      // eslint-disable-next-line playwright/no-nth-methods -- Testing keyboard navigation requires checking specific indices
      const firstVisibleItem = popoverItems.first();

      // When popover opens with search, search input is focused first.
      // Press ArrowDown to move focus to the first item.
      await page.keyboard.press('ArrowDown');

      await expect(firstVisibleItem).toHaveAttribute('data-blok-focused', 'true');

      // Navigate down to second item
      await page.keyboard.press('ArrowDown');

      await expect(firstVisibleItem).not.toHaveAttribute('data-blok-focused', 'true');
      // eslint-disable-next-line playwright/no-nth-methods -- Testing keyboard navigation requires checking specific indices
      await expect(popoverItems.nth(1)).toHaveAttribute('data-blok-focused', 'true');

      // Navigate back up to first item
      await page.keyboard.press('ArrowUp');

      await expect(firstVisibleItem).toHaveAttribute('data-blok-focused', 'true');
    });

    test('activates focused tune option with Enter key', async ({ page }) => {
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

      await openBlockTunesViaShortcut(page);

      // Navigate to convert-to option
      const convertToOption = page.locator(`${POPOVER_CONTAINER_SELECTOR} [data-blok-testid="popover-item"][data-blok-item-name="convert-to"]`);

      await expect(convertToOption).toBeVisible();

      // Focus the convert-to option using keyboard
      while (!await convertToOption.getAttribute('data-blok-focused')) {
        await page.keyboard.press('ArrowDown');
      }

      await expect(convertToOption).toHaveAttribute('data-blok-focused', 'true');

      // Press Enter to activate (opens nested popover)
      await page.keyboard.press('Enter');

      // Nested popover should appear
      await expect(page.locator(NESTED_POPOVER_SELECTOR)).toBeVisible();
    });

    test('opens nested popover with ArrowRight on focused item with children', async ({ page }) => {
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

      await openBlockTunesViaShortcut(page);

      const convertToOption = page.locator(`${POPOVER_CONTAINER_SELECTOR} [data-blok-testid="popover-item"][data-blok-item-name="convert-to"]`);

      await expect(convertToOption).toBeVisible();

      // Focus the convert-to option
      while (!await convertToOption.getAttribute('data-blok-focused')) {
        await page.keyboard.press('ArrowDown');
      }

      // Press ArrowRight to open nested popover
      await page.keyboard.press('ArrowRight');

      await expect(page.locator(NESTED_POPOVER_SELECTOR)).toBeVisible();
    });

    test('closes nested popover with ArrowLeft and returns focus to parent', async ({ page }) => {
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

      await openBlockTunesViaShortcut(page);

      const convertToOption = page.locator(`${POPOVER_CONTAINER_SELECTOR} [data-blok-testid="popover-item"][data-blok-item-name="convert-to"]`);

      // Focus and open nested popover
      while (!await convertToOption.getAttribute('data-blok-focused')) {
        await page.keyboard.press('ArrowDown');
      }

      await page.keyboard.press('ArrowRight');

      await expect(page.locator(NESTED_POPOVER_SELECTOR)).toBeVisible();

      // Press ArrowLeft to close nested popover
      await page.keyboard.press('ArrowLeft');

      await expect(page.locator(NESTED_POPOVER_SELECTOR)).toHaveCount(0);

      // Parent item should be focused again
      await expect(convertToOption).toHaveAttribute('data-blok-focused', 'true');
    });

    test('navigates within nested popover using arrow keys', async ({ page }) => {
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

      await openBlockTunesViaShortcut(page);

      const convertToOption = page.locator(`${POPOVER_CONTAINER_SELECTOR} [data-blok-testid="popover-item"][data-blok-item-name="convert-to"]`);

      // Open nested popover
      while (!await convertToOption.getAttribute('data-blok-focused')) {
        await page.keyboard.press('ArrowDown');
      }

      await page.keyboard.press('ArrowRight');

      const nestedPopover = page.locator(NESTED_POPOVER_SELECTOR);

      await expect(nestedPopover).toBeVisible();

      // Navigate within nested popover
      const nestedItems = nestedPopover.locator('[data-blok-testid="popover-item"]');
      const nestedItemsCount = await nestedItems.count();

      expect(nestedItemsCount).toBeGreaterThan(0);

      // First item in nested popover should be focused
      // eslint-disable-next-line playwright/no-nth-methods -- need to check first item
      await expect(nestedItems.first()).toHaveAttribute('data-blok-focused', 'true');

      // Navigate down in nested popover - verify we can navigate if there are multiple items
      // eslint-disable-next-line playwright/no-conditional-in-test -- checking navigation only when multiple items exist
      if (nestedItemsCount > 1) {
        await page.keyboard.press('ArrowDown');
        // eslint-disable-next-line playwright/no-nth-methods, playwright/no-conditional-expect -- need to check second item, conditionally
        await expect(nestedItems.nth(1)).toHaveAttribute('data-blok-focused', 'true');
      }
    });

    test('closes block tunes popover with Escape key', async ({ page }) => {
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

      const popoverContainer = page.locator(POPOVER_CONTAINER_SELECTOR);

      await expect(popoverContainer).toBeVisible();

      await page.keyboard.press('Escape');

      await expect(popoverContainer).toHaveCount(0);
    });

    test('selects tool in nested popover with Enter and converts block', async ({ page }) => {
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

      await openBlockTunesViaShortcut(page);

      const convertToOption = page.locator(`${POPOVER_CONTAINER_SELECTOR} [data-blok-testid="popover-item"][data-blok-item-name="convert-to"]`);

      // Navigate to and open nested popover
      while (!await convertToOption.getAttribute('data-blok-focused')) {
        await page.keyboard.press('ArrowDown');
      }

      await page.keyboard.press('ArrowRight');

      const nestedPopover = page.locator(NESTED_POPOVER_SELECTOR);

      await expect(nestedPopover).toBeVisible();

      // Navigate to header option and select it
      const headerOption = nestedPopover.locator('[data-blok-item-name="header"]');

      await expect(headerOption).toBeVisible();

      while (!await headerOption.getAttribute('data-blok-focused')) {
        await page.keyboard.press('ArrowDown');
      }

      await page.keyboard.press('Enter');

      // Block should be converted to header
      const headerBlock = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-component="header"]`);

      await expect(headerBlock).toHaveText('Some text');
    });
  });
});

