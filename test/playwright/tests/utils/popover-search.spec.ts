import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OutputData } from '@/types';
import type { MenuConfig } from '../../../../types/tools';
import { PopoverItemType } from '@/types/utils/popover/popover-item-type';
import { selectionChangeDebounceTimeout } from '../../../../src/components/constants';
import { ensureEditorBundleBuilt } from '../helpers/ensure-build';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../../cypress/fixtures/test.html')
).href;

const HOLDER_ID = 'editorjs';
const EDITOR_SELECTOR = '[data-cy=editorjs]';
const BLOCK_SELECTOR = `${EDITOR_SELECTOR} .cdx-block`;
const BLOCK_TUNES_SELECTOR = `${EDITOR_SELECTOR} [data-cy=block-tunes]`;
const SETTINGS_BUTTON_SELECTOR = `${EDITOR_SELECTOR} .ce-toolbar__settings-btn`;
const SEARCH_INPUT_SELECTOR = `${BLOCK_TUNES_SELECTOR} .cdx-search-field__input`;
const POPOVER_ITEM_SELECTOR = `${BLOCK_TUNES_SELECTOR} .ce-popover-item`;
const NOTHING_FOUND_SELECTOR = `${BLOCK_TUNES_SELECTOR} .ce-popover__nothing-found-message`;

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
 * Create editor with provided blocks and optional tools/tunes
 *
 * @param page - The Playwright page object
 * @param blocks - The blocks data to initialize the editor with
 * @param tools - Optional tools configuration
 * @param tunes - Optional tunes configuration
 */
const createEditorWithBlocks = async (
  page: Page,
  blocks: OutputData['blocks'],
  tools?: Record<string, unknown>,
  tunes?: string[]
): Promise<void> => {
  await resetEditor(page);
  await page.evaluate(
    async ({ holderId, blocks: editorBlocks, tools: editorTools, tunes: editorTunes }) => {
      const editor = new window.EditorJS({
        holder: holderId,
        data: { blocks: editorBlocks },
        ...(editorTools && { tools: editorTools }),
        ...(editorTunes && { tunes: editorTunes }),
      });

      window.editorInstance = editor;
      await editor.isReady;
    },
    {
      holderId: HOLDER_ID,
      blocks,
      tools,
      tunes,
    }
  );
};

/**
 * Open block tunes popover
 *
 * @param page - The Playwright page object
 */
const openBlockTunes = async (page: Page): Promise<void> => {
  const block = page.locator(BLOCK_SELECTOR).first();

  await block.click();
  await page.locator(SETTINGS_BUTTON_SELECTOR).click();
  await expect(page.locator(BLOCK_TUNES_SELECTOR)).toBeVisible();
};

/**
 * Open block tunes popover using Cmd+/ shortcut
 *
 * @param page - The Playwright page object
 */
const openBlockTunesWithShortcut = async (page: Page): Promise<void> => {
  const block = page.locator(BLOCK_SELECTOR).first();

  await block.click();
  const modifierKey = process.platform === 'darwin' ? 'Meta' : 'Control';

  await page.keyboard.press(`${modifierKey}+/`);
  await expect(page.locator(BLOCK_TUNES_SELECTOR)).toBeVisible({ timeout: selectionChangeDebounceTimeout + 100 });
};

