// spec: Edge Cases and Error Handling
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

/**
 * Dispatch a paste event with HTML clipboard data on the given element selector.
 */
const pasteHtml = async (page: Page, selector: string, html: string): Promise<void> => {
  await page.evaluate(
    ({ sel, pasteHtml: htmlContent }) => {
      const element = document.querySelector(sel);

      if (!element) {
        throw new Error(`Element not found for selector: ${sel}`);
      }

      const pasteEvent = Object.assign(
        new Event('paste', { bubbles: true, cancelable: true }),
        {
          clipboardData: {
            getData: (type: string): string => (type === 'text/html' ? htmlContent : ''),
            types: ['text/html'],
          },
        }
      );

      element.dispatchEvent(pasteEvent);
    },
    { sel: selector, pasteHtml: html }
  );
};

const defaultTools: Record<string, SerializableToolConfig> = {
  table: {
    className: 'Blok.Table',
  },
};

test.describe('Edge Cases and Error Handling', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('Deleting the only column leaves the table in a clean state', async ({ page }) => {
    const errors: string[] = [];

    page.on('pageerror', (err) => errors.push(err.message));

    // 16.1: Initialize 2x1 table (2 rows, 1 column), delete column 0 via grip
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['A'], ['B']],
            },
          },
        ],
      },
    });

    // Click the first cell to show grips
    const firstCell = page.locator(`${CELL_SELECTOR} >> nth=0`);

    await firstCell.click();

    const colGrip = page.locator(`${COL_GRIP_SELECTOR} >> nth=0`);

    await expect(colGrip).toBeVisible({ timeout: 2000 });
    await colGrip.click({ force: true });

    // Delete the only column
    await page.getByText('Delete').first().click({ force: true });

    // Verify no JS errors occurred
    expect(errors).toHaveLength(0);

    // Verify save() doesn't crash — it should resolve without throwing
    const savedData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    expect(savedData).toBeDefined();
  });

  test('Deleting the only row leaves the table in a clean state', async ({ page }) => {
    const errors: string[] = [];

    page.on('pageerror', (err) => errors.push(err.message));

    // 16.2: Initialize 1x2 table (1 row, 2 columns), delete row 0 via grip
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['A', 'B']],
            },
          },
        ],
      },
    });

    // Click the first cell to show grips
    const firstCell = page.locator(`${CELL_SELECTOR} >> nth=0`);

    await firstCell.click();

    const rowGrip = page.locator(`${ROW_GRIP_SELECTOR} >> nth=0`);

    await expect(rowGrip).toBeVisible({ timeout: 2000 });
    await rowGrip.click({ force: true });

    // Delete the only row
    await page.getByText('Delete').first().click({ force: true });

    // Verify no JS errors occurred
    expect(errors).toHaveLength(0);
  });

  test('Destroy and reinitialize produces a clean state with no orphaned DOM', async ({ page }) => {
    // 16.3: Initialize 2x2 table, type content, call destroy(), reinitialize fresh
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

    // Type content into first cell to make sure state is active
    const firstCellEditable = page.locator(`${CELL_SELECTOR} >> nth=0`).locator('[contenteditable="true"] >> nth=0');

    await firstCellEditable.click();
    await page.keyboard.type('Typed');

    // Destroy the instance
    await page.evaluate(async () => {
      await window.blokInstance?.destroy();
      window.blokInstance = undefined;
    });

    // Reinitialize fresh (no data)
    await createBlok(page, {
      tools: defaultTools,
    });

    // Verify the editor is now clean — no table tool from previous instance
    await expect(page.locator(TABLE_SELECTOR)).toHaveCount(0);

    // Verify no orphaned table cells remain
    await expect(page.locator(CELL_SELECTOR)).toHaveCount(0);

    // Verify the editor holder exists and is functional
    const holder = page.locator(`[data-blok-testid="${HOLDER_ID}"]`);

    await expect(holder).toBeVisible();
  });

  test('Inserting column right twice consecutively results in 5 columns with functional grips', async ({ page }) => {
    // 16.4: Initialize 3x3 table, insert column right twice consecutively via grips
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [
                ['A1', 'A2', 'A3'],
                ['B1', 'B2', 'B3'],
                ['C1', 'C2', 'C3'],
              ],
            },
          },
        ],
      },
    });

    // Click first cell to activate grips
    const firstCell = page.locator(`${CELL_SELECTOR} >> nth=0`);

    await firstCell.click();

    const colGrip = page.locator(`${COL_GRIP_SELECTOR} >> nth=0`);

    await expect(colGrip).toBeVisible({ timeout: 2000 });

    // First insertion: insert column right
    await colGrip.click();
    await page.getByText('Insert Column Right').click();

    const firstRow = page.locator('[data-blok-table-row] >> nth=0');

    await expect(firstRow.locator(CELL_SELECTOR)).toHaveCount(4);

    // The newly inserted column's grip should be locked active (visible attribute)
    const activeGrip = page.locator(`${COL_GRIP_SELECTOR}[data-blok-table-grip-visible]`);

    await expect(activeGrip).toHaveCount(1);

    // Second insertion via the newly created column grip
    await activeGrip.dispatchEvent('pointerdown');
    await activeGrip.dispatchEvent('pointerup');
    await activeGrip.dispatchEvent('click');

    await page.getByText('Insert Column Right').click();

    // Verify 5 columns exist after two consecutive insertions
    await expect(firstRow.locator(CELL_SELECTOR)).toHaveCount(5);

    // Dismiss any locked grip by clicking outside the table
    await page.mouse.click(10, 10);

    // eslint-disable-next-line playwright/no-wait-for-timeout -- need to let scheduleHideAll timeouts complete
    await page.waitForTimeout(300);

    // Verify grips are still functional after consecutive insertions
    await page.locator(`${CELL_SELECTOR} >> nth=0`).hover();

    const visibleGrip = page.locator(`${COL_GRIP_SELECTOR}[data-blok-table-grip-visible]`);

    await expect(visibleGrip).toHaveCount(1);
  });

  test('Pasting the same HTML table twice rapidly results in only one table block', async ({ page }) => {
    // 16.5: Paste same HTML table content twice rapidly, verify only one table block exists
    await createBlok(page, {
      tools: defaultTools,
    });

    const HTML_TABLE = '<table><tr><td>X</td><td>Y</td></tr><tr><td>Z</td><td>W</td></tr></table>';
    const EDITABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [contenteditable="true"]`;

    // Click the paragraph block to focus it
    const paragraph = page.locator(`${EDITABLE_SELECTOR} >> nth=0`);

    await paragraph.click();

    // Dispatch paste event twice rapidly without waiting between them
    await pasteHtml(page, EDITABLE_SELECTOR, HTML_TABLE);
    await pasteHtml(page, EDITABLE_SELECTOR, HTML_TABLE);

    // Wait for the table to render
    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // Verify only one table block exists
    await expect(table).toHaveCount(1);
  });

  test('Initializing with colWidths but no initialColWidth renders correctly without error', async ({ page }) => {
    const errors: string[] = [];

    page.on('pageerror', (err) => errors.push(err.message));

    // 16.6: Initialize with colWidths but no initialColWidth field in tool config
    await createBlok(page, {
      tools: {
        table: {
          className: 'Blok.Table',
          // Deliberately omit initialColWidth from config; provide colWidths in data only
        },
      },
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['A', 'B', 'C'], ['D', 'E', 'F']],
              colWidths: [150, 200, 250],
            },
          },
        ],
      },
    });

    // Verify the table renders
    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // Verify no errors occurred
    expect(errors).toHaveLength(0);

    // Verify all 6 cells render correctly (2 rows x 3 cols)
    const cells = page.locator(CELL_SELECTOR);

    await expect(cells).toHaveCount(6);

    // Verify the column widths from data were applied
    const firstRowCellWidths = await page.evaluate(() => {
      const allCells = document.querySelectorAll('[data-blok-table-cell]');

      return Array.from(allCells).slice(0, 3).map(cell => (cell as HTMLElement).style.width);
    });

    expect(firstRowCellWidths[0]).toBe('150px');
    expect(firstRowCellWidths[1]).toBe('200px');
    expect(firstRowCellWidths[2]).toBe('250px');
  });

  test('Grip operations do not produce page errors', async ({ page }) => {
    const errors: string[] = [];

    // 16.7: Attach page error listener, perform grip operations, verify no page errors captured
    page.on('pageerror', (err) => errors.push(err.message));

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
    const firstCell = page.locator(`${CELL_SELECTOR} >> nth=0`);

    await firstCell.click();

    const rowGrip = page.locator(`${ROW_GRIP_SELECTOR} >> nth=0`);

    await expect(rowGrip).toBeVisible({ timeout: 2000 });

    // Insert a row via grip
    await rowGrip.click();
    await page.getByText('Insert Row Below').click();

    await expect(page.locator('[data-blok-table-row]')).toHaveCount(3);

    // Delete the inserted row — click a cell in the last row
    const lastCell = page.locator(`${CELL_SELECTOR} >> nth=-1`);

    await lastCell.click();

    const lastRowGrip = page.locator(`${ROW_GRIP_SELECTOR} >> nth=-1`);

    await expect(lastRowGrip).toBeVisible({ timeout: 2000 });
    await lastRowGrip.click({ force: true });

    await page.getByText('Delete').first().click({ force: true });

    await expect(page.locator('[data-blok-table-row]')).toHaveCount(2);

    // Reopen grip on the remaining row to verify popover works
    const cellAfterDelete = page.locator(`${CELL_SELECTOR} >> nth=0`).locator('[contenteditable="true"] >> nth=0');

    await cellAfterDelete.click();

    const rowGripAfterDelete = page.locator(`${ROW_GRIP_SELECTOR} >> nth=0`);

    await expect(rowGripAfterDelete).toBeVisible({ timeout: 2000 });
    await rowGripAfterDelete.click({ force: true });

    // Popover should reopen cleanly
    await expect(page.getByText('Insert Row Above')).toBeVisible();

    // Dismiss popover
    await page.mouse.click(10, 10);

    // Verify no page errors were captured throughout all operations
    expect(errors).toHaveLength(0);
  });
});
