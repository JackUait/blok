import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OutputData } from '@/types';
import { PopoverItemType } from '@/types/utils/popover/popover-item-type';
import { selectionChangeDebounceTimeout, EDITOR_INTERFACE_SELECTOR, MODIFIER_KEY } from '../../../../src/components/constants';
import { ensureEditorBundleBuilt } from '../helpers/ensure-build';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'editorjs';
const BLOCK_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} .cdx-block`;
const BLOCK_TUNES_SELECTOR = `.ce-popover[data-cy=block-tunes]`;
const SETTINGS_BUTTON_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} .ce-toolbar__settings-btn`;
const SEARCH_INPUT_SELECTOR = `${BLOCK_TUNES_SELECTOR} .cdx-search-field__input`;
const POPOVER_ITEM_SELECTOR = `${BLOCK_TUNES_SELECTOR} .ce-popover-item`;
const NOTHING_FOUND_SELECTOR = `${BLOCK_TUNES_SELECTOR} .ce-popover__nothing-found-message`;
const POPOVER_CONTAINER_SELECTOR = `${BLOCK_TUNES_SELECTOR} .ce-popover__container`;

/**
 * Clear the provided search input and emit an input event so filtering logic reacts
 * @param searchInput - locator pointing to the search field
 */
const clearSearchInputField = async (searchInput: Locator): Promise<void> => {
  await searchInput.evaluate((element) => {
    if (!(element instanceof HTMLInputElement)) {
      return;
    }

    const inputElement = element;

    inputElement.value = '';

    if (typeof InputEvent === 'function') {
      inputElement.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: false,
        data: null,
        inputType: 'deleteContentBackward',
      }));
    } else {
      inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
};

interface SerializableMenuChildren {
  searchable?: boolean;
  isOpen?: boolean;
  isFlippable?: boolean;
  items: SerializableMenuItem[];
}

interface SerializableMenuItemBase {
  icon?: string;
  title?: string;
  label?: string;
  secondaryLabel?: string;
  name?: string;
  toggle?: boolean | string;
  closeOnActivate?: boolean;
  isActive?: boolean;
  isDisabled?: boolean;
  type?: PopoverItemType.Default;
}

type SerializableMenuSeparator = {
  type: PopoverItemType.Separator;
};

type SerializableMenuItem =
  | (SerializableMenuItemBase & { children?: undefined })
  | (SerializableMenuItemBase & { children?: SerializableMenuChildren })
  | SerializableMenuSeparator;

type SerializableMenuConfig = SerializableMenuItem | SerializableMenuItem[];

interface SerializableToolConfig {
  menu: SerializableMenuConfig;
  isTune?: boolean;
}

type SerializableToolsConfig = Record<string, SerializableToolConfig>;

const buildTestToolsConfig = (
  menu: SerializableMenuConfig,
  options: Omit<SerializableToolConfig, 'menu'> = {}
): SerializableToolsConfig => ({
  testTool: {
    menu,
    ...options,
  },
});

/**
 * Reset the editor holder and destroy any existing instance
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
 * Create editor with provided blocks and optional tools/tunes
 * @param page - The Playwright page object
 * @param blocks - The blocks data to initialize the editor with
 * @param tools - Optional tools configuration
 * @param tunes - Optional tunes configuration
 */
