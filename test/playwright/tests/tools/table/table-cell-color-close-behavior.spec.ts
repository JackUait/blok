// spec: test/playwright/tests/tools/table/table-cell-color-edge-cases.plan.md
// seed: test/playwright/tests/seed.spec.ts

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

/**
 * Helper to create a 3x3 table with labeled cells.
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
 * Helper to select a single cell by clicking on it.
 */
const selectSingleCell = async (page: Page, row: number, col: number): Promise<void> => {
  const cell = getCell(page, row, col);
  const box = assertBoundingBox(await cell.boundingBox(), `cell [${row},${col}]`);

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};

/**
 * Helper to open the pill popover by hovering and clicking the pill.
 */
const openPillPopover = async (page: Page): Promise<void> => {
  const pill = page.locator('[data-blok-table-selection-pill]');

  await expect(pill).toBeAttached();
  const pillBox = assertBoundingBox(await pill.boundingBox(), 'selection pill');

  await page.mouse.move(pillBox.x + pillBox.width / 2, pillBox.y + pillBox.height / 2);
  await expect(pill).toBeVisible();
  await pill.click();
};

/**
 * Helper to hover over the Color item to trigger the nested color picker popover.
 */
const hoverColorItem = async (page: Page): Promise<void> => {
  const colorItem = page.getByText('Color');

  await expect(colorItem).toBeVisible();

  const colorBox = assertBoundingBox(await colorItem.boundingBox(), 'Color item');

  await page.mouse.move(colorBox.x + colorBox.width / 2, colorBox.y + colorBox.height / 2);

  const colorPicker = page.locator('[data-blok-testid="cell-color-picker"]');

  await expect(colorPicker).toBeVisible();
};

/**
 * Helper to drag-select cells from (startRow, startCol) to (endRow, endCol).
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

test.describe('Color Picker Closing Behavior', () => {
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

  test('Pressing Escape closes the entire popover tree including color picker and pill popover', async ({ page }) => {
    // 1. Initialize the editor with a 3x3 table, select cell (0,0), open pill popover and hover Color
    await create3x3TableWithContent(page);

    await selectSingleCell(page, 0, 0);

    const pill = page.locator('[data-blok-table-selection-pill]');

    await expect(pill).toBeAttached();

    await openPillPopover(page);

    // expect: Both the pill popover and color picker nested popover are visible
    await expect(page.getByText('Copy')).toBeVisible();
    await expect(page.getByText('Color')).toBeVisible();

    await hoverColorItem(page);

    const colorPicker = page.locator('[data-blok-testid="cell-color-picker"]');

    await expect(colorPicker).toBeVisible();

    // 2. Press Escape once
    // Actual behavior: Escape closes the entire popover tree via PopoverRegistry.closeTopmost(),
    // which calls hide() on the root pill popover. The root popover's hide() also destroys
    // the nested color picker popover. Both close in a single Escape press.
    await page.keyboard.press('Escape');

    // expect: The color picker is no longer visible
    await expect(colorPicker).not.toBeVisible();

    // expect: The parent pill popover is also closed (entire tree closes on one Escape)
    await expect(page.getByText('Color')).not.toBeVisible();
    await expect(page.getByText('Copy')).not.toBeVisible();
  });

  test('Color picker closes and no color is applied when dismissed without selecting a swatch', async ({ page }) => {
    // 1. Initialize the editor with a 3x3 table, select cell (0,0), open pill popover and hover Color
    await create3x3TableWithContent(page);

    await selectSingleCell(page, 0, 0);

    const pill = page.locator('[data-blok-table-selection-pill]');

    await expect(pill).toBeAttached();

    await openPillPopover(page);
    await hoverColorItem(page);

    const colorPicker = page.locator('[data-blok-testid="cell-color-picker"]');

    await expect(colorPicker).toBeVisible();

    // 2. Press Escape to close the popover tree without selecting a swatch
    await page.keyboard.press('Escape');

    // Close remaining popovers if still open
    const isColorVisible = await page.getByText('Copy').isVisible().catch(() => false);

    if (isColorVisible) {
      await page.keyboard.press('Escape');
    }

    // expect: The color picker is no longer visible
    await expect(colorPicker).not.toBeVisible();

    // Inspect cell (0,0)'s backgroundColor and color styles
    const styles = await getCell(page, 0, 0).evaluate(
      (el) => ({
        backgroundColor: (el as HTMLElement).style.backgroundColor,
        color: (el as HTMLElement).style.color,
      })
    );

    // expect: Cell (0,0) backgroundColor is empty (no color was applied)
    expect(styles.backgroundColor).toBe('');

    // expect: Cell (0,0) color is empty (no text color was applied)
    expect(styles.color).toBe('');

    // 3. Save the editor data and inspect content[0][0]
    const savedData = await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('blokInstance is not initialized');
      }

      return window.blokInstance.save();
    });

    const tableBlock = savedData.blocks[0];

    expect(tableBlock.type).toBe('table');

    const content = (tableBlock.data as {
      content: Array<Array<string | { color?: string; textColor?: string }>>;
    }).content;
    const firstCell = content[0][0];

    if (typeof firstCell === 'object' && firstCell !== null) {
      // expect: content[0][0] has no 'color' property or its value is null/undefined
      expect(firstCell.color ?? null).toBeNull();

      // expect: content[0][0] has no 'textColor' property or its value is null/undefined
      expect(firstCell.textColor ?? null).toBeNull();
    }
    // If firstCell is a string, that means no color was applied, which is also correct
  });

  test('Pill popover closes when user starts a new drag selection over different cells', async ({ page }) => {
    // 1. Initialize the editor with a 3x3 table, select cell (0,0), open the pill popover
    await create3x3TableWithContent(page);

    await selectSingleCell(page, 0, 0);

    const pill = page.locator('[data-blok-table-selection-pill]');

    await expect(pill).toBeAttached();

    await openPillPopover(page);

    // expect: Pill popover is open with Copy, Clear, Color visible
    await expect(page.getByText('Copy')).toBeVisible();
    await expect(page.getByText('Clear')).toBeVisible();
    await expect(page.getByText('Color')).toBeVisible();

    // 2. Drag from cell (2,0) to cell (2,2) to create a new multi-cell selection
    await selectCells(page, 2, 0, 2, 2);

    // expect: The original pill popover from cell (0,0) is closed
    await expect(page.getByText('Copy')).not.toBeVisible();

    // expect: 3 cells in row 2 are selected (data-blok-table-cell-selected count is 3)
    const selectedCells = page.locator('[data-blok-table-cell-selected]');

    await expect(selectedCells).toHaveCount(3);

    // expect: A new selection pill appears for the new selection
    const newPill = page.locator('[data-blok-table-selection-pill]');

    await expect(newPill).toBeAttached();
  });
});
