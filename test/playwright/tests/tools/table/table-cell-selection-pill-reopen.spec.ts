// spec: Pill popover reopens after selecting a different cell
// Regression: after opening the pill popover for one cell then clicking
// another cell, the popover should be openable for the new selection.

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

const assertBoundingBox = (
  box: { x: number; y: number; width: number; height: number } | null,
  label: string
): { x: number; y: number; width: number; height: number } => {
  expect(box, `${label} should have a bounding box`).toBeTruthy();

  return box as { x: number; y: number; width: number; height: number };
};

const getCell = (page: Page, row: number, col: number): ReturnType<Page['locator']> =>
  page
    .locator(`${TABLE_SELECTOR} >> [data-blok-table-row] >> nth=${row}`)
    .locator(`[data-blok-table-cell] >> nth=${col}`);

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

const selectSingleCell = async (page: Page, row: number, col: number): Promise<void> => {
  const cell = getCell(page, row, col);
  const box = assertBoundingBox(await cell.boundingBox(), `cell [${row},${col}]`);

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};

const hoverPill = async (page: Page): Promise<void> => {
  const pill = page.locator('[data-blok-table-selection-pill]');

  await expect(pill).toBeAttached();
  const pillBox = assertBoundingBox(await pill.boundingBox(), 'selection pill');

  await page.mouse.move(pillBox.x + pillBox.width / 2, pillBox.y + pillBox.height / 2);
};

