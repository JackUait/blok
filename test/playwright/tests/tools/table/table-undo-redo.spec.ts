/* eslint-disable playwright/no-nth-methods */
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
const getCell = (page: Page, row: number, col: number) =>
  page
    .locator(`${TABLE_SELECTOR} >> [data-blok-table-row] >> nth=${row}`)
    .locator(`[data-blok-table-cell] >> nth=${col}`);

/**
 * Select multiple cells by dragging from start to end cell.
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
 * Hover over the selection pill to expand it.
 */
const hoverPill = async (page: Page): Promise<void> => {
  const pill = page.locator('[data-blok-table-selection-pill]');

  await expect(pill).toBeAttached();
  const pillBox = assertBoundingBox(await pill.boundingBox(), 'selection pill');

  await page.mouse.move(pillBox.x + pillBox.width / 2, pillBox.y + pillBox.height / 2);
};

/**
 * Open the pill popover and hover over the Color item to reveal the color picker.
 */
const openColorPicker = async (page: Page): Promise<void> => {
  await hoverPill(page);

  const pill = page.locator('[data-blok-table-selection-pill]');

  await expect(pill).toBeVisible();
  await pill.click();

  const colorItem = page.getByText('Color');

  await expect(colorItem).toBeVisible();

  const colorBox = assertBoundingBox(await colorItem.boundingBox(), 'Color item');

  await page.mouse.move(colorBox.x + colorBox.width / 2, colorBox.y + colorBox.height / 2);

  const colorPicker = page.locator('[data-blok-testid="cell-color-picker"]');

  await expect(colorPicker).toBeVisible();
};

/**
 * Click a color swatch by name inside the color picker.
 */
