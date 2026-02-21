// spec: specs/table-tool-test-plan.md (section 8)
// seed: test/playwright/tests/tools/table-cell-selection-delete.spec.ts

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
 * Helper to create a 3x3 table with labeled cells.
 * Content layout: row 0 = ['A1','B1','C1'], row 1 = ['A2','B2','C2'], row 2 = ['A3','B3','C3']
 */
const create3x3TableWithContent = async (page: Page): Promise<void> => {
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

test.describe('Cell Selection', () => {
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

  test('Dragging across cells selects a rectangular range', async ({ page }) => {
    // 1. Initialize editor with a 3x3 table with content ['A1'..'C3']
    await create3x3TableWithContent(page);

    // 2. Press and hold the pointer in cell (0,0), drag to cell (1,1), release
    await selectCells(page, 0, 0, 1, 1);

    // Verify cells (0,0), (0,1), (1,0), (1,1) have the data-blok-table-cell-selected attribute
    const selected = page.locator('[data-blok-table-cell-selected]');

    await expect(selected).toHaveCount(4);

    // Verify cells outside the rectangle are not selected
    await expect(getCell(page, 0, 2)).not.toHaveAttribute('data-blok-table-cell-selected');
    await expect(getCell(page, 1, 2)).not.toHaveAttribute('data-blok-table-cell-selected');
    await expect(getCell(page, 2, 0)).not.toHaveAttribute('data-blok-table-cell-selected');
    await expect(getCell(page, 2, 1)).not.toHaveAttribute('data-blok-table-cell-selected');
    await expect(getCell(page, 2, 2)).not.toHaveAttribute('data-blok-table-cell-selected');
  });

  test('Pressing Delete clears content of all selected cells', async ({ page }) => {
    // 1. Initialize editor with a 3x3 table with content ['A1'..'C3']
    await create3x3TableWithContent(page);

    // 2. Drag to select cells (0,0) to (1,1) (4 cells)
    await selectCells(page, 0, 0, 1, 1);

    const selected = page.locator('[data-blok-table-cell-selected]');

    await expect(selected).toHaveCount(4);

    // 3. Press the Delete key
    await page.keyboard.press('Delete');

    // Verify all 4 selected cells become empty
    await expect(getCellEditable(page, 0, 0)).toHaveText('');
    await expect(getCellEditable(page, 0, 1)).toHaveText('');
    await expect(getCellEditable(page, 1, 0)).toHaveText('');
    await expect(getCellEditable(page, 1, 1)).toHaveText('');

    // Verify unselected cells retain their original content
    await expect(getCellEditable(page, 0, 2)).toHaveText('C1');
    await expect(getCellEditable(page, 1, 2)).toHaveText('C2');
    await expect(getCellEditable(page, 2, 0)).toHaveText('A3');
    await expect(getCellEditable(page, 2, 1)).toHaveText('B3');
    await expect(getCellEditable(page, 2, 2)).toHaveText('C3');
  });

  test('Pressing Backspace clears content of all selected cells', async ({ page }) => {
    // 1. Initialize editor with a 3x3 table
    await create3x3TableWithContent(page);

    // 2. Select cells (0,0) to (1,1)
    await selectCells(page, 0, 0, 1, 1);

    const selected = page.locator('[data-blok-table-cell-selected]');

    await expect(selected).toHaveCount(4);

    // 3. Press Backspace
    await page.keyboard.press('Backspace');

    // Verify all 4 selected cells are cleared
    await expect(getCellEditable(page, 0, 0)).toHaveText('');
    await expect(getCellEditable(page, 0, 1)).toHaveText('');
    await expect(getCellEditable(page, 1, 0)).toHaveText('');
    await expect(getCellEditable(page, 1, 1)).toHaveText('');

    // Verify unselected cells are unaffected
    await expect(getCellEditable(page, 0, 2)).toHaveText('C1');
    await expect(getCellEditable(page, 1, 2)).toHaveText('C2');
    await expect(getCellEditable(page, 2, 0)).toHaveText('A3');
    await expect(getCellEditable(page, 2, 1)).toHaveText('B3');
    await expect(getCellEditable(page, 2, 2)).toHaveText('C3');
  });

  test('Clicking a row grip selects the entire row', async ({ page }) => {
    // 1. Initialize editor with a 3x3 table
    await create3x3TableWithContent(page);

    // 2. Hover to show row grip for row 1
    const row1Cell = getCell(page, 1, 0);

    await row1Cell.hover();

    // Wait for the row grip to become visible
    const rowGrip = page.locator('[data-blok-table-grip-row="1"][data-blok-table-grip-visible]');

    await expect(rowGrip).toBeVisible();

    // 3. Click the row grip
    await rowGrip.click();

    // Verify all 3 cells in row 1 have data-blok-table-cell-selected attribute
    await expect(getCell(page, 1, 0)).toHaveAttribute('data-blok-table-cell-selected', '');
    await expect(getCell(page, 1, 1)).toHaveAttribute('data-blok-table-cell-selected', '');
    await expect(getCell(page, 1, 2)).toHaveAttribute('data-blok-table-cell-selected', '');

    // Verify cells in other rows are not selected
    await expect(getCell(page, 0, 0)).not.toHaveAttribute('data-blok-table-cell-selected');
    await expect(getCell(page, 0, 1)).not.toHaveAttribute('data-blok-table-cell-selected');
    await expect(getCell(page, 0, 2)).not.toHaveAttribute('data-blok-table-cell-selected');
    await expect(getCell(page, 2, 0)).not.toHaveAttribute('data-blok-table-cell-selected');
    await expect(getCell(page, 2, 1)).not.toHaveAttribute('data-blok-table-cell-selected');
    await expect(getCell(page, 2, 2)).not.toHaveAttribute('data-blok-table-cell-selected');
  });

  test('Clicking a column grip selects the entire column', async ({ page }) => {
    // 1. Initialize editor with a 3x3 table
    await create3x3TableWithContent(page);

    // 2. Hover to show column grip for column 0
    const col0Cell = getCell(page, 0, 0);

    await col0Cell.hover();

    // Wait for the column grip to become visible
    const colGrip = page.locator('[data-blok-table-grip-col="0"][data-blok-table-grip-visible]');

    await expect(colGrip).toBeVisible();

    // 3. Click the column grip
    await colGrip.click();

    // Verify all 3 cells in column 0 have data-blok-table-cell-selected attribute
    await expect(getCell(page, 0, 0)).toHaveAttribute('data-blok-table-cell-selected', '');
    await expect(getCell(page, 1, 0)).toHaveAttribute('data-blok-table-cell-selected', '');
    await expect(getCell(page, 2, 0)).toHaveAttribute('data-blok-table-cell-selected', '');

    // Verify cells in other columns are not selected
    await expect(getCell(page, 0, 1)).not.toHaveAttribute('data-blok-table-cell-selected');
    await expect(getCell(page, 0, 2)).not.toHaveAttribute('data-blok-table-cell-selected');
    await expect(getCell(page, 1, 1)).not.toHaveAttribute('data-blok-table-cell-selected');
    await expect(getCell(page, 1, 2)).not.toHaveAttribute('data-blok-table-cell-selected');
    await expect(getCell(page, 2, 1)).not.toHaveAttribute('data-blok-table-cell-selected');
    await expect(getCell(page, 2, 2)).not.toHaveAttribute('data-blok-table-cell-selected');
  });

  test('Selection is cleared when clicking outside the table', async ({ page }) => {
    // 1. Initialize editor with a 3x3 table and a paragraph block above it
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: { text: 'Click me to clear selection' },
          },
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

    // 2. Drag to select a range of cells
    await selectCells(page, 0, 0, 1, 1);

    const selected = page.locator('[data-blok-table-cell-selected]');

    await expect(selected).toHaveCount(4);

    // 3. Click outside the table (on the paragraph block)
    const paragraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-tool="paragraph"]`).filter({ hasText: 'Click me to clear selection' });

    await paragraph.click();

    // Verify data-blok-table-cell-selected attributes are removed from all cells
    await expect(selected).toHaveCount(0);
  });

  test('Resize is disabled while cells are selected', async ({ page }) => {
    // 1. Initialize editor with a 2x2 table with colWidths
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [
                ['A1', 'B1'],
                ['A2', 'B2'],
              ],
              colWidths: [200, 200],
            },
          },
        ],
      },
    });

    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // 2. Drag to create a cell selection
    await selectCells(page, 0, 0, 1, 1);

    const selected = page.locator('[data-blok-table-cell-selected]');

    await expect(selected).toHaveCount(4);

    // Measure the initial width of cell (0,0) before attempting resize
    const cell00 = getCell(page, 0, 0);
    const initialBox = assertBoundingBox(await cell00.boundingBox(), 'cell [0,0] before resize attempt');
    const initialWidth = initialBox.width;

    // 3. Attempt to drag a resize handle while the selection is active
    const resizeHandle = page.locator(`${TABLE_SELECTOR} [data-blok-table-resize]:first-of-type`);
    const handleBox = assertBoundingBox(await resizeHandle.boundingBox(), 'resize handle');

    const handleCenterX = handleBox.x + handleBox.width / 2;
    const handleCenterY = handleBox.y + handleBox.height / 2;

    await page.mouse.move(handleCenterX, handleCenterY);
    await page.mouse.down();
    await page.mouse.move(handleCenterX + 80, handleCenterY, { steps: 10 });
    await page.mouse.up();

    // Verify column widths remain unchanged (resize did not respond)
    const afterBox = assertBoundingBox(await cell00.boundingBox(), 'cell [0,0] after resize attempt');

    expect(afterBox.width).toBeCloseTo(initialWidth, 0);
  });
});
