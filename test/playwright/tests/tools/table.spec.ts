import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;
const CELL_SELECTOR = '[data-blok-table-cell]';

/**
 * Assert a bounding box is non-null and return it with narrowed type.
 * Replaces conditional guards (`if (!box) throw`) to satisfy playwright/no-conditional-in-test.
 */
const assertBoundingBox = (box: { x: number; y: number; width: number; height: number } | null, label: string): { x: number; y: number; width: number; height: number } => {
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

      // Cells now contain block references, not strings
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const content = tableBlock?.data.content as { blocks: string[] }[][];

      expect(content).toHaveLength(2);
      expect(content[0]).toHaveLength(2);

      // Each cell should have a blocks array with at least one block ID
      for (const row of content) {
        for (const cell of row) {
          expect(cell).toHaveProperty('blocks');
          expect(cell.blocks.length).toBeGreaterThanOrEqual(1);
        }
      }

      // Verify the paragraph blocks contain the original text
      const paragraphBlocks = savedData?.blocks.filter((b: { type: string }) => b.type === 'paragraph');

      const paragraphTexts = paragraphBlocks?.map((b: { data: { text: string } }) => b.data.text) as string[];

      expect(paragraphTexts).toContain('Name');
      expect(paragraphTexts).toContain('Value');
      expect(paragraphTexts).toContain('foo');
      expect(paragraphTexts).toContain('bar');
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

      // Click the contenteditable paragraph block inside the first cell
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCellEditable = page.locator(CELL_SELECTOR).first().locator('[contenteditable="true"]').first();

      await firstCellEditable.click();
      await page.keyboard.type('Hello');

      const savedData = await page.evaluate(async () => {
        return window.blokInstance?.save();
      });

      // The cell's paragraph block should contain the typed text
      const tableBlock = savedData?.blocks.find((b: { type: string }) => b.type === 'table');
      const content = (tableBlock?.data as { content: { blocks: string[] }[][] }).content;
      const firstCellBlockId = content[0][0].blocks[0];

      // Find the paragraph block with this ID
      const cellParagraph = savedData?.blocks.find(
        (b: { id?: string }) => b.id === firstCellBlockId
      );

      expect((cellParagraph as { data: { text: string } })?.data.text).toBe('Hello');
    });
  });

  test.describe('cell focus', () => {
    test('focused cell shows grip pills as active indicator', async ({ page }) => {
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

      // Click the contenteditable inside the first cell to trigger focus
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCellEditable = page.locator(CELL_SELECTOR).first().locator('[contenteditable="true"]').first();

      await firstCellEditable.click();

      // In the always-blocks model, cells are not contenteditable so they don't get
      // browser focus styling. The focused cell is indicated by visible grip pills.
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible grip
      const colGrip = page.locator('[data-blok-table-grip-col]').first();
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible grip
      const rowGrip = page.locator('[data-blok-table-grip-row]').first();

      await expect(colGrip).toBeVisible({ timeout: 2000 });
      await expect(rowGrip).toBeVisible({ timeout: 2000 });
    });

    test('unfocused cell has no selection border', async ({ page }) => {
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

      // Without focus, borders should be gray and no blue box-shadow
      const styles = await firstCell.evaluate(el => {
        const s = window.getComputedStyle(el);

        return {
          borderRightColor: s.borderRightColor,
          borderBottomColor: s.borderBottomColor,
          boxShadow: s.boxShadow,
        };
      });

      const blue = 'rgb(59, 130, 246)';

      expect(styles.borderRightColor).not.toBe(blue);
      expect(styles.borderBottomColor).not.toBe(blue);
      expect(styles.boxShadow).toBe('none');
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

    test('enter key creates new block in same cell instead of navigating', async ({ page }) => {
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

      // Click the contenteditable inside the first cell
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCellEditable = page.locator(CELL_SELECTOR).first().locator('[contenteditable="true"]').first();

      await firstCellEditable.click();

      // Move caret to end of text
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');

      // Focus should still be within the first cell (not navigated to cell below)
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

      // Index 0 = first cell. Enter should keep focus in the same cell.
      expect(focusedCellIndex).toBe(0);
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

      const handleBox = assertBoundingBox(await handle.boundingBox(), 'Handle');

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
      const handleBox = assertBoundingBox(await handle.boundingBox(), 'Handle');

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

    test('new columns have consistent width regardless of how many are added', async ({ page }) => {
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

      const table = page.locator(TABLE_SELECTOR);

      await table.hover();

      // Read the initial column width (all 3 should be equal)
      // eslint-disable-next-line playwright/no-nth-methods -- nth is the clearest way to get specific cell
      const initialCell = page.locator('[data-blok-table-row]').first().locator(CELL_SELECTOR).nth(0);
      const initialBox = assertBoundingBox(await initialCell.boundingBox(), 'Initial cell');
      const initialWidth = initialBox.width;

      // Add 3 columns by clicking the add-col button
      const addColBtn = page.locator('[data-blok-table-add-col]');

      for (let i = 0; i < 3; i++) {
        await table.hover();
        await expect(addColBtn).toBeVisible();
        await addColBtn.click();
      }

      // eslint-disable-next-line playwright/no-nth-methods -- nth is the clearest way to get specific cells
      const firstRow = page.locator('[data-blok-table-row]').first();
      const cells = firstRow.locator(CELL_SELECTOR);

      await expect(cells).toHaveCount(6);

      // Get widths of the 3 new columns (indices 3, 4, 5)
      const newWidths: number[] = [];

      for (let i = 3; i < 6; i++) {
        // eslint-disable-next-line playwright/no-nth-methods -- iterating by index
        const cellBox = assertBoundingBox(await cells.nth(i).boundingBox(), `New cell ${i}`);

        newWidths.push(cellBox.width);
      }

      // All new columns should have the same width
      expect(newWidths[1]).toBeCloseTo(newWidths[0], 0);
      expect(newWidths[2]).toBeCloseTo(newWidths[0], 0);

      // Each new column should be approximately half the initial column width
      const expectedWidth = initialWidth / 2;

      expect(newWidths[0]).toBeCloseTo(expectedWidth, 0);
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

      // Type in the new row's first cell — click the contenteditable inside
      await page.evaluate(() => {
        const rows = document.querySelectorAll('[data-blok-table-row]');
        const newRow = rows[2];
        const cell = newRow.querySelector('[data-blok-table-cell]');
        const editable = cell?.querySelector('[contenteditable="true"]') as HTMLElement | null;

        editable?.focus();
        editable?.click();
      });
      await page.keyboard.type('New');

      const savedData = await page.evaluate(async () => {
        return window.blokInstance?.save();
      });

      const tableBlock = savedData?.blocks.find((b: { type: string }) => b.type === 'table');

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const content = tableBlock?.data.content as { blocks: string[] }[][];

      expect(content).toHaveLength(3);

      // The new row's first cell should have a block
      const newCellBlockId = content[2][0].blocks[0];

      expect(newCellBlockId).toBeDefined();

      // Find the paragraph block and verify it contains 'New'
      const cellParagraph = savedData?.blocks.find(
        (b: { id?: string }) => b.id === newCellBlockId
      );

      expect((cellParagraph as { data: { text: string } })?.data.text).toBe('New');
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

  test.describe('row/column controls', () => {
    const GRIP_SELECTOR = '[data-blok-table-grip]';
    const COL_GRIP_SELECTOR = '[data-blok-table-grip-col]';
    const ROW_GRIP_SELECTOR = '[data-blok-table-grip-row]';

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

    test('column grip appears when clicking a cell', async ({ page }) => {
      await createTable2x2(page);

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await firstCell.click();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible grip
      const colGrip = page.locator(COL_GRIP_SELECTOR).first();

      // Grip should become visible (Playwright considers opacity:0 as hidden)
      await expect(colGrip).toBeVisible({ timeout: 2000 });
    });

    test('row grip appears when clicking a cell', async ({ page }) => {
      await createTable2x2(page);

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await firstCell.click();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible grip
      const rowGrip = page.locator(ROW_GRIP_SELECTOR).first();

      await expect(rowGrip).toBeVisible({ timeout: 2000 });
    });

    test('clicking column grip opens popover menu', async ({ page }) => {
      await createTable2x2(page);

      // Click cell to show grips
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await firstCell.click();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible grip
      const visibleGrip = page.locator(COL_GRIP_SELECTOR).first();

      await expect(visibleGrip).toBeVisible();
      await visibleGrip.click();

      // Popover should appear with column menu items
      await expect(page.getByText('Insert Column Left')).toBeVisible();
      await expect(page.getByText('Insert Column Right')).toBeVisible();
      await expect(page.getByText('Delete')).toBeVisible();
    });

    test('column popover does not show move options', async ({ page }) => {
      await createTable2x2(page);

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await firstCell.click();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible grip
      const colGrip = page.locator(COL_GRIP_SELECTOR).first();

      await expect(colGrip).toBeVisible();
      await colGrip.click();

      // Popover should be open
      await expect(page.getByText('Insert Column Left')).toBeVisible();

      // Move options should NOT exist
      await expect(page.getByText('Move Column Left')).toHaveCount(0);
      await expect(page.getByText('Move Column Right')).toHaveCount(0);
    });

    test('clicking row grip opens popover menu', async ({ page }) => {
      await createTable2x2(page);

      // Click cell to show grips
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await firstCell.click();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible grip
      const visibleGrip = page.locator(ROW_GRIP_SELECTOR).first();

      await expect(visibleGrip).toBeVisible();
      await visibleGrip.click();

      // Popover should appear with row menu items
      await expect(page.getByText('Insert Row Above')).toBeVisible();
      await expect(page.getByText('Insert Row Below')).toBeVisible();
      await expect(page.getByText('Delete')).toBeVisible();
    });

    test('row popover does not show move options', async ({ page }) => {
      await createTable2x2(page);

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await firstCell.click();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible grip
      const rowGrip = page.locator(ROW_GRIP_SELECTOR).first();

      await expect(rowGrip).toBeVisible();
      await rowGrip.click();

      // Popover should be open
      await expect(page.getByText('Insert Row Above')).toBeVisible();

      // Move options should NOT exist
      await expect(page.getByText('Move Row Up')).toHaveCount(0);
      await expect(page.getByText('Move Row Down')).toHaveCount(0);
    });

    test('insert row below adds a row', async ({ page }) => {
      await createTable2x2(page);

      // Click first cell to show grips
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await firstCell.click();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible grip
      const visibleGrip = page.locator(ROW_GRIP_SELECTOR).first();

      await expect(visibleGrip).toBeVisible();
      await visibleGrip.click();
      await page.getByText('Insert Row Below').click();

      const rows = page.locator('[data-blok-table-row]');

      await expect(rows).toHaveCount(3);
    });

    test('insert column right adds a column', async ({ page }) => {
      await createTable2x2(page);

      // Click first cell to show grips
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await firstCell.click();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible grip
      const visibleGrip = page.locator(COL_GRIP_SELECTOR).first();

      await expect(visibleGrip).toBeVisible();
      await visibleGrip.click();
      await page.getByText('Insert Column Right').click();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is needed
      const firstRow = page.locator('[data-blok-table-row]').first();
      const cells = firstRow.locator(CELL_SELECTOR);

      await expect(cells).toHaveCount(3);
    });

    test('grip remains functional after consecutive insertions from newly created column', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: true,
                content: [
                  ['Feature', 'Status', 'Notes'],
                  ['Row 1', 'OK', 'Details'],
                  ['Row 2', 'OK', 'Details'],
                ],
                colWidths: [200, 200, 200],
              },
            },
          ],
        },
      });

      // Click first cell to activate table and show grips
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await firstCell.click();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible grip
      const colGrip = page.locator(COL_GRIP_SELECTOR).first();

      await expect(colGrip).toBeVisible();
      await colGrip.click();

      // First insertion
      await page.getByText('Insert Column Right').click();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is needed
      const firstRow = page.locator('[data-blok-table-row]').first();

      await expect(firstRow.locator(CELL_SELECTOR)).toHaveCount(4);

      // The newly inserted column's grip should be locked active (blue).
      // Click it to open its popover and insert again.
      const activeGrip = page.locator(`${COL_GRIP_SELECTOR}[data-blok-table-grip-visible]`);

      await expect(activeGrip).toHaveCount(1);
      await activeGrip.click();

      // Second insertion from the newly created column
      await page.getByText('Insert Column Right').click();

      await expect(firstRow.locator(CELL_SELECTOR)).toHaveCount(5);

      // Dismiss any locked grip by clicking outside the table
      await page.mouse.click(10, 10);

      // Wait for timeouts/RAFs to settle
      // eslint-disable-next-line playwright/no-wait-for-timeout -- need to let scheduleHideAll timeouts complete
      await page.waitForTimeout(300);

      // After both insertions and dismissal, grips must still be functional.
      // Hover a cell and verify a grip becomes visible.
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      await page.locator(CELL_SELECTOR).first().hover();

      const visibleGrip = page.locator(`${COL_GRIP_SELECTOR}[data-blok-table-grip-visible]`);

      await expect(visibleGrip).toHaveCount(1);
    });

    test('column grip is not clipped by wrapper overflow after inserting a column', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [['A', 'B'], ['C', 'D']],
                colWidths: [300, 300],
              },
            },
          ],
        },
      });

      // Click first cell to show grips
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await firstCell.click();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible grip
      const colGrip = page.locator(COL_GRIP_SELECTOR).first();

      await expect(colGrip).toBeVisible();
      await colGrip.click();
      await page.getByText('Insert Column Left').click();

      // After insertion, the new column's grip should be fully visible
      // (not clipped by wrapper overflow-x-auto causing overflow-y: auto)
      // eslint-disable-next-line playwright/no-nth-methods -- first() targets the newly inserted column grip
      const newGrip = page.locator(COL_GRIP_SELECTOR).first();

      await expect(newGrip).toBeVisible();

      const wrapperBox = assertBoundingBox(
        await page.locator(TABLE_SELECTOR).boundingBox(),
        'Table wrapper'
      );
      const gripBox = assertBoundingBox(await newGrip.boundingBox(), 'Column grip');

      // The grip's top edge must be within or at the wrapper's top edge
      expect(gripBox.y).toBeGreaterThanOrEqual(wrapperBox.y);
    });

    test('row grip is not clipped by wrapper overflow after inserting a column', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [['A', 'B'], ['C', 'D']],
                colWidths: [300, 300],
              },
            },
          ],
        },
      });

      // Click first cell to show grips
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await firstCell.click();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible grip
      const colGrip = page.locator(COL_GRIP_SELECTOR).first();

      await expect(colGrip).toBeVisible();
      await colGrip.click();
      await page.getByText('Insert Column Left').click();

      // Click outside the table to clear the column selection
      await page.mouse.click(10, 10);

      // After insertion, hover over a cell to show the row grip
      // eslint-disable-next-line playwright/no-nth-methods -- first() targets the first cell
      const cellInSecondRow = page.locator('[data-blok-table-row]').nth(1).locator(CELL_SELECTOR).first();

      await cellInSecondRow.hover();

      // Wait for row grip to appear (with visible attribute) — target 2nd row (index 1)
      const rowGrip = page.locator('[data-blok-table-grip-row="1"][data-blok-table-grip-visible]');

      await expect(rowGrip).toBeVisible();

      const wrapperBox = assertBoundingBox(
        await page.locator(TABLE_SELECTOR).boundingBox(),
        'Table wrapper'
      );
      const gripBox = assertBoundingBox(await rowGrip.boundingBox(), 'Row grip');

      // The grip's left edge must be within or at the wrapper's left edge
      expect(gripBox.x).toBeGreaterThanOrEqual(wrapperBox.x);
    });

    test('grip pills are children of the grid element, not the wrapper', async ({ page }) => {
      await createTable2x2(page);

      // Grips should be inside the grid (sibling to rows), not direct children of the wrapper
      const gripParentInfo = await page.evaluate(() => {
        const grips = document.querySelectorAll('[data-blok-table-grip]');

        if (grips.length === 0) {
          return { count: 0, allInsideGrid: false };
        }

        const allInsideGrid = Array.from(grips).every(grip => {
          const parent = grip.parentElement;

          // The wrapper has data-blok-tool="table", the grid does not
          return parent !== null && !parent.hasAttribute('data-blok-tool');
        });

        return { count: grips.length, allInsideGrid };
      });

      expect(gripParentInfo.count).toBeGreaterThan(0);
      expect(gripParentInfo.allInsideGrid).toBe(true);
    });

    test('grip pills are solid capsules with no icon content', async ({ page }) => {
      await createTable2x2(page);

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first grip
      const firstGrip = page.locator(GRIP_SELECTOR).first();

      // Pill should have no child elements (no icon SVG inside)
      const childCount = await firstGrip.evaluate(el => el.children.length);

      expect(childCount).toBe(0);
    });

    test('column pill has horizontal capsule dimensions', async ({ page }) => {
      await createTable2x2(page);

      // Click cell to make grip visible so we can measure it
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await firstCell.click();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible grip
      const colGrip = page.locator(COL_GRIP_SELECTOR).first();

      await expect(colGrip).toBeVisible();

      const colBox = await colGrip.boundingBox();

      // Column pill: ~32px wide x 4px tall
      expect(colBox?.width).toBe(32);
      expect(colBox?.height).toBe(4);
    });

    test('row pill has vertical capsule dimensions', async ({ page }) => {
      await createTable2x2(page);

      // Click cell to make grip visible so we can measure it
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await firstCell.click();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible grip
      const rowGrip = page.locator(ROW_GRIP_SELECTOR).first();

      await expect(rowGrip).toBeVisible();

      const rowBox = await rowGrip.boundingBox();

      // Row pill: ~4px wide x 20px tall
      expect(rowBox?.width).toBe(4);
      expect(rowBox?.height).toBe(20);
    });

    test('grips not present in readOnly mode', async ({ page }) => {
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

      const grips = page.locator(GRIP_SELECTOR);

      await expect(grips).toHaveCount(0);
    });

    test('popover reopens after closing via menu item click', async ({ page }) => {
      const errors: string[] = [];

      page.on('pageerror', (err) => errors.push(err.message));

      await createTable2x2(page);

      // Click contenteditable inside first cell to show grips
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCellEditable = page.locator(CELL_SELECTOR).first().locator('[contenteditable="true"]').first();

      await firstCellEditable.click();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible grip
      const rowGrip = page.locator(ROW_GRIP_SELECTOR).first();

      await expect(rowGrip).toBeVisible();

      // Open popover and click a menu item (which closes it via closeOnActivate)
      await rowGrip.click();
      await expect(page.getByText('Insert Row Below')).toBeVisible();
      await page.getByText('Insert Row Below').click();

      // Wait for action to take effect (row inserted)
      await expect(page.locator('[data-blok-table-row]')).toHaveCount(3);

      // Popover should be fully removed from the DOM after closing
      await expect(page.locator('[data-blok-popover]')).toHaveCount(0);

      // Click contenteditable inside a cell to re-show grips, then click grip again to reopen popover
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      await page.locator(CELL_SELECTOR).first().locator('[contenteditable="true"]').first().click();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible grip
      const rowGripAfter = page.locator(ROW_GRIP_SELECTOR).first();

      await expect(rowGripAfter).toBeVisible();
      await rowGripAfter.click();

      // Popover should reopen with row menu items
      await expect(page.getByText('Insert Row Above')).toBeVisible();

      // No stack overflow errors should have occurred
      const stackErrors = errors.filter(e => e.includes('stack'));

      expect(stackErrors).toHaveLength(0);
    });

    test('popover closes when clicking outside', async ({ page }) => {
      await createTable2x2(page);

      // Click first cell to show grips
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await firstCell.click();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible grip
      const rowGrip = page.locator(ROW_GRIP_SELECTOR).first();

      await expect(rowGrip).toBeVisible();
      await rowGrip.click();

      // Popover should be open
      await expect(page.getByText('Insert Row Below')).toBeVisible();

      // Click outside the popover (on the page body, away from the table)
      await page.mouse.click(10, 10);

      // Popover should be removed from the DOM
      await expect(page.locator('[data-blok-popover]')).toHaveCount(0);
    });

    test('delete column removes column with single click and closes popover', async ({ page }) => {
      await createTable2x2(page);

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await firstCell.click();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible grip
      const colGrip = page.locator(COL_GRIP_SELECTOR).first();

      await expect(colGrip).toBeVisible();
      await colGrip.click();

      // Click Delete — should delete immediately (no confirmation step)
      await page.getByText('Delete').click();

      // Column should be deleted (1 cell per row instead of 2)
      // eslint-disable-next-line playwright/no-nth-methods -- first() is needed
      const firstRow = page.locator('[data-blok-table-row]').first();

      await expect(firstRow.locator(CELL_SELECTOR)).toHaveCount(1);

      // Popover should be closed
      await expect(page.locator('[data-blok-popover]')).toHaveCount(0);
    });

    test('delete row removes row with single click and closes popover', async ({ page }) => {
      await createTable2x2(page);

      // eslint-disable-next-line playwright/no-nth-methods -- last() targets second row to avoid header row edge cases
      const lastCell = page.locator(CELL_SELECTOR).last();

      await lastCell.click();

      // eslint-disable-next-line playwright/no-nth-methods -- last() targets the second row grip
      const rowGrip = page.locator(ROW_GRIP_SELECTOR).last();

      await expect(rowGrip).toBeVisible();
      await rowGrip.click();

      // Click Delete — should delete immediately (no confirmation step)
      await page.getByText('Delete').click();

      // Row should be deleted (1 row instead of 2)
      await expect(page.locator('[data-blok-table-row]')).toHaveCount(1);

      // Popover should be closed
      await expect(page.locator('[data-blok-popover]')).toHaveCount(0);
    });
  });

  test.describe('drag reorder', () => {
    const ROW_GRIP_SELECTOR = '[data-blok-table-grip-row]';
    const COL_GRIP_SELECTOR = '[data-blok-table-grip-col]';

    const createTable3x3 = async (page: Page): Promise<void> => {
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
    };

    test('dragging row grip shows ghost preview element', async ({ page }) => {
      await createTable3x3(page);

      // Click cell to show grip
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      await page.locator(CELL_SELECTOR).first().click();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible grip
      const rowGrip = page.locator(ROW_GRIP_SELECTOR).first();

      await expect(rowGrip).toBeVisible();

      const gripBox = assertBoundingBox(await rowGrip.boundingBox(), 'Row grip');

      const startX = gripBox.x + gripBox.width / 2;
      const startY = gripBox.y + gripBox.height / 2;

      // Start drag — move beyond threshold (10px)
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX, startY + 50, { steps: 5 });

      // Ghost element should appear
      const ghost = page.locator('[data-blok-table-drag-ghost]');

      await expect(ghost).toBeVisible();

      // Clean up
      await page.mouse.up();

      // Ghost should be removed after drop
      await expect(ghost).toHaveCount(0);
    });

    test('dragging column grip reorders column and shows ghost', async ({ page }) => {
      await createTable3x3(page);

      // Click contenteditable in second column cell to show its grip
      // eslint-disable-next-line playwright/no-nth-methods -- nth(1) needed to target second cell
      await page.locator(CELL_SELECTOR).nth(1).locator('[contenteditable="true"]').first().click();

      // eslint-disable-next-line playwright/no-nth-methods -- nth(1) needed to target second column grip
      const colGrip = page.locator(COL_GRIP_SELECTOR).nth(1);

      await expect(colGrip).toBeVisible();

      const gripBox = assertBoundingBox(await colGrip.boundingBox(), 'Column grip');

      // Get the left edge of the table so we can drag past column 0
      const tableBox = assertBoundingBox(await page.locator(TABLE_SELECTOR).boundingBox(), 'Table');

      const startX = gripBox.x + gripBox.width / 2;
      const startY = gripBox.y + gripBox.height / 2;
      const targetX = tableBox.x;

      // Drag column 1 to the left edge of the table (past column 0)
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(targetX, startY, { steps: 10 });

      // Ghost should be visible during drag
      const ghost = page.locator('[data-blok-table-drag-ghost]');

      await expect(ghost).toBeVisible();

      await page.mouse.up();

      // Ghost removed
      await expect(ghost).toHaveCount(0);

      // Column should have been reordered: A2 is now in first column
      // Verify by checking the text content of cells in the first row
      // eslint-disable-next-line playwright/no-nth-methods -- first() is needed
      const firstRow = page.locator('[data-blok-table-row]').first();
      // eslint-disable-next-line playwright/no-nth-methods -- nth() needed to target specific cells
      const firstCellText = await firstRow.locator(CELL_SELECTOR).nth(0).textContent();
      // eslint-disable-next-line playwright/no-nth-methods -- nth() needed to target specific cells
      const secondCellText = await firstRow.locator(CELL_SELECTOR).nth(1).textContent();

      expect(firstCellText?.trim()).toBe('A2');
      expect(secondCellText?.trim()).toBe('A1');
    });

    test('dragging row grip reorders row data', async ({ page }) => {
      await createTable3x3(page);

      // Click contenteditable in first cell to show its grip
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      await page.locator(CELL_SELECTOR).first().locator('[contenteditable="true"]').first().click();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible grip
      const rowGrip = page.locator(ROW_GRIP_SELECTOR).first();

      await expect(rowGrip).toBeVisible();

      const gripBox = assertBoundingBox(await rowGrip.boundingBox(), 'Row grip');

      const startX = gripBox.x + gripBox.width / 2;
      const startY = gripBox.y + gripBox.height / 2;

      // Drag row 0 down past row 1 (use row height to move exactly one row)
      const rowHeight = await page.evaluate(() => {
        const row = document.querySelector('[data-blok-table-row]') as HTMLElement;

        return row?.offsetHeight ?? 40;
      });

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX, startY + rowHeight, { steps: 10 });
      await page.mouse.up();

      // Row A should have moved down by one — B1 is now first row
      // Verify by checking the text content of cells
      // eslint-disable-next-line playwright/no-nth-methods -- nth() needed to target specific rows
      const firstRowFirstCell = page.locator('[data-blok-table-row]').nth(0).locator(CELL_SELECTOR).first();
      // eslint-disable-next-line playwright/no-nth-methods -- nth() needed to target specific rows
      const secondRowFirstCell = page.locator('[data-blok-table-row]').nth(1).locator(CELL_SELECTOR).first();

      const firstRowText = await firstRowFirstCell.textContent();
      const secondRowText = await secondRowFirstCell.textContent();

      expect(firstRowText?.trim()).toBe('B1');
      expect(secondRowText?.trim()).toBe('A1');
    });

    test('cursor changes to grabbing during drag', async ({ page }) => {
      await createTable3x3(page);

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      await page.locator(CELL_SELECTOR).first().click();

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible grip
      const rowGrip = page.locator(ROW_GRIP_SELECTOR).first();

      await expect(rowGrip).toBeVisible();

      const gripBox = assertBoundingBox(await rowGrip.boundingBox(), 'Row grip');

      const startX = gripBox.x + gripBox.width / 2;
      const startY = gripBox.y + gripBox.height / 2;

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX, startY + 50, { steps: 5 });

      // Body cursor should be 'grabbing' during drag
      const cursor = await page.evaluate(() => document.body.style.cursor);

      expect(cursor).toBe('grabbing');

      await page.mouse.up();

      // Cursor should be restored
      const cursorAfter = await page.evaluate(() => document.body.style.cursor);

      expect(cursorAfter).toBe('');
    });
  });

  test.describe('cell styling', () => {
    test('block wrappers and tool elements inside table cells have no extra spacing', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [['Hello', 'World']],
              },
            },
          ],
        },
      });

      const wrapperStyles = await page.evaluate(() => {
        const el = document.querySelector('[data-blok-table-cell] [data-blok-element]');

        if (!el) {
          throw new Error('Block wrapper element not found');
        }

        const computed = window.getComputedStyle(el);

        return {
          paddingTop: computed.paddingTop,
          paddingBottom: computed.paddingBottom,
          marginTop: computed.marginTop,
          marginBottom: computed.marginBottom,
        };
      });

      expect(wrapperStyles.paddingTop).toBe('0px');
      expect(wrapperStyles.paddingBottom).toBe('0px');
      expect(wrapperStyles.marginTop).toBe('0px');
      expect(wrapperStyles.marginBottom).toBe('0px');

      const toolStyles = await page.evaluate(() => {
        const el = document.querySelector('[data-blok-table-cell] .blok-block');

        if (!el) {
          throw new Error('Tool block element not found');
        }

        const computed = window.getComputedStyle(el);

        return {
          paddingTop: computed.paddingTop,
          paddingBottom: computed.paddingBottom,
          paddingLeft: computed.paddingLeft,
          paddingRight: computed.paddingRight,
          marginTop: computed.marginTop,
          marginBottom: computed.marginBottom,
        };
      });

      expect(toolStyles.paddingTop).toBe('0px');
      expect(toolStyles.paddingBottom).toBe('0px');
      expect(toolStyles.paddingLeft).toBe('0px');
      expect(toolStyles.paddingRight).toBe('0px');
      expect(toolStyles.marginTop).toBe('0px');
      expect(toolStyles.marginBottom).toBe('0px');
    });

    test('table cells use 14px font size', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [['Hello', 'World']],
              },
            },
          ],
        },
      });

      const cell = page.locator(CELL_SELECTOR).filter({ hasText: 'Hello' });

      await expect(cell).toBeVisible();

      const fontSize = await cell.evaluate((el) => {
        return window.getComputedStyle(el).fontSize;
      });

      expect(fontSize).toBe('14px');
    });
  });

  test.describe('drag to add rows/columns', () => {
    test('dragging add-row button down adds multiple rows', async ({ page }) => {
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

      // Hover to reveal the add-row button
      await table.hover();

      const addRowBtn = page.locator('[data-blok-table-add-row]');

      await expect(addRowBtn).toBeVisible();

      // Measure the height of a row for the drag distance
      // eslint-disable-next-line playwright/no-nth-methods -- first() needed to get first row
      const firstRow = page.locator('[data-blok-table-row]').first();
      const rowBox = assertBoundingBox(await firstRow.boundingBox(), 'First row');

      const btnBox = assertBoundingBox(await addRowBtn.boundingBox(), 'Add row button');

      const startX = btnBox.x + btnBox.width / 2;
      const startY = btnBox.y + btnBox.height / 2;

      // Drag down by ~2.5 row heights to add 2 rows
      const dragDistance = rowBox.height * 2.5;

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX, startY + dragDistance, { steps: 10 });
      await page.mouse.up();

      // Should now have 4 rows (2 original + 2 added)
      const rows = page.locator('[data-blok-table-row]');

      await expect(rows).toHaveCount(4);
    });

    test('dragging add-col button right adds multiple columns', async ({ page }) => {
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

      const addColBtn = page.locator('[data-blok-table-add-col]');

      // Hover button directly to scroll it into view (wrapper has overflow-x: auto)
      await addColBtn.scrollIntoViewIfNeeded();
      await addColBtn.hover();

      await expect(addColBtn).toBeVisible();

      // Measure column width via the grid's last cell offsetWidth
      const colWidth = await page.evaluate(() => {
        const row = document.querySelector('[data-blok-table-row]');
        const cells = row?.querySelectorAll('[data-blok-table-cell]');
        const lastCell = cells?.[cells.length - 1] as HTMLElement | undefined;

        return lastCell?.offsetWidth ?? 100;
      });

      const btnBox = assertBoundingBox(await addColBtn.boundingBox(), 'Add col button');

      const startX = btnBox.x + btnBox.width / 2;
      const startY = btnBox.y + btnBox.height / 2;

      // Drag right by ~2.5 column widths to add 2 columns
      const dragDistance = colWidth * 2.5;

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + dragDistance, startY, { steps: 10 });
      await page.mouse.up();

      // First row should now have 4 cells (2 original + 2 added)
      // eslint-disable-next-line playwright/no-nth-methods -- first() needed to get first row
      const firstRow = page.locator('[data-blok-table-row]').first();
      const cells = firstRow.locator(CELL_SELECTOR);

      await expect(cells).toHaveCount(4);
    });

    test('dragging add-row button back up cancels added rows', async ({ page }) => {
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

      await expect(addRowBtn).toBeVisible();

      // eslint-disable-next-line playwright/no-nth-methods -- first() needed to get first row
      const firstRow = page.locator('[data-blok-table-row]').first();
      const rowBox = assertBoundingBox(await firstRow.boundingBox(), 'First row');

      const btnBox = assertBoundingBox(await addRowBtn.boundingBox(), 'Add row button');

      const startX = btnBox.x + btnBox.width / 2;
      const startY = btnBox.y + btnBox.height / 2;

      // Drag down to add rows, then drag back to start to cancel
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX, startY + rowBox.height * 2, { steps: 5 });
      await page.mouse.move(startX, startY, { steps: 10 });
      await page.mouse.up();

      // Should still have only 2 original rows
      const rows = page.locator('[data-blok-table-row]');

      await expect(rows).toHaveCount(2);
    });

    test('add-row button has row-resize cursor', async ({ page }) => {
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

      await expect(addRowBtn).toBeVisible();

      const cursor = await addRowBtn.evaluate(el => getComputedStyle(el).cursor);

      expect(cursor).toBe('row-resize');
    });

    test('add-col button has col-resize cursor', async ({ page }) => {
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

      const addColBtn = page.locator('[data-blok-table-add-col]');

      await addColBtn.scrollIntoViewIfNeeded();
      await addColBtn.hover();

      await expect(addColBtn).toBeVisible();

      const cursor = await addColBtn.evaluate(el => getComputedStyle(el).cursor);

      expect(cursor).toBe('col-resize');
    });

    test('add-row button shows tooltip on hover', async ({ page }) => {
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

      await expect(addRowBtn).toBeVisible();
      await expect(addRowBtn).toHaveAttribute('title', /row/);
    });

    test('add-col button shows tooltip on hover', async ({ page }) => {
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

      const addColBtn = page.locator('[data-blok-table-add-col]');

      await addColBtn.scrollIntoViewIfNeeded();
      await addColBtn.hover();

      await expect(addColBtn).toBeVisible();
      await expect(addColBtn).toHaveAttribute('title', /column/);
    });

    test('dragging add-row button upward removes existing empty rows', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [['A', 'B'], ['', ''], ['', '']],
              },
            },
          ],
        },
      });

      const table = page.locator(TABLE_SELECTOR);

      await table.hover();

      const addRowBtn = page.locator('[data-blok-table-add-row]');

      await expect(addRowBtn).toBeVisible();

      // eslint-disable-next-line playwright/no-nth-methods -- first() needed to get first row
      const firstRow = page.locator('[data-blok-table-row]').first();
      const rowBox = assertBoundingBox(await firstRow.boundingBox(), 'First row');

      const btnBox = assertBoundingBox(await addRowBtn.boundingBox(), 'Add row button');

      const startX = btnBox.x + btnBox.width / 2;
      const startY = btnBox.y + btnBox.height / 2;

      // Drag up by 2 row heights to remove 2 rows
      const dragDistance = rowBox.height * 2;

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX, startY - dragDistance, { steps: 10 });
      await page.mouse.up();

      // Should have 1 row remaining (started with 3, removed 2)
      const rows = page.locator('[data-blok-table-row]');

      await expect(rows).toHaveCount(1);
    });

    test('dragging add-row button upward does not remove rows with content', async ({ page }) => {
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

      await expect(addRowBtn).toBeVisible();

      // eslint-disable-next-line playwright/no-nth-methods -- first() needed to get first row
      const firstRow = page.locator('[data-blok-table-row]').first();
      const rowBox = assertBoundingBox(await firstRow.boundingBox(), 'First row');

      const btnBox = assertBoundingBox(await addRowBtn.boundingBox(), 'Add row button');

      const startX = btnBox.x + btnBox.width / 2;
      const startY = btnBox.y + btnBox.height / 2;

      // Drag up by 2 row heights to attempt removing rows
      const dragDistance = rowBox.height * 2;

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX, startY - dragDistance, { steps: 10 });
      await page.mouse.up();

      // Both rows have content so neither should be removed
      const rows = page.locator('[data-blok-table-row]');

      await expect(rows).toHaveCount(2);
    });

    test('dragging add-col button leftward does not remove columns with content', async ({ page }) => {
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

      const addColBtn = page.locator('[data-blok-table-add-col]');

      await addColBtn.scrollIntoViewIfNeeded();
      await addColBtn.hover();
      await expect(addColBtn).toBeVisible();

      // eslint-disable-next-line playwright/no-nth-methods -- first() needed to get first cell width
      const firstCell = page.locator(CELL_SELECTOR).first();
      const cellBox = assertBoundingBox(await firstCell.boundingBox(), 'First cell');

      const btnBox = assertBoundingBox(await addColBtn.boundingBox(), 'Add col button');

      const startX = btnBox.x + btnBox.width / 2;
      const startY = btnBox.y + btnBox.height / 2;

      // Drag left by 2 column widths to attempt removing columns
      const dragDistance = cellBox.width * 2;

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX - dragDistance, startY, { steps: 10 });
      await page.mouse.up();

      // Both columns have content so neither should be removed
      // eslint-disable-next-line playwright/no-nth-methods -- first() needed to get first row
      const firstRowCells = page.locator('[data-blok-table-row]').first().locator(CELL_SELECTOR);

      await expect(firstRowCells).toHaveCount(2);
    });

    test('resets wrapper scroll after adding then removing columns by drag', async ({ page }) => {
      // Matches user report: add several columns by dragging right, then drag left to remove
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: true,
                content: [
                  ['Feature', 'Notes'],
                  ['Supports any size', 'Yes'],
                  ['Tab and Enter keys', 'Full support'],
                  ['HTML tables supported', 'Via paste'],
                  ['Toggle in settings', 'Menu option'],
                ],
              },
            },
          ],
        },
      });

      const wrapper = page.locator(TABLE_SELECTOR);
      const addColBtn = page.locator('[data-blok-table-add-col]');

      await addColBtn.scrollIntoViewIfNeeded();
      await addColBtn.hover();
      await expect(addColBtn).toBeVisible();

      // eslint-disable-next-line playwright/no-nth-methods -- first() for cell width
      const firstCell = page.locator(CELL_SELECTOR).first();
      const cellBox = assertBoundingBox(await firstCell.boundingBox(), 'First cell');

      const btnBox = assertBoundingBox(await addColBtn.boundingBox(), 'Add col button');

      const startX = btnBox.x + btnBox.width / 2;
      const startY = btnBox.y + btnBox.height / 2;
      const colWidth = cellBox.width;

      // Phase 1: Drag right to add columns
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + colWidth * 3, startY, { steps: 15 });

      // Phase 2: Drag left past starting point — removes added empty columns
      // and attempts to remove original columns (which have content → blocked)
      await page.mouse.move(startX - colWidth * 2, startY, { steps: 25 });
      await page.mouse.up();

      // Should have 2 columns remaining (originals with content preserved)
      // eslint-disable-next-line playwright/no-nth-methods -- first() for first row
      const finalCells = page.locator('[data-blok-table-row]').first().locator(CELL_SELECTOR);

      await expect(finalCells).toHaveCount(2);

      // The wrapper must not be scrolled — all content should be visible from the left edge
      const scrollLeft = await wrapper.evaluate(el => el.scrollLeft);

      expect(scrollLeft).toBe(0);

      // Verify the first cell's left edge is fully visible within the wrapper
      const cellVisibility = await page.evaluate(() => {
        const row = document.querySelector('[data-blok-table-row]');
        const cell = row?.querySelector('[data-blok-table-cell]');
        const wrapperEl = document.querySelector('[data-blok-tool="table"]');

        if (!cell || !wrapperEl) {
          throw new Error('Cell or wrapper not found');
        }

        return {
          cellLeft: cell.getBoundingClientRect().left,
          wrapperLeft: wrapperEl.getBoundingClientRect().left,
        };
      });

      // First cell's left edge must not be to the left of the wrapper's left edge
      expect(cellVisibility.cellLeft).toBeGreaterThanOrEqual(cellVisibility.wrapperLeft);
    });
  });

  test.describe('readonly mode preserves cell content', () => {
    test('table cells retain their text content after toggling to readonly mode', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [['Hello', 'World'], ['Foo', 'Bar']],
              },
            },
          ],
        },
      });

      // Verify content is visible in edit mode
      const cells = page.locator(CELL_SELECTOR);

      await expect(cells).toHaveCount(4);
      await expect(cells.filter({ hasText: 'Hello' })).toHaveCount(1);
      await expect(cells.filter({ hasText: 'World' })).toHaveCount(1);
      await expect(cells.filter({ hasText: 'Foo' })).toHaveCount(1);
      await expect(cells.filter({ hasText: 'Bar' })).toHaveCount(1);

      // Toggle to readonly mode
      await page.evaluate(async () => {
        await window.blokInstance?.readOnly.toggle();
      });

      // Cells must still contain text after readonly toggle
      const readonlyCells = page.locator(CELL_SELECTOR);

      await expect(readonlyCells).toHaveCount(4);
      await expect(readonlyCells.filter({ hasText: 'Hello' })).toHaveCount(1);
      await expect(readonlyCells.filter({ hasText: 'World' })).toHaveCount(1);
      await expect(readonlyCells.filter({ hasText: 'Foo' })).toHaveCount(1);
      await expect(readonlyCells.filter({ hasText: 'Bar' })).toHaveCount(1);
    });

    test('table cell content is not rendered as top-level blocks in readonly mode', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [['CellA', 'CellB']],
              },
            },
          ],
        },
      });

      // Toggle to readonly mode
      await page.evaluate(async () => {
        await window.blokInstance?.readOnly.toggle();
      });

      // Cell content must be inside the table, not rendered as separate blocks outside
      const tableWrapper = page.locator(TABLE_SELECTOR);

      await expect(tableWrapper).toHaveCount(1);
      await expect(tableWrapper).toContainText('CellA');
      await expect(tableWrapper).toContainText('CellB');

      // Toggle back to edit mode and save to verify data integrity
      await page.evaluate(async () => {
        await window.blokInstance?.readOnly.toggle();
      });

      const savedData = await page.evaluate(async () => {
        return window.blokInstance?.save();
      });

      const tableBlock = savedData?.blocks.find(b => b.type === 'table');

      expect(tableBlock).toBeDefined();

      // Table data content should have cells with block references, not empty arrays
      const content = (tableBlock?.data as { content: Array<Array<{ blocks: string[] }>> }).content;

      expect(content).toHaveLength(1);
      expect(content[0]).toHaveLength(2);
      content[0].forEach(cell => {
        expect(cell.blocks.length).toBeGreaterThan(0);
      });
    });

    test('table grid width does not change when toggling to readonly mode', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: true,
                content: [['Feature', 'Status', 'Notes'], ['Grid rendering', 'Complete', 'Supports any size']],
              },
            },
          ],
        },
      });

      // Measure grid width in edit mode
      const editGridWidth = await page.evaluate(() => {
        const table = document.querySelector('[data-blok-tool="table"]');
        const grid = table?.firstElementChild as HTMLElement;

        return grid?.getBoundingClientRect().width;
      });

      // Toggle to readonly mode
      await page.evaluate(async () => {
        await window.blokInstance?.readOnly.toggle();
      });

      // Measure grid width in readonly mode
      const readonlyGridWidth = await page.evaluate(() => {
        const table = document.querySelector('[data-blok-tool="table"]');
        const grid = table?.firstElementChild as HTMLElement;

        return grid?.getBoundingClientRect().width;
      });

      // Grid width must remain the same across mode transitions
      expect(readonlyGridWidth).toBe(editGridWidth);
    });

    test('table content survives readonly round-trip (edit -> readonly -> edit)', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: true,
                content: [['Name', 'Value'], ['Key1', 'Val1']],
              },
            },
          ],
        },
      });

      // Toggle to readonly
      await page.evaluate(async () => {
        await window.blokInstance?.readOnly.toggle();
      });

      // Toggle back to edit mode
      await page.evaluate(async () => {
        await window.blokInstance?.readOnly.toggle();
      });

      // Content must still be visible in the table cells
      const cells = page.locator(CELL_SELECTOR);

      await expect(cells).toHaveCount(4);
      await expect(cells.filter({ hasText: 'Name' })).toHaveCount(1);
      await expect(cells.filter({ hasText: 'Value' })).toHaveCount(1);
      await expect(cells.filter({ hasText: 'Key1' })).toHaveCount(1);
      await expect(cells.filter({ hasText: 'Val1' })).toHaveCount(1);
    });
  });

  test.describe('cell selection', () => {
    test('dragging across cells highlights a rectangular selection', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [['A1', 'A2', 'A3'], ['B1', 'B2', 'B3'], ['C1', 'C2', 'C3']],
              },
            },
          ],
        },
      });

      const table = page.locator(TABLE_SELECTOR);

      await expect(table).toBeVisible();

      const cells = page.locator(CELL_SELECTOR);

      // eslint-disable-next-line playwright/no-nth-methods -- nth(0) needed for first cell
      const firstCell = cells.nth(0);
      const firstBox = assertBoundingBox(await firstCell.boundingBox(), 'first cell');

      // eslint-disable-next-line playwright/no-nth-methods -- nth(4) needed for cell at row 1, col 1
      const targetCell = cells.nth(4);
      const targetBox = assertBoundingBox(await targetCell.boundingBox(), 'target cell');

      const startX = firstBox.x + firstBox.width / 2;
      const startY = firstBox.y + firstBox.height / 2;
      const endX = targetBox.x + targetBox.width / 2;
      const endY = targetBox.y + targetBox.height / 2;

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(endX, endY, { steps: 5 });
      await page.mouse.up();

      const selected = page.locator('[data-blok-table-cell-selected]');

      await expect(selected).toHaveCount(4);
    });

    test('selection clears when clicking outside', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [['A1', 'A2'], ['B1', 'B2']],
              },
            },
          ],
        },
      });

      const cells = page.locator(CELL_SELECTOR);

      // eslint-disable-next-line playwright/no-nth-methods -- nth(0) needed for first cell
      const firstCell = cells.nth(0);
      const firstBox = assertBoundingBox(await firstCell.boundingBox(), 'first cell');

      // eslint-disable-next-line playwright/no-nth-methods -- nth(3) needed for last cell
      const lastCell = cells.nth(3);
      const lastBox = assertBoundingBox(await lastCell.boundingBox(), 'last cell');

      await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(lastBox.x + lastBox.width / 2, lastBox.y + lastBox.height / 2, { steps: 5 });
      await page.mouse.up();

      const selected = page.locator('[data-blok-table-cell-selected]');

      await expect(selected).toHaveCount(4);

      await page.mouse.click(10, 10);

      await expect(selected).toHaveCount(0);
    });

    test('selection overlay covers exactly the selected cells', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [
                  ['A1', 'A2', 'A3', 'A4'],
                  ['B1', 'B2', 'B3', 'B4'],
                  ['C1', 'C2', 'C3', 'C4'],
                  ['D1', 'D2', 'D3', 'D4'],
                ],
              },
            },
          ],
        },
      });

      const cells = page.locator(CELL_SELECTOR);

      // Select a 2x2 interior block: cells (1,1) to (2,2)
      // In a 4-col grid: row 1 col 1 = index 5, row 2 col 2 = index 10
      // eslint-disable-next-line playwright/no-nth-methods -- nth(5) needed for cell at row 1, col 1
      const topLeft = cells.nth(5);
      const topLeftBox = assertBoundingBox(await topLeft.boundingBox(), 'top-left cell');

      // eslint-disable-next-line playwright/no-nth-methods -- nth(10) needed for cell at row 2, col 2
      const bottomRight = cells.nth(10);
      const bottomRightBox = assertBoundingBox(await bottomRight.boundingBox(), 'bottom-right cell');

      await page.mouse.move(topLeftBox.x + topLeftBox.width / 2, topLeftBox.y + topLeftBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(bottomRightBox.x + bottomRightBox.width / 2, bottomRightBox.y + bottomRightBox.height / 2, { steps: 5 });
      await page.mouse.up();

      const selected = page.locator('[data-blok-table-cell-selected]');

      await expect(selected).toHaveCount(4);

      // Verify the overlay exists with blue border
      const overlay = page.locator('[data-blok-table-selection-overlay]');

      await expect(overlay).toBeVisible();

      const borderColor = await overlay.evaluate(el => getComputedStyle(el).borderColor);

      expect(borderColor).toBe('rgb(59, 130, 246)');

      // Verify overlay position matches the selected 2x2 area
      const overlayBox = assertBoundingBox(await overlay.boundingBox(), 'selection overlay');
      const expectedWidth = bottomRightBox.x + bottomRightBox.width - topLeftBox.x;
      const expectedHeight = bottomRightBox.y + bottomRightBox.height - topLeftBox.y;

      expect(overlayBox.width).toBeGreaterThan(expectedWidth - 5);
      expect(overlayBox.width).toBeLessThan(expectedWidth + 5);
      expect(overlayBox.height).toBeGreaterThan(expectedHeight - 5);
      expect(overlayBox.height).toBeLessThan(expectedHeight + 5);
    });

    test('clicking a single cell does not create a selection', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [['A1', 'A2'], ['B1', 'B2']],
              },
            },
          ],
        },
      });

      const cells = page.locator(CELL_SELECTOR);

      // eslint-disable-next-line playwright/no-nth-methods -- nth(0) needed for first cell
      const firstCell = cells.nth(0);
      const firstBox = assertBoundingBox(await firstCell.boundingBox(), 'first cell');

      await page.mouse.click(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);

      const selected = page.locator('[data-blok-table-cell-selected]');

      await expect(selected).toHaveCount(0);
    });

    test('edge selection overlay covers only selected cells, not entire grid border', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [
                  ['A1', 'A2', 'A3', 'A4'],
                  ['B1', 'B2', 'B3', 'B4'],
                  ['C1', 'C2', 'C3', 'C4'],
                  ['D1', 'D2', 'D3', 'D4'],
                ],
              },
            },
          ],
        },
      });

      const table = page.locator(TABLE_SELECTOR);

      await expect(table).toBeVisible();

      const cells = page.locator(CELL_SELECTOR);

      // Select a 2x2 region at the top-left corner: cells (0,0) to (1,1)
      // In a 4-column grid, cell (0,0) is index 0, cell (1,1) is index 5
      // eslint-disable-next-line playwright/no-nth-methods -- nth(0) needed for cell at row 0, col 0
      const startCell = cells.nth(0);
      const startBox = assertBoundingBox(await startCell.boundingBox(), 'start cell');

      // eslint-disable-next-line playwright/no-nth-methods -- nth(5) needed for cell at row 1, col 1
      const endCell = cells.nth(5);
      const endBox = assertBoundingBox(await endCell.boundingBox(), 'end cell');

      const startX = startBox.x + startBox.width / 2;
      const startY = startBox.y + startBox.height / 2;
      const endX = endBox.x + endBox.width / 2;
      const endY = endBox.y + endBox.height / 2;

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(endX, endY, { steps: 5 });
      await page.mouse.up();

      const selected = page.locator('[data-blok-table-cell-selected]');

      await expect(selected).toHaveCount(4);

      // Verify the selection overlay exists and covers only the selected area
      const overlay = page.locator('[data-blok-table-selection-overlay]');

      await expect(overlay).toBeVisible();

      // Verify overlay has blue border
      const borderColor = await overlay.evaluate(
        (el) => getComputedStyle(el).borderColor
      );

      expect(borderColor).toBe('rgb(59, 130, 246)');

      // Get bounding boxes to compare overlay size against selected area vs full grid
      const overlayBox = assertBoundingBox(await overlay.boundingBox(), 'selection overlay');
      const tableBox = assertBoundingBox(await table.boundingBox(), 'table');

      // The selected region is 2 columns out of 4, so the overlay width should be
      // approximately half the table width, not the full width
      const expectedWidth = endBox.x + endBox.width - startBox.x;
      const expectedHeight = endBox.y + endBox.height - startBox.y;

      // Overlay width should match the 2-column selected area (with small tolerance for borders)
      expect(overlayBox.width).toBeGreaterThan(expectedWidth - 5);
      expect(overlayBox.width).toBeLessThan(expectedWidth + 5);

      // Overlay height should match the 2-row selected area
      expect(overlayBox.height).toBeGreaterThan(expectedHeight - 5);
      expect(overlayBox.height).toBeLessThan(expectedHeight + 5);

      // Critical assertion: overlay must NOT span the full grid width or height
      // If the bug is present, the overlay would cover all 4 columns / all 4 rows
      expect(overlayBox.width).toBeLessThan(tableBox.width * 0.75);
      expect(overlayBox.height).toBeLessThan(tableBox.height * 0.75);
    });

    test('cell selection cancels RectangleSelection when active', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: true,
                content: [['Feature', 'Status', 'Notes'], ['A', 'B', 'C'], ['D', 'E', 'F']],
              },
            },
          ],
        },
      });

      const table = page.locator(TABLE_SELECTOR);
      const cells = page.locator(CELL_SELECTOR);

      await expect(table).toBeVisible();

      // Get cell bounding boxes
      // eslint-disable-next-line playwright/no-nth-methods -- nth(3) needed for first data cell (A)
      const firstCellBox = assertBoundingBox(await cells.nth(3).boundingBox(), 'First data cell');
      // eslint-disable-next-line playwright/no-nth-methods -- nth(5) needed for last cell in row (C)
      const lastCellBox = assertBoundingBox(await cells.nth(5).boundingBox(), 'Last data cell');

      // Start drag in first cell
      const startX = firstCellBox.x + firstCellBox.width / 2;
      const startY = firstCellBox.y + firstCellBox.height / 2;

      await page.mouse.move(startX, startY);
      await page.mouse.down();

      // Drag to last cell in row
      const endX = lastCellBox.x + lastCellBox.width / 2;
      const endY = lastCellBox.y + lastCellBox.height / 2;

      await page.mouse.move(endX, endY, { steps: 5 });

      // Verify CELL selection overlay appears
      const cellSelectionOverlay = page.locator('[data-blok-table-selection-overlay]');

      await expect(cellSelectionOverlay).toBeVisible();

      // Verify block selection overlay does NOT appear (RectangleSelection was cancelled)
      const blockSelectionRect = page.locator('[data-blok-overlay-rectangle]');

      await expect(blockSelectionRect).toBeHidden();

      await page.mouse.up();

      // Cell selection should persist after mouseup
      await expect(cellSelectionOverlay).toBeVisible();

      // Verify the correct cells are selected (3 cells in the row)
      const selected = page.locator('[data-blok-table-cell-selected]');

      await expect(selected).toHaveCount(3);
    });
  });
});
