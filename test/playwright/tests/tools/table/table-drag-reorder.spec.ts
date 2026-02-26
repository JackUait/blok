// spec: specs/table-tool-test-plan.md (Drag-to-Reorder Rows and Columns)
// seed: test/playwright/tests/tools/table.spec.ts

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;
const COL_GRIP_SELECTOR = '[data-blok-table-grip-col]';
const ROW_GRIP_SELECTOR = '[data-blok-table-grip-row]';
const ADD_ROW_SELECTOR = '[data-blok-table-add-row]';
const ADD_COL_SELECTOR = '[data-blok-table-add-col]';

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

test.describe('Drag-to-Reorder Rows and Columns', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('Dragging a row grip reorders rows', async ({ page }) => {
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

    // Click first cell to reveal grips
    const firstCell = getCell(page, 0, 0);

    await firstCell.click();

    // Wait for row grip to appear
    // eslint-disable-next-line playwright/no-nth-methods -- first() needed to get the first row grip
    const rowGrip = page.locator(ROW_GRIP_SELECTOR).first();

    await expect(rowGrip).toBeVisible({ timeout: 2000 });

    // Get bounding boxes for drag
    const gripBox = assertBoundingBox(await rowGrip.boundingBox(), 'Row grip');
    const row1Cell = getCell(page, 1, 0);
    const row1Box = assertBoundingBox(await row1Cell.boundingBox(), 'Row 1 cell');

    // Drag row 0 grip down past row 1
    await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      gripBox.x + gripBox.width / 2,
      row1Box.y + row1Box.height + 10,
      { steps: 10 }
    );
    await page.mouse.up();

    // After drag, R1C1 should have moved to row 1 position
    // Row 0 should now contain R2C1 content
    const cellAtRow0 = getCell(page, 0, 0);

    await expect(cellAtRow0).toContainText('R2C1');

    const cellAtRow1 = getCell(page, 1, 0);

    await expect(cellAtRow1).toContainText('R1C1');
  });

  test('Dragging a column grip reorders columns', async ({ page }) => {
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

    // Click first cell to reveal grips
    const firstCell = getCell(page, 0, 0);

    await firstCell.click();

    // Wait for column grip to appear
    // eslint-disable-next-line playwright/no-nth-methods -- first() needed to get the first column grip
    const colGrip = page.locator(COL_GRIP_SELECTOR).first();

    await expect(colGrip).toBeVisible({ timeout: 2000 });

    // Get bounding boxes for drag
    const gripBox = assertBoundingBox(await colGrip.boundingBox(), 'Column grip');
    const col1Cell = getCell(page, 0, 1);
    const col1Box = assertBoundingBox(await col1Cell.boundingBox(), 'Column 1 cell');

    // Drag column 0 grip right past column 1
    await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      col1Box.x + col1Box.width + 10,
      gripBox.y + gripBox.height / 2,
      { steps: 10 }
    );
    await page.mouse.up();

    // After drag, columns should be swapped
    // Row 0: B, A instead of A, B
    const cellAt00 = getCell(page, 0, 0);

    await expect(cellAt00).toContainText('B');

    const cellAt01 = getCell(page, 0, 1);

    await expect(cellAt01).toContainText('A');
  });

  test('Add controls are hidden during grip drag', async ({ page }) => {
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

    // Click first cell to show grips
    const firstCell = getCell(page, 0, 0);

    await firstCell.click();

    // eslint-disable-next-line playwright/no-nth-methods -- first() needed to get the first row grip
    const rowGrip = page.locator(ROW_GRIP_SELECTOR).first();

    await expect(rowGrip).toBeVisible({ timeout: 2000 });

    const gripBox = assertBoundingBox(await rowGrip.boundingBox(), 'Row grip');

    // Start dragging
    await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      gripBox.x + gripBox.width / 2,
      gripBox.y + gripBox.height / 2 + 50,
      { steps: 5 }
    );

    // While dragging, add controls should not be visible (either hidden or removed from DOM)
    await expect(page.locator(ADD_ROW_SELECTOR)).not.toBeVisible();
    await expect(page.locator(ADD_COL_SELECTOR)).not.toBeVisible();

    await page.mouse.up();
  });

  test('Resize is disabled during grip drag', async ({ page }) => {
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['A', 'B'], ['C', 'D']],
              colWidths: [200, 200],
            },
          },
        ],
      },
    });

    // Get initial column width
    const initialWidth = await page.evaluate(() => {
      const cell = document.querySelector('[data-blok-table-cell]');

      return cell ? (cell as HTMLElement).getBoundingClientRect().width : 0;
    });

    // Click first cell to show grips
    const firstCell = getCell(page, 0, 0);

    await firstCell.click();

    // eslint-disable-next-line playwright/no-nth-methods -- first() needed to get the first row grip
    const rowGrip = page.locator(ROW_GRIP_SELECTOR).first();

    await expect(rowGrip).toBeVisible({ timeout: 2000 });

    const gripBox = assertBoundingBox(await rowGrip.boundingBox(), 'Row grip');

    // Start a grip drag
    await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      gripBox.x + gripBox.width / 2,
      gripBox.y + gripBox.height / 2 + 30,
      { steps: 5 }
    );
    await page.mouse.up();

    // Verify column widths are unchanged after drag
    const finalWidth = await page.evaluate(() => {
      const cell = document.querySelector('[data-blok-table-cell]');

      return cell ? (cell as HTMLElement).getBoundingClientRect().width : 0;
    });

    expect(finalWidth).toBeCloseTo(initialWidth, 0);
  });
});
