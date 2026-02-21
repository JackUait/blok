// spec: Delete Button Disabled State and Heading Toggle Position
// seed: test/playwright/tests/tools/table.spec.ts

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';

const HOLDER_ID = 'blok';
const CELL_SELECTOR = '[data-blok-table-cell]';
const COL_GRIP_SELECTOR = '[data-blok-table-grip-col]';
const ROW_GRIP_SELECTOR = '[data-blok-table-grip-row]';

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
};

test.describe('Delete Button Disabled State and Heading Toggle Position', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('delete column button is disabled when only one column remains', async ({ page }) => {
    // Init editor with 2x1 table (2 rows, 1 column)
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              withHeadingColumn: false,
              content: [['A'], ['B']],
            },
          },
        ],
      },
    });

    // Click first cell to show grips
    const firstCell = page.locator(`${CELL_SELECTOR} >> nth=0`);

    await firstCell.click();

    // Click column grip to open popover
    const colGrip = page.locator(`${COL_GRIP_SELECTOR} >> nth=0`);

    await expect(colGrip).toBeVisible({ timeout: 2000 });
    await colGrip.click();

    // Delete button should be visible but disabled (data-blok-disabled="true")
    await expect(page.getByText('Delete')).toBeVisible();

    const deleteItem = page.locator('[data-blok-testid="popover-item"][data-blok-disabled="true"]');

    await expect(deleteItem).toBeVisible();

    // Clicking the disabled delete button should not remove the column
    await deleteItem.dispatchEvent('click');

    // Table should still have 1 column per row
    const firstRow = page.locator('[data-blok-table-row] >> nth=0');

    await expect(firstRow.locator(CELL_SELECTOR)).toHaveCount(1);
  });

  test('delete row button is disabled when only one row remains', async ({ page }) => {
    // Init editor with 1x2 table (1 row, 2 columns)
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              withHeadingColumn: false,
              content: [['A', 'B']],
            },
          },
        ],
      },
    });

    // Click first cell to show grips
    const firstCell = page.locator(`${CELL_SELECTOR} >> nth=0`);

    await firstCell.click();

    // Click row grip to open popover
    const rowGrip = page.locator(`${ROW_GRIP_SELECTOR} >> nth=0`);

    await expect(rowGrip).toBeVisible({ timeout: 2000 });
    await rowGrip.click();

    // Delete button should be visible but disabled (data-blok-disabled="true")
    await expect(page.getByText('Delete')).toBeVisible();

    const deleteItem = page.locator('[data-blok-testid="popover-item"][data-blok-disabled="true"]');

    await expect(deleteItem).toBeVisible();

    // Clicking the disabled delete button should not remove the row
    await deleteItem.dispatchEvent('click');

    // Table should still have 1 row
    await expect(page.locator('[data-blok-table-row]')).toHaveCount(1);
  });

  test('heading toggle only appears in row grip popover for row 0', async ({ page }) => {
    // Init editor with 3x2 table (3 rows, 2 columns)
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              withHeadingColumn: false,
              content: [['A', 'B'], ['C', 'D'], ['E', 'F']],
            },
          },
        ],
      },
    });

    // Click a cell in row 1 (second row, first column) to show grips
    const secondRowCell = page.locator(`${CELL_SELECTOR} >> nth=2`);

    await secondRowCell.click();

    // Click the row 1 grip to open its popover
    const rowGripForRow1 = page.locator(`${ROW_GRIP_SELECTOR} >> nth=1`);

    await expect(rowGripForRow1).toBeVisible({ timeout: 2000 });
    await rowGripForRow1.scrollIntoViewIfNeeded();
    await rowGripForRow1.dispatchEvent('click');

    // Row 1 popover should NOT contain the heading toggle
    await expect(page.getByText('Insert Row Above')).toBeVisible();
    await expect(page.getByText('Header row')).toHaveCount(0);

    // Close the popover
    await page.mouse.click(10, 10);
    await expect(page.locator('[data-blok-popover]')).toHaveCount(0);

    // Click the first cell in row 0 to show grips
    const firstCell = page.locator(`${CELL_SELECTOR} >> nth=0`);

    await firstCell.click();

    // Click the row 0 grip to open its popover
    const rowGripForRow0 = page.locator(`${ROW_GRIP_SELECTOR} >> nth=0`);

    await expect(rowGripForRow0).toBeVisible({ timeout: 2000 });
    await rowGripForRow0.click();

    // Row 0 popover SHOULD contain the heading toggle
    await expect(page.getByText('Header row')).toBeVisible();
  });

  test('heading column toggle only appears in column grip popover for column 0', async ({ page }) => {
    // Init editor with 2x3 table (2 rows, 3 columns)
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              withHeadingColumn: false,
              content: [['A', 'B', 'C'], ['D', 'E', 'F']],
            },
          },
        ],
      },
    });

    // Click a cell in column 1 (second column) to show grips
    const secondColumnCell = page.locator(`${CELL_SELECTOR} >> nth=1`);

    await secondColumnCell.click();

    // Click the column 1 grip to open its popover
    const colGripForCol1 = page.locator(`${COL_GRIP_SELECTOR} >> nth=1`);

    await expect(colGripForCol1).toBeVisible({ timeout: 2000 });
    await colGripForCol1.click();

    // Column 1 popover should NOT contain the heading column toggle
    await expect(page.getByText('Insert Column Left')).toBeVisible();
    await expect(page.getByText('Header column')).toHaveCount(0);

    // Close the popover
    await page.mouse.click(10, 10);
    await expect(page.locator('[data-blok-popover]')).toHaveCount(0);

    // Click the first cell in column 0 to show grips
    const firstCell = page.locator(`${CELL_SELECTOR} >> nth=0`);

    await firstCell.click();

    // Click the column 0 grip to open its popover
    const colGripForCol0 = page.locator(`${COL_GRIP_SELECTOR} >> nth=0`);

    await expect(colGripForCol0).toBeVisible({ timeout: 2000 });
    await colGripForCol0.click();

    // Column 0 popover SHOULD contain the heading column toggle
    await expect(page.getByText('Header column')).toBeVisible();
  });

  test('toggling heading row off does not remove heading column styling', async ({ page }) => {
    // Init editor with 2x2 table with both heading row and heading column enabled
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: true,
              withHeadingColumn: true,
              content: [['H1', 'H2'], ['D1', 'D2']],
            },
          },
        ],
      },
    });

    // Verify both heading attributes are present initially
    await expect(page.locator('[data-blok-table-heading]')).toBeVisible();
    await expect(page.locator('[data-blok-table-heading-col] >> nth=0')).toBeVisible();

    // Click first cell to show grips
    const firstCell = page.locator(`${CELL_SELECTOR} >> nth=0`);

    await firstCell.click();

    // Open row 0 grip popover
    const rowGrip = page.locator(`${ROW_GRIP_SELECTOR} >> nth=0`);

    await expect(rowGrip).toBeVisible({ timeout: 2000 });
    await rowGrip.click();

    // Heading row toggle should be visible in the popover
    await expect(page.getByText('Header row')).toBeVisible();

    // Click the heading row toggle to turn it off
    await page.getByText('Header row').click();

    // Close the popover
    await page.mouse.click(10, 10);
    await expect(page.locator('[data-blok-popover]')).toHaveCount(0);

    // Heading row styling should be removed
    await expect(page.locator('[data-blok-table-heading]')).toHaveCount(0);

    // Heading column styling should still be present
    await expect(page.locator('[data-blok-table-heading-col] >> nth=0')).toBeVisible();
  });

  test('toggling heading column off does not remove heading row styling', async ({ page }) => {
    // Init editor with 2x2 table with both heading row and heading column enabled
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: true,
              withHeadingColumn: true,
              content: [['H1', 'H2'], ['D1', 'D2']],
            },
          },
        ],
      },
    });

    // Verify both heading attributes are present initially
    await expect(page.locator('[data-blok-table-heading]')).toBeVisible();
    await expect(page.locator('[data-blok-table-heading-col] >> nth=0')).toBeVisible();

    // Click first cell to show grips
    const firstCell = page.locator(`${CELL_SELECTOR} >> nth=0`);

    await firstCell.click();

    // Open column 0 grip popover
    const colGrip = page.locator(`${COL_GRIP_SELECTOR} >> nth=0`);

    await expect(colGrip).toBeVisible({ timeout: 2000 });
    await colGrip.click();

    // Heading column toggle should be visible in the popover
    await expect(page.getByText('Header column')).toBeVisible();

    // Click the heading column toggle to turn it off
    await page.getByText('Header column').click();

    // Close the popover
    await page.mouse.click(10, 10);
    await expect(page.locator('[data-blok-popover]')).toHaveCount(0);

    // Heading column styling should be removed
    await expect(page.locator('[data-blok-table-heading-col]')).toHaveCount(0);

    // Heading row styling should still be present
    await expect(page.locator('[data-blok-table-heading]')).toBeVisible();
  });
});
