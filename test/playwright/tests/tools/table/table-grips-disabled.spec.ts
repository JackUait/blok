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
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
    const firstCell = page.locator(CELL_SELECTOR).first();

    await firstCell.click();

    // Click column grip to open popover
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible grip
    const colGrip = page.locator(COL_GRIP_SELECTOR).first();

    await expect(colGrip).toBeVisible({ timeout: 2000 });
    await colGrip.click();

    // Delete button should be visible but disabled (data-blok-disabled="true")
    await expect(page.getByText('Delete')).toBeVisible();

    const deleteItem = page.locator('[data-blok-testid="popover-item"][data-blok-disabled="true"]');

    await expect(deleteItem).toBeVisible();

    // Clicking the disabled delete button should not remove the column
    await deleteItem.click({ force: true });

    // Table should still have 1 column per row
    // eslint-disable-next-line playwright/no-nth-methods -- first() needed to get first row
    const firstRow = page.locator('[data-blok-table-row]').first();

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
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
    const firstCell = page.locator(CELL_SELECTOR).first();

    await firstCell.click();

    // Click row grip to open popover
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible grip
    const rowGrip = page.locator(ROW_GRIP_SELECTOR).first();

    await expect(rowGrip).toBeVisible({ timeout: 2000 });
    await rowGrip.click();

    // Delete button should be visible but disabled (data-blok-disabled="true")
    await expect(page.getByText('Delete')).toBeVisible();

    const deleteItem = page.locator('[data-blok-testid="popover-item"][data-blok-disabled="true"]');

    await expect(deleteItem).toBeVisible();

    // Clicking the disabled delete button should not remove the row
    await deleteItem.click({ force: true });

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
    // eslint-disable-next-line playwright/no-nth-methods -- nth(2) targets the first cell of the second row in a 2-col table
    const secondRowCell = page.locator(CELL_SELECTOR).nth(2);

    await secondRowCell.click();

    // Click the row 1 grip to open its popover
    // eslint-disable-next-line playwright/no-nth-methods -- nth(1) targets the second row grip
    const rowGripForRow1 = page.locator(ROW_GRIP_SELECTOR).nth(1);

    await expect(rowGripForRow1).toBeVisible({ timeout: 2000 });
    // eslint-disable-next-line playwright/no-force-option -- row grip may be overlapped by adjacent cell in layout
    await rowGripForRow1.click({ force: true });

    // Row 1 popover should NOT contain the heading toggle
    await expect(page.getByText('Insert Row Above')).toBeVisible();
    await expect(page.getByText('Header row')).toHaveCount(0);

    // Close the popover
    await page.mouse.click(10, 10);
    await expect(page.locator('[data-blok-popover]')).toHaveCount(0);

    // Click the first cell in row 0 to show grips
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get the first cell
    const firstCell = page.locator(CELL_SELECTOR).first();

    await firstCell.click();

    // Click the row 0 grip to open its popover
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first row grip
    const rowGripForRow0 = page.locator(ROW_GRIP_SELECTOR).first();

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
    // eslint-disable-next-line playwright/no-nth-methods -- nth(1) targets the second cell (column 1) in the first row
    const secondColumnCell = page.locator(CELL_SELECTOR).nth(1);

    await secondColumnCell.click();

    // Click the column 1 grip to open its popover
    // eslint-disable-next-line playwright/no-nth-methods -- nth(1) targets the second column grip
    const colGripForCol1 = page.locator(COL_GRIP_SELECTOR).nth(1);

    await expect(colGripForCol1).toBeVisible({ timeout: 2000 });
    await colGripForCol1.click();

    // Column 1 popover should NOT contain the heading column toggle
    await expect(page.getByText('Insert Column Left')).toBeVisible();
    await expect(page.getByText('Header column')).toHaveCount(0);

    // Close the popover
    await page.mouse.click(10, 10);
    await expect(page.locator('[data-blok-popover]')).toHaveCount(0);

    // Click the first cell in column 0 to show grips
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get the first cell
    const firstCell = page.locator(CELL_SELECTOR).first();

    await firstCell.click();

    // Click the column 0 grip to open its popover
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first column grip
    const colGripForCol0 = page.locator(COL_GRIP_SELECTOR).first();

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
    // eslint-disable-next-line playwright/no-nth-methods -- first() needed to get first heading col cell
    await expect(page.locator('[data-blok-table-heading-col]').first()).toBeVisible();

    // Click first cell to show grips
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
    const firstCell = page.locator(CELL_SELECTOR).first();

    await firstCell.click();

    // Open row 0 grip popover
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first row grip
    const rowGrip = page.locator(ROW_GRIP_SELECTOR).first();

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
    // eslint-disable-next-line playwright/no-nth-methods -- first() needed to get first heading col cell
    await expect(page.locator('[data-blok-table-heading-col]').first()).toBeVisible();
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
    // eslint-disable-next-line playwright/no-nth-methods -- first() needed to get first heading col cell
    await expect(page.locator('[data-blok-table-heading-col]').first()).toBeVisible();

    // Click first cell to show grips
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
    const firstCell = page.locator(CELL_SELECTOR).first();

    await firstCell.click();

    // Open column 0 grip popover
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first column grip
    const colGrip = page.locator(COL_GRIP_SELECTOR).first();

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
