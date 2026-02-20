// spec: specs/table-tool-test-plan.md
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
 * Replaces conditional guards (`if (!box) throw`) to satisfy playwright/no-conditional-in-test.
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
 * The add-col button uses proximity-based visibility (within 40px of the right edge).
 */
const hoverNearRightEdge = async (
  page: Page,
  tableLocator: ReturnType<Page['locator']>
): Promise<void> => {
  const tableBox = assertBoundingBox(await tableLocator.boundingBox(), 'Table for right-edge hover');

  await page.mouse.move(
    tableBox.x + tableBox.width - 10,
    tableBox.y + tableBox.height / 2
  );
};

/**
 * Hover near the bottom edge of the table so the add-row button becomes visible.
 * The add-row button uses proximity-based visibility (within 40px of the bottom edge).
 */
const hoverNearBottomEdge = async (
  page: Page,
  tableLocator: ReturnType<Page['locator']>
): Promise<void> => {
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
            // Handle dot notation (e.g., 'Blok.Header')
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

test.describe('Add Row and Column Controls', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('Add-row button becomes visible on hover near the bottom edge', async ({ page }) => {
    // 1. Initialize editor with a 2x2 table
    await createTable2x2(page);

    const table = page.locator(TABLE_SELECTOR);

    // 2. Hover within 40px of bottom edge to trigger proximity-based add-row button visibility
    await hoverNearBottomEdge(page, table);

    // 3. Verify data-blok-table-add-row is visible
    const addRowBtn = page.locator('[data-blok-table-add-row]');

    await expect(addRowBtn).toBeVisible();
  });

  test('Clicking the add-row button appends a new empty row', async ({ page }) => {
    // 1. Initialize editor with a 2x2 table
    await createTable2x2(page);

    const table = page.locator(TABLE_SELECTOR);

    // 2. Hover near bottom edge to reveal the add-row button
    await hoverNearBottomEdge(page, table);

    const addRowBtn = page.locator('[data-blok-table-add-row]');

    await expect(addRowBtn).toBeVisible();

    // 3. Click the add-row button
    await addRowBtn.click();

    // 4. Verify a third row is added with empty cells
    const rows = page.locator('[data-blok-table-row]');

    await expect(rows).toHaveCount(3);

    // eslint-disable-next-line playwright/no-nth-methods -- nth(2) is the clearest way to get third row
    const newRow = rows.nth(2);
    const newRowCells = newRow.locator(CELL_SELECTOR);

    await expect(newRowCells).toHaveCount(2);
  });

  test('Add-column button becomes visible on hover near the right edge', async ({ page }) => {
    // 1. Initialize editor with a 2x2 table
    await createTable2x2(page);

    const table = page.locator(TABLE_SELECTOR);

    // 2. Hover within 40px of the right edge to trigger proximity-based add-col button visibility
    await hoverNearRightEdge(page, table);

    // 3. Verify data-blok-table-add-col is visible
    const addColBtn = page.locator('[data-blok-table-add-col]');

    await expect(addColBtn).toBeVisible();
  });

  test('Clicking the add-column button appends a new empty column', async ({ page }) => {
    // 1. Initialize editor with a 2x2 table
    await createTable2x2(page);

    const table = page.locator(TABLE_SELECTOR);

    // 2. Hover near right edge to reveal the add-column button
    await hoverNearRightEdge(page, table);

    const addColBtn = page.locator('[data-blok-table-add-col]');

    await expect(addColBtn).toBeVisible();

    // 3. Click the add-column button
    await addColBtn.click();

    // 4. Verify each row now has 3 cells
    const rows = page.locator('[data-blok-table-row]');

    await expect(rows).toHaveCount(2);

    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first row
    const firstRow = rows.first();

    await expect(firstRow.locator(CELL_SELECTOR)).toHaveCount(3);

    // eslint-disable-next-line playwright/no-nth-methods -- nth(1) is the clearest way to get second row
    const secondRow = rows.nth(1);

    await expect(secondRow.locator(CELL_SELECTOR)).toHaveCount(3);
  });

  test('Dragging the add-row button downward adds multiple rows', async ({ page }) => {
    // 1. Initialize editor with a 2x2 table
    await createTable2x2(page);

    const table = page.locator(TABLE_SELECTOR);

    // 2. Hover near bottom edge to reveal the add-row button
    await hoverNearBottomEdge(page, table);

    const addRowBtn = page.locator('[data-blok-table-add-row]');

    await expect(addRowBtn).toBeVisible();

    const addRowBox = assertBoundingBox(await addRowBtn.boundingBox(), 'Add-row button');
    const startX = addRowBox.x + addRowBox.width / 2;
    const startY = addRowBox.y + addRowBox.height / 2;

    // Measure a row height to know how far to drag
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first row
    const firstRowBox = assertBoundingBox(
      await page.locator('[data-blok-table-row]').first().boundingBox(),
      'First row'
    );
    const rowHeight = firstRowBox.height;

    // 3. Press and hold the pointer on the add-row button, drag downward by two row heights
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY + rowHeight * 2, { steps: 10 });
    await page.mouse.up();

    // 4. Verify two new rows are appended to the table (total 4 rows)
    const rows = page.locator('[data-blok-table-row]');

    await expect(rows).toHaveCount(4);
  });

  test('Dragging the add-column button rightward adds multiple columns', async ({ page }) => {
    // 1. Initialize editor with a 2x2 table
    await createTable2x2(page);

    const table = page.locator(TABLE_SELECTOR);

    // 2. Hover near right edge to reveal the add-column button
    await hoverNearRightEdge(page, table);

    const addColBtn = page.locator('[data-blok-table-add-col]');

    await expect(addColBtn).toBeVisible();

    const addColBox = assertBoundingBox(await addColBtn.boundingBox(), 'Add-col button');
    const startX = addColBox.x + addColBox.width / 2;
    const startY = addColBox.y + addColBox.height / 2;

    // Measure the drag unit size: the implementation uses half the average column width
    // (computeHalfAvgWidth) as the unit, so we must match that to get exactly 2 new columns.
    const unitSize = await page.evaluate(() => {
      const cells = document.querySelectorAll('[data-blok-table-cell]');
      const row = document.querySelector('[data-blok-table-row]');
      const cellsInRow = row ? row.querySelectorAll('[data-blok-table-cell]') : cells;
      let totalWidth = 0;

      for (const cell of cellsInRow) {
        totalWidth += (cell as HTMLElement).offsetWidth;
      }

      return Math.round((totalWidth / cellsInRow.length / 2) * 100) / 100;
    });

    // 3. Press and hold the pointer on the add-column button, drag rightward by two unit sizes
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + unitSize * 2, startY, { steps: 10 });
    await page.mouse.up();

    // 4. Verify two new columns are appended (each row now has 4 cells)
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first row
    const firstRow = page.locator('[data-blok-table-row]').first();

    await expect(firstRow.locator(CELL_SELECTOR)).toHaveCount(4);
  });

  test('Dragging add-column button leftward removes empty columns that were added', async ({ page }) => {
    // 1. Initialize editor with a 2x2 table
    await createTable2x2(page);

    const table = page.locator(TABLE_SELECTOR);

    // 2. Hover near right edge to reveal the add-column button
    await hoverNearRightEdge(page, table);

    const addColBtn = page.locator('[data-blok-table-add-col]');

    await expect(addColBtn).toBeVisible();

    const addColBox = assertBoundingBox(await addColBtn.boundingBox(), 'Add-col button');
    const startX = addColBox.x + addColBox.width / 2;
    const startY = addColBox.y + addColBox.height / 2;

    // Measure a column width to know how far to drag
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
    const firstCellBox = assertBoundingBox(
      await page.locator(CELL_SELECTOR).first().boundingBox(),
      'First cell'
    );
    const colWidth = firstCellBox.width;

    // 3. Drag rightward to add two columns, then drag leftward past original position
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Drag rightward by two column widths to add two columns
    await page.mouse.move(startX + colWidth * 2, startY, { steps: 10 });
    // Drag leftward past the original position to remove the newly added empty columns
    await page.mouse.move(startX - colWidth, startY, { steps: 10 });
    await page.mouse.up();

    // 4. Verify the newly added columns are removed — back to original 2 columns
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first row
    const firstRow = page.locator('[data-blok-table-row]').first();

    await expect(firstRow.locator(CELL_SELECTOR)).toHaveCount(2);
  });

  test('Add controls are absent in read-only mode', async ({ page }) => {
    // 1. Initialize editor with a 2x2 table
    await createTable2x2(page);

    // 2. Toggle read-only mode via readOnly.toggle()
    await page.evaluate(async () => {
      await window.blokInstance?.readOnly.toggle();
    });

    // 3. Verify neither the add-row nor the add-column buttons exist in the DOM
    const addRowBtn = page.locator('[data-blok-table-add-row]');
    const addColBtn = page.locator('[data-blok-table-add-col]');

    await expect(addRowBtn).toHaveCount(0);
    await expect(addColBtn).toHaveCount(0);
  });

  test('New row data is saved and editable', async ({ page }) => {
    // 1. Initialize editor with a 2x2 table
    await createTable2x2(page);

    const table = page.locator(TABLE_SELECTOR);

    // 2. Hover near bottom edge and click the add-row button
    await hoverNearBottomEdge(page, table);

    const addRowBtn = page.locator('[data-blok-table-add-row]');

    await expect(addRowBtn).toBeVisible();
    await addRowBtn.click();

    // 3. Click into the first cell of the new row and type 'NewContent'
    await page.evaluate(() => {
      const rows = document.querySelectorAll('[data-blok-table-row]');
      const newRow = rows[2];
      const cell = newRow.querySelector('[data-blok-table-cell]');
      const editable = cell?.querySelector('[contenteditable="true"]') as HTMLElement | null;

      editable?.focus();
      editable?.click();
    });
    await page.keyboard.type('NewContent');

    // 4. Call save() and verify saved output
    const savedData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    const tableBlock = savedData?.blocks.find((b: { type: string }) => b.type === 'table');

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const content = tableBlock?.data.content as { blocks: string[] }[][];

    // 5. Verify saved data content array has 3 rows
    expect(content).toHaveLength(3);

    // Third row's first cell should reference a paragraph block
    const newCellBlockId = content[2][0].blocks[0];

    expect(newCellBlockId).toBeDefined();

    // Find the paragraph block and verify it contains 'NewContent'
    const cellParagraph = savedData?.blocks.find(
      (b: { id?: string }) => b.id === newCellBlockId
    );

    expect((cellParagraph as { data: { text: string } })?.data.text).toBe('NewContent');
  });
});
