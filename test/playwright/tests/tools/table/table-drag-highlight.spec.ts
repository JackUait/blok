// spec: Drag Reorder Selection Highlighting
// seed: test/playwright/tests/tools/table.spec.ts

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

/**
 * Returns a locator for a specific cell in the table grid.
 */
const getCell = (page: Page, row: number, col: number): ReturnType<Page['locator']> =>
  page.locator(`${TABLE_SELECTOR} >> [data-blok-table-row] >> nth=${row}`)
    .locator(`[data-blok-table-cell] >> nth=${col}`);

test.describe('Drag Reorder Selection Highlighting', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('after drag-reordering a row, the moved row receives cell selection highlighting', async ({ page }) => {
    // 1. Init editor with 3x2 table with content ['R1C1','R1C2','R2C1','R2C2','R3C1','R3C2']
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['R1C1', 'R1C2'], ['R2C1', 'R2C2'], ['R3C1', 'R3C2']],
            },
          },
        ],
      },
    });

    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // 2. Click first cell's contenteditable to show row grip
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get the first cell
    await page.locator(CELL_SELECTOR).first().locator('[contenteditable="true"]').first().click();

    // Wait for row grip to become visible
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get the first visible grip
    const rowGrip = page.locator(ROW_GRIP_SELECTOR).first();

    await expect(rowGrip).toBeVisible({ timeout: 2000 });

    // 3. Get bounding boxes for grip and target row using assertBoundingBox
    const gripBox = assertBoundingBox(await rowGrip.boundingBox(), 'Row grip');
    const row1Cell = getCell(page, 1, 0);
    const row1Box = assertBoundingBox(await row1Cell.boundingBox(), 'Row 1 first cell');

    // 4. Press and hold row grip, drag down past second row, release
    await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      gripBox.x + gripBox.width / 2,
      row1Box.y + row1Box.height + 10,
      { steps: 10 }
    );
    await page.mouse.up();

    // 5. Verify content was reordered: row 0 should now contain R2C1, row 1 should contain R1C1
    await expect(getCell(page, 0, 0)).toContainText('R2C1');
    await expect(getCell(page, 1, 0)).toContainText('R1C1');

    // 6. Verify all cells in the moved row's new position (row 1) have data-blok-table-cell-selected attribute
    await expect(getCell(page, 1, 0)).toHaveAttribute('data-blok-table-cell-selected', '');
    await expect(getCell(page, 1, 1)).toHaveAttribute('data-blok-table-cell-selected', '');

    // Verify cells in other rows are not selected
    await expect(getCell(page, 0, 0)).not.toHaveAttribute('data-blok-table-cell-selected');
    await expect(getCell(page, 0, 1)).not.toHaveAttribute('data-blok-table-cell-selected');
    await expect(getCell(page, 2, 0)).not.toHaveAttribute('data-blok-table-cell-selected');
    await expect(getCell(page, 2, 1)).not.toHaveAttribute('data-blok-table-cell-selected');
  });

  test('after drag-reordering a column, the moved column receives cell selection highlighting', async ({ page }) => {
    // 1. Init editor with 2x3 table with content ['A','B','C','D','E','F']
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

    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // 2. Click first cell's contenteditable to show column grip for col 0
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get the first cell
    await page.locator(CELL_SELECTOR).first().locator('[contenteditable="true"]').first().click();

    // Wait for column grip to become visible
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get the first visible grip
    const colGrip = page.locator(COL_GRIP_SELECTOR).first();

    await expect(colGrip).toBeVisible({ timeout: 2000 });

    // 3. Get bounding boxes for grip and target column using assertBoundingBox
    const gripBox = assertBoundingBox(await colGrip.boundingBox(), 'Column grip');
    const col1Cell = getCell(page, 0, 1);
    const col1Box = assertBoundingBox(await col1Cell.boundingBox(), 'Column 1 first cell');

    // 4. Show column grip for col 0, drag right past col 1, release
    await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      col1Box.x + col1Box.width + 10,
      gripBox.y + gripBox.height / 2,
      { steps: 10 }
    );
    await page.mouse.up();

    // 5. Verify content was reordered: col 0 should now contain B, col 1 should contain A
    await expect(getCell(page, 0, 0)).toContainText('B');
    await expect(getCell(page, 0, 1)).toContainText('A');

    // 6. Verify all cells in the moved column's new position (col 1) have data-blok-table-cell-selected attribute
    await expect(getCell(page, 0, 1)).toHaveAttribute('data-blok-table-cell-selected', '');
    await expect(getCell(page, 1, 1)).toHaveAttribute('data-blok-table-cell-selected', '');

    // Verify cells in other columns are not selected
    await expect(getCell(page, 0, 0)).not.toHaveAttribute('data-blok-table-cell-selected');
    await expect(getCell(page, 1, 0)).not.toHaveAttribute('data-blok-table-cell-selected');
    await expect(getCell(page, 0, 2)).not.toHaveAttribute('data-blok-table-cell-selected');
    await expect(getCell(page, 1, 2)).not.toHaveAttribute('data-blok-table-cell-selected');
  });
});
