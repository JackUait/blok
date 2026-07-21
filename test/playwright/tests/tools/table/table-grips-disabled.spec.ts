// spec: Delete Button Disabled State and Heading Toggle Position
// seed: test/playwright/tests/tools/table.spec.ts

import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';

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
    await gotoTestPage(page);
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

    // Hover a cell in row 1 (second row, first column) to show its grips.
    const secondRowCell = page.locator(`${CELL_SELECTOR} >> nth=2`);

    await secondRowCell.hover({ position: { x: 8, y: 8 } });

    // Click the exposed half of the row grip; its center sits on the table border.
    const rowGripForRow1 = page.locator('[data-blok-table-grip-row="1"][data-blok-table-grip-visible]');

    await expect(rowGripForRow1).toBeVisible({ timeout: 2000 });
    await rowGripForRow1.click({ position: { x: 1, y: 1 } });

    // Row 1 popover should NOT contain the heading toggle.
    await expect(page.getByRole('menuitem', { name: 'Insert row above', exact: true })).toBeVisible();
    await expect(page.getByText('Header row', { exact: true })).toHaveCount(0);

    // Close the popover and wait for its grip to finish hiding.
    await page.mouse.click(10, 10);
    await expect(page.locator('[data-blok-popover]')).toHaveCount(0);
    await expect(page.locator('[data-blok-table-grip-visible]')).toHaveCount(0);

    // Hover the first cell in row 0 to show its grips.
    const firstCell = page.locator(`${CELL_SELECTOR} >> nth=0`);

    await firstCell.hover({ position: { x: 8, y: 8 } });

    // Click the exposed half of the row grip; its center sits on the table border.
    const rowGripForRow0 = page.locator('[data-blok-table-grip-row="0"][data-blok-table-grip-visible]');

    await expect(rowGripForRow0).toBeVisible({ timeout: 2000 });
    await rowGripForRow0.click({ position: { x: 1, y: 1 } });

    // Row 0 popover SHOULD contain the heading toggle.
    await expect(page.getByText('Header row', { exact: true })).toBeVisible();
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

    // Hover a cell in column 1 (second column) to show its grips.
    const secondColumnCell = page.locator(`${CELL_SELECTOR} >> nth=1`);

    await secondColumnCell.hover({ position: { x: 8, y: 8 } });

    // Click the exposed half of the column grip; its center sits on the table border.
    const colGripForCol1 = page.locator('[data-blok-table-grip-col="1"][data-blok-table-grip-visible]');

    await expect(colGripForCol1).toBeVisible({ timeout: 2000 });
    await colGripForCol1.click({ position: { x: 1, y: 1 } });

    // Column 1 popover should NOT contain the heading column toggle.
    await expect(page.getByRole('menuitem', { name: 'Insert column left', exact: true })).toBeVisible();
    await expect(page.getByText('Header column', { exact: true })).toHaveCount(0);

    // Close the popover
    await page.mouse.click(10, 10);
    await expect(page.locator('[data-blok-popover]')).toHaveCount(0);

    // Hover the first cell in column 0 to show its grips.
    const firstCell = page.locator(`${CELL_SELECTOR} >> nth=0`);

    await firstCell.hover({ position: { x: 8, y: 8 } });

    // Click the exposed half of the column grip; its center sits on the table border.
    const colGripForCol0 = page.locator('[data-blok-table-grip-col="0"][data-blok-table-grip-visible]');

    await expect(colGripForCol0).toBeVisible({ timeout: 2000 });
    await colGripForCol0.click({ position: { x: 1, y: 1 } });

    // Column 0 popover SHOULD contain the heading column toggle.
    await expect(page.getByText('Header column', { exact: true })).toBeVisible();
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