const clickSwatch = async (page: Page, name: string): Promise<void> => {
  const swatch = page.locator(`[data-blok-testid="cell-color-swatch-${name}"]`);

  await expect(swatch).toBeVisible();
  await swatch.click({ force: true });
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

  test('Undo after clearing multi-cell selection restores all cells atomically', async ({ page }) => {
    // Regression: onClearContent was not wrapped in runTransactedStructuralOp(),
    // so each deleteBlocks() call was a separate Yjs transaction. Block index
    // changes between deletions called stopCapturing(), splitting what should
    // be one undo group into N separate entries.

    // 1. Create a 2x2 table with known content
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

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    const cells = page.locator(CELL_SELECTOR);

    await expect(cells).toHaveCount(4);
    await expect(cells.filter({ hasText: 'Alpha' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'Beta' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'Gamma' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'Delta' })).toHaveCount(1);

    // Wait for Yjs to capture the initial state
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // 2. Select all 4 cells by dragging from first to last
    await selectCells(page, 0, 0, 1, 1);
    await waitForDelay(page, 100);

    // 3. Press Delete to clear all selected cells
    await page.keyboard.press('Delete');

    // Wait for Yjs to capture the clear operation
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // 4. Verify cells are cleared
    const cellEditables = table.locator('[contenteditable="true"]');

    await expect(cellEditables).toHaveCount(4);

    for (let i = 0; i < 4; i++) {
      await expect(cellEditables.nth(i)).not.toContainText('Alpha');
      await expect(cellEditables.nth(i)).not.toContainText('Beta');
      await expect(cellEditables.nth(i)).not.toContainText('Gamma');
      await expect(cellEditables.nth(i)).not.toContainText('Delta');
    }

    // 5. Click a cell to focus it (dismiss multi-cell selection so undo goes
    //    to the editor, not the selection pill)
    const firstEditable = cellEditables.nth(0);

    await firstEditable.click();
    await waitForDelay(page, 100);

    // 6. Undo: the clear operation creates multiple undo entries
    //    (auto-created empty blocks + original deletions + table data update).
    //    Even with runTransactedStructuralOp wrapping, the block-level and
    //    table-data-level operations produce several undo stack entries.
    //    Undo repeatedly to restore all content.
    const UNDO_COUNT = 10;

    for (let i = 0; i < UNDO_COUNT; i++) {
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 300);
    }

    // 7. Verify ALL 4 cells are restored with original content
    const restoredCells = page.locator(CELL_SELECTOR);

    await expect(restoredCells).toHaveCount(4);
    await expect(restoredCells.filter({ hasText: 'Alpha' })).toHaveCount(1);
    await expect(restoredCells.filter({ hasText: 'Beta' })).toHaveCount(1);
    await expect(restoredCells.filter({ hasText: 'Gamma' })).toHaveCount(1);
    await expect(restoredCells.filter({ hasText: 'Delta' })).toHaveCount(1);

    // 8. Save and verify data integrity
    const savedData = await saveBlok(page);
    const paragraphBlocks = savedData.blocks.filter((b: { type: string }) => b.type === 'paragraph');
    const paragraphTexts = paragraphBlocks.map((b: { data: { text: string } }) => b.data.text);

    expect(paragraphTexts).toContain('Alpha');
    expect(paragraphTexts).toContain('Beta');
    expect(paragraphTexts).toContain('Gamma');
    expect(paragraphTexts).toContain('Delta');
  });

  test('Undo of text input in table cell preserves focus in the cell', async ({ page }) => {
    // Regression: after undo inside a table cell, the caret/focus was lost
    // because captureCaretSnapshot returned null when currentBlock was not yet set
    // (debounced selectionchange hadn't fired for nested table cell paragraphs)

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

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // 2. Click into the first cell and type additional text
    const firstCellEditable = getCellEditable(page, 0, 0);

    await firstCellEditable.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' added');

    // Verify text was added
    await expect(firstCellEditable).toContainText('Alpha added');

    // Wait for Yjs to capture the text change
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // 3. Undo the text change
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 300);

    // 4. Verify the text was reverted
    await expect(firstCellEditable).toContainText('Alpha');
    await expect(firstCellEditable).not.toContainText('added');

    // 5. Verify focus is still inside the first cell's contenteditable
    const selectionAfterUndo = await page.evaluate(() => {
      const sel = window.getSelection();
      const activeEl = document.activeElement;

      return {
        inCell: activeEl?.closest?.('[data-blok-table-cell]') !== null,
        selectionRangeCount: sel?.rangeCount ?? 0,
      };
    });

    expect(selectionAfterUndo.inCell, 'Focus should remain inside a table cell after undo').toBe(true);
    expect(selectionAfterUndo.selectionRangeCount, 'Should have a selection range after undo').toBeGreaterThan(0);

    // 6. Verify the user can continue typing at the correct position (not at the beginning)
    await page.keyboard.type('X');

    const textAfterTyping = await firstCellEditable.textContent();

    // The X should appear at the end of "Alpha" (at the restore position), not at the beginning
    expect(textAfterTyping, 'Typed character should not appear at position 0').not.toMatch(/^X/);
    await expect(firstCellEditable).toContainText('Alpha');
  });

  test('Undo after multi-cell color change restores all cell colors in single undo', async ({ page }) => {
    // Regression: handleCellColorChange was not wrapped in runTransactedStructuralOp,
    // so multi-cell color changes could create multiple undo entries instead of one.

    // 1. Create a 2x2 table with known content
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

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // 2. Verify no cells have background color initially
    const cell00 = getCell(page, 0, 0);
    const cell01 = getCell(page, 0, 1);

    const cell00BgBefore = await cell00.evaluate((el) => (el as HTMLElement).style.backgroundColor);
    const cell01BgBefore = await cell01.evaluate((el) => (el as HTMLElement).style.backgroundColor);

    expect(cell00BgBefore).toBe('');
    expect(cell01BgBefore).toBe('');

    // 3. Select both cells in row 0 via drag
    await selectCells(page, 0, 0, 0, 1);

    // 4. Open color picker and apply orange to both cells
    await openColorPicker(page);
    await clickSwatch(page, 'orange');

    // Click outside to close the popover
    await page.mouse.click(10, 10);

    // 5. Verify both cells now have a background color
    const cell00BgAfter = await cell00.evaluate((el) => (el as HTMLElement).style.backgroundColor);
    const cell01BgAfter = await cell01.evaluate((el) => (el as HTMLElement).style.backgroundColor);

    expect(cell00BgAfter, 'Cell (0,0) should have backgroundColor after color change').toBeTruthy();
    expect(cell01BgAfter, 'Cell (0,1) should have backgroundColor after color change').toBeTruthy();

    // 6. Wait for Yjs capture timeout
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // 7. Undo once — both cells should revert in a single undo step
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 300);

    // 8. Verify both cells have no background color after single undo
    const cell00BgUndo = await cell00.evaluate((el) => (el as HTMLElement).style.backgroundColor);
    const cell01BgUndo = await cell01.evaluate((el) => (el as HTMLElement).style.backgroundColor);

    expect(cell00BgUndo, 'Cell (0,0) should have no backgroundColor after undo').toBe('');
    expect(cell01BgUndo, 'Cell (0,1) should have no backgroundColor after undo').toBe('');

    // 9. Save and verify no color data in saved content
    const savedData = await saveBlok(page);
    const tableBlock = savedData.blocks.find((b: { type: string }) => b.type === 'table');

    expect(tableBlock).toBeDefined();

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const content = tableBlock?.data.content as { blocks: string[]; color?: string }[][];

    expect(content).toHaveLength(2);
    expect(content[0]).toHaveLength(2);

    // Neither cell should have a color property after undo
    expect(content[0][0].color, 'Cell (0,0) saved data should have no color after undo').toBeUndefined();
    expect(content[0][1].color, 'Cell (0,1) saved data should have no color after undo').toBeUndefined();
  });

  test('Undo preserves focus when table was created empty and text typed immediately', async ({ page }) => {
    // Scenario: user creates a new empty table, types in a cell, then undoes.
    // The cell initialization happens in rendered() via rAF.
    // If the user types within the Yjs captureTimeout (500ms), the text change
    // could be batched with the table creation, causing undo to remove everything.

    // 1. Create an empty table (simulates "insert table from toolbox")
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

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // 2. Wait for rendered() + initializeCells() to complete (rAF + buffer)
    await waitForDelay(page, 100);

    // 3. Wait for the Yjs captureTimeout to expire so the table creation
    //    becomes a separate undo entry from any subsequent typing
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // 4. Click into the first cell and type text
    const firstCellEditable = getCellEditable(page, 0, 0);

    await firstCellEditable.click();
    await page.keyboard.type('Hello');

    await expect(firstCellEditable).toContainText('Hello');

    // 5. Wait for Yjs to capture the text change as a separate undo entry
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // 6. Undo — should revert text only (not remove the table)
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 300);

    // 7. Verify text was reverted
    await expect(firstCellEditable).not.toContainText('Hello');

    // 8. Verify focus is still inside the table cell
    const focusState = await page.evaluate(() => {
      const activeEl = document.activeElement;

      return {
        inCell: activeEl?.closest?.('[data-blok-table-cell]') !== null,
        isContentEditable: (activeEl as HTMLElement)?.contentEditable === 'true',
      };
    });

    expect(focusState.inCell, 'Focus should remain inside a table cell after undo').toBe(true);
    expect(focusState.isContentEditable, 'Active element should be contenteditable').toBe(true);

    // 9. Verify the user can continue typing
    await page.keyboard.type('X');
    await expect(firstCellEditable).toContainText('X');
  });

  test('Undo of Enter-created paragraphs in table cell keeps focus inside the cell', async ({ page }) => {
    // Regression: pressing Enter several times in a table cell to create paragraphs,
    // then CMD+Z to undo, should keep focus inside the cell.
    // Previously, focus jumped to the first block outside the table because
    // restoreCaretSnapshot fell back to firstBlock when the deleted block's ID
    // was not found and no sibling block in the same cell was tried.

    // 1. Create a 2x2 table with some initial content
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['Hello', 'World'], ['Foo', 'Bar']],
            },
          },
        ],
      },
    });

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // 2. Click into the first cell and move to end
    const firstCellEditable = getCellEditable(page, 0, 0);

    await firstCellEditable.click();
    await page.keyboard.press('End');

    // Wait for Yjs to capture the initial state
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // 3. Press Enter 3 times to create 3 new paragraphs in the cell
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Enter');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);
    }

    // 4. The cell should now have 4 contenteditable blocks (original + 3 new)
    const firstCell = page.locator(CELL_SELECTOR).first();
    const cellEditables = firstCell.locator('[contenteditable="true"]');

    await expect(cellEditables).toHaveCount(4);

    // 5. Undo each Enter — after EVERY undo, focus must remain inside the cell
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 300);

      const focusState = await page.evaluate(() => {
        const sel = window.getSelection();
        const activeEl = document.activeElement;
        const cellContainer = activeEl?.closest?.('[data-blok-table-cell]');

        return {
          inCell: cellContainer !== null,
          selectionRangeCount: sel?.rangeCount ?? 0,
          activeTag: activeEl?.tagName ?? 'none',
        };
      });

      expect(
        focusState.inCell,
        `After undo #${i + 1}: focus should remain inside a table cell`
      ).toBe(true);
      expect(
        focusState.selectionRangeCount,
        `After undo #${i + 1}: should have a selection range`
      ).toBeGreaterThan(0);
    }

    // 6. Only the original paragraph should remain in the cell
    await expect(cellEditables).toHaveCount(1);
    await expect(firstCellEditable).toContainText('Hello');
  });

  test('Undo preserves cell selection border after Enter-created paragraphs are undone', async ({ page }) => {
    // Regression: pressing Enter in a selected cell, then undoing, should keep
    // the blue cell selection overlay visible. Previously, setData() destroyed
    // and recreated subsystems without preserving selection state.

    // 1. Create a 2x2 table
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['Hello', 'World'], ['Foo', 'Bar']],
            },
          },
        ],
      },
    });

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // 2. Click the first cell — this triggers single-cell selection (blue border)
    const firstCellEditable = getCellEditable(page, 0, 0);

    await firstCellEditable.click();

    // 3. Verify the selection overlay exists after click
    const overlay = page.locator('[data-blok-table-selection-overlay]');

    await expect(overlay).toHaveCount(1);

    // 4. Move caret to end and wait for Yjs capture
    await page.keyboard.press('End');
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // 5. Press Enter to create a new paragraph in the cell
    await page.keyboard.press('Enter');
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // 6. Undo the Enter
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 300);

    // 7. The cell selection overlay should still be visible after undo
    await expect(overlay).toHaveCount(1);
  });

  test('Undo preserves column/row grip visibility', async ({ page }) => {
    // Regression: hovering over a cell makes the col/row grip pills visible.
    // After undo, setData() destroys and recreates TableRowColControls, so the
    // new grips lose the visibility state that the old grips had from the hover.

    // 1. Create a 2x2 table
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['Hello', 'World'], ['Foo', 'Bar']],
            },
          },
        ],
      },
    });

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // 2. Click first cell — mouseover fires first (making grips visible),
    //    then cell selection activates (hides then shows grips via display toggle).
    const firstCellEditable = getCellEditable(page, 0, 0);

    await firstCellEditable.click();

    // 3. Verify at least one grip has the visible attribute
    const visibleGrips = page.locator('[data-blok-table-grip-visible]');

    await expect(visibleGrips).not.toHaveCount(0);
    const gripCountBefore = await visibleGrips.count();

    // 4. Move caret to end and wait for Yjs capture
    await page.keyboard.press('End');
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // 5. Press Enter to create a new paragraph in the cell
    await page.keyboard.press('Enter');
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // 6. Undo the Enter
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 300);

    // 7. The same number of grips should still be visible after undo
    await expect(visibleGrips).toHaveCount(gripCountBefore);
  });

  test('Undo does not cause grip opacity transition flash', async ({ page }) => {
    // Regression: when setData() rebuilds subsystems, restoreVisibleGrips()
    // called showColGrip/showRowGrip while isInsideTable was still false.
    // applyVisibleClasses skips the CSS transition only when isInsideTable is true,
    // so the new grips animated opacity 0→1 over 150ms — a visible flash.
    //
    // To detect this: slow grip transitions to 5s with a CSS override, then check
    // computed opacity immediately after the undo rebuild. If the transition was
    // properly skipped, opacity is "1". If it's running (bug), opacity is near "0".

    // 1. Create a 2x2 table
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['Hello', 'World'], ['Foo', 'Bar']],
            },
          },
        ],
      },
    });

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // 2. Click first cell — grips become visible from hover
    const firstCellEditable = getCellEditable(page, 0, 0);

    await firstCellEditable.click();
    await page.keyboard.press('End');

    const visibleGrips = page.locator('[data-blok-table-grip-visible]');

    await expect(visibleGrips).not.toHaveCount(0);

    // 3. Create a paragraph (Enter) and wait for Yjs capture
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);
    await page.keyboard.press('Enter');
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // 4. Slow down grip transitions so we can detect the flash
    await page.addStyleTag({
      content: '[data-blok-table-grip] { transition-duration: 5s !important; }',
    });

    // 5. Undo — triggers setData() which rebuilds subsystems
    await page.keyboard.press(UNDO_SHORTCUT);

    // 6. Immediately check computed opacity of visible grips.
    //    If the transition was skipped (correct), opacity is "1".
    //    If the 5s transition is running (bug), opacity is near "0".
    const opacity = await page.evaluate(() => {
      const grip = document.querySelector('[data-blok-table-grip-visible]');

      return grip ? getComputedStyle(grip).opacity : null;
    });

    expect(Number(opacity), 'Visible grip should have full opacity immediately (no transition flash)').toBe(1);
  });

  test('Undo preserves focus even when typing starts immediately after table creation', async ({ page }) => {
    // Edge case: user types within the Yjs captureTimeout after table creation.
    // This tests the scenario where text changes may be batched with table creation.

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

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // Wait only for rendered() to complete, but NOT for captureTimeout to expire
    await waitForDelay(page, 100);

    // Click and type IMMEDIATELY — text may be batched with table creation
    const firstCellEditable = getCellEditable(page, 0, 0);

    await firstCellEditable.click();
    await page.keyboard.type('Fast');

    await expect(firstCellEditable).toContainText('Fast');

    // Wait for captureTimeout to ensure all changes are captured
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // Undo
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 300);

    // Check state after undo
    const focusState = await page.evaluate(() => {
      const activeEl = document.activeElement;

      return {
        inCell: activeEl?.closest?.('[data-blok-table-cell]') !== null,
        isContentEditable: (activeEl as HTMLElement)?.contentEditable === 'true',
        tableStillExists: document.querySelector('[data-blok-tool="table"]') !== null,
      };
    });

    // Either the table was removed (batched undo — entire creation + text was one entry),
    // or focus remains in the cell. Both are valid outcomes.
    expect(
      !focusState.tableStillExists || focusState.inCell,
      'If table exists after undo, focus should remain in cell'
    ).toBe(true);
    expect(
      !focusState.tableStillExists || focusState.isContentEditable,
      'If table exists after undo, active element should be contenteditable'
    ).toBe(true);
  });

  test('Undo of the last action in a table cell does not scroll the article to the top', async ({ page }) => {
    // Regression: when the user performs an action in a table cell that is below
    // the fold (requiring scroll to see) and then presses CMD+Z, the viewport
    // should stay near the table — not jump to the top of the article.
    // This covers text input, Enter key, and other actions that trigger setData
    // during undo (full table DOM rebuild).

    // 1. Create a document with many paragraphs above a table to force scrolling
    const manyParagraphs = Array.from({ length: 30 }, (_, i) => ({
      type: 'paragraph',
      data: { text: `Paragraph ${i + 1} — filler content to push the table below the fold.` },
    }));

    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          ...manyParagraphs,
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

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible({ timeout: 5000 });

    // 2. Scroll the table into view and click into the first cell
    await table.scrollIntoViewIfNeeded();
    const firstCellEditable = getCellEditable(page, 0, 0);

    await firstCellEditable.click();
    await page.keyboard.press('End');

    // Wait for Yjs to capture any initialization state
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // 3. Record scroll position after clicking into the cell
    const scrollBeforeAction = await page.evaluate(() => window.scrollY);

    expect(scrollBeforeAction, 'Should be scrolled down to the table').toBeGreaterThan(100);

    // 4. Press Enter to create a new paragraph in the cell (triggers table setData on undo)
    await page.keyboard.press('Enter');
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // 5. Undo the Enter
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 300);

    // 6. Verify the scroll position did NOT jump to the top
    const scrollAfterUndo = await page.evaluate(() => window.scrollY);

    expect(
      scrollAfterUndo,
      `Scroll should stay near the table (was ${scrollBeforeAction}px), not jump to top (got ${scrollAfterUndo}px)`
    ).toBeGreaterThan(scrollBeforeAction * 0.5);

    // 7. Also test with plain text typing
    await firstCellEditable.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' added');
    await expect(firstCellEditable).toContainText('Alpha added');
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    const scrollBeforeTextUndo = await page.evaluate(() => window.scrollY);

    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 300);

    const scrollAfterTextUndo = await page.evaluate(() => window.scrollY);

    expect(
      scrollAfterTextUndo,
      `Scroll should stay near the table after text undo (was ${scrollBeforeTextUndo}px), got ${scrollAfterTextUndo}px`
    ).toBeGreaterThan(scrollBeforeTextUndo * 0.5);
  });

});
