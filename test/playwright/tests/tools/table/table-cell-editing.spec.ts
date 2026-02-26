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
});
