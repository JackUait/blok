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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const tableBlock = savedData?.blocks.find((b: { type: string }) => b.type === 'table');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const content = tableBlock?.data.content as { blocks: string[] }[][];
      const firstCellBlockId = content[0][0].blocks[0];

      // Find the paragraph block with this ID
      const cellParagraph = savedData?.blocks.find(
        (b: { id?: string }) => b.id === firstCellBlockId
      );

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
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

      // Type in the new row's first cell — click the contenteditable inside
      // eslint-disable-next-line playwright/no-nth-methods -- nth(2) + first() needed to target the newly added row's first cell
      const newCellEditable = page.locator('[data-blok-table-row]').nth(2)
        .locator(CELL_SELECTOR).first()
        .locator('[contenteditable="true"]').first();

      await newCellEditable.click();
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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
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
      await expect(page.getByText('Delete Column')).toBeVisible();
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
      await expect(page.getByText('Delete Row')).toBeVisible();
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

      const gripBox = await rowGrip.boundingBox();

      if (!gripBox) {
        throw new Error('Grip not visible');
      }

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

      const gripBox = await colGrip.boundingBox();

      if (!gripBox) {
        throw new Error('Grip not visible');
      }

      // Get the left edge of the table so we can drag past column 0
      const tableBox = await page.locator(TABLE_SELECTOR).boundingBox();

      if (!tableBox) {
        throw new Error('Table not visible');
      }

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

      const gripBox = await rowGrip.boundingBox();

      if (!gripBox) {
        throw new Error('Grip not visible');
      }

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

      const gripBox = await rowGrip.boundingBox();

      if (!gripBox) {
        throw new Error('Grip not visible');
      }

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

      const blockWrapper = page.locator(`${CELL_SELECTOR} [data-blok-element]`).first();

      await expect(blockWrapper).toBeVisible();

      const wrapperStyles = await blockWrapper.evaluate((el) => {
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

      const toolBlock = page.locator(`${CELL_SELECTOR} .blok-block`).first();

      await expect(toolBlock).toBeVisible();

      const toolStyles = await toolBlock.evaluate((el) => {
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

      const cell = page.locator(CELL_SELECTOR).first();

      await expect(cell).toBeVisible();

      const fontSize = await cell.evaluate((el) => {
        return window.getComputedStyle(el).fontSize;
      });

      expect(fontSize).toBe('14px');
    });
  });
});
