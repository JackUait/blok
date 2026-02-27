// spec: Cell Background Color via Pill Popover
// seed: test/playwright/tests/tools/table/table-cell-selection-pill.spec.ts

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

/**
 * Helper to select a single cell by clicking on it.
 */
const selectSingleCell = async (page: Page, row: number, col: number): Promise<void> => {
  const cell = getCell(page, row, col);
  const box = assertBoundingBox(await cell.boundingBox(), `cell [${row},${col}]`);

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};

/**
 * Helper to open the pill popover and navigate to the Color sub-popover.
 * Returns once the color picker is visible.
 */
const openColorPicker = async (page: Page): Promise<void> => {
  await hoverPill(page);

  const pill = page.locator('[data-blok-table-selection-pill]');

  await expect(pill).toBeVisible();
  await pill.click();

  // Click the "Color" item in the pill popover
  const colorItem = page.getByText('Color');

  await expect(colorItem).toBeVisible();
  await colorItem.click();

  // Wait for the nested color picker popover to appear
  const colorPicker = page.locator('[data-blok-testid="cell-color-picker"]');

  await expect(colorPicker).toBeVisible();
};

/**
 * Helper to click a color swatch by name inside the nested color picker.
 * Uses force:true because the nested popover animation can cause
 * adjacent swatches to briefly intercept pointer events.
 */
const clickSwatch = async (page: Page, name: string): Promise<void> => {
  const swatch = page.locator(`[data-blok-testid="cell-color-swatch-${name}"]`);

  await expect(swatch).toBeVisible();
  await swatch.click({ force: true });
};

test.describe('Cell Background Color', () => {
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

  test('applies background color to a single cell via pill popover', async ({ page }) => {
    // 1. Initialize editor with a 3x3 table with content
    await create3x3TableWithContent(page);

    // 2. Click on cell (0,0) to select it
    await selectSingleCell(page, 0, 0);

    // 3. Wait for the pill to appear
    const pill = page.locator('[data-blok-table-selection-pill]');

    await expect(pill).toBeAttached();

    // 4. Open the color picker via the pill popover
    await openColorPicker(page);

    // 5. Click the orange swatch
    await clickSwatch(page, 'orange');

    // 6. Verify cell (0,0) has a non-empty backgroundColor style
    const cellBg = await getCell(page, 0, 0).evaluate(
      (el) => (el as HTMLElement).style.backgroundColor
    );

    expect(cellBg).toBeTruthy();
    expect(cellBg.length).toBeGreaterThan(0);
  });

  test('color persists in saved data', async ({ page }) => {
    // 1. Initialize editor with a 3x3 table with content
    await create3x3TableWithContent(page);

    // 2. Click on cell (0,0) to select it
    await selectSingleCell(page, 0, 0);

    // 3. Wait for the pill and open color picker
    const pill = page.locator('[data-blok-table-selection-pill]');

    await expect(pill).toBeAttached();
    await openColorPicker(page);

    // 4. Click the orange swatch
    await clickSwatch(page, 'orange');

    // 5. Save the editor data and check the first cell has a color property
    const savedData = await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('blokInstance is not initialized');
      }

      return window.blokInstance.save();
    });

    const tableBlock = savedData.blocks[0];

    expect(tableBlock.type).toBe('table');

    const content = (tableBlock.data as { content: Array<Array<{ color?: string }>> }).content;
    const firstCell = content[0][0];

    expect(firstCell).toHaveProperty('color');
    expect(firstCell.color).toBeTruthy();
  });

  test('default button removes cell color', async ({ page }) => {
    // 1. Initialize editor with a 3x3 table with content
    await create3x3TableWithContent(page);

    // 2. Select cell (0,0) and apply a color
    await selectSingleCell(page, 0, 0);

    const pill = page.locator('[data-blok-table-selection-pill]');

    await expect(pill).toBeAttached();
    await openColorPicker(page);

    await clickSwatch(page, 'orange');

    // 3. Verify backgroundColor is set
    const cellBgBefore = await getCell(page, 0, 0).evaluate(
      (el) => (el as HTMLElement).style.backgroundColor
    );

    expect(cellBgBefore).toBeTruthy();

    // 4. Click on cell (0,0) again to select it
    await selectSingleCell(page, 0, 0);
    await expect(pill).toBeAttached();

    // 5. Open pill -> Color -> click the Default button
    await openColorPicker(page);

    const defaultBtn = page.locator('[data-blok-testid="cell-color-default-btn"]');

    await expect(defaultBtn).toBeVisible();
    await defaultBtn.click();

    // 6. Verify backgroundColor is empty
    const cellBgAfter = await getCell(page, 0, 0).evaluate(
      (el) => (el as HTMLElement).style.backgroundColor
    );

    expect(cellBgAfter).toBe('');
  });

  test('applies background color to multiple cells via drag selection', async ({ page }) => {
    // 1. Initialize editor with a 3x3 table with content
    await create3x3TableWithContent(page);

    // 2. Drag-select from (0,0) to (1,1) to select 4 cells
    await selectCells(page, 0, 0, 1, 1);

    const selected = page.locator('[data-blok-table-cell-selected]');

    await expect(selected).toHaveCount(4);

    // 3. Open pill -> Color -> pick a swatch
    await openColorPicker(page);

    await clickSwatch(page, 'orange');

    // 4. Verify all 4 cells have backgroundColor set
    for (const [row, col] of [[0, 0], [0, 1], [1, 0], [1, 1]] as Array<[number, number]>) {
      const cellBg = await getCell(page, row, col).evaluate(
        (el) => (el as HTMLElement).style.backgroundColor
      );

      expect(cellBg, `cell [${row},${col}] should have background color`).toBeTruthy();
    }

    // 5. Verify unselected cells do NOT have backgroundColor
    for (const [row, col] of [[0, 2], [1, 2], [2, 0], [2, 1], [2, 2]] as Array<[number, number]>) {
      const cellBg = await getCell(page, row, col).evaluate(
        (el) => (el as HTMLElement).style.backgroundColor
      );

      expect(cellBg, `cell [${row},${col}] should NOT have background color`).toBe('');
    }
  });
});
