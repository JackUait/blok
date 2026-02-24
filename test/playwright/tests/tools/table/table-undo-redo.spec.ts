// E2E regression tests for table undo/redo data preservation
// Validates fixes for table data loss during undo/redo operations

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;
const CELL_SELECTOR = '[data-blok-table-cell]';
const ROW_SELECTOR = '[data-blok-table-row]';

const UNDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';

// Wait for Yjs captureTimeout (500ms) plus small buffer
const YJS_CAPTURE_TIMEOUT = 600;

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
            // Handle dot notation (e.g., 'Blok.Table')
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
};

/**
 * Returns the first contenteditable element inside the cell at (row, col).
 * Assumes a 2-column table layout.
 */
const getCellEditable = (page: Page, row: number, col: number) => {
  // eslint-disable-next-line playwright/no-nth-methods -- nth() is necessary to index into a grid by row/col
  return page.locator(CELL_SELECTOR).nth(row * 2 + col).locator('[contenteditable="true"]').first();
};

/**
 * Wait for a specified delay via page.evaluate.
 * Used to wait for Yjs captureTimeout before undo/redo.
 */
const waitForDelay = async (page: Page, delayMs: number): Promise<void> => {
  await page.evaluate(
    async (timeout) => {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, timeout);
      });
    },
    delayMs
  );
};

/**
 * Save the editor and return the output data.
 */
const saveBlok = async (page: Page): Promise<OutputData> => {
  return await page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('Blok instance not found');
    }

    return await window.blokInstance.save();
  });
};

