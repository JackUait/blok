// spec: Combined Heading Row and Column
// seed: test/playwright/tests/tools/table/table-rendering.spec.ts

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;
const CELL_SELECTOR = '[data-blok-table-cell]';
const ROW_SELECTOR = '[data-blok-table-row]';

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

test.describe('Combined Heading Row and Column', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('table with both heading row and heading column applies both styling attributes simultaneously', async ({ page }) => {
    // 1. Init editor with table data: withHeadings:true, withHeadingColumn:true, content 3x3
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: true,
              withHeadingColumn: true,
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

    // 2. Wait for the table to be visible
    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // 3. Verify row 0 has data-blok-table-heading attribute (heading row)
    const rows = table.locator(ROW_SELECTOR);

    await expect(rows).toHaveCount(3);

    const firstRow = rows.nth(0);

    await expect(firstRow).toHaveAttribute('data-blok-table-heading', '');

    // 4. Verify first cell of every row has data-blok-table-heading-col attribute (3 cells total)
    const headingColCells = table.locator('[data-blok-table-heading-col]');

    await expect(headingColCells).toHaveCount(3);

    // Verify each row's first cell has the heading-col attribute
    const firstRowFirstCell = firstRow.locator(CELL_SELECTOR).nth(0);
    const secondRowFirstCell = rows.nth(1).locator(CELL_SELECTOR).nth(0);
    const thirdRowFirstCell = rows.nth(2).locator(CELL_SELECTOR).nth(0);

    await expect(firstRowFirstCell).toHaveAttribute('data-blok-table-heading-col', '');
    await expect(secondRowFirstCell).toHaveAttribute('data-blok-table-heading-col', '');
    await expect(thirdRowFirstCell).toHaveAttribute('data-blok-table-heading-col', '');

    // 5. Verify top-left cell has BOTH attributes: parent row has data-blok-table-heading
    //    AND the cell itself has data-blok-table-heading-col
    await expect(firstRow).toHaveAttribute('data-blok-table-heading', '');
    await expect(firstRowFirstCell).toHaveAttribute('data-blok-table-heading-col', '');

    // 6. Verify non-heading cells (not in row 0, not in first column) have neither attribute
    // Row 1, Col 1 (second row, second column) is an interior non-heading cell
    const interiorCell = rows.nth(1).locator(CELL_SELECTOR).nth(1);

    await expect(interiorCell).not.toHaveAttribute('data-blok-table-heading-col');

    // Row 2, Col 2 (third row, third column) is also an interior non-heading cell
    const anotherInteriorCell = rows.nth(2).locator(CELL_SELECTOR).nth(2);

    await expect(anotherInteriorCell).not.toHaveAttribute('data-blok-table-heading-col');

    // The non-heading rows themselves should not have the heading row attribute
    await expect(rows.nth(1)).not.toHaveAttribute('data-blok-table-heading');
    await expect(rows.nth(2)).not.toHaveAttribute('data-blok-table-heading');
  });
});
