/* eslint-disable playwright/no-nth-methods */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

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

const HOLDER_ID = 'blok';
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;

/**
 * Assert a bounding box is non-null and return it with narrowed type.
 */
const assertBoundingBox = (
  box: { x: number; y: number; width: number; height: number } | null,
  label: string
): { x: number; y: number; width: number; height: number } => {
  expect(box, `${label} should have a bounding box`).toBeTruthy();

  return box as { x: number; y: number; width: number; height: number };
};

/**
 * Returns a locator for a specific cell in the table grid.
 */
const getCell = (page: Page, row: number, col: number): ReturnType<Page['locator']> =>
  page
    .locator(`${TABLE_SELECTOR} >> [data-blok-table-row] >> nth=${row}`)
    .locator(`[data-blok-table-cell] >> nth=${col}`);

/**
 * Returns a locator for the editable area inside a specific cell.
 */
const getCellEditable = (page: Page, row: number, col: number): ReturnType<Page['locator']> =>
  getCell(page, row, col).locator('[contenteditable="true"]');

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
  paragraph: {
    className: 'Blok.Paragraph',
  },
};

/**
 * Helper to select multiple cells by dragging from start to end cell.
 */
const selectCells = async (
  page: Page,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number
): Promise<void> => {
  const startCell = getCell(page, startRow, startCol);
  const endCell = getCell(page, endRow, endCol);

  const startBox = assertBoundingBox(await startCell.boundingBox(), `cell [${startRow},${startCol}]`);
  const endBox = assertBoundingBox(await endCell.boundingBox(), `cell [${endRow},${endCol}]`);

  // For single column selections, use the left edge of the cell to avoid overflow.
  // For regular selections, use center.
  const isSingleColumn = startCol === endCol;
  const startX = isSingleColumn ? startBox.x + 5 : startBox.x + startBox.width / 2;
  const startY = startBox.y + startBox.height / 2;
  const endX = isSingleColumn ? endBox.x + 5 : endBox.x + endBox.width / 2;
  const endY = endBox.y + endBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();
};

/**
 * Dispatch a paste event with both text/html and text/plain on the active element.
 * Used to simulate Cmd+V when Playwright clipboard API is not available.
 */
const dispatchPasteEvent = async (page: Page, html: string, plain: string): Promise<void> => {
  await page.evaluate(({ htmlData, plainData }) => {
    const activeElement = document.activeElement as HTMLElement | null;

    if (!activeElement) {
      throw new Error('No active element to paste into');
    }

    const pasteEvent = Object.assign(new Event('paste', {
      bubbles: true,
      cancelable: true,
    }), {
      clipboardData: {
        getData: (type: string): string => {
          if (type === 'text/html') {
            return htmlData;
          }

          if (type === 'text/plain') {
            return plainData;
          }

          return '';
        },
        types: ['text/html', 'text/plain'],
      },
    });

    activeElement.dispatchEvent(pasteEvent);
  }, { htmlData: html, plainData: plain });
};

/**
 * Perform copy via a synthetic copy event and capture the clipboard data.
 * Returns the HTML and plain text that the copy handler wrote to the clipboard.
 *
 * Dispatches a copy event on `document` with a fake clipboardData that records
 * whatever the table cell selection handler writes via `setData`.
 */
const performCopyAndCapture = async (page: Page): Promise<{ html: string; plain: string }> => {
  return page.evaluate(() => {
    const dataStore: Record<string, string> = {};
    const fakeClipboardData = {
      setData: (type: string, data: string): void => {
        dataStore[type] = data;
      },
      getData: (type: string): string => dataStore[type] ?? '',
      types: [] as string[],
    };

    const copyEvent = Object.assign(new Event('copy', {
      bubbles: true,
      cancelable: true,
    }), {
      clipboardData: fakeClipboardData,
    });

    document.dispatchEvent(copyEvent);

    return {
      html: dataStore['text/html'] ?? '',
      plain: dataStore['text/plain'] ?? '',
    };
  });
};

