// spec: specs/table-tool-test-plan.md
// seed: test/playwright/tests/tools/table.spec.ts

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;
const CELL_SELECTOR = '[data-blok-table-cell]';

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
 * Returns the cell at the given 0-based row and column index.
 */
const getCell = (page: Page, row: number, col: number) => {
  return page
    .locator(`${TABLE_SELECTOR} >> [data-blok-table-row] >> nth=${row}`)
    .locator(`${CELL_SELECTOR} >> nth=${col}`);
};

/**
 * Returns the first contenteditable element inside the cell at (row, col).
 */
const getCellEditable = (page: Page, row: number, col: number) => {
  return getCell(page, row, col).locator('[data-blok-table-cell-blocks] [contenteditable="true"] >> nth=0');
};

test.describe('Cell Editing', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('Types text into a table cell and text persists in saved data', async ({ page }) => {
    // 1. Initialize editor with a 2x2 table with empty cells
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

    // 2. Click the contenteditable area inside the first cell
    const firstCellEditable = getCellEditable(page, 0, 0);

    await firstCellEditable.click();

    // 3. Type 'Hello World'
    await page.keyboard.type('Hello World');

    // 4. Call save() on the editor
    const savedData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    // 5. Verify 'Hello World' is visible in the first cell
    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();
    await expect(firstCellEditable).toContainText('Hello World');

    // Verify saved data contains a paragraph block with text 'Hello World' referenced by the first cell's block ID
    const tableBlock = savedData?.blocks.find((b: { type: string }) => b.type === 'table');
    const content = (tableBlock?.data as { content: { blocks: string[] }[][] }).content;
    const firstCellBlockId = content[0][0].blocks[0];

    const cellParagraph = savedData?.blocks.find(
      (b: { id?: string }) => b.id === firstCellBlockId
    );

    expect((cellParagraph as { data: { text: string } })?.data.text).toBe('Hello World');
  });

  test('Pressing Enter in a cell creates a new block within the same cell', async ({ page }) => {
    // 1. Initialize editor with a 2x2 table with empty cells
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

    // 2. Click into the first cell's editable area
    const firstCellEditable = getCellEditable(page, 0, 0);

    await firstCellEditable.click();

    // 3. Type 'First line'
    await page.keyboard.type('First line');

    // 4. Press Enter
    await page.keyboard.press('Enter');

    // 5. Type 'Second line'
    await page.keyboard.type('Second line');

    // 6. Verify both 'First line' and 'Second line' appear in the first cell
    const firstCell = getCell(page, 0, 0);

    await expect(firstCell).toContainText('First line');
    await expect(firstCell).toContainText('Second line');

    // 7. Verify focus remains in the first cell (not moved to next row)
    const focusedCellIndex = await page.evaluate(() => {
      const activeEl = document.activeElement;

      if (!activeEl) {
        return -1;
      }

      const cell = activeEl.closest('[data-blok-table-cell]');

      if (!cell) {
        return -1;
      }

      const allCells = Array.from(document.querySelectorAll('[data-blok-table-cell]'));

      return allCells.indexOf(cell);
    });

    expect(focusedCellIndex).toBe(0);
  });

  test('Pressing Enter in an empty cell creates a block in the same cell, not the cell above', async ({ page }) => {
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            id: 'table1',
            type: 'table',
            data: {
              withHeadings: false,
              content: [['', ''], ['', '']],
            },
          },
        ],
      },
    });

    // Click the second row, first column cell (row 1, col 0)
    const targetCell = getCell(page, 1, 0);
    const editable = getCellEditable(page, 1, 0);

    await editable.click();

    // Press Enter in the empty cell
    await page.keyboard.press('Enter');

    // The new block should be in the same cell (row 1, col 0)
    const focusCellIndex = await page.evaluate(() => {
      const active = document.activeElement;

      if (!active) {
        return -1;
      }

      const cell = active.closest('[data-blok-table-cell]');

      if (!cell) {
        return -1;
      }

      const allCells = Array.from(document.querySelectorAll('[data-blok-table-cell]'));

      return allCells.indexOf(cell);
    });

    // Cell index 2 = row 1, col 0 in a 2x2 table (0-indexed: 0,1,2,3)
    expect(focusCellIndex).toBe(2);

    // Verify the cell above (row 0, col 0) still has only one block
    const cellAboveBlockCount = getCell(page, 0, 0).locator('[data-blok-id]');

    await expect(cellAboveBlockCount).toHaveCount(1);

    // Verify the target cell now has two blocks (original + new from Enter)
    const targetCellBlockCount = targetCell.locator('[data-blok-id]');

    await expect(targetCellBlockCount).toHaveCount(2);
  });

  test('Pressing Enter in the middle of text splits into two blocks within the same cell', async ({ page }) => {
    // 1. Initialize editor with a 2x2 table
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

    // 2. Click into the first cell and type text
    const firstCellEditable = getCellEditable(page, 0, 0);

    await firstCellEditable.click();
    await page.keyboard.type('HelloWorld');

    // 3. Move caret to the middle (before "World")
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('ArrowLeft');
    }

    // 4. Press Enter to split the text
    await page.keyboard.press('Enter');

    // 5. Verify both halves appear in the first cell
    const firstCell = getCell(page, 0, 0);

    await expect(firstCell).toContainText('Hello');
    await expect(firstCell).toContainText('World');

    // 6. Verify the cell has exactly 2 block holders
    const blockHolders = firstCell.locator('[data-blok-id]');

    await expect(blockHolders).toHaveCount(2);

    // 7. Save and verify no orphan blocks outside the table
    const savedData = await page.evaluate(async () => {
      const blok = window.blokInstance;

      if (!blok) {
        throw new Error('Blok instance not found');
      }

      return blok.save();
    });

    // Find the table block index
    const tableIndex = savedData.blocks.findIndex(
      (b: { type: string }) => b.type === 'table'
    );

    expect(tableIndex).toBeGreaterThanOrEqual(0);

    // Count non-table paragraph blocks after the table that are NOT children of the table.
    // In the flat output, child blocks of the table legitimately appear after the table block
    // with a parent reference. An orphan is a block that has no parent (or a null parent).
    const blocksAfterTable = savedData.blocks.slice(tableIndex + 1);

    // There should be no orphaned paragraph blocks containing "Hello" or "World"
    // (orphaned = not owned by the table, i.e. no parent pointing to the table block)
    const tableId = (savedData.blocks[tableIndex] as { id: string }).id;
    const orphanedBlocks = blocksAfterTable.filter(
      (b: { type: string; parent?: string; data?: { text?: string } }) =>
        b.type === 'paragraph' &&
        b.parent !== tableId &&
        (b.data?.text === 'Hello' || b.data?.text === 'World')
    );

    expect(orphanedBlocks).toHaveLength(0);
  });

  test('Clicking blank space below block content in a cell focuses the last block', async ({ page }) => {
    // 1. Initialize editor with a 2x2 table with empty cells
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

    // 2. Click on the cell element (not the contenteditable, but the cell background/blocks container)
    const firstCell = getCell(page, 0, 0);

    // Click near the bottom of the cell to land on blank space
    const cellBox = assertBoundingBox(await firstCell.boundingBox(), 'First cell');

    await page.mouse.click(
      cellBox.x + cellBox.width / 2,
      cellBox.y + cellBox.height - 4
    );

    // 3. Verify the contenteditable element of the last block in the cell receives focus
    const focusedInFirstCell = await page.evaluate(() => {
      const activeEl = document.activeElement;

      if (!activeEl) {
        return false;
      }

      const cell = activeEl.closest('[data-blok-table-cell]');
      const allCells = Array.from(document.querySelectorAll('[data-blok-table-cell]'));

      return allCells.indexOf(cell as Element) === 0;
    });

    expect(focusedInFirstCell).toBe(true);
  });

  test('Cell placeholder is suppressed inside table cells when focused', async ({ page }) => {
    // 1. Initialize editor with a 2x2 table with empty cells
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

    // 2. Click the first cell's editable area
    const firstCellEditable = getCellEditable(page, 0, 0);

    await firstCellEditable.click();

    // 3. Verify data-blok-placeholder-active attribute is absent on the focused editable
    await expect(firstCellEditable).not.toHaveAttribute('data-blok-placeholder-active');
  });

  test('Cell placeholder is suppressed inside table cells when unfocused', async ({ page }) => {
    // 1. Initialize editor with a 2x2 table with empty cells
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

    // 2. Do not click into any cell - verify absence of placeholder in unfocused state
    const firstCellEditable = getCellEditable(page, 0, 0);

    // 3. Verify no placeholder attribute on unfocused cell's editable
    await expect(firstCellEditable).not.toHaveAttribute('data-blok-placeholder-active');

    // Also verify the data-placeholder attribute is stripped from table cell editables
    await expect(firstCellEditable).not.toHaveAttribute('data-placeholder');
  });

  test('Ghost children (blocks with parent but not in any cell) are cleaned up on render', async ({ page }) => {
    // Set up data that simulates stale ghost children:
    // - A table with a 2x2 grid where cells reference specific child blocks
    // - Additional paragraph blocks that claim the table as parent but are NOT in any cell's blocks array
    const tableId = 'table-ghost-test';
    const cellBlock1 = 'cell-block-1';
    const cellBlock2 = 'cell-block-2';
    const cellBlock3 = 'cell-block-3';
    const cellBlock4 = 'cell-block-4';
    const ghostBlock1 = 'ghost-block-1';
    const ghostBlock2 = 'ghost-block-2';
    const ghostBlock3 = 'ghost-block-3';

    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            id: tableId,
            type: 'table',
            data: {
              withHeadings: false,
              content: [
                [{ blocks: [cellBlock1] }, { blocks: [cellBlock2] }],
                [{ blocks: [cellBlock3] }, { blocks: [cellBlock4] }],
              ],
            },
          },
          // Legitimate child blocks referenced by cells
          { id: cellBlock1, type: 'paragraph', data: { text: 'Cell 1' }, parent: tableId },
          { id: cellBlock2, type: 'paragraph', data: { text: 'Cell 2' }, parent: tableId },
          { id: cellBlock3, type: 'paragraph', data: { text: 'Cell 3' }, parent: tableId },
          { id: cellBlock4, type: 'paragraph', data: { text: 'Cell 4' }, parent: tableId },
          // Ghost children: have parent=tableId but are NOT in any cell's blocks array
          { id: ghostBlock1, type: 'paragraph', data: { text: 'Ghost 1' }, parent: tableId },
          { id: ghostBlock2, type: 'paragraph', data: { text: '' }, parent: tableId },
          { id: ghostBlock3, type: 'paragraph', data: { text: 'Ghost 3' }, parent: tableId },
        ],
      },
    });

    // 1. Verify ghost blocks are NOT visible in the working area outside the table
    // Check that ghost block holders don't exist as direct children of the working area
    const ghostBlocksInWorkingArea = await page.evaluate(
      ({ ghostIds }) => {
        const workingArea = document.querySelector('[data-blok-redactor]');

        if (!workingArea) {
          return [];
        }

        return ghostIds.filter(id =>
          workingArea.querySelector(`:scope > [data-blok-id="${id}"]`) !== null
        );
      },
      { ghostIds: [ghostBlock1, ghostBlock2, ghostBlock3] }
    );

    expect(ghostBlocksInWorkingArea).toHaveLength(0);

    // 2. Verify the "Ghost" text does not appear anywhere outside the table
    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // Ghost text should not be present on the page at all
    await expect(page.getByText('Ghost 1')).toHaveCount(0);
    await expect(page.getByText('Ghost 3')).toHaveCount(0);

    // 3. Verify legitimate cell blocks still render correctly inside the table
    await expect(table).toContainText('Cell 1');
    await expect(table).toContainText('Cell 2');
    await expect(table).toContainText('Cell 3');
    await expect(table).toContainText('Cell 4');

    // 4. Save and verify ghost blocks are excluded from output
    const savedData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    const savedBlockIds = savedData?.blocks.map(
      (b: { id?: string }) => b.id
    ) ?? [];

    // Ghost block IDs should not appear in saved data
    expect(savedBlockIds).not.toContain(ghostBlock1);
    expect(savedBlockIds).not.toContain(ghostBlock2);
    expect(savedBlockIds).not.toContain(ghostBlock3);

    // Legitimate cell block IDs should still be present
    expect(savedBlockIds).toContain(cellBlock1);
    expect(savedBlockIds).toContain(cellBlock2);
    expect(savedBlockIds).toContain(cellBlock3);
    expect(savedBlockIds).toContain(cellBlock4);
  });
});
