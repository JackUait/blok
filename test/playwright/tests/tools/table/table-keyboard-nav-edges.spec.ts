// spec: Keyboard Navigation Edge Cases
// seed: test/playwright/tests/tools/table/table-keyboard-nav.spec.ts

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

/**
 * Evaluates the index of the currently focused cell within the flat list of all table cells.
 * Returns -1 if no activeElement, -2 if activeElement is outside the table.
 */
const getFocusedCellIndex = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const activeEl = document.activeElement;

    if (!activeEl) {
      return -1;
    }

    const cell = activeEl.closest('[data-blok-table-cell]');

    if (!cell) {
      return -2;
    }

    const allCells = Array.from(document.querySelectorAll('[data-blok-table-cell]'));

    return allCells.indexOf(cell);
  });

test.describe('Keyboard Navigation Edge Cases', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('Tab at the very last cell does not move focus outside the table', async ({ page }) => {
    // 1. Initialize editor with a 2x2 table and a paragraph block after it
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
          {
            type: 'paragraph',
            data: { text: 'After table' },
          },
        ],
      },
    });

    // 2. Click the last cell (row 1, col 1)
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to access the first editable
    await getCellEditable(page, 1, 1).first().click();

    // 3. Press Tab
    await page.keyboard.press('Tab');

    // Verify focus does not escape the table - activeElement must still be inside a table cell
    const focusedCellIndex = await getFocusedCellIndex(page);

    // -2 means focus left the table entirely (e.g., moved to the paragraph block)
    expect(focusedCellIndex).not.toBe(-2);
    // -1 means no activeElement at all
    expect(focusedCellIndex).not.toBe(-1);
  });

  test('Shift+Tab at the very first cell does not move focus outside the table', async ({ page }) => {
    // 1. Initialize editor with a paragraph block before a 2x2 table
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: { text: 'Before table' },
          },
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

    // 2. Click the first cell (row 0, col 0)
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to access the first editable
    await getCellEditable(page, 0, 0).first().click();

    // 3. Press Shift+Tab
    await page.keyboard.press('Shift+Tab');

    // Verify focus does not escape the table - activeElement must still be inside a table cell
    const focusedCellIndex = await getFocusedCellIndex(page);

    // -2 means focus left the table entirely (e.g., moved to the paragraph block before)
    expect(focusedCellIndex).not.toBe(-2);
    // -1 means no activeElement at all
    expect(focusedCellIndex).not.toBe(-1);
  });

  test('Enter key creates a new block within the cell, not a new row', async ({ page }) => {
    // 1. Initialize editor with a 2x2 table
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['', ''], ['', '']],
            },
          },
        ],
      },
    });

    // 2. Click the first cell's contenteditable area
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to access the first editable
    await getCellEditable(page, 0, 0).first().click();

    // 3. Type 'Line one'
    await page.keyboard.type('Line one');

    // 4. Press Enter
    await page.keyboard.press('Enter');

    // 5. Type 'Line two'
    await page.keyboard.type('Line two');

    // Verify: still only 2 rows total — Enter must NOT have added a new row
    await expect(page.locator('[data-blok-table-row]')).toHaveCount(2);

    // Verify both lines appear inside the first cell
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
    const firstCell = page.locator(CELL_SELECTOR).first();

    await expect(firstCell).toContainText('Line one');
    await expect(firstCell).toContainText('Line two');

    // Verify focus remains in the first cell (index 0)
    const focusedCellIndex = await getFocusedCellIndex(page);

    expect(focusedCellIndex).toBe(0);
  });

  test('Backspace at start of first block in cell does not delete or merge cells', async ({ page }) => {
    const errors: string[] = [];

    page.on('pageerror', (err) => errors.push(err.message));

    // 1. Initialize editor with a 2x2 table with content ['A','B','C','D']
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

    // 2. Click the first cell's contenteditable area
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to access the first editable
    await getCellEditable(page, 0, 0).first().click();

    // 3. Move cursor to the very start of the cell content (Home key)
    await page.keyboard.press('Home');

    // 4. Press Backspace at the start of the first block
    await page.keyboard.press('Backspace');

    // Verify: still 2 rows — Backspace must NOT have removed a row
    await expect(page.locator('[data-blok-table-row]')).toHaveCount(2);

    // Verify: still 2 cols per row — cells must not have been merged
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first row
    const firstRow = page.locator('[data-blok-table-row]').first();

    await expect(firstRow.locator(CELL_SELECTOR)).toHaveCount(2);

    // Verify: table is still visible and functional
    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // Verify: no JS errors occurred
    expect(errors).toHaveLength(0);
  });
});