test.describe('Table Undo/Redo', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('Undo of text input in table cell preserves table structure and other cell content', async ({ page }) => {
    // 1. Create a 2x2 table with known text content
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['Alpha', 'Beta'], ['Gamma', 'Delta']],
            },
          },
        ],
      },
    });

    // 2. Verify initial content is rendered
    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    const cells = page.locator(CELL_SELECTOR);

    await expect(cells.filter({ hasText: 'Alpha' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'Delta' })).toHaveCount(1);

    // 3. Click into the first cell and type additional text
    const firstCellEditable = getCellEditable(page, 0, 0);

    await firstCellEditable.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' added');

    // Verify text was added
    await expect(firstCellEditable).toContainText('Alpha added');

    // Wait for Yjs to capture the text change
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // 4. Undo the text change
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 300);

    // 5. Verify the table still has 2 rows and 4 cells
    const rows = page.locator(ROW_SELECTOR);

    await expect(rows).toHaveCount(2);
    await expect(cells).toHaveCount(4);

    // 6. Verify original content is restored in the first cell
    await expect(firstCellEditable).toContainText('Alpha');
    await expect(firstCellEditable).not.toContainText('added');

    // 7. Verify other cells still have their content
    await expect(cells.filter({ hasText: 'Beta' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'Gamma' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'Delta' })).toHaveCount(1);

    // 8. Save and verify data integrity
    const savedData = await saveBlok(page);
    const tableBlock = savedData.blocks.find((b: { type: string }) => b.type === 'table');

    expect(tableBlock).toBeDefined();

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const content = tableBlock?.data.content as { blocks: string[] }[][];

    expect(content).toHaveLength(2);
    expect(content[0]).toHaveLength(2);
    expect(content[1]).toHaveLength(2);

    // Verify paragraph blocks still contain the original text
    const paragraphBlocks = savedData.blocks.filter((b: { type: string }) => b.type === 'paragraph');
    const paragraphTexts = paragraphBlocks.map((b: { data: { text: string } }) => b.data.text);

    expect(paragraphTexts).toContain('Alpha');
    expect(paragraphTexts).toContain('Beta');
    expect(paragraphTexts).toContain('Gamma');
    expect(paragraphTexts).toContain('Delta');
  });

  test('Redo after undo restores typed text in table cell without data loss', async ({ page }) => {
    // 1. Create a 2x2 table with content
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['A', 'B'], ['C', 'D']],
            },
          },
        ],
      },
    });

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // 2. Click into first cell and type additional text
    const firstCellEditable = getCellEditable(page, 0, 0);

    await firstCellEditable.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' extra');

    await expect(firstCellEditable).toContainText('A extra');
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // 3. Undo - text removed
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 300);

    await expect(firstCellEditable).toContainText('A');
    await expect(firstCellEditable).not.toContainText('extra');

    // 4. Redo - text restored
    await page.keyboard.press(REDO_SHORTCUT);
    await waitForDelay(page, 300);

    // 5. Verify text is restored
    await expect(firstCellEditable).toContainText('A extra');

    // 6. Verify table structure is intact
    const rows = page.locator(ROW_SELECTOR);

    await expect(rows).toHaveCount(2);

    const cells = page.locator(CELL_SELECTOR);

    await expect(cells).toHaveCount(4);

    // 7. Verify other cell content is preserved
    await expect(cells.filter({ hasText: 'B' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'C' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'D' })).toHaveCount(1);
  });

  test('Undo preserves table with headings enabled', async ({ page }) => {
    // 1. Create a 2x2 table with headings enabled
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: true,
              content: [['Name', 'Value'], ['foo', 'bar']],
            },
          },
        ],
      },
    });

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // Verify heading row is present
    const headingRow = page.locator('[data-blok-table-heading]');

    await expect(headingRow).toBeVisible();

    // 2. Type in second row cell (data row)
    const secondRowEditable = getCellEditable(page, 1, 0);

    await secondRowEditable.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' updated');

    await expect(secondRowEditable).toContainText('foo updated');
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // 3. Undo the text change
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 300);

    // 4. Verify table structure is intact (2 rows, heading still present)
    const rows = page.locator(ROW_SELECTOR);

    await expect(rows).toHaveCount(2);
    await expect(headingRow).toBeVisible();

    // 5. Verify all cell content is preserved
    const cells = page.locator(CELL_SELECTOR);

    await expect(cells.filter({ hasText: 'Name' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'Value' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'foo' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'bar' })).toHaveCount(1);

    // 6. Save and verify data integrity
    const savedData = await saveBlok(page);
    const tableBlock = savedData.blocks.find((b: { type: string }) => b.type === 'table');

    expect(tableBlock).toBeDefined();

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(tableBlock?.data.withHeadings).toBe(true);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const content = tableBlock?.data.content as { blocks: string[] }[][];

    expect(content).toHaveLength(2);
    expect(content[0]).toHaveLength(2);
    expect(content[1]).toHaveLength(2);

    // Verify paragraph blocks contain the original text
    const paragraphBlocks = savedData.blocks.filter((b: { type: string }) => b.type === 'paragraph');
    const paragraphTexts = paragraphBlocks.map((b: { data: { text: string } }) => b.data.text);

    expect(paragraphTexts).toContain('Name');
    expect(paragraphTexts).toContain('Value');
    expect(paragraphTexts).toContain('foo');
    expect(paragraphTexts).toContain('bar');
  });

  test('Undo of typing in a newly created empty table preserves interactivity', async ({ page }) => {
    // Regression test for the kill chain: create empty table → type → undo
    // Previously, undo would revert table content to [] and leave it non-interactive

    // 1. Create a new empty table (no pre-existing content)
    await createBlok(page, {
      tools: defaultTools,
    });

    // Insert a table via the toolbox slash menu
    const firstBlock = page.locator(`${BLOK_INTERFACE_SELECTOR} [contenteditable="true"]`).first();

    await firstBlock.click();
    await page.keyboard.type('/');

    // Wait for toolbox popover to open
    await page.waitForFunction(
      () => document.querySelector('[data-blok-testid="toolbox-popover"][data-blok-popover-opened="true"]') !== null,
      { timeout: 3000 }
    );

    const tableToolboxItem = page.locator('[data-blok-item-name="table"]');

    await tableToolboxItem.click({ force: true });

    // Wait for the table to appear and cells to be populated
    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // Wait for cell blocks to be initialized
    const firstCellEditable = table.locator('[contenteditable="true"]').first();

    await expect(firstCellEditable).toBeVisible();

    // Wait for Yjs to finalize the table creation entry
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // 2. Type text in the first cell
    await firstCellEditable.click();
    await page.keyboard.type('Hello');

    await expect(firstCellEditable).toContainText('Hello');

    // Wait for Yjs to capture the typing
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // 3. Undo the typing
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 300);

    // 4. Table should still be interactive — cells should have contenteditable elements
    const cellEditables = table.locator('[contenteditable="true"]');

    await expect(cellEditables.first()).toBeVisible();

    // 5. The typed text should be removed
    await expect(firstCellEditable).not.toContainText('Hello');

    // 6. Table structure should be intact (3x3 default grid)
    const rows = table.locator(ROW_SELECTOR);

    await expect(rows).toHaveCount(3);

    const cells = table.locator(CELL_SELECTOR);

    await expect(cells).toHaveCount(9);

    // 7. Redo should restore the text
    await page.keyboard.press(REDO_SHORTCUT);
    await waitForDelay(page, 300);

    await expect(firstCellEditable).toContainText('Hello');

    // 8. Table should still be interactive after redo
    await expect(cellEditables.first()).toBeVisible();

    // 9. Save and verify data integrity
    const savedData = await saveBlok(page);
    const tableBlock = savedData.blocks.find((b: { type: string }) => b.type === 'table');

    expect(tableBlock).toBeDefined();

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const content = tableBlock?.data.content as { blocks: string[] }[][];

    expect(content).toHaveLength(3);
    expect(content[0]).toHaveLength(3);
  });
});