/**
 * Perform cut via a synthetic cut event and capture the clipboard data.
 * Returns the HTML and plain text that the cut handler wrote to the clipboard.
 */
const performCutAndCapture = async (page: Page): Promise<{ html: string; plain: string }> => {
  return page.evaluate(() => {
    const dataStore: Record<string, string> = {};
    const fakeClipboardData = {
      setData: (type: string, data: string): void => {
        dataStore[type] = data;
      },
      getData: (type: string): string => dataStore[type] ?? '',
      types: [] as string[],
    };

    const cutEvent = Object.assign(new Event('cut', {
      bubbles: true,
      cancelable: true,
    }), {
      clipboardData: fakeClipboardData,
    });

    document.dispatchEvent(cutEvent);

    return {
      html: dataStore['text/html'] ?? '',
      plain: dataStore['text/plain'] ?? '',
    };
  });
};

test.describe('Table cell copy/paste', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.afterEach(async ({ page }) => {
    await resetBlok(page);
  });

  test('should copy selected cells and paste into another position in the same table', async ({ page }) => {
    // Create a 4x4 table with known content
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [
                ['A1', 'B1', 'C1', 'D1'],
                ['A2', 'B2', 'C2', 'D2'],
                ['A3', 'B3', 'C3', 'D3'],
                ['A4', 'B4', 'C4', 'D4'],
              ],
            },
          },
        ],
      },
    });

    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // Select cells (0,0) to (1,1) — a 2x2 block: A1, B1, A2, B2
    await selectCells(page, 0, 0, 1, 1);

    const selected = page.locator('[data-blok-table-cell-selected]');

    await expect(selected).toHaveCount(4);

    // Copy via synthetic copy event and capture clipboard data
    const { html, plain } = await performCopyAndCapture(page);

    // Verify clipboard data was produced (HTML contains a <table> with embedded JSON)
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('<table');
    expect(plain).toBeTruthy();

    // Click into cell (2,2) to place cursor there
    const targetEditable = getCellEditable(page, 2, 2);

    await targetEditable.click();
    await expect(targetEditable).toBeFocused();

    // Paste the copied data
    await dispatchPasteEvent(page, html, plain);

    // Wait for content to update — cells (2,2)-(3,3) should have copied content
    await expect(getCellEditable(page, 2, 2)).toHaveText('A1');
    await expect(getCellEditable(page, 2, 3)).toHaveText('B1');
    await expect(getCellEditable(page, 3, 2)).toHaveText('A2');
    await expect(getCellEditable(page, 3, 3)).toHaveText('B2');

    // Cells outside the paste region should retain original content
    await expect(getCellEditable(page, 2, 0)).toHaveText('A3');
    await expect(getCellEditable(page, 2, 1)).toHaveText('B3');
    await expect(getCellEditable(page, 3, 0)).toHaveText('A4');
    await expect(getCellEditable(page, 3, 1)).toHaveText('B4');
  });

  test('should cut cells and clear original content', async ({ page }) => {
    // Create a 3x3 table with known content
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [
                ['A1', 'B1', 'C1'],
                ['A2', 'B2', 'C2'],
                ['A3', 'B3', 'C3'],
              ],
            },
          },
        ],
      },
    });

    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // Select cells (0,0) to (1,1) — 4 cells: A1, B1, A2, B2
    await selectCells(page, 0, 0, 1, 1);

    const selected = page.locator('[data-blok-table-cell-selected]');

    await expect(selected).toHaveCount(4);

    // Cut via synthetic cut event
    const { html, plain } = await performCutAndCapture(page);

    // Verify clipboard data was produced
    expect(html).toContain('<table');
    expect(plain).toBeTruthy();

    // Cut clears the cells and dismisses selection — the 4 cells should be empty
    await expect(getCellEditable(page, 0, 0)).toHaveText('');
    await expect(getCellEditable(page, 0, 1)).toHaveText('');
    await expect(getCellEditable(page, 1, 0)).toHaveText('');
    await expect(getCellEditable(page, 1, 1)).toHaveText('');

    // Unselected cells should retain their content
    await expect(getCellEditable(page, 0, 2)).toHaveText('C1');
    await expect(getCellEditable(page, 1, 2)).toHaveText('C2');
    await expect(getCellEditable(page, 2, 0)).toHaveText('A3');
    await expect(getCellEditable(page, 2, 1)).toHaveText('B3');
    await expect(getCellEditable(page, 2, 2)).toHaveText('C3');
  });

  test('should preserve selection overlay during copy (not cut)', async ({ page }) => {
    // Create a 3x3 table with content
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [
                ['A1', 'B1', 'C1'],
                ['A2', 'B2', 'C2'],
                ['A3', 'B3', 'C3'],
              ],
            },
          },
        ],
      },
    });

    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // Select cells (0,0) to (1,1)
    await selectCells(page, 0, 0, 1, 1);

    const selected = page.locator('[data-blok-table-cell-selected]');
    const overlay = page.locator('[data-blok-table-selection-overlay]');

    await expect(selected).toHaveCount(4);
    await expect(overlay).toBeVisible();

    // Copy (not cut) — selection should remain
    await performCopyAndCapture(page);

    // Selection overlay and cell attributes should still be present
    await expect(selected).toHaveCount(4);
    await expect(overlay).toBeVisible();

    // Cell content should be unchanged
    await expect(getCellEditable(page, 0, 0)).toHaveText('A1');
    await expect(getCellEditable(page, 0, 1)).toHaveText('B1');
    await expect(getCellEditable(page, 1, 0)).toHaveText('A2');
    await expect(getCellEditable(page, 1, 1)).toHaveText('B2');
  });

  test('should paste and auto-expand rows when pasting beyond table bounds', async ({ page }) => {
    // Create a 2x2 table
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [
                ['X1', 'Y1'],
                ['X2', 'Y2'],
              ],
            },
          },
        ],
      },
    });

    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // Select all 4 cells and copy
    await selectCells(page, 0, 0, 1, 1);
    await expect(page.locator('[data-blok-table-cell-selected]')).toHaveCount(4);

    const { html, plain } = await performCopyAndCapture(page);

    expect(html).toContain('<table');

    // Click into cell (1,0) — pasting 2x2 from here needs row index 2, which doesn't exist
    // Clear selection first by clicking outside, then clicking the target cell
    const targetEditable = getCellEditable(page, 1, 0);

    await targetEditable.click();
    await expect(targetEditable).toBeFocused();

    // Paste — should auto-expand the table to accommodate
    await dispatchPasteEvent(page, html, plain);

    // The table should now have 3 rows (auto-expanded from 2)
    const rowsAfterPaste = page.locator(`${TABLE_SELECTOR} [data-blok-table-row]`);

    await expect(rowsAfterPaste).toHaveCount(3);

    // Verify pasted content landed at (1,0)-(2,1)
    await expect(getCellEditable(page, 1, 0)).toHaveText('X1');
    await expect(getCellEditable(page, 1, 1)).toHaveText('Y1');
    await expect(getCellEditable(page, 2, 0)).toHaveText('X2');
    await expect(getCellEditable(page, 2, 1)).toHaveText('Y2');

    // Row 0 should be unchanged
    await expect(getCellEditable(page, 0, 0)).toHaveText('X1');
    await expect(getCellEditable(page, 0, 1)).toHaveText('Y1');
  });

  test('should paste outside table and create a new table block', async ({ page }) => {
    // Create a table with a paragraph block below it
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [
                ['Hello', 'World'],
                ['Foo', 'Bar'],
              ],
            },
          },
          {
            type: 'paragraph',
            data: { text: '' },
          },
        ],
      },
    });

    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // Select all 4 cells in the table and copy
    await selectCells(page, 0, 0, 1, 1);
    await expect(page.locator('[data-blok-table-cell-selected]')).toHaveCount(4);

    const { html, plain } = await performCopyAndCapture(page);

    expect(html).toContain('<table');

    // Click on the paragraph block below the table to focus it
     
    const paragraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-tool="paragraph"]`).last();

    await paragraph.click();

    // Paste — the paste module's TableCellsHandler should create a new table block
    await dispatchPasteEvent(page, html, plain);

    // Wait for the second table to appear
    const tables = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`);

    await expect(tables).toHaveCount(2, { timeout: 5000 });
  });

  test('Pasting cells that expand the table preserves existing pixel colWidths in saved data', async ({ page }) => {
    // Initialize editor with TWO tables:
    // Table 1 (source): 2x3, no colWidths
    // Table 2 (target): 2x2, with colWidths [200, 200]
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [
                ['X1', 'X2', 'X3'],
                ['Y1', 'Y2', 'Y3'],
              ],
            },
          },
          {
            type: 'table',
            data: {
              withHeadings: false,
              colWidths: [200, 200],
              content: [
                ['A', 'B'],
                ['C', 'D'],
              ],
            },
          },
        ],
      },
    });

    const allTables = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`);

    await expect(allTables).toHaveCount(2);

    // Helper to get a cell scoped to a specific table instance
    const getCellInTable = (tableIndex: number, row: number, col: number): ReturnType<Page['locator']> =>
      allTables
        .nth(tableIndex)
        .locator(`[data-blok-table-row] >> nth=${row}`)
        .locator(`[data-blok-table-cell] >> nth=${col}`);

    const getCellEditableInTable = (tableIndex: number, row: number, col: number): ReturnType<Page['locator']> =>
      getCellInTable(tableIndex, row, col).locator('[contenteditable="true"]');

    // Select cells (0,0) to (0,2) in table 1 — 3 cells in the first row: X1, X2, X3
    const startCell = getCellInTable(0, 0, 0);
    const endCell = getCellInTable(0, 0, 2);

    const startBox = assertBoundingBox(await startCell.boundingBox(), 'table1 cell [0,0]');
    const endBox = assertBoundingBox(await endCell.boundingBox(), 'table1 cell [0,2]');

    await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2, { steps: 10 });
    await page.mouse.up();

    // Verify 3 cells are selected in table 1
    const selected = allTables.nth(0).locator('[data-blok-table-cell-selected]');

    await expect(selected).toHaveCount(3);

    // Copy via synthetic copy event
    const { html, plain } = await performCopyAndCapture(page);

    expect(html).toContain('<table');

    // Click into cell (0,0) of table 2
    const targetEditable = getCellEditableInTable(1, 0, 0);

    await targetEditable.click();
    await expect(targetEditable).toBeFocused();

    // Paste — should auto-expand table 2 from 2 columns to 3 columns
    await dispatchPasteEvent(page, html, plain);

    // Wait for pasted content to appear in the expanded cell
    await expect(getCellEditableInTable(1, 0, 2)).toHaveText('X3');

    // Save and verify colWidths in the second table block
    const savedData = await page.evaluate(async () => {
      const data = await window.blokInstance?.save();

      return data;
    });

    expect(savedData).toBeTruthy();

    // Find the second table block in saved data
    const tableBlocks = savedData?.blocks.filter(
      (block: { type: string }) => block.type === 'table'
    );

    expect(tableBlocks).toHaveLength(2);

    const secondTableData = tableBlocks?.[1]?.data as {
      colWidths?: number[];
      content: string[][];
    };

    // The colWidths array should have been expanded from 2 entries to 3
    expect(secondTableData.colWidths).toBeDefined();
    expect(secondTableData.colWidths).toHaveLength(3);
  });
});
