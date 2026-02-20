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
});
