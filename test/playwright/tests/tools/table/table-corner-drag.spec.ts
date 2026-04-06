/* eslint-disable playwright/no-nth-methods */
// E2E tests for the table corner drag handle

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';

const HOLDER_ID = 'blok';
const CELL_SELECTOR = '[data-blok-table-cell]';
const ROW_SELECTOR = '[data-blok-table-row]';
const CORNER_DRAG_SELECTOR = '[data-blok-table-corner-drag]';
const CORNER_TOOLTIP_SELECTOR = '[data-blok-table-corner-tooltip]';

const UNDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';

// Wait for Yjs captureTimeout (500ms) plus small buffer
const YJS_CAPTURE_TIMEOUT = 600;

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

const createTable = async (
  page: Page,
  content: string[][]
): Promise<void> => {
  await createBlok(page, {
    tools: defaultTools,
    data: {
      blocks: [
        {
          type: 'table',
          data: {
            withHeadings: false,
            content,
          },
        },
      ],
    },
  });
};

/**
 * Click the corner drag handle using the mouse API directly.
 * The handle is positioned at bottom: -36px, right: -36px from the table wrapper,
 * and may be obscured by other overlays (e.g. toolbar tooltip), so we use
 * page.mouse to send pointer events directly to its coordinates.
 */
const clickCornerHandle = async (page: Page): Promise<void> => {
  const cornerHandle = page.locator(CORNER_DRAG_SELECTOR);
  const box = assertBoundingBox(await cornerHandle.boundingBox(), 'Corner handle');

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};

/**
 * Move the mouse over the corner drag handle to trigger its mouseenter event.
 */
const hoverCornerHandle = async (page: Page): Promise<void> => {
  const cornerHandle = page.locator(CORNER_DRAG_SELECTOR);
  const box = assertBoundingBox(await cornerHandle.boundingBox(), 'Corner handle');

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
};

