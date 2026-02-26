// spec: Cell Selection Pill and Popover
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

/**
 * Helper to hover over the selection pill to expand it.
 * The pill is positioned at the right edge center of the selected cells rectangle.
 */
const hoverPill = async (page: Page): Promise<void> => {
  const pill = page.locator('[data-blok-table-selection-pill]');

  await expect(pill).toBeAttached();
  const pillBox = assertBoundingBox(await pill.boundingBox(), 'selection pill');

  await page.mouse.move(pillBox.x + pillBox.width / 2, pillBox.y + pillBox.height / 2);
};

test.describe('Cell Selection Pill and Popover', () => {
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

  test('selection pill appears after dragging across cells and hovering the selection overlay', async ({ page }) => {
    // 1. Initialize editor with a 3x3 table with content
    await create3x3TableWithContent(page);

    // 2. Drag from cell (0,0) to cell (1,1) to create a 2x2 selection
    await selectCells(page, 0, 0, 1, 1);

    // 3. Wait for data-blok-table-cell-selected on 4 cells
    const selected = page.locator('[data-blok-table-cell-selected]');

    await expect(selected).toHaveCount(4);

    // 4. The pill element is created as part of the selection
    const pill = page.locator('[data-blok-table-selection-pill]');

    await expect(pill).toBeAttached();

    // 5. Move mouse over the pill to expand it (mouseenter triggers expansion)
    await hoverPill(page);

    // Expected: pill is visible and attached to the DOM
    await expect(pill).toBeVisible();
  });

  test('clicking the selection pill opens a popover with Clear action', async ({ page }) => {
    // 1. Initialize editor with a 3x3 table with content
    await create3x3TableWithContent(page);

    // 2. Create a 2x2 selection by dragging from cell (0,0) to cell (1,1)
    await selectCells(page, 0, 0, 1, 1);

    const selected = page.locator('[data-blok-table-cell-selected]');

    await expect(selected).toHaveCount(4);

    // 3. Hover over the pill to ensure it is interactable
    await hoverPill(page);

    // 4. Click the pill element to open the popover
    const pill = page.locator('[data-blok-table-selection-pill]');

    await expect(pill).toBeVisible();
    await pill.click();

    // Expected: popover appears with "Clear" menu item
    await expect(page.getByText('Clear')).toBeVisible();
  });

  test('clicking Clear clears content of selected cells', async ({ page }) => {
    // 1. Initialize editor with a 3x3 table with content
    await create3x3TableWithContent(page);

    // 2. Create a 2x2 selection on cells with content (A1, B1, A2, B2)
    await selectCells(page, 0, 0, 1, 1);

    const selected = page.locator('[data-blok-table-cell-selected]');

    await expect(selected).toHaveCount(4);

    // 3. Hover over the pill and open the popover
    await hoverPill(page);

    const pill = page.locator('[data-blok-table-selection-pill]');

    await expect(pill).toBeVisible();
    await pill.click();

    // 4. Click the "Clear" menu item in the popover
    const clearButton = page.getByText('Clear');

    await expect(clearButton).toBeVisible();
    await clearButton.click();

    // Expected: 4 selected cells become empty
    await expect(getCellEditable(page, 0, 0)).toHaveText('');
    await expect(getCellEditable(page, 0, 1)).toHaveText('');
    await expect(getCellEditable(page, 1, 0)).toHaveText('');
    await expect(getCellEditable(page, 1, 1)).toHaveText('');

    // Expected: unselected cells retain their original content
    await expect(getCellEditable(page, 0, 2)).toHaveText('C1');
    await expect(getCellEditable(page, 1, 2)).toHaveText('C2');
    await expect(getCellEditable(page, 2, 0)).toHaveText('A3');
    await expect(getCellEditable(page, 2, 1)).toHaveText('B3');
    await expect(getCellEditable(page, 2, 2)).toHaveText('C3');

    // Expected: selection is cleared (no selected attributes remain)
    await expect(page.locator('[data-blok-table-cell-selected]')).toHaveCount(0);
  });

  test('clicking outside the table clears an active cell selection', async ({ page }) => {
    // 1. Initialize editor with a 3x3 table with content
    await create3x3TableWithContent(page);

    // 2. Create a 2x2 cell selection
    await selectCells(page, 0, 0, 1, 1);

    const selected = page.locator('[data-blok-table-cell-selected]');

    await expect(selected).toHaveCount(4);

    // 3. Click outside the table to dismiss the selection.
    //    The source code listens for the next pointerdown outside the pill to clear selection.
    //    Escape key is not handled by TableCellSelection (only Delete/Backspace are).
    await page.mouse.click(10, 10);

    // Expected: all cells lose data-blok-table-cell-selected
    await expect(selected).toHaveCount(0);

    // Expected: content is preserved in previously selected cells
    await expect(getCellEditable(page, 0, 0)).toHaveText('A1');
    await expect(getCellEditable(page, 0, 1)).toHaveText('B1');
    await expect(getCellEditable(page, 1, 0)).toHaveText('A2');
    await expect(getCellEditable(page, 1, 1)).toHaveText('B2');
  });

  test('selection overlay is absolutely positioned with blue border', async ({ page }) => {
    // 1. Initialize editor with a 3x3 table with content
    await create3x3TableWithContent(page);

    // 2. Create a 2x2 selection from cell (0,0) to cell (1,1)
    await selectCells(page, 0, 0, 1, 1);

    const selected = page.locator('[data-blok-table-cell-selected]');

    await expect(selected).toHaveCount(4);

    // 3. Query the DOM for the overlay element
    const overlay = page.locator('[data-blok-table-selection-overlay]');

    await expect(overlay).toBeAttached();

    // Expected: overlay is absolutely positioned with blue border
    const overlayStyles = await overlay.evaluate((el) => {
      const computed = getComputedStyle(el);
      const htmlEl = el as HTMLElement;
      const styleAttr = htmlEl.getAttribute('style') ?? '';

      return {
        position: htmlEl.style.position,
        // The inline style is set as '#3b82f6' but browsers normalise to rgb().
        // Check both representations inside the browser context.
        hasBlueBorder:
          styleAttr.includes('#3b82f6') ||
          computed.border.includes('rgb(59, 130, 246)'),
        borderDebug: `raw="${styleAttr}", computed="${computed.border}"`,
        pointerEvents: computed.pointerEvents,
      };
    });

    expect(overlayStyles.position).toBe('absolute');
    expect(overlayStyles.hasBlueBorder, `Expected blue border (#3b82f6 or rgb(59, 130, 246)), got ${overlayStyles.borderDebug}`).toBe(true);
    // Overlay should have pointer-events: none so mouse events pass through to cells
    expect(overlayStyles.pointerEvents).toBe('none');
  });
});
