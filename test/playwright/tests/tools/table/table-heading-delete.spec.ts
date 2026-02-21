import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;
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

test.describe('Heading Row/Column Delete Behavior', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('Deleting heading row removes that row and transfers heading to the new first row', async ({ page }) => {
    // 1. Initialize a 3x3 table with withHeadings: true and content
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: true,
              content: [
                ['H1', 'H2', 'H3'],
                ['A1', 'A2', 'A3'],
                ['B1', 'B2', 'B3'],
              ],
            },
          },
        ],
      },
    });

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // 2. Verify data-blok-table-heading attribute exists on the first row
    const headingRow = page.locator('[data-blok-table-heading]');

    await expect(headingRow).toBeVisible();

    // 3. Click cell (0,0) to reveal the row grip for row 0
    const firstCell = page.locator(`${CELL_SELECTOR} >> nth=0`);

    await firstCell.click();

    // 4. Wait for row grip to appear
    const rowGrip = page.locator(`${ROW_GRIP_SELECTOR} >> nth=0`);

    await expect(rowGrip).toBeVisible({ timeout: 2000 });

    // 5. Click the row grip to open popover
    await rowGrip.click();

    // 6. Click the "Delete" option in the popover
    await page.getByText('Delete').click();

    // 7. Verify the heading row (H1, H2, H3) was removed — table now has 2 rows
    await expect(page.locator('[data-blok-table-row]')).toHaveCount(2);

    // 8. The heading attribute transfers to the new first row (previously row 1)
    const newHeadingRow = page.locator('[data-blok-table-heading]');

    await expect(newHeadingRow).toHaveCount(1);

    // 9. Verify the new first row contains the previously-second-row content
    const firstRowCells = page.locator('[data-blok-table-row]').nth(0).locator(CELL_SELECTOR);

    await expect(firstRowCells.nth(0)).toHaveText('A1');
    await expect(firstRowCells.nth(1)).toHaveText('A2');
    await expect(firstRowCells.nth(2)).toHaveText('A3');
  });

  test('Deleting heading column removes that column and transfers heading to the new first column', async ({ page }) => {
    // 1. Initialize a 3x3 table with withHeadingColumn: true and content
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadingColumn: true,
              content: [
                ['H1', 'A1', 'B1'],
                ['H2', 'A2', 'B2'],
                ['H3', 'A3', 'B3'],
              ],
            },
          },
        ],
      },
    });

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // 2. Verify data-blok-table-heading-col attribute exists on first-column cells
    const headingColCells = page.locator('[data-blok-table-heading-col]');

    await expect(headingColCells).toHaveCount(3);

    // 3. Click cell (0,0) to reveal the column grip for column 0
    const firstCell = page.locator(`${CELL_SELECTOR} >> nth=0`);

    await firstCell.click();

    // 4. Wait for column grip to appear
    const colGrip = page.locator(`${COL_GRIP_SELECTOR} >> nth=0`);

    await expect(colGrip).toBeVisible({ timeout: 2000 });

    // 5. Click the column grip to open popover
    await colGrip.click();

    // 6. Click the "Delete" option in the popover
    await page.getByText('Delete').click();

    // 7. Verify the heading column (H1, H2, H3) was removed — each row now has 2 cells
    const firstRow = page.locator('[data-blok-table-row] >> nth=0');

    await expect(firstRow.locator(CELL_SELECTOR)).toHaveCount(2);

    // 8. The heading-col attribute transfers to the new first column (previously column 1)
    await expect(page.locator('[data-blok-table-heading-col]')).toHaveCount(3);

    // 9. Verify the new first column contains the previously-second-column content
    const rows = page.locator('[data-blok-table-row]');

    await expect(rows.nth(0).locator(CELL_SELECTOR).nth(0)).toHaveText('A1');
    await expect(rows.nth(1).locator(CELL_SELECTOR).nth(0)).toHaveText('A2');
    await expect(rows.nth(2).locator(CELL_SELECTOR).nth(0)).toHaveText('A3');
  });
});
