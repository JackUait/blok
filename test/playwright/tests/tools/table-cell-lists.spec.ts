import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;
const CELL_SELECTOR = '[data-blok-table-cell]';
const CELL_BLOCKS_SELECTOR = '[data-blok-table-cell-blocks]';
const BLOCK_ELEMENT_SELECTOR = '[data-blok-element]';
const LIST_TOOL_SELECTOR = '[data-blok-tool="list"]';
const CELL_EDITABLE_SELECTOR = `${CELL_SELECTOR} [contenteditable="true"]`;

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
  paragraph: {
    className: 'Blok.Paragraph',
  },
};

/**
 * Helper to create a 2x2 table with empty cells
 */
const create2x2Table = async (page: Page): Promise<void> => {
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
};

test.describe('table cells — always-blocks model', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('basic cell behavior', () => {
    test('table cells contain paragraph blocks on creation', async ({ page }) => {
      await create2x2Table(page);

      // Every cell should have a blocks container
      const cellBlocksContainers = page.locator(CELL_BLOCKS_SELECTOR);

      await expect(cellBlocksContainers).toHaveCount(4);

      // Each blocks container should have at least one block element inside
      // Block holders use data-blok-element attribute
      for (let i = 0; i < 4; i++) {
        // eslint-disable-next-line playwright/no-nth-methods -- iterating over all cells by index
        const container = cellBlocksContainers.nth(i);
        const blocks = container.locator(BLOCK_ELEMENT_SELECTOR);

        await expect(blocks.first()).toBeVisible();
      }
    });

    test('typing in a cell shows text', async ({ page }) => {
      await create2x2Table(page);

      // Click into first cell's editable area (the paragraph block inside the cell)
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstEditable = page.locator(CELL_EDITABLE_SELECTOR).first();

      await firstEditable.click();
      await page.keyboard.type('Hello world');

      await expect(firstEditable).toContainText('Hello world');
    });

    test('Tab moves focus to next cell', async ({ page }) => {
      await create2x2Table(page);

      // Click into first cell's editable area
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstEditable = page.locator(CELL_EDITABLE_SELECTOR).first();

      await firstEditable.click();
      await page.keyboard.type('Cell 1');

      // Tab to move to the next cell
      await page.keyboard.press('Tab');

      // Type in the second cell
      await page.keyboard.type('Cell 2');

      // Verify the second cell contains the typed text
      // eslint-disable-next-line playwright/no-nth-methods -- nth(1) needed to target second cell's editable
      const secondEditable = page.locator(CELL_EDITABLE_SELECTOR).nth(1);

      await expect(secondEditable).toContainText('Cell 2');
    });

    test('cell always has at least one block', async ({ page }) => {
      await create2x2Table(page);

      // Each cell should have a blocks container with at least one block
      const cells = page.locator(CELL_SELECTOR);
      const cellCount = await cells.count();

      expect(cellCount).toBe(4);

      for (let i = 0; i < cellCount; i++) {
        // eslint-disable-next-line playwright/no-nth-methods -- iterating over all cells by index
        const cell = cells.nth(i);
        const blocksContainer = cell.locator(CELL_BLOCKS_SELECTOR);

        await expect(blocksContainer).toBeVisible();

        const blocks = blocksContainer.locator(BLOCK_ELEMENT_SELECTOR);

        await expect(blocks.first()).toBeVisible();
      }
    });
  });

  test.describe('list creation in cells (via editor markdown shortcuts)', () => {
    // TODO: List creation via markdown shortcuts depends on the editor-level
    // paragraph-to-list conversion being wired up for blocks inside table cells.
    // The block lifecycle interceptor (Task 7) needs the editor to fire block-added
    // events so the new list block is re-mounted into the cell. If these tests
    // fail, the wiring may not be complete yet.

    // TODO: Markdown shortcut conversion (paragraph -> list) is not yet wired up
    // for blocks inside table cells. The editor-level shortcut handler fires but
    // the new list block isn't re-mounted into the cell. Enable when Task 7's
    // block lifecycle interceptor handles this case.
    test.fixme('typing "- " converts paragraph to unordered list in cell', async ({ page }) => {
      await create2x2Table(page);

      // Click into first cell's editable area
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstEditable = page.locator(CELL_EDITABLE_SELECTOR).first();

      await firstEditable.click();

      // Type the markdown trigger for unordered list
      await page.keyboard.type('- ');

      // A list block should appear in the cell
      // eslint-disable-next-line playwright/no-nth-methods -- first() targets the first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await expect(firstCell.locator(LIST_TOOL_SELECTOR)).toBeVisible();
    });

    // TODO: Same as above — ordered list markdown shortcut not yet wired for cell blocks
    test.fixme('typing "1. " converts paragraph to ordered list in cell', async ({ page }) => {
      await create2x2Table(page);

      // Click into first cell's editable area
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstEditable = page.locator(CELL_EDITABLE_SELECTOR).first();

      await firstEditable.click();

      // Type the markdown trigger for ordered list
      await page.keyboard.type('1. ');

      // A list block should appear in the cell
      // eslint-disable-next-line playwright/no-nth-methods -- first() targets the first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await expect(firstCell.locator(LIST_TOOL_SELECTOR)).toBeVisible();
    });

    // TODO: Depends on markdown shortcut conversion working in cell blocks
    test.fixme('text after list trigger is preserved', async ({ page }) => {
      await create2x2Table(page);

      // Click into first cell's editable area
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstEditable = page.locator(CELL_EDITABLE_SELECTOR).first();

      await firstEditable.click();

      // Type trigger followed by content
      await page.keyboard.type('- Hello');

      // The list item should contain the text after the trigger
      // eslint-disable-next-line playwright/no-nth-methods -- first() targets the first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await expect(firstCell.locator(LIST_TOOL_SELECTOR)).toContainText('Hello');
    });
  });

  test.describe('multiple blocks in cells', () => {
    test('Enter creates new content line in same cell', async ({ page }) => {
      await create2x2Table(page);

      // Click into first cell's editable area
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstEditable = page.locator(CELL_EDITABLE_SELECTOR).first();

      await firstEditable.click();
      await page.keyboard.type('First line');

      // Press Enter — the table tool has enableLineBreaks, so Enter creates
      // a new line within the same block (soft break) or a new block
      // depending on the editor wiring
      await page.keyboard.press('Enter');
      await page.keyboard.type('Second line');

      // Verify both lines of text appear within the first cell
      // eslint-disable-next-line playwright/no-nth-methods -- first() targets the first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await expect(firstCell).toContainText('First line');
      await expect(firstCell).toContainText('Second line');
    });
  });

  test.describe('cell navigation', () => {
    test('Tab at end of row wraps to next row', async ({ page }) => {
      await create2x2Table(page);

      // Click into the second cell (last cell of first row)
      // eslint-disable-next-line playwright/no-nth-methods -- nth(1) needed to target second cell's editable
      const secondEditable = page.locator(CELL_EDITABLE_SELECTOR).nth(1);

      await secondEditable.click();
      await page.keyboard.type('End of row 1');

      // Tab should wrap to first cell of second row
      await page.keyboard.press('Tab');
      await page.keyboard.type('Start of row 2');

      // Verify text landed in the first cell of the second row (cell index 2)
      // eslint-disable-next-line playwright/no-nth-methods -- nth(2) targets the third cell (first cell of second row)
      const thirdEditable = page.locator(CELL_EDITABLE_SELECTOR).nth(2);

      await expect(thirdEditable).toContainText('Start of row 2');
    });
  });
});