const openPillPopover = async (page: Page): Promise<void> => {
  await hoverPill(page);

  const pill = page.locator('[data-blok-table-selection-pill]');

  await expect(pill).toBeVisible();
  await pill.click();
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

test.describe('Pill popover reopens for different cell', () => {
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

  test('opens pill popover for second cell after opening and closing popover for first cell', async ({ page }) => {
    await create3x3TableWithContent(page);

    // 1. Select cell (0,0) and open its pill popover
    await selectSingleCell(page, 0, 0);

    const pill = page.locator('[data-blok-table-selection-pill]');

    await expect(pill).toBeAttached();
    await openPillPopover(page);
    await expect(page.getByText('Copy')).toBeVisible();

    // 2. Close the popover by clicking outside the table
    await page.mouse.click(10, 10);
    await expect(page.getByText('Copy')).not.toBeVisible();

    // 3. Select cell (2,2)
    await selectSingleCell(page, 2, 2);

    const newPill = page.locator('[data-blok-table-selection-pill]');

    await expect(newPill).toBeAttached();

    // 4. Open the pill popover for the new cell
    await openPillPopover(page);

    // 5. Verify the popover opened
    await expect(page.getByText('Copy')).toBeVisible();
  });

  test('opens pill popover for second cell after clicking another cell while popover is open', async ({ page }) => {
    await create3x3TableWithContent(page);

    // 1. Select cell (0,0) and open pill popover
    await selectSingleCell(page, 0, 0);
    await expect(page.locator('[data-blok-table-selection-pill]')).toBeAttached();
    await openPillPopover(page);
    await expect(page.getByText('Copy')).toBeVisible();

    // 2. Click cell (2,2) while popover is still open
    await selectSingleCell(page, 2, 2);
    await expect(page.locator('[data-blok-table-selection-pill]')).toBeAttached();

    // 3. Open pill popover for new cell
    await openPillPopover(page);
    await expect(page.getByText('Copy')).toBeVisible();
  });

  test('opens pill popover for second cell after using color picker on first cell', async ({ page }) => {
    await create3x3TableWithContent(page);

    // 1. Select cell (0,0) and pick a color
    await selectSingleCell(page, 0, 0);
    await expect(page.locator('[data-blok-table-selection-pill]')).toBeAttached();
    await openPillPopover(page);

    const colorItem = page.getByText('Color');

    await expect(colorItem).toBeVisible();

    const colorBox = assertBoundingBox(await colorItem.boundingBox(), 'Color item');

    await page.mouse.move(colorBox.x + colorBox.width / 2, colorBox.y + colorBox.height / 2);

    const swatch = page.locator('[data-blok-testid="cell-color-swatch-orange"]');

    await expect(swatch).toBeVisible();
    await swatch.click({ force: true });

    // 2. Close popover by clicking outside table
    await page.mouse.click(10, 10);

    // 3. Select cell (2,2)
    await selectSingleCell(page, 2, 2);
    await expect(page.locator('[data-blok-table-selection-pill]')).toBeAttached();

    // 4. Open pill popover for new cell
    await openPillPopover(page);
    await expect(page.getByText('Copy')).toBeVisible();
  });

  test('opens pill popover after closing color picker with outside click then selecting adjacent cell', async ({ page }) => {
    await create3x3TableWithContent(page);

    // 1. Select cell (0,0) and open color picker via hover
    await selectSingleCell(page, 0, 0);
    await expect(page.locator('[data-blok-table-selection-pill]')).toBeAttached();
    await openPillPopover(page);

    const colorItem = page.getByText('Color');

    await expect(colorItem).toBeVisible();

    const colorBox = assertBoundingBox(await colorItem.boundingBox(), 'Color item');

    await page.mouse.move(colorBox.x + colorBox.width / 2, colorBox.y + colorBox.height / 2);

    const colorPicker = page.locator('[data-blok-testid="cell-color-picker"]');

    await expect(colorPicker).toBeVisible();

    // 2. Close the popover by clicking outside the table (NOT picking a color)
    await page.mouse.click(10, 10);
    await expect(colorPicker).not.toBeVisible();

    // 3. Select the adjacent cell (0,1)
    await selectSingleCell(page, 0, 1);
    await expect(page.locator('[data-blok-table-selection-pill]')).toBeAttached();

    // 4. Open pill popover
    await openPillPopover(page);
    await expect(page.getByText('Copy')).toBeVisible();
  });

  test('opens pill popover for second drag-selection after first drag-selection popover', async ({ page }) => {
    await create3x3TableWithContent(page);

    // 1. Drag-select (0,0)→(0,1), open popover
    await selectCells(page, 0, 0, 0, 1);
    await expect(page.locator('[data-blok-table-cell-selected]')).toHaveCount(2);
    await openPillPopover(page);
    await expect(page.getByText('Copy')).toBeVisible();

    // 2. Close by clicking outside
    await page.mouse.click(10, 10);
    await expect(page.getByText('Copy')).not.toBeVisible();

    // 3. Drag-select (2,0)→(2,1)
    await selectCells(page, 2, 0, 2, 1);
    await expect(page.locator('[data-blok-table-cell-selected]')).toHaveCount(2);

    // 4. Open popover for new selection
    await openPillPopover(page);
    await expect(page.getByText('Copy')).toBeVisible();
  });

  test('opens pill popover rapidly switching between cells', async ({ page }) => {
    await create3x3TableWithContent(page);

    // Rapidly: select cell A → open popover → select cell B → open popover → select cell C → open popover
    for (const [row, col] of [[0, 0], [1, 1], [2, 2]] as Array<[number, number]>) {
      await selectSingleCell(page, row, col);
      await expect(page.locator('[data-blok-table-selection-pill]')).toBeAttached();
      await openPillPopover(page);
      await expect(page.getByText('Copy')).toBeVisible();
    }
  });

  test('opens pill popover for adjacent cell after color picker was open on neighboring cell', async ({ page }) => {
    await create3x3TableWithContent(page);

    // 1. Select cell (0,0) and open color picker via hover
    await selectSingleCell(page, 0, 0);
    await expect(page.locator('[data-blok-table-selection-pill]')).toBeAttached();
    await openPillPopover(page);

    const colorItem = page.getByText('Color');

    await expect(colorItem).toBeVisible();

    const colorBox = assertBoundingBox(await colorItem.boundingBox(), 'Color item');

    await page.mouse.move(colorBox.x + colorBox.width / 2, colorBox.y + colorBox.height / 2);

    const colorPicker = page.locator('[data-blok-testid="cell-color-picker"]');

    await expect(colorPicker).toBeVisible();

    // Pick a color while color picker is visible
    const swatch = page.locator('[data-blok-testid="cell-color-swatch-orange"]');

    await expect(swatch).toBeVisible();
    await swatch.click({ force: true });

    // 2. Dismiss any remaining popover by clicking outside the table
    await page.mouse.click(10, 10);
    await expect(page.getByText('Copy')).not.toBeVisible();

    // 3. Select the adjacent cell (0,1)
    await selectSingleCell(page, 0, 1);
    await expect(page.locator('[data-blok-table-selection-pill]')).toBeAttached();

    // 4. Open pill popover for cell (0,1)
    await openPillPopover(page);
    await expect(page.getByText('Copy')).toBeVisible();
  });

  test('opens pill popover for cell after opening and closing popover twice for same cell', async ({ page }) => {
    await create3x3TableWithContent(page);

    // 1. Select cell (0,0), open and close popover twice
    await selectSingleCell(page, 0, 0);
    await expect(page.locator('[data-blok-table-selection-pill]')).toBeAttached();

    // First open/close
    await openPillPopover(page);
    await expect(page.getByText('Copy')).toBeVisible();
    await page.mouse.click(10, 10);
    await expect(page.getByText('Copy')).not.toBeVisible();

    // Second open/close — re-select the same cell since selection was cleared
    await selectSingleCell(page, 0, 0);
    await expect(page.locator('[data-blok-table-selection-pill]')).toBeAttached();
    await openPillPopover(page);
    await expect(page.getByText('Copy')).toBeVisible();
    await page.mouse.click(10, 10);
    await expect(page.getByText('Copy')).not.toBeVisible();

    // 2. Now select cell (2,2) and open its popover
    await selectSingleCell(page, 2, 2);
    await expect(page.locator('[data-blok-table-selection-pill]')).toBeAttached();
    await openPillPopover(page);
    await expect(page.getByText('Copy')).toBeVisible();
  });
});