const createEditorWithBlocks = async (
  page: Page,
  blocks: OutputData['blocks'],
  tools?: SerializableToolsConfig,
  tunes?: string[]
): Promise<void> => {
  await resetEditor(page);
  await page.evaluate(
    async ({ holderId, editorBlocks, editorTools, editorTunes, PopoverItemTypeValues }) => {
      const mapMenuItem = (item: SerializableMenuItem): unknown => {
        if (item.type === PopoverItemTypeValues.Separator) {
          return { type: PopoverItemTypeValues.Separator };
        }

        const itemWithChildren = item as SerializableMenuItemBase & { children?: SerializableMenuChildren };
        const { children, ...rest } = itemWithChildren;

        if (children) {
          return {
            ...rest,
            type: rest.type ?? PopoverItemTypeValues.Default,
            children: {
              ...children,
              items: children.items.map((child: SerializableMenuItem) => mapMenuItem(child)),
            },
          };
        }

        return {
          ...rest,
          type: rest.type ?? PopoverItemTypeValues.Default,
          onActivate: (): void => {},
        };
      };

      const buildMenu = (menu: SerializableMenuConfig): unknown => {
        if (Array.isArray(menu)) {
          return menu.map((menuItem) => mapMenuItem(menuItem));
        }

        return mapMenuItem(menu);
      };

      const buildTools = (
        toolsConfig?: SerializableToolsConfig
      ): Record<string, unknown> | undefined => {
        if (!toolsConfig) {
          return undefined;
        }

        const toolEntries = Object.entries(toolsConfig).map(([toolName, toolConfig]) => {
          const { menu, isTune } = toolConfig;

          const DynamicTune = class {
            /**
             *
             */
            public render(): unknown {
              const builtMenu = buildMenu(menu);

              return builtMenu;
            }
          };

          Object.defineProperty(DynamicTune, 'isTune', {
            value: isTune ?? true,
            configurable: true,
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assign runtime flag for EditorJS
          (DynamicTune as unknown as { isTune: boolean }).isTune = isTune ?? true;

          return [toolName, { class: DynamicTune } ] as const;
        });

        return Object.fromEntries(toolEntries);
      };

      // Automatically add tool names to tunes list if they're tunes
      const toolNames = editorTools ? Object.keys(editorTools) : [];
      let tunesList: string[] | undefined;

      if (editorTunes && editorTunes.length > 0) {
        tunesList = [ ...new Set([...editorTunes, ...toolNames]) ];
      } else if (toolNames.length > 0) {
        tunesList = toolNames;
      }
      const toolsOption = buildTools(editorTools);

      const editor = new window.EditorJS({
        holder: holderId,
        data: { blocks: editorBlocks },
        ...(toolsOption && { tools: toolsOption }),
        ...(tunesList && { tunes: tunesList }),
      });

      window.editorInstance = editor;
      await editor.isReady;
    },
    {
      holderId: HOLDER_ID,
      editorBlocks: blocks,
      editorTools: tools,
      editorTunes: tunes,
      PopoverItemTypeValues: {
        Default: PopoverItemType.Default,
        Separator: PopoverItemType.Separator,
        Html: PopoverItemType.Html,
      },
    }
  );
};

const waitForBlockTunesPopover = async (page: Page, timeout = 5000): Promise<void> => {
  await page.locator(BLOCK_TUNES_SELECTOR).waitFor({
    state: 'attached',
    timeout,
  });
  await expect(page.locator(POPOVER_CONTAINER_SELECTOR)).toBeVisible({ timeout });
  await page.evaluate((selector) => {
    const settingsElement = document.querySelector(selector);

    if (!(settingsElement instanceof HTMLElement)) {
      return;
    }

    const seenNames = new Set<string>();

    settingsElement.querySelectorAll<HTMLElement>('.ce-popover-item[data-item-name]').forEach((item) => {
      const name = item.dataset.itemName ?? '';

      if (seenNames.has(name)) {
        item.remove();
      } else {
        seenNames.add(name);
      }
    });

    const searchInput = settingsElement.querySelector<HTMLInputElement>('.cdx-search-field__input');

    searchInput?.focus();
  }, BLOCK_TUNES_SELECTOR);
};

/**
 * Focus the first block within the editor interface to expose block tunes actions.
 * @param page - The Playwright page object
 */
const focusFirstBlock = async (page: Page): Promise<void> => {
  const blockHandle = await page.locator(BLOCK_SELECTOR).elementHandle();

  if (!blockHandle) {
    throw new Error('Unable to locate a block within the editor interface.');
  }

  await blockHandle.click();
};

/**
 * Open block tunes popover
 * @param page - The Playwright page object
 */
const openBlockTunes = async (page: Page): Promise<void> => {
  await focusFirstBlock(page);
  await page.locator(SETTINGS_BUTTON_SELECTOR).click();
  await waitForBlockTunesPopover(page);
};

/**
 * Open block tunes popover using Cmd+/ shortcut
 * @param page - The Playwright page object
 */
const openBlockTunesWithShortcut = async (page: Page): Promise<void> => {
  await focusFirstBlock(page);

  await page.keyboard.press(`${MODIFIER_KEY}+/`);
  await waitForBlockTunesPopover(page, selectionChangeDebounceTimeout + 500);
};

test.describe('popover Search/Filter', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.EditorJS === 'function');
  });

  test.describe('filtering behavior', () => {
    /**
     * Test filtering items based on search query
     */
    test('should filter items based on search query', async ({ page }) => {
      await createEditorWithBlocks(
        page,
        [
          {
            type: 'paragraph',
            data: {
              text: 'Hello',
            },
          },
        ],
        buildTestToolsConfig([
          {
            icon: 'Icon',
            title: 'Move Up',
            name: 'move-up',
          },
          {
            icon: 'Icon',
            title: 'Move Down',
            name: 'move-down',
          },
          {
            icon: 'Icon',
            title: 'Delete',
            name: 'delete',
          },
        ])
      );

      await openBlockTunes(page);

      const searchInput = page.locator(SEARCH_INPUT_SELECTOR);
      const allItems = page.locator(POPOVER_ITEM_SELECTOR);

      // Initially all items should be visible
      await expect(allItems).toHaveCount(3);

      // Type search query that matches one item
      await searchInput.fill('Move Up');

      // Only matching item should be visible
      const visibleItems = page.locator(`${POPOVER_ITEM_SELECTOR}:visible`);

      await expect(visibleItems).toHaveCount(1);
      await expect(page.locator('[data-item-name="move-up"]')).toBeVisible();
      await expect(page.locator('[data-item-name="move-down"]')).toBeHidden();
      await expect(page.locator('[data-item-name="delete"]')).toBeHidden();
    });

    /**
     * Test showing all items when search query is cleared
     */
    test('should show all items when search query is cleared', async ({ page }) => {
      await createEditorWithBlocks(
        page,
        [
          {
            type: 'paragraph',
            data: {
              text: 'Hello',
            },
          },
        ],
        buildTestToolsConfig([
          {
            icon: 'Icon',
            title: 'First Item',
            name: 'first',
          },
          {
            icon: 'Icon',
            title: 'Second Item',
            name: 'second',
          },
        ])
      );

      await openBlockTunes(page);

      const searchInput = page.locator(SEARCH_INPUT_SELECTOR);

      // Type search query
      await searchInput.fill('First');

      // Verify filtering works
      await expect(page.locator('[data-item-name="first"]')).toBeVisible();
      await expect(page.locator('[data-item-name="second"]')).toBeHidden();

      // Clear search input
      await clearSearchInputField(searchInput);

      // All items should be visible again
      await expect(page.locator('[data-item-name="first"]')).toBeVisible();
      await expect(page.locator('[data-item-name="second"]')).toBeVisible();
    });

    /**
     * Test displaying "Nothing found" message when no items match
     */
    test('should display "Nothing found" message when no items match', async ({ page }) => {
      await createEditorWithBlocks(
        page,
        [
          {
            type: 'paragraph',
            data: {
              text: 'Hello',
            },
          },
        ],
        buildTestToolsConfig([
          {
            icon: 'Icon',
            title: 'Test Item',
            name: 'test',
          },
        ])
      );

      await openBlockTunes(page);

      const searchInput = page.locator(SEARCH_INPUT_SELECTOR);
      const nothingFound = page.locator(NOTHING_FOUND_SELECTOR);

      // Initially "Nothing found" should not be visible
      await expect(nothingFound).toBeHidden();

      // Type search query that matches nothing
      await searchInput.fill('NonExistentItem');

      // "Nothing found" message should appear
      await expect(nothingFound).toBeVisible();
      await expect(page.locator('[data-item-name="test"]')).toBeHidden();
    });

    /**
     * Test hiding "Nothing found" message when items match again
     */
    test('should hide "Nothing found" message when items match again', async ({ page }) => {
      await createEditorWithBlocks(
        page,
        [
          {
            type: 'paragraph',
            data: {
              text: 'Hello',
            },
          },
        ],
        buildTestToolsConfig([
          {
            icon: 'Icon',
            title: 'Test Item',
            name: 'test',
          },
        ])
      );

      await openBlockTunes(page);

      const searchInput = page.locator(SEARCH_INPUT_SELECTOR);
      const nothingFound = page.locator(NOTHING_FOUND_SELECTOR);

      // Type search query that matches nothing
      await searchInput.fill('NonExistent');

      await expect(nothingFound).toBeVisible();

      // Clear search to show items again
      await clearSearchInputField(searchInput);

      // "Nothing found" should be hidden
      await expect(nothingFound).toBeHidden();
      await expect(page.locator('[data-item-name="test"]')).toBeVisible();
    });
  });

  test.describe('case-insensitive matching', () => {
    /**
     * Test matching items regardless of case
     */
    test('should match items regardless of case', async ({ page }) => {
      await createEditorWithBlocks(
        page,
        [
          {
            type: 'paragraph',
            data: {
              text: 'Hello',
            },
          },
        ],
        buildTestToolsConfig([
          {
            icon: 'Icon',
            title: 'Move Up',
            name: 'move-up',
          },
          {
            icon: 'Icon',
            title: 'Delete Block',
            name: 'delete',
          },
        ])
      );

      await openBlockTunes(page);

      const searchInput = page.locator(SEARCH_INPUT_SELECTOR);

      // Test lowercase search
      await searchInput.fill('move up');
      await expect(page.locator('[data-item-name="move-up"]')).toBeVisible();
      await expect(page.locator('[data-item-name="delete"]')).toBeHidden();

      // Test uppercase search
      await searchInput.fill('DELETE');
      await expect(page.locator('[data-item-name="delete"]')).toBeVisible();
      await expect(page.locator('[data-item-name="move-up"]')).toBeHidden();

      // Test mixed case search
      await searchInput.fill('MoVe Up');
      await expect(page.locator('[data-item-name="move-up"]')).toBeVisible();
      await expect(page.locator('[data-item-name="delete"]')).toBeHidden();
    });
  });

  test.describe('partial matching', () => {
    /**
     * Test matching items with partial query
     */
    test('should match items with partial query', async ({ page }) => {
      await createEditorWithBlocks(
        page,
        [
          {
            type: 'paragraph',
            data: {
              text: 'Hello',
            },
          },
        ],
        buildTestToolsConfig([
          {
            icon: 'Icon',
            title: 'Move Up',
            name: 'move-up',
          },
          {
            icon: 'Icon',
            title: 'Move Down',
            name: 'move-down',
          },
          {
            icon: 'Icon',
            title: 'Delete Block',
            name: 'delete',
          },
        ])
      );

      await openBlockTunes(page);

      const searchInput = page.locator(SEARCH_INPUT_SELECTOR);

      // Partial match at start
      await searchInput.fill('Move');
      await expect(page.locator('[data-item-name="move-up"]')).toBeVisible();
      await expect(page.locator('[data-item-name="move-down"]')).toBeVisible();
      await expect(page.locator('[data-item-name="delete"]')).toBeHidden();

      // Partial match in middle
      await searchInput.fill('Down');
      await expect(page.locator('[data-item-name="move-down"]')).toBeVisible();
      await expect(page.locator('[data-item-name="move-up"]')).toBeHidden();
      await expect(page.locator('[data-item-name="delete"]')).toBeHidden();

      // Partial match at end
      await searchInput.fill('Block');
      await expect(page.locator('[data-item-name="delete"]')).toBeVisible();
      await expect(page.locator('[data-item-name="move-up"]')).toBeHidden();
      await expect(page.locator('[data-item-name="move-down"]')).toBeHidden();
    });
  });

  test.describe('special characters', () => {
    /**
     * Test handling special characters in search query
     */
    test('should handle special characters in search query', async ({ page }) => {
      await createEditorWithBlocks(
        page,
        [
          {
            type: 'paragraph',
            data: {
              text: 'Hello',
            },
          },
        ],
        buildTestToolsConfig([
          {
            icon: 'Icon',
            title: 'Item (with) [brackets]',
            name: 'brackets',
          },
          {
            icon: 'Icon',
            title: 'Item with-dash',
            name: 'dash',
          },
          {
            icon: 'Icon',
            title: 'Item with.dot',
            name: 'dot',
          },
        ])
      );

      await openBlockTunes(page);

      const searchInput = page.locator(SEARCH_INPUT_SELECTOR);

      // Search with brackets
      await searchInput.fill('brackets');
      await expect(page.locator('[data-item-name="brackets"]')).toBeVisible();
      await expect(page.locator('[data-item-name="dash"]')).toBeHidden();
      await expect(page.locator('[data-item-name="dot"]')).toBeHidden();

      // Search with dash
      await searchInput.fill('dash');
      await expect(page.locator('[data-item-name="dash"]')).toBeVisible();
      await expect(page.locator('[data-item-name="brackets"]')).toBeHidden();
      await expect(page.locator('[data-item-name="dot"]')).toBeHidden();

      // Search with dot
      await searchInput.fill('dot');
      await expect(page.locator('[data-item-name="dot"]')).toBeVisible();
      await expect(page.locator('[data-item-name="brackets"]')).toBeHidden();
      await expect(page.locator('[data-item-name="dash"]')).toBeHidden();
    });

    /**
     * Test handling empty search query
     */
    test('should handle empty search query', async ({ page }) => {
      await createEditorWithBlocks(
        page,
        [
          {
            type: 'paragraph',
            data: {
              text: 'Hello',
            },
          },
        ],
        buildTestToolsConfig([
          {
            icon: 'Icon',
            title: 'First Item',
            name: 'first',
          },
          {
            icon: 'Icon',
            title: 'Second Item',
            name: 'second',
          },
        ])
      );

      await openBlockTunes(page);

      const searchInput = page.locator(SEARCH_INPUT_SELECTOR);

      // Empty search should show all items
      await expect(page.locator('[data-item-name="first"]')).toBeVisible();
      await expect(page.locator('[data-item-name="second"]')).toBeVisible();

      // Type something
      await searchInput.fill('First');

      // Clear to empty
      await clearSearchInputField(searchInput);

      // All items should be visible again
      await expect(page.locator('[data-item-name="first"]')).toBeVisible();
      await expect(page.locator('[data-item-name="second"]')).toBeVisible();
    });
  });

  test.describe('search input interactions', () => {
    /**
     * Test updating filter results as user types
     */
    test('should update filter results as user types', async ({ page }) => {
      await createEditorWithBlocks(
        page,
        [
          {
            type: 'paragraph',
            data: {
              text: 'Hello',
            },
          },
        ],
        buildTestToolsConfig([
          {
            icon: 'Icon',
            title: 'Move Up',
            name: 'move-up',
          },
          {
            icon: 'Icon',
            title: 'Move Down',
            name: 'move-down',
          },
          {
            icon: 'Icon',
            title: 'Delete',
            name: 'delete',
          },
        ])
      );

      await openBlockTunes(page);

      const searchInput = page.locator(SEARCH_INPUT_SELECTOR);

      // Type character by character
      await searchInput.fill('M');
      await expect(page.locator('[data-item-name="move-up"]')).toBeVisible();
      await expect(page.locator('[data-item-name="move-down"]')).toBeVisible();
      await expect(page.locator('[data-item-name="delete"]')).toBeHidden();

      await searchInput.fill('Mo');
      await expect(page.locator('[data-item-name="move-up"]')).toBeVisible();
      await expect(page.locator('[data-item-name="move-down"]')).toBeVisible();
      await expect(page.locator('[data-item-name="delete"]')).toBeHidden();

      await searchInput.fill('Mov');
      await expect(page.locator('[data-item-name="move-up"]')).toBeVisible();
      await expect(page.locator('[data-item-name="move-down"]')).toBeVisible();
      await expect(page.locator('[data-item-name="delete"]')).toBeHidden();

      await searchInput.fill('Move U');
      await expect(page.locator('[data-item-name="move-up"]')).toBeVisible();
      await expect(page.locator('[data-item-name="move-down"]')).toBeHidden();
      await expect(page.locator('[data-item-name="delete"]')).toBeHidden();
    });

    /**
     * Test updating filter results when backspace is used
     */
    test('should update filter results when backspace is used', async ({ page }) => {
      await createEditorWithBlocks(
        page,
        [
          {
            type: 'paragraph',
            data: {
              text: 'Hello',
            },
          },
        ],
        buildTestToolsConfig([
          {
            icon: 'Icon',
            title: 'Move Up',
            name: 'move-up',
          },
          {
            icon: 'Icon',
            title: 'Move Down',
            name: 'move-down',
          },
          {
            icon: 'Icon',
            title: 'Delete',
            name: 'delete',
          },
        ])
      );

      await openBlockTunes(page);

      const searchInput = page.locator(SEARCH_INPUT_SELECTOR);

      // Type full query
      await searchInput.fill('Move Up');
      await expect(page.locator('[data-item-name="move-up"]')).toBeVisible();
      await expect(page.locator('[data-item-name="move-down"]')).toBeHidden();

      // Delete characters one by one
      await searchInput.fill('Move U');
      await expect(page.locator('[data-item-name="move-up"]')).toBeVisible();
      await expect(page.locator('[data-item-name="move-down"]')).toBeHidden();

      await searchInput.fill('Move ');
      await expect(page.locator('[data-item-name="move-up"]')).toBeVisible();
      await expect(page.locator('[data-item-name="move-down"]')).toBeVisible();

      await searchInput.fill('Move');
      await expect(page.locator('[data-item-name="move-up"]')).toBeVisible();
      await expect(page.locator('[data-item-name="move-down"]')).toBeVisible();

      await searchInput.fill('Mo');
      await expect(page.locator('[data-item-name="move-up"]')).toBeVisible();
      await expect(page.locator('[data-item-name="move-down"]')).toBeVisible();

      await clearSearchInputField(searchInput);
      await expect(page.locator('[data-item-name="move-up"]')).toBeVisible();
      await expect(page.locator('[data-item-name="move-down"]')).toBeVisible();
      await expect(page.locator('[data-item-name="delete"]')).toBeVisible();
    });

    /**
     * Test maintaining focus on search input during filtering
     */
    test('should maintain focus on search input during filtering', async ({ page }) => {
      await createEditorWithBlocks(
        page,
        [
          {
            type: 'paragraph',
            data: {
              text: 'Hello',
            },
          },
        ],
        buildTestToolsConfig([
          {
            icon: 'Icon',
            title: 'Test Item',
            name: 'test',
          },
        ])
      );

      await openBlockTunes(page);

      const searchInput = page.locator(SEARCH_INPUT_SELECTOR);

      // Search input should be focused initially
      await expect(searchInput).toBeFocused();

      // Type search query
      await searchInput.fill('Test');

      // Search input should still be focused
      await expect(searchInput).toBeFocused();
    });
  });

  test.describe('search input focus', () => {
    /**
     * Test that search input is focused after popover opened
     */
    test('should be focused after popover opened', async ({ page }) => {
      await createEditorWithBlocks(
        page,
        [
          {
            type: 'paragraph',
            data: {
              text: 'Some text',
            },
          },
        ]
      );

      await openBlockTunesWithShortcut(page);

      // Check that caret is set to the search input
      const containsCaret = await page.evaluate((selector) => {
        const sel = window.getSelection();

        if (!sel || sel.rangeCount !== 1) {
          return false;
        }

        const range = sel.getRangeAt(0);
        const searchFieldElement = document.querySelector(selector);

        if (!searchFieldElement) {
          return false;
        }

        return searchFieldElement.contains(range.startContainer);
      }, `${BLOCK_TUNES_SELECTOR} .cdx-search-field`);

      expect(containsCaret).toBe(true);
    });
  });

  test.describe('keyboard navigation with search', () => {
    /**
     * Test keyboard navigation between items ignoring separators when search query is applied
     */
    test('should perform keyboard navigation between items ignoring separators when search query is applied', async ({ page }) => {
      await createEditorWithBlocks(
        page,
        [
          {
            type: 'paragraph',
            data: {
              text: 'Hello',
            },
          },
        ],
        buildTestToolsConfig([
          {
            icon: 'Icon',
            title: 'Tune 1',
            name: 'test-item-1',
          },
          {
            type: PopoverItemType.Separator,
          },
          {
            icon: 'Icon',
            title: 'Tune 2',
            name: 'test-item-2',
          },
        ])
      );

      await openBlockTunes(page);

      const separator = page.locator(`${BLOCK_TUNES_SELECTOR} .ce-popover-item-separator`);

      // Check separator is displayed initially
      await expect(separator).toBeVisible();

      // Enter search query
      const searchInput = page.locator(SEARCH_INPUT_SELECTOR);

      await searchInput.fill('Tune');

      // Check separator is not displayed when search is active
      await expect(separator).toBeHidden();

      // Press Tab to navigate
      await page.keyboard.press('Tab');

      // Check first item is focused
      await expect(page.locator('[data-item-name="test-item-1"].ce-popover-item--focused')).toBeVisible();
      await expect(page.locator('[data-item-name="test-item-2"].ce-popover-item--focused')).toBeHidden();

      // Press Tab again
      await page.keyboard.press('Tab');

      // Check second item is focused
      await expect(page.locator('[data-item-name="test-item-1"].ce-popover-item--focused')).toBeHidden();
      await expect(page.locator('[data-item-name="test-item-2"].ce-popover-item--focused')).toBeVisible();
    });
  });

  test.describe('i18n support', () => {
    /**
     * Test i18n support in nested popover search
     */
    test('should support i18n in nested popover', async ({ page }) => {
      await resetEditor(page);
      await page.evaluate(
        async ({ holderId }) => {
          /**
           * Block Tune with nested children
           * @class TestTune
           */
          class TestTune {
            public static isTune = true;

            /**
             *
             */
            // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- return type inferred from usage
            public render() {
              return {
                icon: 'Icon',
                title: 'Title',
                toggle: 'key',
                name: 'test-item',
                children: {
                  searchable: true,
                  items: [
                    {
                      icon: 'Icon',
                      title: 'Title',
                      name: 'nested-test-item',
                      onActivate: (): void => {},
                    },
                  ],
                },
              };
            }
          }

          const editor = new window.EditorJS({
            holder: holderId,
            data: {
              blocks: [
                {
                  type: 'paragraph',
                  data: {
                    text: 'Hello',
                  },
                },
              ],
            },
            tools: {
              testTool: TestTune,
            },
            tunes: [ 'testTool' ],
            i18n: {
              messages: {
                ui: {
                  popover: {
                    'Filter': 'Искать',
                    // eslint-disable-next-line @typescript-eslint/naming-convention -- i18n
                    'Nothing found': 'Ничего не найдено',
                  },
                },
              },
            },
          });

          window.editorInstance = editor;
          await editor.isReady;
        },
        {
          holderId: HOLDER_ID,
        }
      );

      await openBlockTunes(page);

      // Click the item to open nested popover
      await page.locator('[data-item-name="test-item"]').click();

      // Check nested popover search input has placeholder text with i18n
      const nestedSearchInput = page.locator(
        `${BLOCK_TUNES_SELECTOR} .ce-popover--nested .cdx-search-field__input`
      );

      await expect(nestedSearchInput).toHaveAttribute('placeholder', 'Искать');

      // Enter search query
      await nestedSearchInput.fill('Some text');

      // Check nested popover has nothing found message with i18n
      const nothingFoundMessage = page.locator(
        `${BLOCK_TUNES_SELECTOR} .ce-popover--nested .ce-popover__nothing-found-message`
      );

      await expect(nothingFoundMessage).toHaveText('Ничего не найдено');
    });
  });

  test.describe('nested popover search', () => {
    /**
     * Test filtering items in nested popover
     */
    test('should filter items in nested popover', async ({ page }) => {
      await createEditorWithBlocks(
        page,
        [
          {
            type: 'paragraph',
            data: {
              text: 'Hello',
            },
          },
        ],
        buildTestToolsConfig({
          icon: 'Icon',
          title: 'Parent Item',
          name: 'parent',
          children: {
            searchable: true,
            items: [
              {
                icon: 'Icon',
                title: 'Child One',
                name: 'child-one',
              },
              {
                icon: 'Icon',
                title: 'Child Two',
                name: 'child-two',
              },
              {
                icon: 'Icon',
                title: 'Child Three',
                name: 'child-three',
              },
            ],
          },
        })
      );

      await openBlockTunes(page);

      // Click parent item to open nested popover
      await page.locator('[data-item-name="parent"]').click();

      // Wait for nested popover to appear
      const nestedPopoverContainer = page.locator(
        `${BLOCK_TUNES_SELECTOR} .ce-popover--nested .ce-popover__container`
      );

      await expect(nestedPopoverContainer).toBeVisible();

      const nestedSearchInput = page.locator(
        `${BLOCK_TUNES_SELECTOR} .ce-popover--nested .cdx-search-field__input`
      );

      // Initially all child items should be visible
      await expect(page.locator('[data-item-name="child-one"]')).toBeVisible();
      await expect(page.locator('[data-item-name="child-two"]')).toBeVisible();
      await expect(page.locator('[data-item-name="child-three"]')).toBeVisible();

      // Filter in nested popover
      await nestedSearchInput.fill('One');

      // Only matching child should be visible
      await expect(page.locator('[data-item-name="child-one"]')).toBeVisible();
      await expect(page.locator('[data-item-name="child-two"]')).toBeHidden();
      await expect(page.locator('[data-item-name="child-three"]')).toBeHidden();
    });
  });
});

