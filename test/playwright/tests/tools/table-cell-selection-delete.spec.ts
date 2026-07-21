import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

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
const assertBoundingBox = (box: { x: number; y: number; width: number; height: number } | null, label: string): { x: number; y: number; width: number; height: number } => {
  expect(box, `${label} should have a bounding box`).toBeTruthy();

  return box as { x: number; y: number; width: number; height: number };
};

/**
 * Returns a locator for a specific cell in the table grid.
 */
const getCell = (page: Page, row: number, col: number): ReturnType<Page['locator']> =>
  page.locator(`${TABLE_SELECTOR} >> [data-blok-table-row] >> nth=${row}`)
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
  paragraph: {
    className: 'Blok.Paragraph',
  },
};

/**
 * Helper to create a 3x3 table with labeled cells
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
 * Helper to select multiple cells by dragging from start to end cell
 */
const selectCells = async (page: Page, startRow: number, startCol: number, endRow: number, endCol: number): Promise<void> => {
  const startCell = getCell(page, startRow, startCol);
  const endCell = getCell(page, endRow, endCol);

  const startBox = assertBoundingBox(await startCell.boundingBox(), `cell [${startRow},${startCol}]`);
  const endBox = assertBoundingBox(await endCell.boundingBox(), `cell [${endRow},${endCol}]`);

  // Always use cell center coordinates for both start and end
  const startX = startBox.x + startBox.width / 2;
  const startY = startBox.y + startBox.height / 2;
  const endX = endBox.x + endBox.width / 2;
  const endY = endBox.y + endBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();
};

