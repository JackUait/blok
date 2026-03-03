// spec: Table Block Escape — Adding Blocks Below Tables
// seed: test/playwright/tests/tools/table/table-keyboard-nav-edges.spec.ts

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

const getCell = (page: Page, row: number, col: number): ReturnType<Page['locator']> =>
  page.locator(`${TABLE_SELECTOR} >> [data-blok-table-row] >> nth=${row}`)
    .locator(`${CELL_SELECTOR} >> nth=${col}`);

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
      const blokConfig: Record<string, unknown> = { holder };

      if (initialData) { blokConfig.data = initialData; }

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

          if (!toolClass) { throw new Error(`Tool "${name}" is not available globally`); }

          return { ...accumulator, [name]: { class: toolClass, ...config } };
        }, {});

        blokConfig.tools = resolvedTools;
      }

      const blok = new window.Blok(blokConfig);

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, data, serializedTools },
  );
};

const defaultTools: Record<string, SerializableToolConfig> = {
  table: { className: 'Blok.Table' },
};

/**
 * Checks if activeElement is outside any table cell.
 */
const isFocusOutsideTable = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const active = document.activeElement;

    if (!active) { return false; }

    return active.closest('[data-blok-table-cell]') === null;
  });

test.describe('Table Block Escape — Adding Blocks Below Tables', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('Tab at the last cell creates a new block below the table and focuses it', async ({ page }) => {
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: { withHeadings: false, content: [['A', 'B'], ['C', 'D']] },
          },
        ],
      },
    });

    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to access the first editable
    await getCellEditable(page, 1, 1).first().click();
    await page.keyboard.press('Tab');

    const outsideTable = await isFocusOutsideTable(page);

    expect(outsideTable).toBe(true);

    // Verify the new block is editable
    await page.keyboard.type('After table');

    const newParagraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"]`);

    await expect(newParagraph.filter({ hasText: 'After table' })).toHaveCount(1);
  });

  test('Tab at the last cell focuses existing block below table when one exists', async ({ page }) => {
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: { withHeadings: false, content: [['A', 'B'], ['C', 'D']] },
          },
          {
            type: 'paragraph',
            data: { text: 'Existing paragraph' },
          },
        ],
      },
    });

    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to access the first editable
    await getCellEditable(page, 1, 1).first().click();
    await page.keyboard.press('Tab');

    const outsideTable = await isFocusOutsideTable(page);

    expect(outsideTable).toBe(true);
  });

  test('Shift+Tab at the first cell moves focus to the block above the table', async ({ page }) => {
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
            data: { withHeadings: false, content: [['A', 'B'], ['C', 'D']] },
          },
        ],
      },
    });

    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to access the first editable
    await getCellEditable(page, 0, 0).first().click();
    await page.keyboard.press('Shift+Tab');

    const outsideTable = await isFocusOutsideTable(page);

    expect(outsideTable).toBe(true);
  });

  test('Shift+Tab at the first cell does nothing when table is the first block', async ({ page }) => {
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: { withHeadings: false, content: [['A', 'B'], ['C', 'D']] },
          },
        ],
      },
    });

    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to access the first editable
    await getCellEditable(page, 0, 0).first().click();
    await page.keyboard.press('Shift+Tab');

    // Focus stays inside the table (no block above to go to)
    const focusedCellIndex = await page.evaluate(() => {
      const active = document.activeElement;

      if (!active) { return -1; }

      const cell = active.closest('[data-blok-table-cell]');

      if (!cell) { return -2; }

      return Array.from(document.querySelectorAll('[data-blok-table-cell]')).indexOf(cell);
    });

    expect(focusedCellIndex).toBe(0);
  });

  test('ArrowDown from last row exits table to block below', async ({ page }) => {
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: { withHeadings: false, content: [['A', 'B'], ['C', 'D']] },
          },
          {
            type: 'paragraph',
            data: { text: 'After table' },
          },
        ],
      },
    });

    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to access the first editable
    await getCellEditable(page, 1, 1).first().click();
    await page.keyboard.press('ArrowDown');

    const outsideTable = await isFocusOutsideTable(page);

    expect(outsideTable).toBe(true);
  });

  test('ArrowDown from last row of last block creates new block', async ({ page }) => {
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: { withHeadings: false, content: [['A', 'B'], ['C', 'D']] },
          },
        ],
      },
    });

    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to access the first editable
    await getCellEditable(page, 1, 1).first().click();
    await page.keyboard.press('ArrowDown');

    const outsideTable = await isFocusOutsideTable(page);

    expect(outsideTable).toBe(true);

    await page.keyboard.type('New block');

    const newParagraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"]`);

    await expect(newParagraph.filter({ hasText: 'New block' })).toHaveCount(1);
  });

  test('clicking below table in pseudo-element overlap zone creates a new block', async ({ page }) => {
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: { withHeadings: false, content: [['A', 'B'], ['C', 'D']] },
          },
        ],
      },
    });

    const tableWrapper = page.locator(TABLE_SELECTOR);

    await expect(tableWrapper).toBeVisible();

    const tableBox = await tableWrapper.boundingBox();

    expect(tableBox).not.toBeNull();

    const box = tableBox as NonNullable<typeof tableBox>;

    // Click 20px below the table's bottom edge (inside the 40px pseudo-element zone)
    await page.mouse.click(
      box.x + box.width / 2,
      box.y + box.height + 20
    );

    const outsideTable = await isFocusOutsideTable(page);

    expect(outsideTable).toBe(true);
  });

  test('plus button remains visible when editing inside a table cell', async ({ page }) => {
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: { withHeadings: false, content: [['A', 'B'], ['C', 'D']] },
          },
        ],
      },
    });

    const tableWrapper = page.locator(TABLE_SELECTOR);

    await tableWrapper.hover();

    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to access the first editable
    await getCellEditable(page, 0, 0).first().click();

    const plusButton = page.locator('[data-blok-testid="plus-button"]');

    await expect(plusButton).toBeVisible();
  });
});
