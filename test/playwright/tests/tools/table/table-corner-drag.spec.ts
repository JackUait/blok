 
// E2E tests for the table corner drag handle

import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';

const HOLDER_ID = 'blok';
const CELL_SELECTOR = '[data-blok-table-cell]';
const ROW_SELECTOR = '[data-blok-table-row]';
const CORNER_DRAG_SELECTOR = '[data-blok-table-corner-drag]';
const GRID_SELECTOR = '[data-blok-table-scroll] table';
const SINGLETON_TOOLTIP_SELECTOR = '[data-blok-interface="tooltip"]';

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
 * A pixel-width table. Without explicit widths a table fills its container, so
 * its corner starts pinned to that container's right edge.
 */
const createTableWithWidths = async (
  page: Page,
  content: string[][],
  colWidths: number[]
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
            colWidths,
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
    await gotoTestPage(page);
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

    // 3. Verify the singleton tooltip is visible and shows "3×2" (cols×rows)
    const tooltip = page.locator(SINGLETON_TOOLTIP_SELECTOR);

    await expect(tooltip).toHaveAttribute('data-blok-shown', 'true');
    await expect(tooltip).toHaveText('3\u00D72');
  });

  test('Corner drag grows the table until its corner catches the pointer', async ({ page }) => {
    /*
     * Notion's contract: the grid's bottom-right corner follows the pointer.
     * Rows and columns keep being appended until the edge reaches the dragged
     * point and no further — so the overshoot is under one row/column, whatever
     * the sizes of the ones that got added.
     *
     * Growth is measured as the grid's own width/height, not its on-screen
     * position: a table dragged past its scroll container gets scrolled to keep
     * the corner in view, which pins the visible right edge to that container.
     *
     * Explicit column widths keep the grid narrower than its container, so the
     * whole gesture stays inside it and the auto-scroll never arms — this test is
     * about the corner tracking the pointer, which is a different contract.
     */
    await createTableWithWidths(page, [['A', 'B'], ['C', 'D']], [120, 120]);

    const grid = page.locator(`${GRID_SELECTOR}`);
    const sizeOf = (): Promise<{ width: number; height: number }> =>
      grid.evaluate(el => ({ width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height }));
    const gridBefore = await sizeOf();

    const cornerHandle = page.locator(CORNER_DRAG_SELECTOR);
    const cornerBox = assertBoundingBox(await cornerHandle.boundingBox(), 'Corner handle');

    const startX = cornerBox.x + cornerBox.width / 2;
    const startY = cornerBox.y + cornerBox.height / 2;
    const dx = 180;
    const dy = 90;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + dx, startY + dy, { steps: 10 });
    await page.mouse.up();

    const rows = page.locator(ROW_SELECTOR);

    expect(await rows.count()).toBeGreaterThan(2);

    const firstRowCells = rows.nth(0).locator(CELL_SELECTOR);

    expect(await firstRowCells.count()).toBeGreaterThan(2);

    const gridAfter = await sizeOf();
    const { lastColumnWidth, lastRowHeight } = await page.evaluate(() => {
      const rowEls = document.querySelectorAll('[data-blok-table-row]');
      const lastRow = rowEls[rowEls.length - 1] as HTMLElement;
      const cells = rowEls[0].querySelectorAll('[data-blok-table-cell]');
      const lastCell = cells[cells.length - 1] as HTMLElement;

      return {
        lastColumnWidth: lastCell.getBoundingClientRect().width,
        lastRowHeight: lastRow.getBoundingClientRect().height,
      };
    });

    const grownRight = gridAfter.width - gridBefore.width;
    const grownBottom = gridAfter.height - gridBefore.height;

    expect(grownRight).toBeGreaterThanOrEqual(dx - 1);
    expect(grownRight).toBeLessThan(dx + lastColumnWidth);
    expect(grownBottom).toBeGreaterThanOrEqual(dy - 1);
    expect(grownBottom).toBeLessThan(dy + lastRowHeight);
  });

  /*
   * The behaviours Notion documents for this handle, asserted directly:
   *
   *   "To add more rows and columns, drag the bottom-right corner of the table
   *    outward diagonally. To add just columns, drag outward to the right and
   *    drag towards the bottom to add just more rows."
   *    — notion.com/help/columns-headings-and-dividers
   *   "drag the bottom right corner of the table to add or remove rows and
   *    columns at the same time"
   *
   * Pixel column widths keep the whole gesture inside the scroll container, so
   * the auto-scroll never joins in and these test only the documented axes.
   */
  test('Corner drag right adds only columns, and down adds only rows', async ({ page }) => {
    await createTableWithWidths(page, [['A', 'B', 'C'], ['D', 'E', 'F']], [120, 120, 120]);

    const rows = page.locator(ROW_SELECTOR);
    const columns = rows.nth(0).locator(CELL_SELECTOR);

    expect(await rows.count()).toBe(2);
    expect(await columns.count()).toBe(3);

    const dragCornerBy = async (dx: number, dy: number): Promise<void> => {
      const box = assertBoundingBox(await page.locator(CORNER_DRAG_SELECTOR).boundingBox(), 'Corner handle');
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;

      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 5 });
      await page.mouse.up();
    };

    await dragCornerBy(130, 0);

    expect(await columns.count()).toBeGreaterThan(3);
    expect(await rows.count()).toBe(2);

    const columnsAfterHorizontal = await columns.count();

    await dragCornerBy(0, 80);

    expect(await rows.count()).toBeGreaterThan(2);
    expect(await columns.count()).toBe(columnsAfterHorizontal);
  });

  test('Corner drag inward removes rows and columns, content included', async ({ page }) => {
    /*
     * Every cell here holds text: Notion's inward drag removes rows and columns
     * regardless, and the gesture is one undo entry. This is the assertion that
     * caught Blok's old emptiness gate, under which dragging back over typed
     * cells did nothing — a unit test cannot see it, because a mocked block API
     * leaves the cells textually empty either way.
     */
    await createTableWithWidths(
      page,
      [['A', 'B', 'C'], ['D', 'E', 'F'], ['G', 'H', 'I']],
      [120, 120, 120]
    );

    const rows = page.locator(ROW_SELECTOR);
    const columns = rows.nth(0).locator(CELL_SELECTOR);

    expect(await rows.count()).toBe(3);
    expect(await columns.count()).toBe(3);

    const box = assertBoundingBox(await page.locator(CORNER_DRAG_SELECTOR).boundingBox(), 'Corner handle');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    await page.mouse.move(x, y);
    await page.mouse.down();
    // Back past the last column's own width and the last row's own height.
    await page.mouse.move(x - 130, y - 40, { steps: 5 });
    await page.mouse.up();

    expect(await columns.count()).toBe(2);
    expect(await rows.count()).toBe(2);
  });

  test('One undo restores everything an inward drag removed', async ({ page }) => {
    // The safety net that makes a content-removing drag acceptable.
    await createTableWithWidths(
      page,
      [['A', 'B', 'C'], ['D', 'E', 'F'], ['G', 'H', 'I']],
      [120, 120, 120]
    );

    const rows = page.locator(ROW_SELECTOR);
    const columns = rows.nth(0).locator(CELL_SELECTOR);
    const box = assertBoundingBox(await page.locator(CORNER_DRAG_SELECTOR).boundingBox(), 'Corner handle');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 130, y - 40, { steps: 5 });
    await page.mouse.up();

    expect(await columns.count()).toBe(2);
    expect(await rows.count()).toBe(2);
    await expect(page.getByText('I')).toBeHidden();

    // eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(YJS_CAPTURE_TIMEOUT);
    await page.locator(CELL_SELECTOR).first().click();
    await page.keyboard.press(UNDO_SHORTCUT);

    await expect.poll(() => rows.count()).toBe(3);
    expect(await columns.count()).toBe(3);
    await expect(page.getByText('I')).toBeVisible();
  });

  test('Corner drag auto-scrolls and keeps growing at the container edge', async ({ page }) => {
    /*
     * 20 columns hit the fluid-mode per-column minimum, so the grid is wider
     * than its scroll container and its corner is clipped to the visible edge.
     * Holding the drag there must scroll the container and keep appending —
     * without it the gesture dead-ends at the edge.
     */
    await createTable(page, [
      Array.from({ length: 20 }, (_, i) => `H${i}`),
      Array.from({ length: 20 }, (_, i) => `C${i}`),
    ]);

    const scrollContainer = page.locator('[data-blok-table-scroll]');
    const containerBox = assertBoundingBox(await scrollContainer.boundingBox(), 'Scroll container');
    const cornerHandle = page.locator(CORNER_DRAG_SELECTOR);
    const cornerBox = assertBoundingBox(await cornerHandle.boundingBox(), 'Corner handle');

    const columns = page.locator(ROW_SELECTOR).nth(0).locator(CELL_SELECTOR);
    const startY = cornerBox.y + cornerBox.height / 2;

    await page.mouse.move(cornerBox.x + cornerBox.width / 2, startY);
    await page.mouse.down();
    /*
     * Park well past the container's right edge: speed follows the pointer, so
     * sitting 8px out crawls while this races. Inside the edge it never arms.
     */
    await page.mouse.move(containerBox.x + containerBox.width + 160, startY, { steps: 5 });

    const parked = await columns.count();

    await expect.poll(() => columns.count(), { timeout: 5_000 }).toBeGreaterThan(parked);

    const scrolled = await scrollContainer.evaluate(el => el.scrollLeft);

    expect(scrolled).toBeGreaterThan(0);

    await page.mouse.up();
  });

  test('Corner drag scrolls the page while held at the viewport bottom', async ({ page }) => {
    /*
     * Rows are bounded by the page, not by the table's own scroller (which hides
     * overflow-y), so running out of room downward has to scroll the window.
     */
    // Short enough that the corner starts on screen, so the drag can reach it.
    await createTable(page, Array.from({ length: 6 }, (_, r) => [`A${r}`, `B${r}`]));

    const cornerHandle = page.locator(CORNER_DRAG_SELECTOR);
    const cornerBox = assertBoundingBox(await cornerHandle.boundingBox(), 'Corner handle');
    const viewport = page.viewportSize();

    if (viewport === null) {
      throw new Error('viewport size unavailable');
    }

    const rows = page.locator(ROW_SELECTOR);
    const startX = cornerBox.x + cornerBox.width / 2;

    await page.mouse.move(startX, cornerBox.y + cornerBox.height / 2);
    await page.mouse.down();
    // Drag to the very bottom of the viewport and hold there.
    await page.mouse.move(startX, viewport.height - 2, { steps: 5 });

    /*
     * Everything up to here is the corner tracking the pointer. What the
     * auto-scroll adds is growth that continues while the pointer sits still,
     * plus the page scrolling to keep the corner in view.
     */
    const settled = await rows.count();

    await expect.poll(() => rows.count(), { timeout: 5_000 }).toBeGreaterThan(settled);

    const scrolled = await page.evaluate(() => window.scrollY);

    expect(scrolled).toBeGreaterThan(0);

    await page.mouse.up();
  });

  test('Scroll container has overflow classes during corner drag column addition', async ({ page }) => {
    // Regression: corner drag's onAddColumn did not enable scroll overflow,
    // causing the grid to overflow unclipped and the hit zone to appear
    // in the middle of the table instead of at the visible corner.

    // 1. Create a 2x2 table (starts in percent mode, no colWidths)
    await createTable(page, [['A', 'B'], ['C', 'D']]);

    // 2. The scroll container exists from the first render in both width modes
    // (a fluid table has a per-column min-width floor and can overflow too).
    const scrollContainerBefore = await page.evaluate(() =>
      document.querySelector('[data-blok-table-scroll]') !== null
    );

    expect(scrollContainerBefore).toBe(true);

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