test.describe('table cell selection — delete key', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.afterEach(async ({ page }) => {
    await resetBlok(page);
  });

  test('pressing Delete key clears selected cells', async ({ page }) => {
    await create3x3TableWithContent(page);

    // Select cells (0,0) to (1,1) - that's A1, B1, A2, B2
    await selectCells(page, 0, 0, 1, 1);

    // Verify cells are selected
    const selected = page.locator('[data-blok-table-cell-selected]');

    await expect(selected).toHaveCount(4);

    // Press Delete key
    await page.keyboard.press('Delete');

    // Verify the selected cells are now empty
    await expect(getCellEditable(page, 0, 0)).toHaveText('');
    await expect(getCellEditable(page, 0, 1)).toHaveText('');
    await expect(getCellEditable(page, 1, 0)).toHaveText('');
    await expect(getCellEditable(page, 1, 1)).toHaveText('');

    // Verify unselected cells still have their content
    await expect(getCellEditable(page, 0, 2)).toHaveText('C1');
    await expect(getCellEditable(page, 1, 2)).toHaveText('C2');
    await expect(getCellEditable(page, 2, 0)).toHaveText('A3');
    await expect(getCellEditable(page, 2, 1)).toHaveText('B3');
    await expect(getCellEditable(page, 2, 2)).toHaveText('C3');
  });

  test('pressing Backspace key clears selected cells', async ({ page }) => {
    await create3x3TableWithContent(page);

    // Select cells (1,1) to (2,2) - that's B2, C2, B3, C3
    await selectCells(page, 1, 1, 2, 2);

    // Verify cells are selected
    const selected = page.locator('[data-blok-table-cell-selected]');

    await expect(selected).toHaveCount(4);

    // Press Backspace key
    await page.keyboard.press('Backspace');

    // Verify the selected cells are now empty
    await expect(getCellEditable(page, 1, 1)).toHaveText('');
    await expect(getCellEditable(page, 1, 2)).toHaveText('');
    await expect(getCellEditable(page, 2, 1)).toHaveText('');
    await expect(getCellEditable(page, 2, 2)).toHaveText('');

    // Verify unselected cells still have their content
    await expect(getCellEditable(page, 0, 0)).toHaveText('A1');
    await expect(getCellEditable(page, 0, 1)).toHaveText('B1');
    await expect(getCellEditable(page, 0, 2)).toHaveText('C1');
    await expect(getCellEditable(page, 1, 0)).toHaveText('A2');
    await expect(getCellEditable(page, 2, 0)).toHaveText('A3');
  });

  test('delete key does not interfere with normal text editing in single cell', async ({ page }) => {
    await create3x3TableWithContent(page);

    // Click into a single cell (single-cell selection is created but does not
    // interfere with normal character-level editing)
    await getCellEditable(page, 0, 0).click();

    // Verify one cell is selected (single-click creates a single-cell selection)
    const selected = page.locator('[data-blok-table-cell-selected]');

    await expect(selected).toHaveCount(1);

    // Position cursor at the end and delete backward (normal text editing)
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace');

    // Verify the cell content is edited (A1 → A)
    await expect(getCellEditable(page, 0, 0)).toHaveText('A');

    // Now position at start and delete forward
    await page.keyboard.press('Home');
    await page.keyboard.press('Delete');

    // Verify the cell content is further edited (A → empty)
    await expect(getCellEditable(page, 0, 0)).toHaveText('');

    // Verify other cells are unaffected
    await expect(getCellEditable(page, 0, 1)).toHaveText('B1');
    await expect(getCellEditable(page, 0, 2)).toHaveText('C1');
  });

  test('multi-cell delete keeps focus inside the anchor cell', async ({ page }) => {
    // A 2x2 table where the selection spans every cell: deleting clears all of
    // the table's blocks, so the editor has no sibling to move the caret to.
    // Regression: focus fell onto <body> instead of staying in the table.
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
            },
          },
        ],
      },
    });

    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // Select every cell (0,0) → (1,1)
    await selectCells(page, 0, 0, 1, 1);

    const selected = page.locator('[data-blok-table-cell-selected]');

    await expect(selected).toHaveCount(4);

    await page.keyboard.press('Delete');

    // Content is cleared
    await expect(getCellEditable(page, 0, 0)).toHaveText('');

    // Focus lands in the top-left anchor cell, not <body>.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const cell = document.activeElement?.closest('[data-blok-table-cell]');

          return cell?.getAttribute('data-blok-table-cell-row') === '0'
            && cell?.getAttribute('data-blok-table-cell-col') === '0';
        })
      )
      .toBe(true);
  });

  test('deleting a block-selected line inside a cell keeps focus in that cell', async ({ page }) => {
    // Cmd+A twice escalates from text selection to block selection of the
    // cell's line; Backspace then deletes that block via the editor's
    // block-selection deletion path (not the table's own clear-content path).
    // Regression: no replacement block is inserted for a partial selection and
    // no caret was set, so focus fell onto <body>.
    await create3x3TableWithContent(page);

    await getCellEditable(page, 1, 1).click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+a');

    // The cell's paragraph is now block-selected
    await expect(page.locator('[data-blok-selected="true"]')).toHaveCount(1);

    await page.keyboard.press('Backspace');

    // Content is cleared but focus stays inside cell (1,1)
    await expect(getCellEditable(page, 1, 1)).toHaveText('');
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const cell = document.activeElement?.closest('[data-blok-table-cell]');

          return cell?.getAttribute('data-blok-table-cell-row') === '1'
            && cell?.getAttribute('data-blok-table-cell-col') === '1';
        })
      )
      .toBe(true);
  });

  test('drag from a cell line edge does not lasso-select and delete the table', async ({ page }) => {
    // A drag that starts at the far-left edge of a line inside a cell can land
    // on the hovering block toolbar (plus button). Regression: that mousedown
    // armed RectangleSelection, the lasso selected the whole table block, and
    // Backspace deleted the entire table.
    await create3x3TableWithContent(page);

    // Build a multi-line cell: 3 lines inside cell (0,0)
    await getCellEditable(page, 0, 0).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('line two');
    await page.keyboard.press('Enter');
    await page.keyboard.type('line three');

    const cell = getCell(page, 0, 0);
    const editables = cell.locator('[contenteditable="true"]');

    await expect(editables).toHaveCount(3);

    const firstBox = assertBoundingBox(await editables.first().boundingBox(), 'first line');
    const lastBox = assertBoundingBox(await editables.last().boundingBox(), 'last line');

    // Hover the first line so the block toolbar appears at its left edge,
    // then drag from that edge down to the last line — all within one cell.
    await page.mouse.move(firstBox.x + 2, firstBox.y + firstBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(lastBox.x + lastBox.width - 2, lastBox.y + lastBox.height / 2, { steps: 12 });
    await page.mouse.up();

    // The table block itself must not be block-selected by that drag
    const selectedOutsideCells = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-blok-selected="true"]'))
        .filter((el) => el.closest('[data-blok-table-cell]') === null).length
    );

    expect(selectedOutsideCells).toBe(0);

    await page.keyboard.press('Backspace');

    // The table survives
    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();
  });

  test('column selection delete clears all cells in column', async ({ page }) => {
    await create3x3TableWithContent(page);

    // Select entire first column (cells 0,0 to 2,0)
    await selectCells(page, 0, 0, 2, 0);

    // Verify cells are selected
    const selected = page.locator('[data-blok-table-cell-selected]');

    await expect(selected).toHaveCount(3);

    // Press Delete key
    await page.keyboard.press('Delete');

    // Verify the entire first column is now empty
    await expect(getCellEditable(page, 0, 0)).toHaveText('');
    await expect(getCellEditable(page, 1, 0)).toHaveText('');
    await expect(getCellEditable(page, 2, 0)).toHaveText('');

    // Verify other columns still have their content
    await expect(getCellEditable(page, 0, 1)).toHaveText('B1');
    await expect(getCellEditable(page, 0, 2)).toHaveText('C1');
    await expect(getCellEditable(page, 1, 1)).toHaveText('B2');
    await expect(getCellEditable(page, 1, 2)).toHaveText('C2');
    await expect(getCellEditable(page, 2, 1)).toHaveText('B3');
    await expect(getCellEditable(page, 2, 2)).toHaveText('C3');
  });
});