test.describe('Table Corner Drag Handle', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('Corner click adds one row and one column', async ({ page }) => {
    // 1. Create a 2x2 table
    await createTable(page, [['A', 'B'], ['C', 'D']]);

    // 2. Verify initial dimensions: 2 rows, 2 columns
    const rows = page.locator(ROW_SELECTOR);

    await expect(rows).toHaveCount(2);

    const firstRowCells = rows.nth(0).locator(CELL_SELECTOR);

    await expect(firstRowCells).toHaveCount(2);

    // 3. Click the corner drag handle (uses mouse API to bypass overlay interception)
    await clickCornerHandle(page);

    // 4. Verify the table now has 3 rows and 3 columns
    await expect(rows).toHaveCount(3);

    const firstRowCellsAfter = rows.nth(0).locator(CELL_SELECTOR);

    await expect(firstRowCellsAfter).toHaveCount(3);
  });

  test('Tooltip shows table size on hover', async ({ page }) => {
    // 1. Create a 2x3 table
    await createTable(page, [['A', 'B', 'C'], ['D', 'E', 'F']]);

    // 2. Hover over the corner drag handle (uses mouse API to bypass overlay interception)
    await hoverCornerHandle(page);

    // 3. Verify the tooltip is visible and shows "2×3"
    const tooltip = page.locator(CORNER_TOOLTIP_SELECTOR);

    await expect(tooltip).toHaveCSS('opacity', '1');
    await expect(tooltip).toHaveText('2\u00D73');
  });

  test('Corner drag adds rows and columns', async ({ page }) => {
    // 1. Create a 2x2 table
    await createTable(page, [['A', 'B'], ['C', 'D']]);

    // 2. Get the bounding box of the corner handle
    const cornerHandle = page.locator(CORNER_DRAG_SELECTOR);
    const cornerBox = assertBoundingBox(await cornerHandle.boundingBox(), 'Corner handle');

    // Measure the unit sizes that the drag handler uses internally:
    // unitHeight = last row's offsetHeight, unitWidth = last cell's offsetWidth.
    const { unitWidth, unitHeight } = await page.evaluate(() => {
      const rows = document.querySelectorAll('[data-blok-table-row]');
      const lastRow = rows[rows.length - 1] as HTMLElement;
      const firstRow = rows[0];
      const cells = firstRow.querySelectorAll('[data-blok-table-cell]');
      const lastCell = cells[cells.length - 1] as HTMLElement;

      return { unitWidth: lastCell.offsetWidth, unitHeight: lastRow.offsetHeight };
    });

    const startX = cornerBox.x + cornerBox.width / 2;
    const startY = cornerBox.y + cornerBox.height / 2;

    // 3. Drag diagonally: beyond one unit in each direction to add 1 row and 1 column
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(
      startX + unitWidth + 10,
      startY + unitHeight + 10,
      { steps: 10 }
    );
    await page.mouse.up();

    // 4. Verify the table has more rows and more columns than before
    const rows = page.locator(ROW_SELECTOR);

    await expect(rows).toHaveCount(3);

    const firstRowCells = rows.nth(0).locator(CELL_SELECTOR);

    await expect(firstRowCells).toHaveCount(3);
  });

  test('Scroll container has overflow classes during corner drag column addition', async ({ page }) => {
    // Regression: corner drag's onAddColumn did not enable scroll overflow,
    // causing the grid to overflow unclipped and the hit zone to appear
    // in the middle of the table instead of at the visible corner.

    // 1. Create a 2x2 table (starts in percent mode, no colWidths)
    await createTable(page, [['A', 'B'], ['C', 'D']]);

    // 2. Verify scroll container starts without overflow classes (percent mode)
    const scrollContainerBefore = await page.evaluate(() => {
      const sc = document.querySelector('[data-blok-table-scroll]') as HTMLElement;

      return {
        hasOverflowX: sc?.classList.contains('overflow-x-auto'),
        hasOverflowY: sc?.classList.contains('overflow-y-hidden'),
      };
    });

    expect(scrollContainerBefore.hasOverflowX).toBe(false);
    expect(scrollContainerBefore.hasOverflowY).toBe(false);

    // 3. Start a corner drag and add columns
    const cornerHandle = page.locator(CORNER_DRAG_SELECTOR);
    const cornerBox = assertBoundingBox(await cornerHandle.boundingBox(), 'Corner handle');

    const unitWidth = await page.evaluate(() => {
      const firstRow = document.querySelector('[data-blok-table-row]');
      const cells = firstRow?.querySelectorAll('[data-blok-table-cell]') ?? [];

      return (cells[cells.length - 1] as HTMLElement)?.offsetWidth || 100;
    });

    const startX = cornerBox.x + cornerBox.width / 2;
    const startY = cornerBox.y + cornerBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();

    // Drag right enough to add 2 columns
    await page.mouse.move(startX + unitWidth * 2 + 10, startY, { steps: 10 });

    // 4. Check scroll container MID-DRAG — it must have overflow classes now
    const scrollContainerDuring = await page.evaluate(() => {
      const sc = document.querySelector('[data-blok-table-scroll]') as HTMLElement;

      return {
        hasOverflowX: sc?.classList.contains('overflow-x-auto'),
        hasOverflowY: sc?.classList.contains('overflow-y-hidden'),
      };
    });

    expect(scrollContainerDuring.hasOverflowX).toBe(true);
    expect(scrollContainerDuring.hasOverflowY).toBe(true);

    await page.mouse.up();
  });

  test('Undo reverses corner click additions', async ({ page }) => {
    // 1. Create a 2x2 table
    await createTable(page, [['A', 'B'], ['C', 'D']]);

    // 2. Verify initial dimensions
    const rows = page.locator(ROW_SELECTOR);

    await expect(rows).toHaveCount(2);

    const firstRowCells = rows.nth(0).locator(CELL_SELECTOR);

    await expect(firstRowCells).toHaveCount(2);

    // 3. Click the corner handle to add 1 row + 1 column
    await clickCornerHandle(page);

    // 4. Verify 3x3 after click
    await expect(rows).toHaveCount(3);
    await expect(firstRowCells).toHaveCount(3);

    // 5. Wait for Yjs to capture the state, then undo
    // eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(YJS_CAPTURE_TIMEOUT);
    await page.keyboard.press(UNDO_SHORTCUT);

    // 6. Verify the table is back to 2x2
    await expect(rows).toHaveCount(2);
    await expect(firstRowCells).toHaveCount(2);
  });
});
