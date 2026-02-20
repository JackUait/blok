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

/**
 * Returns a locator for a specific cell in the table grid.
 * Row and col are 0-based indices.
 */
const getCell = (page: Page, row: number, col: number): ReturnType<Page['locator']> =>
  page.locator(`${TABLE_SELECTOR} >> [data-blok-table-row] >> nth=${row}`)
    .locator(`${CELL_SELECTOR} >> nth=${col}`);

/**
 * Returns a locator for the editable area inside a specific cell.
 */
const getCellEditable = (page: Page, row: number, col: number): ReturnType<Page['locator']> =>
  getCell(page, row, col).locator('[contenteditable="true"]');

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

test.describe('Keyboard Navigation', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('Tab key moves focus to the next cell in the same row', async ({ page }) => {
    // 1. Initialize editor with a 2x2 table containing ['A','B','C','D']
    await createTable2x2(page);

    // 2. Click the first cell's contenteditable area
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
    await getCellEditable(page, 0, 0).first().click();

    // 3. Press Tab
    await page.keyboard.press('Tab');

    // Verify focus moves to the second cell (B) — document.activeElement is inside the second cell
    const focusedCellIndex = await page.evaluate(() => {
      const activeEl = document.activeElement;

      if (!activeEl) {
        return -1;
      }

      const cell = activeEl.closest('[data-blok-table-cell]');

      if (!cell) {
        return -1;
      }

      const allCells = Array.from(document.querySelectorAll('[data-blok-table-cell]'));

      return allCells.indexOf(cell);
    });

    // Index 1 = second cell (B)
    expect(focusedCellIndex).toBe(1);
  });

  test('Tab at the last column wraps focus to the first cell of the next row', async ({ page }) => {
    // 1. Initialize editor with a 2x2 table
    await createTable2x2(page);

    // 2. Click the last cell in the first row (row 0, col 1)
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to access the first editable
    await getCellEditable(page, 0, 1).first().click();

    // 3. Press Tab
    await page.keyboard.press('Tab');

    // Verify focus moves to the first cell of the second row (index 2 in flat cell list)
    const focusedCellIndex = await page.evaluate(() => {
      const activeEl = document.activeElement;

      if (!activeEl) {
        return -1;
      }

      const cell = activeEl.closest('[data-blok-table-cell]');

      if (!cell) {
        return -1;
      }

      const allCells = Array.from(document.querySelectorAll('[data-blok-table-cell]'));

      return allCells.indexOf(cell);
    });

    // Index 2 = first cell of row 2 (C)
    expect(focusedCellIndex).toBe(2);
  });

  test('Tab at the very last cell of the table does nothing (no wrap to start)', async ({ page }) => {
    // 1. Initialize editor with a 2x2 table
    await createTable2x2(page);

    // 2. Click the last cell (row 1, col 1)
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to access the first editable
    await getCellEditable(page, 1, 1).first().click();

    // 3. Press Tab
    await page.keyboard.press('Tab');

    // Verify focus does not jump outside the table or wrap back to the first cell
    const focusedCellIndex = await page.evaluate(() => {
      const activeEl = document.activeElement;

      if (!activeEl) {
        return -1;
      }

      const cell = activeEl.closest('[data-blok-table-cell]');

      if (!cell) {
        // Focus may have left the table entirely — return special sentinel
        return -2;
      }

      const allCells = Array.from(document.querySelectorAll('[data-blok-table-cell]'));

      return allCells.indexOf(cell);
    });

    // Focus should NOT be at index 0 (first cell / wrap-around) and NOT outside the table (-2)
    expect(focusedCellIndex).not.toBe(0);
    expect(focusedCellIndex).not.toBe(-2);
  });

  test('Shift+Tab moves focus to the previous cell', async ({ page }) => {
    // 1. Initialize editor with a 2x2 table
    await createTable2x2(page);

    // 2. Click the second cell (row 0, col 1)
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to access the first editable
    await getCellEditable(page, 0, 1).first().click();

    // 3. Press Shift+Tab
    await page.keyboard.press('Shift+Tab');

    // Verify focus moves back to the first cell (row 0, col 0)
    const focusedCellIndex = await page.evaluate(() => {
      const activeEl = document.activeElement;

      if (!activeEl) {
        return -1;
      }

      const cell = activeEl.closest('[data-blok-table-cell]');

      if (!cell) {
        return -1;
      }

      const allCells = Array.from(document.querySelectorAll('[data-blok-table-cell]'));

      return allCells.indexOf(cell);
    });

    // Index 0 = first cell (A)
    expect(focusedCellIndex).toBe(0);
  });

  test('Shift+Tab at the first column wraps focus to the last cell of the previous row', async ({ page }) => {
    // 1. Initialize editor with a 2x2 table
    await createTable2x2(page);

    // 2. Click the first cell of the second row (row 1, col 0)
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to access the first editable
    await getCellEditable(page, 1, 0).first().click();

    // 3. Press Shift+Tab
    await page.keyboard.press('Shift+Tab');

    // Verify focus moves to the last cell of the first row (row 0, col 1 → index 1)
    const focusedCellIndex = await page.evaluate(() => {
      const activeEl = document.activeElement;

      if (!activeEl) {
        return -1;
      }

      const cell = activeEl.closest('[data-blok-table-cell]');

      if (!cell) {
        return -1;
      }

      const allCells = Array.from(document.querySelectorAll('[data-blok-table-cell]'));

      return allCells.indexOf(cell);
    });

    // Index 1 = last cell of first row (B)
    expect(focusedCellIndex).toBe(1);
  });
});