test.describe('Popover Search/Filter', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.EditorJS === 'function');
  });

  test.describe('Filtering behavior', () => {
    /**
     * Test filtering items based on search query
     */
    test('should filter items based on search query', async ({ page }) => {
      /**
       * Block Tune with multiple items for testing filtering
       *
       * @class TestTune
       */
      class TestTune {
        public static isTune = true;

        /**
         *
         */
        public render(): MenuConfig {
          return [
            {
              icon: 'Icon',
              title: 'Move Up',
              name: 'move-up',
              onActivate: (): void => {},
            },
            {
              icon: 'Icon',
              title: 'Move Down',
              name: 'move-down',
              onActivate: (): void => {},
            },
            {
              icon: 'Icon',
              title: 'Delete',
              name: 'delete',
              onActivate: (): void => {},
            },
          ];
        }
      }

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
        {
          testTool: TestTune,
        },
        [ 'testTool' ]
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
      /**
       * Block Tune with multiple items
       *
       * @class TestTune
       */
      class TestTune {
        public static isTune = true;

        /**
         *
         */
        public render(): MenuConfig {
          return [
            {
              icon: 'Icon',
              title: 'First Item',
              name: 'first',
              onActivate: (): void => {},
            },
            {
              icon: 'Icon',
              title: 'Second Item',
              name: 'second',
              onActivate: (): void => {},
            },
          ];
        }
      }

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
        {
          testTool: TestTune,
        },
        [ 'testTool' ]
      );

      await openBlockTunes(page);

      const searchInput = page.locator(SEARCH_INPUT_SELECTOR);

      // Type search query
      await searchInput.fill('First');

      // Verify filtering works
      await expect(page.locator('[data-item-name="first"]')).toBeVisible();
      await expect(page.locator('[data-item-name="second"]')).toBeHidden();

      // Clear search input
      await searchInput.clear();

      // All items should be visible again
      await expect(page.locator('[data-item-name="first"]')).toBeVisible();
      await expect(page.locator('[data-item-name="second"]')).toBeVisible();
    });

    /**
     * Test displaying "Nothing found" message when no items match
     */
    test('should display "Nothing found" message when no items match', async ({ page }) => {
      /**
       * Block Tune with items
       *
       * @class TestTune
       */
      class TestTune {
        public static isTune = true;

        /**
         *
         */
        public render(): MenuConfig {
          return [
            {
              icon: 'Icon',
              title: 'Test Item',
              name: 'test',
              onActivate: (): void => {},
            },
          ];
        }
      }

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
        {
          testTool: TestTune,
        },
        [ 'testTool' ]
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
      /**
       * Block Tune with items
       *
       * @class TestTune
       */
      class TestTune {
        public static isTune = true;

        /**
         *
         */
        public render(): MenuConfig {
          return [
            {
              icon: 'Icon',
              title: 'Test Item',
              name: 'test',
              onActivate: (): void => {},
            },
          ];
        }
      }

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
        {
          testTool: TestTune,
        },
        [ 'testTool' ]
      );

      await openBlockTunes(page);

      const searchInput = page.locator(SEARCH_INPUT_SELECTOR);
      const nothingFound = page.locator(NOTHING_FOUND_SELECTOR);

      // Type search query that matches nothing
      await searchInput.fill('NonExistent');

      await expect(nothingFound).toBeVisible();

      // Clear search to show items again
      await searchInput.clear();

      // "Nothing found" should be hidden
      await expect(nothingFound).toBeHidden();
      await expect(page.locator('[data-item-name="test"]')).toBeVisible();
    });
  });

  test.describe('Case-insensitive matching', () => {
    /**
     * Test matching items regardless of case
     */
    test('should match items regardless of case', async ({ page }) => {
      /**
       * Block Tune with items
       *
       * @class TestTune
       */
      class TestTune {
        public static isTune = true;

        /**
         *
         */
        public render(): MenuConfig {
          return [
            {
              icon: 'Icon',
              title: 'Move Up',
              name: 'move-up',
              onActivate: (): void => {},
            },
            {
              icon: 'Icon',
              title: 'Delete Block',
              name: 'delete',
              onActivate: (): void => {},
            },
          ];
        }
      }

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
        {
          testTool: TestTune,
        },
        [ 'testTool' ]
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

  test.describe('Partial matching', () => {
    /**
     * Test matching items with partial query
     */
    test('should match items with partial query', async ({ page }) => {
      /**
       * Block Tune with items
       *
       * @class TestTune
       */
      class TestTune {
        public static isTune = true;

        /**
         *
         */
        public render(): MenuConfig {
          return [
            {
              icon: 'Icon',
              title: 'Move Up',
              name: 'move-up',
              onActivate: (): void => {},
            },
            {
              icon: 'Icon',
              title: 'Move Down',
              name: 'move-down',
              onActivate: (): void => {},
            },
            {
              icon: 'Icon',
              title: 'Delete Block',
              name: 'delete',
              onActivate: (): void => {},
            },
          ];
        }
      }

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
        {
          testTool: TestTune,
        },
        [ 'testTool' ]
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

  test.describe('Special characters', () => {
    /**
     * Test handling special characters in search query
     */
    test('should handle special characters in search query', async ({ page }) => {
      /**
       * Block Tune with items containing special characters
       *
       * @class TestTune
       */
      class TestTune {
        public static isTune = true;

        /**
         *
         */
        public render(): MenuConfig {
          return [
            {
              icon: 'Icon',
              title: 'Item (with) [brackets]',
              name: 'brackets',
              onActivate: (): void => {},
            },
            {
              icon: 'Icon',
              title: 'Item with-dash',
              name: 'dash',
              onActivate: (): void => {},
            },
            {
              icon: 'Icon',
              title: 'Item with.dot',
              name: 'dot',
              onActivate: (): void => {},
            },
          ];
        }
      }

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
        {
          testTool: TestTune,
        },
        [ 'testTool' ]
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
      /**
       * Block Tune with items
       *
       * @class TestTune
       */
      class TestTune {
        public static isTune = true;

        /**
         *
         */
        public render(): MenuConfig {
          return [
            {
              icon: 'Icon',
              title: 'First Item',
              name: 'first',
              onActivate: (): void => {},
            },
            {
              icon: 'Icon',
              title: 'Second Item',
              name: 'second',
              onActivate: (): void => {},
            },
          ];
        }
      }

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
        {
          testTool: TestTune,
        },
        [ 'testTool' ]
      );

      await openBlockTunes(page);

      const searchInput = page.locator(SEARCH_INPUT_SELECTOR);

      // Empty search should show all items
      await expect(page.locator('[data-item-name="first"]')).toBeVisible();
      await expect(page.locator('[data-item-name="second"]')).toBeVisible();

      // Type something
      await searchInput.fill('First');

      // Clear to empty
      await searchInput.clear();

      // All items should be visible again
      await expect(page.locator('[data-item-name="first"]')).toBeVisible();
      await expect(page.locator('[data-item-name="second"]')).toBeVisible();
    });
  });

  test.describe('Search input interactions', () => {
    /**
     * Test updating filter results as user types
     */
    test('should update filter results as user types', async ({ page }) => {
      /**
       * Block Tune with items
       *
       * @class TestTune
       */
      class TestTune {
        public static isTune = true;

        /**
         *
         */
        public render(): MenuConfig {
          return [
            {
              icon: 'Icon',
              title: 'Move Up',
              name: 'move-up',
              onActivate: (): void => {},
            },
            {
              icon: 'Icon',
              title: 'Move Down',
              name: 'move-down',
              onActivate: (): void => {},
            },
            {
              icon: 'Icon',
              title: 'Delete',
              name: 'delete',
              onActivate: (): void => {},
            },
          ];
        }
      }

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
        {
          testTool: TestTune,
        },
        [ 'testTool' ]
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
      /**
       * Block Tune with items
       *
       * @class TestTune
       */
      class TestTune {
        public static isTune = true;

        /**
         *
         */
        public render(): MenuConfig {
          return [
            {
              icon: 'Icon',
              title: 'Move Up',
              name: 'move-up',
              onActivate: (): void => {},
            },
            {
              icon: 'Icon',
              title: 'Move Down',
              name: 'move-down',
              onActivate: (): void => {},
            },
            {
              icon: 'Icon',
              title: 'Delete',
              name: 'delete',
              onActivate: (): void => {},
            },
          ];
        }
      }

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
        {
          testTool: TestTune,
        },
        [ 'testTool' ]
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

      await searchInput.clear();
      await expect(page.locator('[data-item-name="move-up"]')).toBeVisible();
      await expect(page.locator('[data-item-name="move-down"]')).toBeVisible();
      await expect(page.locator('[data-item-name="delete"]')).toBeVisible();
    });

    /**
     * Test maintaining focus on search input during filtering
     */
    test('should maintain focus on search input during filtering', async ({ page }) => {
      /**
       * Block Tune with items
       *
       * @class TestTune
       */
      class TestTune {
        public static isTune = true;

        /**
         *
         */
        public render(): MenuConfig {
          return [
            {
              icon: 'Icon',
              title: 'Test Item',
              name: 'test',
              onActivate: (): void => {},
            },
          ];
        }
      }

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
        {
          testTool: TestTune,
        },
        [ 'testTool' ]
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

  test.describe('Search input focus', () => {
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

  test.describe('Keyboard navigation with search', () => {
    /**
     * Test keyboard navigation between items ignoring separators when search query is applied
     */
    test('should perform keyboard navigation between items ignoring separators when search query is applied', async ({ page }) => {
      /**
       * Block Tune with separator
       *
       * @class TestTune
       */
      class TestTune {
        public static isTune = true;

        /**
         *
         */
        public render(): MenuConfig {
          return [
            {
              onActivate: (): void => {},
              icon: 'Icon',
              title: 'Tune 1',
              name: 'test-item-1',
            },
            {
              type: PopoverItemType.Separator,
            },
            {
              onActivate: (): void => {},
              icon: 'Icon',
              title: 'Tune 2',
              name: 'test-item-2',
            },
          ];
        }
      }

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
        {
          testTool: TestTune,
        },
        [ 'testTool' ]
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
           *
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

  test.describe('Nested popover search', () => {
    /**
     * Test filtering items in nested popover
     */
    test('should filter items in nested popover', async ({ page }) => {
      /**
       * Block Tune with nested children
       *
       * @class TestTune
       */
      class TestTune {
        public static isTune = true;

        /**
         *
         */
        public render(): MenuConfig {
          return {
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
                  onActivate: (): void => {},
                },
                {
                  icon: 'Icon',
                  title: 'Child Two',
                  name: 'child-two',
                  onActivate: (): void => {},
                },
                {
                  icon: 'Icon',
                  title: 'Child Three',
                  name: 'child-three',
                  onActivate: (): void => {},
                },
              ],
            },
          };
        }
      }

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
        {
          testTool: TestTune,
        },
        [ 'testTool' ]
      );

      await openBlockTunes(page);

      // Click parent item to open nested popover
      await page.locator('[data-item-name="parent"]').click();

      // Wait for nested popover to appear
      const nestedPopover = page.locator(`${BLOCK_TUNES_SELECTOR} .ce-popover--nested`);

      await expect(nestedPopover).toBeVisible();

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

