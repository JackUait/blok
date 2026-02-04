import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

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

test.describe('table tool', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('rendering', () => {
    test('renders table from saved data', async ({ page }) => {
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

      const table = page.locator(TABLE_SELECTOR);

      await expect(table).toBeVisible();

      const cells = page.locator(CELL_SELECTOR);

      await expect(cells).toHaveCount(4);
      await expect(cells.filter({ hasText: 'A' })).toHaveCount(1);
      await expect(cells.filter({ hasText: 'D' })).toHaveCount(1);
    });

    test('renders table with heading row', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: true,
                content: [['H1', 'H2'], ['D1', 'D2']],
              },
            },
          ],
        },
      });

      const headingRow = page.locator('[data-blok-table-heading]');

      await expect(headingRow).toBeVisible();
    });
  });

  test.describe('data saving', () => {
    test('saves table data correctly', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: true,
                content: [['Name', 'Value'], ['foo', 'bar']],
              },
            },
          ],
        },
      });

      const savedData = await page.evaluate(async () => {
        return window.blokInstance?.save();
      });

      const tableBlock = savedData?.blocks.find((b: { type: string }) => b.type === 'table');

      expect(tableBlock).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(tableBlock?.data.withHeadings).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(tableBlock?.data.content).toStrictEqual([['Name', 'Value'], ['foo', 'bar']]);
    });
  });

  test.describe('editing', () => {
    test('allows editing cell content', async ({ page }) => {
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

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await firstCell.click();
      await page.keyboard.type('Hello');

      const savedData = await page.evaluate(async () => {
        return window.blokInstance?.save();
      });

      const tableBlock = savedData?.blocks.find((b: { type: string }) => b.type === 'table');

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(tableBlock?.data.content[0][0]).toBe('Hello');
    });
  });

  test.describe('keyboard navigation', () => {
    test('tab key navigates between cells', async ({ page }) => {
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

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await firstCell.click();
      await page.keyboard.press('Tab');

      // Second cell should be focused
      const focusedText = await page.evaluate(() => {
        return document.activeElement?.textContent;
      });

      expect(focusedText).toBe('B');
    });

    test('enter key navigates to cell below', async ({ page }) => {
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

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await firstCell.click();
      await page.keyboard.press('Enter');

      const focusedText = await page.evaluate(() => {
        return document.activeElement?.textContent;
      });

      expect(focusedText).toBe('C');
    });
  });

  test.describe('column resize', () => {
    test('dragging resize handle changes only the dragged column width', async ({ page }) => {
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

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first handle
      const handle = page.locator('[data-blok-table-resize]').first();

      await expect(handle).toBeAttached();

      const handleBox = await handle.boundingBox();

      if (!handleBox) {
        throw new Error('Handle not visible');
      }

      const startX = handleBox.x + handleBox.width / 2;
      const startY = handleBox.y + handleBox.height / 2;

      // Get initial second column width
      const initialSecondWidth = await page.evaluate(() => {
        const cells = document.querySelectorAll('[data-blok-table-cell]');

        return (cells[1] as HTMLElement).getBoundingClientRect().width;
      });

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 100, startY, { steps: 5 });
      await page.mouse.up();

      // Second column should be unchanged
      const finalSecondWidth = await page.evaluate(() => {
        const cells = document.querySelectorAll('[data-blok-table-cell]');

        return (cells[1] as HTMLElement).getBoundingClientRect().width;
      });

      expect(Math.abs(finalSecondWidth - initialSecondWidth)).toBeLessThan(2);
    });

    test('resize handles not present in readOnly mode', async ({ page }) => {
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

      // Toggle readOnly
      await page.evaluate(async () => {
        await window.blokInstance?.readOnly.toggle();
      });

      // After toggle readOnly triggers re-render, handles should be gone
      const handles = page.locator('[data-blok-table-resize]');

      await expect(handles).toHaveCount(0);
    });

    test('column widths persist after save', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [['A', 'B'], ['C', 'D']],
                colWidths: [400, 200],
              },
            },
          ],
        },
      });

      const firstCellWidth = await page.evaluate(() => {
        const cell = document.querySelector('[data-blok-table-cell]') as HTMLElement;

        return cell?.style.width;
      });

      expect(firstCellWidth).toBe('400px');

      const savedData = await page.evaluate(async () => {
        return window.blokInstance?.save();
      });

      const tableBlock = savedData?.blocks.find((b: { type: string }) => b.type === 'table');

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(tableBlock?.data.colWidths).toStrictEqual([400, 200]);
    });

    test('table width changes when column is resized', async ({ page }) => {
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

      const initialTableWidth = await page.evaluate(() => {
        const table = document.querySelector('[data-blok-tool="table"]');
        const grid = table?.firstElementChild as HTMLElement;

        return grid?.getBoundingClientRect().width;
      });

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first handle
      const handle = page.locator('[data-blok-table-resize]').first();
      const handleBox = await handle.boundingBox();

      if (!handleBox) {
        throw new Error('Handle not visible');
      }

      const startX = handleBox.x + handleBox.width / 2;
      const startY = handleBox.y + handleBox.height / 2;

      // Drag left to shrink
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX - 100, startY, { steps: 5 });
      await page.mouse.up();

      const finalTableWidth = await page.evaluate(() => {
        const table = document.querySelector('[data-blok-tool="table"]');
        const grid = table?.firstElementChild as HTMLElement;

        return grid?.getBoundingClientRect().width;
      });

      // Table should be ~100px narrower
      expect(finalTableWidth).toBeLessThan(initialTableWidth - 50);
    });
  });

  test.describe('add row/column controls', () => {
    test('add-row button appears on hover and adds a row when clicked', async ({ page }) => {
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

      const table = page.locator(TABLE_SELECTOR);

      // Hover over the table to reveal controls
      await table.hover();

      const addRowBtn = page.locator('[data-blok-table-add-row]');

      await expect(addRowBtn).toBeVisible();

      await addRowBtn.click();

      // Should now have 3 rows
      const rows = page.locator('[data-blok-table-row]');

      await expect(rows).toHaveCount(3);
    });

    test('add-column button appears on hover and adds a column when clicked', async ({ page }) => {
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

      const table = page.locator(TABLE_SELECTOR);

      await table.hover();

      const addColBtn = page.locator('[data-blok-table-add-col]');

      await expect(addColBtn).toBeVisible();

      await addColBtn.click();

      // First row should now have 3 cells
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first row
      const firstRow = page.locator('[data-blok-table-row]').first();
      const cells = firstRow.locator(CELL_SELECTOR);

      await expect(cells).toHaveCount(3);
    });

    test('new row data is saved correctly', async ({ page }) => {
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

      const table = page.locator(TABLE_SELECTOR);

      await table.hover();

      const addRowBtn = page.locator('[data-blok-table-add-row]');

      await addRowBtn.click();

      // Type in the new row's first cell
      // eslint-disable-next-line playwright/no-nth-methods -- nth(2) + first() needed to target the newly added row's first cell
      const newCell = page.locator('[data-blok-table-row]').nth(2).locator(CELL_SELECTOR).first();

      await newCell.click();
      await page.keyboard.type('New');

      const savedData = await page.evaluate(async () => {
        return window.blokInstance?.save();
      });

      const tableBlock = savedData?.blocks.find((b: { type: string }) => b.type === 'table');

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(tableBlock?.data.content).toHaveLength(3);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(tableBlock?.data.content[2][0]).toBe('New');
    });

    test('add controls are not present in readOnly mode', async ({ page }) => {
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

      // Toggle readOnly
      await page.evaluate(async () => {
        await window.blokInstance?.readOnly.toggle();
      });

      const addRowBtn = page.locator('[data-blok-table-add-row]');
      const addColBtn = page.locator('[data-blok-table-add-col]');

      await expect(addRowBtn).toHaveCount(0);
      await expect(addColBtn).toHaveCount(0);
    });
  });
});
