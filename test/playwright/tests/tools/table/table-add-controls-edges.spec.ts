// spec: Add Controls Edge Cases
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

/**
 * Hover near the right edge of the table so the add-column button becomes visible.
 */
const hoverNearRightEdge = async (page: Page, tableLocator: ReturnType<Page['locator']>): Promise<void> => {
  const tableBox = assertBoundingBox(await tableLocator.boundingBox(), 'Table for right-edge hover');

  await page.mouse.move(
    tableBox.x + tableBox.width - 10,
    tableBox.y + tableBox.height / 2
  );
};

/**
 * Hover near the bottom edge of the table so the add-row button becomes visible.
 */
const hoverNearBottomEdge = async (page: Page, tableLocator: ReturnType<Page['locator']>): Promise<void> => {
  const tableBox = assertBoundingBox(await tableLocator.boundingBox(), 'Table for bottom-edge hover');

  await page.mouse.move(
    tableBox.x + tableBox.width / 2,
    tableBox.y + tableBox.height - 10
  );
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

test.describe('Add Controls Edge Cases', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('add controls are not interactive when a cell selection is active', async ({ page }) => {
    // Init editor with 3x3 table with content
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['A1', 'A2', 'A3'], ['B1', 'B2', 'B3'], ['C1', 'C2', 'C3']],
            },
          },
        ],
      },
    });

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    const cells = page.locator(CELL_SELECTOR);

    // Drag to select cells (0,0) to (1,1) to create an active selection
    // eslint-disable-next-line playwright/no-nth-methods -- nth(0) needed for first cell
    const firstCell = cells.nth(0);
    const firstBox = assertBoundingBox(await firstCell.boundingBox(), 'first cell');

    // eslint-disable-next-line playwright/no-nth-methods -- nth(4) needed for cell at row 1, col 1 in a 3-column table
    const targetCell = cells.nth(4);
    const targetBox = assertBoundingBox(await targetCell.boundingBox(), 'target cell (1,1)');

    await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 5 });
    await page.mouse.up();

    // Verify selection is active (data-blok-table-cell-selected present)
    const selected = page.locator('[data-blok-table-cell-selected]');

    await expect(selected).toHaveCount(4);

    // Check that both add buttons have pointer-events disabled right after selection,
    // before any hover interaction that could trigger the show/hide proximity logic.
    const addRowBtn = page.locator('[data-blok-table-add-row]');

    const pointerEventsAfterSelection = await page.evaluate(() => {
      const row = document.querySelector('[data-blok-table-add-row]');
      const col = document.querySelector('[data-blok-table-add-col]');

      return {
        row: row ? getComputedStyle(row).pointerEvents : null,
        col: col ? getComputedStyle(col).pointerEvents : null,
      };
    });

    expect(pointerEventsAfterSelection.row).toBe('none');
    expect(pointerEventsAfterSelection.col).toBe('none');

    // Hover bottom edge — this triggers showRow() which must NOT override pointer-events
    await hoverNearBottomEdge(page, table);

    // After hovering, pointer-events must still be 'none' (regression: showRow() used to reset it)
    await expect(addRowBtn).toHaveCSS('pointer-events', 'none');

    // Verify table still has 3 rows — no row was accidentally added
    const rows = page.locator('[data-blok-table-row]');

    await expect(rows).toHaveCount(3);
  });

  test('add-row button tooltip shows expected text', async ({ page }) => {
    // Init editor with 2x2 table
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['A', 'B'], ['C', 'D']],
            },
          },
        ],
      },
    });

    const table = page.locator(TABLE_SELECTOR);

    // Hover near bottom edge to reveal add-row button
    await hoverNearBottomEdge(page, table);

    const addRowBtn = page.locator('[data-blok-table-add-row]');

    await expect(addRowBtn).toBeVisible();

    // Hover over the button itself to trigger the floating tooltip
    await addRowBtn.hover();

    // The tooltip is a floating element, not a title attribute
    const tooltip = page.getByTestId('tooltip-content');

    await expect(tooltip).toContainText(/row/i);
  });

  test('add-column button tooltip shows expected text', async ({ page }) => {
    // Init editor with 2x2 table
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['A', 'B'], ['C', 'D']],
            },
          },
        ],
      },
    });

    const table = page.locator(TABLE_SELECTOR);
    const addColBtn = page.locator('[data-blok-table-add-col]');

    // Hover near right edge to reveal add-column button
    await hoverNearRightEdge(page, table);

    await expect(addColBtn).toBeVisible();

    // Hover over the button itself to trigger the floating tooltip
    await addColBtn.hover();

    // The tooltip is a floating element, not a title attribute
    const tooltip = page.getByTestId('tooltip-content');

    await expect(tooltip).toContainText(/column/i);
  });

  test('add-col and add-row buttons are exactly 4px from the grid after adding a column', async ({ page }) => {
    // Create a percent-mode table (no colWidths — buttons start in percent mode)
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['A', 'B', 'C'], ['D', 'E', 'F']],
            },
          },
        ],
      },
    });

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // Click the add-column button to add a column (triggers percent→pixel mode transition)
    await hoverNearRightEdge(page, table);

    const addColBtn = page.locator('[data-blok-table-add-col]');

    await expect(addColBtn).toBeVisible();
    await addColBtn.click();

    // Wait for layout to settle after the column is added
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('[data-blok-table-row]');

      return rows.length > 0 && (rows[0] as HTMLElement).querySelectorAll('[data-blok-table-cell]').length === 4;
    });

    // Measure button positions vs table edges using real rendered layout
    const gaps = await page.evaluate(() => {
      const scrollContainer = document.querySelector('[data-blok-table-scroll]') as HTMLElement | null;
      const grid = scrollContainer?.firstElementChild as HTMLElement | null;
      const addColBtnEl = document.querySelector('[data-blok-table-add-col]') as HTMLElement | null;
      const addRowBtnEl = document.querySelector('[data-blok-table-add-row]') as HTMLElement | null;

      if (!scrollContainer || !grid || !addColBtnEl || !addRowBtnEl) {
        return null;
      }

      const scrollRect = scrollContainer.getBoundingClientRect();
      const gridRect = grid.getBoundingClientRect();
      const colBtnRect = addColBtnEl.getBoundingClientRect();
      const rowBtnRect = addRowBtnEl.getBoundingClientRect();

      return {
        colGap: colBtnRect.left - Math.min(gridRect.right, scrollRect.right),
        rowGap: rowBtnRect.top - gridRect.bottom,
      };
    });

    expect(gaps).not.toBeNull();

    // Both buttons must be within [2, 6] px of the table edge — centred on 4px
    const { colGap, rowGap } = gaps!;

    expect(colGap).toBeGreaterThanOrEqual(2);
    expect(colGap).toBeLessThanOrEqual(6);
    expect(rowGap).toBeGreaterThanOrEqual(2);
    expect(rowGap).toBeLessThanOrEqual(6);
  });

  test('add-col button stays 4px from grid after user scrolls table back to the left', async ({ page }) => {
    // Create a percent-mode table so the first add-column click triggers percent→pixel transition
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['A', 'B', 'C'], ['D', 'E', 'F']],
            },
          },
        ],
      },
    });

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // Add a column — this transitions to pixel mode and auto-scrolls right
    await hoverNearRightEdge(page, table);

    const addColBtn = page.locator('[data-blok-table-add-col]');

    await expect(addColBtn).toBeVisible();
    await addColBtn.click();

    // Wait for 4 columns
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('[data-blok-table-row]');

      return rows.length > 0 && (rows[0] as HTMLElement).querySelectorAll('[data-blok-table-cell]').length === 4;
    });

    // Now simulate the user scrolling the table back to the start (scrollLeft=0)
    await page.evaluate(() => {
      const sc = document.querySelector('[data-blok-table-scroll]') as HTMLElement | null;

      if (sc) sc.scrollLeft = 0;
    });

    // The scroll event must trigger syncRowButtonWidth — give it one rAF to settle
    await page.waitForFunction(() => {
      const sc = document.querySelector('[data-blok-table-scroll]') as HTMLElement | null;

      return sc?.scrollLeft === 0;
    });

    // Measure gap at scrollLeft=0 (grid overflows scroll container to the right)
    const colGap = await page.evaluate(() => {
      const sc = document.querySelector('[data-blok-table-scroll]') as HTMLElement | null;
      const grid = sc?.firstElementChild as HTMLElement | null;
      const btn = document.querySelector('[data-blok-table-add-col]') as HTMLElement | null;

      if (!sc || !grid || !btn) return null;

      const scrollRect = sc.getBoundingClientRect();
      const gridRect = grid.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();

      return btnRect.left - Math.min(gridRect.right, scrollRect.right);
    });

    expect(colGap).not.toBeNull();
    expect(colGap!).toBeGreaterThanOrEqual(2);
    expect(colGap!).toBeLessThanOrEqual(6);
  });

  test('both buttons stay 4px from grid after viewport is resized narrower', async ({ page }) => {
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['A', 'B', 'C'], ['D', 'E', 'F']],
            },
          },
        ],
      },
    });

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // Add a column to enter pixel mode (table grid wider than scroll container)
    await hoverNearRightEdge(page, table);

    const addColBtn = page.locator('[data-blok-table-add-col]');

    await expect(addColBtn).toBeVisible();
    await addColBtn.click();

    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('[data-blok-table-row]');

      return rows.length > 0 && (rows[0] as HTMLElement).querySelectorAll('[data-blok-table-cell]').length === 4;
    });

    // Resize viewport narrower so the scroll container shrinks
    const originalWidth = page.viewportSize()!.width;

    await page.setViewportSize({ width: Math.round(originalWidth * 0.6), height: page.viewportSize()!.height });

    // Wait until the scroll container itself has shrunk (layout reflow complete).
    // setViewportSize waits for the resize to be applied, but ResizeObserver callbacks
    // are fired asynchronously in the rendering pipeline. Polling sc.clientWidth ensures
    // layout has stabilised before we measure button positions.
    const newWidth = Math.round(originalWidth * 0.6);

    await page.waitForFunction((targetWidth: number) => {
      const sc = document.querySelector('[data-blok-table-scroll]') as HTMLElement | null;

      return sc !== null && sc.clientWidth < targetWidth;
    }, newWidth);

    const gaps = await page.evaluate(() => {
      const sc = document.querySelector('[data-blok-table-scroll]') as HTMLElement | null;
      const grid = sc?.firstElementChild as HTMLElement | null;
      const addColBtnEl = document.querySelector('[data-blok-table-add-col]') as HTMLElement | null;
      const addRowBtnEl = document.querySelector('[data-blok-table-add-row]') as HTMLElement | null;

      if (!sc || !grid || !addColBtnEl || !addRowBtnEl) return null;

      const scrollRect = sc.getBoundingClientRect();
      const gridRect = grid.getBoundingClientRect();
      const colBtnRect = addColBtnEl.getBoundingClientRect();
      const rowBtnRect = addRowBtnEl.getBoundingClientRect();

      // Visible grid right edge = min(grid's right, scroll container's right)
      const visibleGridRight = Math.min(gridRect.right, scrollRect.right);
      const visibleGridWidth = visibleGridRight - scrollRect.left;

      return {
        colGap: colBtnRect.left - Math.min(gridRect.right, scrollRect.right),
        rowGap: rowBtnRect.top - gridRect.bottom,
        addRowWidth: addRowBtnEl.getBoundingClientRect().width,
        visibleGridWidth,
      };
    });

    expect(gaps).not.toBeNull();
    expect(gaps!.colGap).toBeGreaterThanOrEqual(2);
    expect(gaps!.colGap).toBeLessThanOrEqual(6);
    expect(gaps!.rowGap).toBeGreaterThanOrEqual(2);
    expect(gaps!.rowGap).toBeLessThanOrEqual(6);
    // add-row button width must match the visible portion of the grid
    // (may be narrower than sc.clientWidth when scrolled past the grid's right edge)
    expect(Math.abs(gaps!.addRowWidth - gaps!.visibleGridWidth)).toBeLessThanOrEqual(2);
  });

  test('add-col button height is explicitly set to grid height by syncRowButtonWidth', async ({ page }) => {
    // Regression: on systems with traditional (non-overlay) scrollbars, a horizontal scrollbar
    // inflates the scroll container's height, which propagates to the wrapper. The add-col button
    // used bottom:0 which tied it to the wrapper, causing it to grow taller than the grid.
    // Fix: syncRowButtonWidth() must explicitly set height = grid.getBoundingClientRect().height
    // so the button never exceeds the grid's actual rendered height.
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['A', 'B', 'C'], ['D', 'E', 'F']],
            },
          },
        ],
      },
    });

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // Add a column — transitions to pixel mode and calls syncRowButtonWidth
    await hoverNearRightEdge(page, table);

    const addColBtn = page.locator('[data-blok-table-add-col]');

    await expect(addColBtn).toBeVisible();
    await addColBtn.click();

    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('[data-blok-table-row]');

      return rows.length > 0 && (rows[0] as HTMLElement).querySelectorAll('[data-blok-table-cell]').length === 4;
    });

    // syncRowButtonWidth() must have set an explicit pixel height on the add-col button
    // equal to the grid's rendered height, to prevent scrollbar-induced height inflation.
    const heights = await page.evaluate(() => {
      const sc = document.querySelector('[data-blok-table-scroll]') as HTMLElement | null;
      const grid = sc?.firstElementChild as HTMLElement | null;
      const btn = document.querySelector('[data-blok-table-add-col]') as HTMLElement | null;

      if (!grid || !btn) return null;

      const gridHeight = grid.getBoundingClientRect().height;

      return {
        // Parsed numeric value of the button's inline style.height (NaN if empty)
        parsedStyleHeight: parseFloat(btn.style.height),
        gridRenderedHeight: gridHeight,
      };
    });

    expect(heights).not.toBeNull();
    // Before fix: parsedStyleHeight is NaN (style.height was '') — this assertion fails
    // After fix: parsedStyleHeight === gridRenderedHeight
    expect(heights!.parsedStyleHeight).toBeCloseTo(heights!.gridRenderedHeight, 2);
  });

  test('add-row button top is pinned to grid bottom by syncRowButtonWidth', async ({ page }) => {
    // Regression: on systems with traditional (non-overlay) scrollbars, a horizontal scrollbar
    // inflates the scroll container's height, which propagates to the wrapper. The add-row button
    // used bottom:-36px which tied it to the wrapper's bottom — as the wrapper grew, the button
    // shifted down by the same amount.
    // Fix: syncRowButtonWidth() must set top = gridHeight + 4px (grid bottom relative to wrapper
    // top) so the button position is independent of wrapper height inflation.
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['A', 'B', 'C'], ['D', 'E', 'F']],
            },
          },
        ],
      },
    });

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // Add a column — transitions to pixel mode and calls syncRowButtonWidth
    await hoverNearRightEdge(page, table);

    const addColBtn = page.locator('[data-blok-table-add-col]');

    await expect(addColBtn).toBeVisible();
    await addColBtn.click();

    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('[data-blok-table-row]');

      return rows.length > 0 && (rows[0] as HTMLElement).querySelectorAll('[data-blok-table-cell]').length === 4;
    });

    // syncRowButtonWidth() must set addRowBtn.style.top = gridHeight + 4px
    // so it stays anchored to the grid bottom, not the wrapper bottom.
    const positions = await page.evaluate(() => {
      const wrapper = document.querySelector('[data-blok-tool="table"]') as HTMLElement | null;
      const sc = document.querySelector('[data-blok-table-scroll]') as HTMLElement | null;
      const grid = sc?.firstElementChild as HTMLElement | null;
      const btn = document.querySelector('[data-blok-table-add-row]') as HTMLElement | null;

      if (!wrapper || !grid || !btn) return null;

      const wrapperRect = wrapper.getBoundingClientRect();
      const gridRect = grid.getBoundingClientRect();
      const expectedTop = gridRect.bottom - wrapperRect.top + 4;

      return {
        // Parsed numeric value of btn.style.top (NaN if '' or unset)
        parsedStyleTop: parseFloat(btn.style.top),
        expectedTop,
      };
    });

    expect(positions).not.toBeNull();
    // Before fix: parsedStyleTop is NaN (style.top was never set) — this assertion fails
    // After fix: parsedStyleTop ≈ expectedTop (grid bottom relative to wrapper + 4px gap)
    expect(positions!.parsedStyleTop).toBeCloseTo(positions!.expectedTop, 2);
  });
});
