import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;
const CELL_SELECTOR = '[data-blok-table-cell]';
const CELL_BLOCKS_SELECTOR = '[data-blok-table-cell-blocks]';
const LIST_ITEM_SELECTOR = '[data-blok-tool="list"]';

type SerializableToolConfig = {
  className?: string;
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
        >((accumulator, { name, className, config }) => {
          let toolClass: unknown = null;

          if (className) {
            // Handle dot notation (e.g., 'Blok.Header')
            toolClass = className.split('.').reduce(
              (obj: unknown, key: string) => (obj as Record<string, unknown>)?.[key],
              window
            ) ?? null;
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

const defaultTools: Record<string, SerializableToolConfig> = {
  table: {
    className: 'Blok.Table',
  },
  list: {
    className: 'Blok.List',
  },
};

test.describe('table cell lists - markdown shortcut conversion', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('unordered list trigger ("- ")', () => {
    test('typing "- " at start of empty cell converts to unordered list', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [['', ''], ['', '']],
              },
            },
          ],
        },
      });

      // Wait for table to render
      await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

      // Click on first cell
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await firstCell.click();

      // Type the markdown trigger for unordered list
      await page.keyboard.type('- ');

      // Cell should now contain a blocks container
      await expect(page.locator(CELL_BLOCKS_SELECTOR)).toBeVisible();

      // Should have a list item
      await expect(page.locator(LIST_ITEM_SELECTOR)).toBeVisible();
    });

    test('text after "- " trigger is preserved in list item', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [['', ''], ['', '']],
              },
            },
          ],
        },
      });

      await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await firstCell.click();

      // Type trigger followed by content
      await page.keyboard.type('- Hello world');

      // The list item should contain the text after the trigger
      await expect(page.locator(LIST_ITEM_SELECTOR)).toContainText('Hello world');
    });
  });

  test.describe('ordered list trigger ("1. ")', () => {
    test('typing "1. " at start of empty cell converts to ordered list', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [['', ''], ['', '']],
              },
            },
          ],
        },
      });

      await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await firstCell.click();

      // Type the markdown trigger for ordered list
      await page.keyboard.type('1. ');

      // Cell should now contain a blocks container
      await expect(page.locator(CELL_BLOCKS_SELECTOR)).toBeVisible();

      // Should have a list item
      await expect(page.locator(LIST_ITEM_SELECTOR)).toBeVisible();
    });

    test('text after "1. " trigger is preserved in list item', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [['', ''], ['', '']],
              },
            },
          ],
        },
      });

      await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await firstCell.click();

      // Type trigger followed by content
      await page.keyboard.type('1. First item');

      // The list item should contain the text after the trigger
      await expect(page.locator(LIST_ITEM_SELECTOR)).toContainText('First item');
    });

    test('ordered list shows correct marker', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [['', ''], ['', '']],
              },
            },
          ],
        },
      });

      await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await firstCell.click();
      await page.keyboard.type('1. Item');

      // Ordered list should have style attribute
      await expect(page.locator(LIST_ITEM_SELECTOR)).toHaveAttribute('data-list-style', 'ordered');
    });
  });

  test.describe('checklist trigger ("[] ")', () => {
    test('typing "[] " at start of empty cell converts to checklist', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [['', ''], ['', '']],
              },
            },
          ],
        },
      });

      await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await firstCell.click();

      // Type the markdown trigger for checklist
      await page.keyboard.type('[] ');

      // Cell should now contain a blocks container
      await expect(page.locator(CELL_BLOCKS_SELECTOR)).toBeVisible();

      // Should have a list item with checklist style
      await expect(page.locator(LIST_ITEM_SELECTOR)).toBeVisible();
      await expect(page.locator(LIST_ITEM_SELECTOR)).toHaveAttribute('data-list-style', 'checklist');
    });

    test('checklist has a checkbox element', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [['', ''], ['', '']],
              },
            },
          ],
        },
      });

      await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await firstCell.click();
      await page.keyboard.type('[] Todo item');

      // Checklist should have a checkbox
      await expect(page.getByRole('checkbox')).toBeVisible();
    });

    test('text after "[] " trigger is preserved in checklist item', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [['', ''], ['', '']],
              },
            },
          ],
        },
      });

      await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await firstCell.click();
      await page.keyboard.type('[] Buy groceries');

      // The list item should contain the text after the trigger
      await expect(page.locator(LIST_ITEM_SELECTOR)).toContainText('Buy groceries');
    });
  });

  // Keyboard navigation tests are skipped until block integration is wired up.
  // The TableCellBlocks.handleKeyDown method handles Tab/Shift+Tab/Shift+Enter,
  // but the keyboard event listener is not yet connected for nested blocks.
  // These tests document the expected behavior for when the wiring is complete.
  test.describe.skip('keyboard navigation in cell lists', () => {
    test('tab should navigate from list item to next cell', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [['', 'Second cell'], ['', '']],
              },
            },
          ],
        },
      });

      await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await firstCell.click();

      // Create a list in first cell
      await page.keyboard.type('- Item 1');
      await expect(page.locator(CELL_BLOCKS_SELECTOR)).toBeVisible();

      // Tab should navigate to second cell
      await page.keyboard.press('Tab');

      // Focus should be in second cell (or its content)
      // eslint-disable-next-line playwright/no-nth-methods -- nth(1) needed to target second cell
      const secondCell = page.locator(CELL_SELECTOR).nth(1);
      const hasFocus = await secondCell.evaluate(el => el.contains(document.activeElement) || el === document.activeElement);

      expect(hasFocus).toBe(true);
    });

    test('shift+Tab should navigate from list item to previous cell', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [['First cell', ''], ['', '']],
              },
            },
          ],
        },
      });

      await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

      // Click on second cell
      // eslint-disable-next-line playwright/no-nth-methods -- nth(1) needed to target second cell
      const secondCell = page.locator(CELL_SELECTOR).nth(1);

      await secondCell.click();

      // Create a list in second cell
      await page.keyboard.type('- Item');
      await expect(page.locator(CELL_BLOCKS_SELECTOR)).toBeVisible();

      // Shift+Tab should navigate to first cell
      await page.keyboard.press('Shift+Tab');

      // Focus should be in first cell (or its content)
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();
      const hasFocus = await firstCell.evaluate(el => el.contains(document.activeElement) || el === document.activeElement);

      expect(hasFocus).toBe(true);
    });

    test('shift+Enter should exit list and navigate to cell below', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [['', ''], ['Cell below', '']],
              },
            },
          ],
        },
      });

      await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

      // Click on first cell
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await firstCell.click();

      // Create a list in first cell
      await page.keyboard.type('- Item');
      await expect(page.locator(CELL_BLOCKS_SELECTOR)).toBeVisible();

      // Shift+Enter should exit list to cell below
      await page.keyboard.press('Shift+Enter');

      // Focus should be in cell below (first column, second row)
      // eslint-disable-next-line playwright/no-nth-methods -- nth(2) needed to target third cell (first cell of second row)
      const cellBelow = page.locator(CELL_SELECTOR).nth(2);
      const hasFocus = await cellBelow.evaluate(el => el.contains(document.activeElement) || el === document.activeElement);

      expect(hasFocus).toBe(true);
    });

    test('tab at end of row should wrap to first cell of next row', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [['', ''], ['First cell row 2', '']],
              },
            },
          ],
        },
      });

      await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

      // Click on second cell (last cell of first row)
      // eslint-disable-next-line playwright/no-nth-methods -- nth(1) needed to target second cell
      const secondCell = page.locator(CELL_SELECTOR).nth(1);

      await secondCell.click();

      // Create a list in second cell
      await page.keyboard.type('- Item');
      await expect(page.locator(CELL_BLOCKS_SELECTOR)).toBeVisible();

      // Tab should wrap to first cell of next row
      await page.keyboard.press('Tab');

      // Focus should be in first cell of second row (index 2 in 2x2 table)
      // eslint-disable-next-line playwright/no-nth-methods -- nth(2) needed to target third cell
      const firstCellRow2 = page.locator(CELL_SELECTOR).nth(2);
      const hasFocus = await firstCellRow2.evaluate(el => el.contains(document.activeElement) || el === document.activeElement);

      expect(hasFocus).toBe(true);
    });

    test('shift+Tab at start of row should wrap to last cell of previous row', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [['', 'Last cell row 1'], ['', '']],
              },
            },
          ],
        },
      });

      await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

      // Click on first cell of second row (index 2)
      // eslint-disable-next-line playwright/no-nth-methods -- nth(2) needed to target third cell
      const firstCellRow2 = page.locator(CELL_SELECTOR).nth(2);

      await firstCellRow2.click();

      // Create a list in this cell
      await page.keyboard.type('- Item');
      await expect(page.locator(CELL_BLOCKS_SELECTOR)).toBeVisible();

      // Shift+Tab should wrap to last cell of first row
      await page.keyboard.press('Shift+Tab');

      // Focus should be in last cell of first row (index 1)
      // eslint-disable-next-line playwright/no-nth-methods -- nth(1) needed to target second cell
      const lastCellRow1 = page.locator(CELL_SELECTOR).nth(1);
      const hasFocus = await lastCellRow1.evaluate(el => el.contains(document.activeElement) || el === document.activeElement);

      expect(hasFocus).toBe(true);
    });
  });

  test.describe('edge cases', () => {
    test('trigger in non-first cell also creates list', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [['A', ''], ['', '']],
              },
            },
          ],
        },
      });

      await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

      // Click on second cell (index 1)
      // eslint-disable-next-line playwright/no-nth-methods -- nth(1) needed to target second cell
      const secondCell = page.locator(CELL_SELECTOR).nth(1);

      await secondCell.click();
      await page.keyboard.type('- Second cell list');

      // Should have created a list in the second cell
      await expect(page.locator(CELL_BLOCKS_SELECTOR)).toBeVisible();
      await expect(page.locator(LIST_ITEM_SELECTOR)).toContainText('Second cell list');
    });

    test('cell with existing content does not convert on trigger typed elsewhere', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [['Existing content', ''], ['', '']],
              },
            },
          ],
        },
      });

      await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await firstCell.click();

      // Move cursor to end and type trigger (not at start)
      await page.keyboard.press('End');
      await page.keyboard.type('- ');

      // Should NOT have converted to block-based cell
      // The cell should still be plain text
      await expect(page.locator(CELL_BLOCKS_SELECTOR)).toHaveCount(0);

      // The text should just be appended
      await expect(firstCell).toContainText('Existing content- ');
    });

    test('trigger without space does not convert', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [['', ''], ['', '']],
              },
            },
          ],
        },
      });

      await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await firstCell.click();

      // Type trigger without trailing space
      await page.keyboard.type('-');

      // Should NOT have converted to block-based cell
      await expect(page.locator(CELL_BLOCKS_SELECTOR)).toHaveCount(0);
    });

    test('whitespace before trigger at start still triggers conversion', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [['', ''], ['', '']],
              },
            },
          ],
        },
      });

      await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await firstCell.click();

      // Type leading spaces then trigger
      await page.keyboard.type('  - List item');

      // Should have converted (leading whitespace is trimmed)
      await expect(page.locator(CELL_BLOCKS_SELECTOR)).toBeVisible();
      await expect(page.locator(LIST_ITEM_SELECTOR)).toContainText('List item');
    });
  });
});
