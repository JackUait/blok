// spec: specs/plan.md (Row and Column Grip Controls)
// seed: test/playwright/tests/tools/table.spec.ts

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';

const HOLDER_ID = 'blok';
const CELL_SELECTOR = '[data-blok-table-cell]';
const COL_GRIP_SELECTOR = '[data-blok-table-grip-col]';
const ROW_GRIP_SELECTOR = '[data-blok-table-grip-row]';

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

const createTable2x2 = async (page: Page): Promise<void> => {
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
};

test.describe('Row and Column Grip Controls', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('Column grip pill appears when hovering a cell', async ({ page }) => {
    // Initialize 2x2 table and click first cell to show grips
    await createTable2x2(page);

    const firstCell = page.locator(`${CELL_SELECTOR} >> nth=0`);

    await firstCell.click();

    // Verify data-blok-table-grip-col is visible
    const colGrip = page.locator(`${COL_GRIP_SELECTOR} >> nth=0`);

    await expect(colGrip).toBeVisible({ timeout: 2000 });

    // Verify data-blok-table-grip-row is visible
    const rowGrip = page.locator(`${ROW_GRIP_SELECTOR} >> nth=0`);

    await expect(rowGrip).toBeVisible({ timeout: 2000 });
  });

  test('Click column grip shows popover with Insert Column Left, Insert Column Right, Delete', async ({ page }) => {
    // Initialize 2x2 table and click cell to show grips
    await createTable2x2(page);

    const firstCell = page.locator(`${CELL_SELECTOR} >> nth=0`);

    await firstCell.click();

    // Click column grip to open popover
    const colGrip = page.locator(`${COL_GRIP_SELECTOR} >> nth=0`);

    await expect(colGrip).toBeVisible();
    await colGrip.click();

    // Verify popover with column menu items
    await expect(page.getByText('Insert Column Left')).toBeVisible();
    await expect(page.getByText('Insert Column Right')).toBeVisible();
    await expect(page.getByText('Delete')).toBeVisible();
  });

  test('Click Insert Column Left adds new column at index 0', async ({ page }) => {
    // Initialize 2x2 table
    await createTable2x2(page);

    const firstCell = page.locator(`${CELL_SELECTOR} >> nth=0`);

    await firstCell.click();

    const colGrip = page.locator(`${COL_GRIP_SELECTOR} >> nth=0`);

    await expect(colGrip).toBeVisible();
    await colGrip.click();

    // Click Insert Column Left
    await page.getByText('Insert Column Left').click();

    // Verify 3 cells per row - new column at index 0
    const firstRow = page.locator('[data-blok-table-row] >> nth=0');
    const cells = firstRow.locator(CELL_SELECTOR);

    await expect(cells).toHaveCount(3);

    // Verify original content moved to index 1 (new column at index 0 is empty)
    const secondCellText = await cells.nth(1).textContent();

    expect(secondCellText?.trim()).toBe('A');
  });

  test('Click Insert Column Right adds new column between original columns', async ({ page }) => {
    // Initialize 2x2 table
    await createTable2x2(page);

    const firstCell = page.locator(`${CELL_SELECTOR} >> nth=0`);

    await firstCell.click();

    const colGrip = page.locator(`${COL_GRIP_SELECTOR} >> nth=0`);

    await expect(colGrip).toBeVisible();
    await colGrip.click();

    // Click Insert Column Right
    await page.getByText('Insert Column Right').click();

    // Verify first row has 3 cells
    const firstRow = page.locator('[data-blok-table-row] >> nth=0');
    const cells = firstRow.locator(CELL_SELECTOR);

    await expect(cells).toHaveCount(3);

    // Verify original columns: A at index 0, new (empty) at index 1, B at index 2
    const firstCellText = await cells.nth(0).textContent();
    const thirdCellText = await cells.nth(2).textContent();

    expect(firstCellText?.trim()).toBe('A');
    expect(thirdCellText?.trim()).toBe('B');
  });

  test('Click column Delete removes column leaving 1 column per row', async ({ page }) => {
    // Initialize 2x2 table
    await createTable2x2(page);

    const firstCell = page.locator(`${CELL_SELECTOR} >> nth=0`);

    await firstCell.click();

    const colGrip = page.locator(`${COL_GRIP_SELECTOR} >> nth=0`);

    await expect(colGrip).toBeVisible();
    await colGrip.click();

    // Click Delete
    await page.getByText('Delete').click();

    // Verify 1 column per row
    const firstRow = page.locator('[data-blok-table-row] >> nth=0');

    await expect(firstRow.locator(CELL_SELECTOR)).toHaveCount(1);
  });

  test('Click row grip shows popover with Insert Row Above, Insert Row Below, Delete', async ({ page }) => {
    // Initialize 2x2 table and click cell to show grips
    await createTable2x2(page);

    const firstCell = page.locator(`${CELL_SELECTOR} >> nth=0`);

    await firstCell.click();

    // Click row grip to open popover
    const rowGrip = page.locator(`${ROW_GRIP_SELECTOR} >> nth=0`);

    await expect(rowGrip).toBeVisible();
    await rowGrip.click();

    // Verify popover with row menu items
    await expect(page.getByText('Insert Row Above')).toBeVisible();
    await expect(page.getByText('Insert Row Below')).toBeVisible();
    await expect(page.getByText('Delete')).toBeVisible();
  });

  test('Click Insert Row Above adds new row at index 0', async ({ page }) => {
    // Initialize 2x2 table
    await createTable2x2(page);

    const firstCell = page.locator(`${CELL_SELECTOR} >> nth=0`);

    await firstCell.click();

    const rowGrip = page.locator(`${ROW_GRIP_SELECTOR} >> nth=0`);

    await expect(rowGrip).toBeVisible();
    await rowGrip.click();

    // Click Insert Row Above
    await page.getByText('Insert Row Above').click();

    // Verify 3 rows
    const rows = page.locator('[data-blok-table-row]');

    await expect(rows).toHaveCount(3);

    // Verify original first row content moved to index 1
    const secondRowFirstCell = rows.nth(1).locator(`${CELL_SELECTOR} >> nth=0`);
    const cellText = await secondRowFirstCell.textContent();

    expect(cellText?.trim()).toBe('A');
  });

  test('Click Insert Row Below adds new row at index 1', async ({ page }) => {
    // Initialize 2x2 table
    await createTable2x2(page);

    const firstCell = page.locator(`${CELL_SELECTOR} >> nth=0`);

    await firstCell.click();

    const rowGrip = page.locator(`${ROW_GRIP_SELECTOR} >> nth=0`);

    await expect(rowGrip).toBeVisible();
    await rowGrip.click();

    // Click Insert Row Below
    await page.getByText('Insert Row Below').click();

    // Verify 3 rows
    const rows = page.locator('[data-blok-table-row]');

    await expect(rows).toHaveCount(3);

    // Verify original rows remain at index 0 and 2, new row is at index 1
    const firstRowFirstCell = rows.nth(0).locator(`${CELL_SELECTOR} >> nth=0`);
    const firstCellText = await firstRowFirstCell.textContent();

    expect(firstCellText?.trim()).toBe('A');

    const thirdRowFirstCell = rows.nth(2).locator(`${CELL_SELECTOR} >> nth=0`);
    const thirdCellText = await thirdRowFirstCell.textContent();

    expect(thirdCellText?.trim()).toBe('C');
  });

  test('Delete middle row via grip removes it leaving 2 rows', async ({ page }) => {
    // Initialize 3x2 table (3 rows, 2 columns)
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['A', 'B'], ['C', 'D'], ['E', 'F']],
            },
          },
        ],
      },
    });

    // Click middle row cell to show its grip
    const middleCellEditable = page.locator(`${CELL_SELECTOR} >> nth=2`).locator('[contenteditable="true"] >> nth=0');

    await middleCellEditable.click();

    // Click the middle row grip
    const middleRowGrip = page.locator(`${ROW_GRIP_SELECTOR} >> nth=1`);

    await expect(middleRowGrip).toBeVisible();
    await middleRowGrip.click();

    // Click Delete
    await page.getByText('Delete').click();

    // Verify 2 rows remain
    await expect(page.locator('[data-blok-table-row]')).toHaveCount(2);
  });

  test('Middle column grip in 3-column table shows column action items', async ({ page }) => {
    // Initialize 3-column table
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

    // Click middle column cell to show its grip
    const middleCell = page.locator(`${CELL_SELECTOR} >> nth=1`);

    await middleCell.click();

    const middleColGrip = page.locator(`${COL_GRIP_SELECTOR} >> nth=1`);

    await expect(middleColGrip).toBeVisible();
    await middleColGrip.click();

    // Verify popover shows column action items
    await expect(page.getByText('Insert Column Left')).toBeVisible();
    await expect(page.getByText('Insert Column Right')).toBeVisible();

    // Move Column options are not available via popover (drag-only)
    await expect(page.getByText('Move Column Left')).toHaveCount(0);
    await expect(page.getByText('Move Column Right')).toHaveCount(0);
  });

  test('Middle row grip in 3-row table shows row action items', async ({ page }) => {
    // Initialize 3-row table
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['A', 'B'], ['C', 'D'], ['E', 'F']],
            },
          },
        ],
      },
    });

    // Click middle row cell to show its grip
    const middleCell = page.locator(`${CELL_SELECTOR} >> nth=2`);

    await middleCell.click();

    const middleRowGrip = page.locator(`${ROW_GRIP_SELECTOR} >> nth=1`);

    await expect(middleRowGrip).toBeVisible();
    await middleRowGrip.click();

    // Verify popover shows row action items
    await expect(page.getByText('Insert Row Above')).toBeVisible();
    await expect(page.getByText('Insert Row Below')).toBeVisible();

    // Move Row options are not available via popover (drag-only)
    await expect(page.getByText('Move Row Up')).toHaveCount(0);
    await expect(page.getByText('Move Row Down')).toHaveCount(0);
  });

  test('Toggle heading via row 0 grip popover sets data-blok-table-heading attribute', async ({ page }) => {
    // Initialize 2x2 table without headings
    await createTable2x2(page);

    // Click first cell to show grips
    const firstCellEditable = page.locator(`${CELL_SELECTOR} >> nth=0`).locator('[contenteditable="true"] >> nth=0');

    await firstCellEditable.click();

    // Click row 0 grip to open popover
    const rowGrip = page.locator(`${ROW_GRIP_SELECTOR} >> nth=0`);

    await expect(rowGrip).toBeVisible();
    await rowGrip.click();

    // The heading toggle switch appears for row 0 - click it to enable heading
    const headerRowToggle = page.getByText('Header row');

    await expect(headerRowToggle).toBeVisible();

    // Click the toggle to activate heading
    await headerRowToggle.click();

    // Verify data-blok-table-heading attribute is set on the first row
    const headingRow = page.locator('[data-blok-table-heading]');

    await expect(headingRow).toBeVisible();
  });

  test('Toggle heading column via column 0 grip sets data-blok-table-heading-col on first cells', async ({ page }) => {
    // Initialize 2x2 table without headings
    await createTable2x2(page);

    // Click first cell to show grips
    const firstCellEditable = page.locator(`${CELL_SELECTOR} >> nth=0`).locator('[contenteditable="true"] >> nth=0');

    await firstCellEditable.click();

    // Click column 0 grip to open popover
    const colGrip = page.locator(`${COL_GRIP_SELECTOR} >> nth=0`);

    await expect(colGrip).toBeVisible();
    await colGrip.click();

    // The heading toggle appears for column 0 - click it to enable heading column
    const headerColToggle = page.getByText('Header column');

    await expect(headerColToggle).toBeVisible();

    // Click the toggle to activate heading column
    await headerColToggle.click();

    // Verify data-blok-table-heading-col attribute is set on first cells
    await expect(page.locator('[data-blok-table-heading-col] >> nth=0')).toBeVisible();
  });

  test('Toggle read-only hides all grip elements', async ({ page }) => {
    // Initialize 2x2 table
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

    // Toggle readOnly mode
    await page.evaluate(async () => {
      await window.blokInstance?.readOnly.toggle();
    });

    // Verify no grip elements exist in read-only mode
    const colGrips = page.locator(COL_GRIP_SELECTOR);
    const rowGrips = page.locator(ROW_GRIP_SELECTOR);

    await expect(colGrips).toHaveCount(0);
    await expect(rowGrips).toHaveCount(0);
  });

  test('Grip reopens after insert row and close popover sequence', async ({ page }) => {
    // Initialize 2x2 table
    await createTable2x2(page);

    // Click contenteditable inside first cell to show grips
    const firstCellEditable = page.locator(`${CELL_SELECTOR} >> nth=0`).locator('[contenteditable="true"] >> nth=0');

    await firstCellEditable.click();

    // Open grip popover and insert row
    const rowGrip = page.locator(`${ROW_GRIP_SELECTOR} >> nth=0`);

    await expect(rowGrip).toBeVisible();
    await rowGrip.click();

    await expect(page.getByText('Insert Row Below')).toBeVisible();

    // Click Insert Row Below to close popover via menu action
    await page.getByText('Insert Row Below').click();

    // Wait for row to be inserted
    await expect(page.locator('[data-blok-table-row]')).toHaveCount(3);

    // Popover should be closed
    await expect(page.locator('[data-blok-popover]')).toHaveCount(0);

    // Re-click a cell to show grips again
    await page.locator(`${CELL_SELECTOR} >> nth=0`).locator('[contenteditable="true"] >> nth=0').click();

    const rowGripAfter = page.locator(`${ROW_GRIP_SELECTOR} >> nth=0`);

    await expect(rowGripAfter).toBeVisible();

    // Scroll into view and force click to avoid intercept issues from adjacent cells
    await rowGripAfter.scrollIntoViewIfNeeded();
    await rowGripAfter.click({ force: true });

    // Verify popover reopens correctly
    await expect(page.getByText('Insert Row Above')).toBeVisible();
  });

  test('Column grip has 24x4 dimensions and row grip has 4x20 dimensions', async ({ page }) => {
    // Initialize 2x2 table
    await createTable2x2(page);

    // Click cell to make grips visible for measurement
    const firstCell = page.locator(`${CELL_SELECTOR} >> nth=0`);

    await firstCell.click();

    // Measure column grip dimensions
    const colGrip = page.locator(`${COL_GRIP_SELECTOR} >> nth=0`);

    await expect(colGrip).toBeVisible();

    const colBox = assertBoundingBox(await colGrip.boundingBox(), 'Column grip');

    // Column pill: 24px wide x 4px tall
    expect(colBox.width).toBe(24);
    expect(colBox.height).toBe(4);

    // Measure row grip dimensions
    const rowGrip = page.locator(`${ROW_GRIP_SELECTOR} >> nth=0`);

    await expect(rowGrip).toBeVisible();

    const rowBox = assertBoundingBox(await rowGrip.boundingBox(), 'Row grip');

    // Row pill: 4px wide x 20px tall
    expect(rowBox.width).toBe(4);
    expect(rowBox.height).toBe(20);
  });

  test('Pressing Escape closes an open grip popover', async ({ page }) => {
    // Initialize 3x3 table with content
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [
                ['A', 'B', 'C'],
                ['D', 'E', 'F'],
                ['G', 'H', 'I'],
              ],
            },
          },
        ],
      },
    });

    // Hover cell (0,0) to reveal grips
    const firstCell = page.locator(`${CELL_SELECTOR} >> nth=0`);

    await firstCell.hover();

    // Wait for column grip to become visible
    const colGrip = page.locator('[data-blok-table-grip-col="0"][data-blok-table-grip-visible]');

    await expect(colGrip).toBeVisible({ timeout: 2000 });

    // Click the column grip to open popover
    await colGrip.click();

    // Verify the popover is visible
    await expect(page.getByText('Insert Column Left')).toBeVisible();

    // Press Escape key
    await page.keyboard.press('Escape');

    // Verify the popover is no longer visible
    await expect(page.locator('[data-blok-popover]')).toHaveCount(0);
  });
});
