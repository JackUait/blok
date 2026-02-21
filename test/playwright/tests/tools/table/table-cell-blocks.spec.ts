// spec: specs/table-tool-test-plan.md
// seed: test/playwright/tests/tools/table-any-block-type.spec.ts

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;
const TOOLBOX_POPOVER_SELECTOR = '[data-blok-testid="toolbox-popover"]';
const TOOLBOX_CONTAINER_SELECTOR = `${TOOLBOX_POPOVER_SELECTOR} [data-blok-testid="popover-container"]`;

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

const defaultTools: Record<string, SerializableToolConfig> = {
  table: {
    className: 'Blok.Table',
  },
  paragraph: {
    className: 'Blok.Paragraph',
  },
  header: {
    className: 'Blok.Header',
  },
  list: {
    className: 'Blok.List',
  },
};

/**
 * Returns a locator for a specific cell in the table grid.
 */
const getCell = (page: Page, row: number, col: number): ReturnType<Page['locator']> =>
  page.locator(`${TABLE_SELECTOR} >> [data-blok-table-row] >> nth=${row}`)
    .locator(`[data-blok-table-cell] >> nth=${col}`);

/**
 * Returns a locator for the editable area inside a specific cell.
 */
const getCellEditable = (page: Page, row: number, col: number): ReturnType<Page['locator']> =>
  getCell(page, row, col).locator('[data-blok-table-cell-blocks] [contenteditable="true"] >> nth=0');

/**
 * Helper to create a 2x2 table with empty cells and all default tools registered.
 */
const create2x2Table = async (page: Page): Promise<void> => {
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

  await expect(page.locator(TABLE_SELECTOR)).toBeVisible();
};

/**
 * Helper to paste HTML content into the currently focused element.
 */
const pasteHtml = async (page: Page, html: string): Promise<void> => {
  await page.evaluate((pasteData) => {
    const activeElement = document.activeElement;

    if (!activeElement) {
      throw new Error('No active element to paste into');
    }

    const pasteEvent = Object.assign(new Event('paste', {
      bubbles: true,
      cancelable: true,
    }), {
      clipboardData: {
        getData: (type: string): string => {
          if (type === 'text/html') {
            return pasteData;
          }

          return '';
        },
        types: ['text/html'],
      },
    });

    activeElement.dispatchEvent(pasteEvent);
  }, html);
};

test.describe('Block Types Inside Table Cells', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('Slash menu opens when typing slash in a table cell', async ({ page }) => {
    // 1. Initialize editor with a 2x2 table, paragraph, header, and list tools registered
    await create2x2Table(page);

    // 2. Click the first cell's editable area
    await getCellEditable(page, 0, 0).click();

    // 3. Type '/'
    await page.keyboard.type('/');

    // The toolbox popover container should become visible
    await expect(page.locator(TOOLBOX_CONTAINER_SELECTOR)).toBeVisible();
  });

  test("The 'Table' tool is hidden from the toolbox when inside a table cell", async ({ page }) => {
    // 1. Initialize editor with table, header, paragraph, and list tools
    await create2x2Table(page);

    // 2. Click into a table cell and type '/'
    await getCellEditable(page, 0, 0).click();
    await page.keyboard.type('/');

    // Wait for toolbox to open
    await expect(page.locator(TOOLBOX_CONTAINER_SELECTOR)).toBeVisible();

    // 3. The 'Table' item should NOT appear among the visible toolbox items
    const tableItem = page.locator(
      `${TOOLBOX_POPOVER_SELECTOR} [data-blok-item-name="table"]:not([data-blok-hidden])`
    );

    await expect(tableItem).toHaveCount(0);
  });

  test("The 'Header' tool is hidden from the toolbox when inside a table cell", async ({ page }) => {
    // 1. Initialize editor with table, header, paragraph, and list tools
    await create2x2Table(page);

    // 2. Click into a table cell and type '/'
    await getCellEditable(page, 0, 0).click();
    await page.keyboard.type('/');

    // Wait for toolbox to open
    await expect(page.locator(TOOLBOX_CONTAINER_SELECTOR)).toBeVisible();

    // 3. The 'Header' item should NOT appear among the visible toolbox items (default restricted)
    const headerItem = page.locator(
      `${TOOLBOX_POPOVER_SELECTOR} [data-blok-item-name="header"]:not([data-blok-hidden])`
    );

    await expect(headerItem).toHaveCount(0);
  });

  test('Selecting a list tool from the slash menu inserts a list in the cell', async ({ page }) => {
    // 1. Initialize editor with table, paragraph, and list tools
    await create2x2Table(page);

    // 2. Click into the first cell and type '/'
    await getCellEditable(page, 0, 0).click();
    await page.keyboard.type('/');

    // Wait for toolbox to open
    await expect(page.locator(TOOLBOX_CONTAINER_SELECTOR)).toBeVisible();

    // 3. Click 'List' in the toolbox popover
    await page.locator(`${TOOLBOX_POPOVER_SELECTOR} [data-blok-item-name="bulleted-list"]`).click();

    // A list block should appear inside the first cell
    const firstCell = getCell(page, 0, 0);

    await expect(firstCell.locator('[data-blok-tool="list"]')).toBeVisible();
  });

  test("Markdown shortcut '- ' converts paragraph to list inside a cell", async ({ page }) => {
    // 1. Initialize editor with table and list tools
    await create2x2Table(page);

    // 2. Click into the first cell
    await getCellEditable(page, 0, 0).click();

    // 3. Type '- Item'
    await page.keyboard.type('- Item');

    // The cell should now contain a list block with 'Item'
    const firstCell = getCell(page, 0, 0);
    const listInCell = firstCell.locator('[data-blok-tool="list"]');

    await expect(listInCell).toBeVisible();
    await expect(listInCell).toContainText('Item');
  });

  test('Pasting HTML list content creates a list block inside the cell', async ({ page }) => {
    // 1. Initialize editor with table and list tools
    await create2x2Table(page);

    // 2. Click into the first cell to focus it
    await getCellEditable(page, 0, 0).click();

    // 3. Dispatch a paste event with clipboard HTML: '<ul><li>A</li><li>B</li></ul>'
    await pasteHtml(page, '<ul><li>A</li><li>B</li></ul>');

    // The cell should contain at least one list block and contain the text 'A'
    const firstCell = getCell(page, 0, 0);
    const listInCell = firstCell.locator('[data-blok-tool="list"]');

    await expect(listInCell).not.toHaveCount(0);
    await expect(firstCell).toContainText('A');
  });

  test('Pasting a restricted block type (header) into a cell converts it to paragraph', async ({ page }) => {
    // Detect platform modifier key
    const modKey = await page.evaluate(() => {
      const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
      const platform = (nav.userAgentData?.platform ?? nav.platform ?? '').toLowerCase();

      return platform.includes('mac') ? 'Meta' : 'Control';
    });

    // 1. Initialize editor with a header block and a table block
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'header',
            data: { text: 'Pasted heading', level: 2 },
          },
          {
            type: 'table',
            data: {
              content: [
                [{ blocks: [] }, { blocks: [] }],
                [{ blocks: [] }, { blocks: [] }],
              ],
            },
          },
        ],
      },
    });

    // 2. Click the header block, select all text, copy it
    const headerBlock = page.locator('[data-blok-tool="header"]');

    await headerBlock.click();
    await page.keyboard.press(`${modKey}+a`);
    await page.keyboard.press(`${modKey}+c`);

    // 3. Click into the first table cell's editable area
    const cellEditable = getCellEditable(page, 0, 0);

    await cellEditable.click();

    // 4. Paste the copied content
    await page.keyboard.press(`${modKey}+v`);

    // The pasted content should appear as a paragraph block, not a header block
    const firstCell = getCell(page, 0, 0);
    const cellBlocks = firstCell.locator('[data-blok-table-cell-blocks]');

    await expect(cellBlocks.locator('[data-blok-tool="header"]')).toHaveCount(0);
    await expect(cellBlocks).toContainText('Pasted heading');
  });

  test('Custom restricted tools configured via restrictedTools are hidden in cell toolbox', async ({ page }) => {
    // 1. Initialize editor with table tool configured with restrictedTools: ['list']
    //    and also register paragraph and list tools
    await createBlok(page, {
      tools: {
        table: {
          className: 'Blok.Table',
          config: { restrictedTools: ['list'] },
        },
        paragraph: {
          className: 'Blok.Paragraph',
        },
        list: {
          className: 'Blok.List',
        },
      },
    });

    // 2. Click the first empty paragraph block and insert a table via slash menu
    const firstParagraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-tool="paragraph"] [contenteditable="true"]`);

    await firstParagraph.click();
    await page.keyboard.type('/');

    await page.waitForFunction(
      () => document.querySelector('[data-blok-testid="toolbox-popover"][data-blok-popover-opened="true"]') !== null,
      { timeout: 3000 }
    );

    const tableToolboxItem = page.locator('[data-blok-item-name="table"]');

    // eslint-disable-next-line playwright/no-force-option -- popover container intercepting pointer events
    await tableToolboxItem.click({ force: true });

    // Wait for the table to appear
    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // 3. Click into the first cell and type '/'
    const firstCellEditable = page
      .locator(`${TABLE_SELECTOR} >> [data-blok-table-row] >> nth=0`)
      .locator('[data-blok-table-cell] >> nth=0')
      .locator('[data-blok-table-cell-blocks] [contenteditable="true"] >> nth=0');

    await firstCellEditable.click();
    await page.keyboard.type('/');

    // Wait for toolbox to open via DOM attribute
    await page.waitForFunction(
      () => document.querySelector('[data-blok-testid="toolbox-popover"][data-blok-popover-opened="true"]') !== null,
      { timeout: 3000 }
    );

    const toolboxPopover = page.locator(TOOLBOX_POPOVER_SELECTOR);

    // All list-related entries (Bulleted list, Numbered list, To-do list) should be hidden
    const visibleListEntries = toolboxPopover.locator(
      '[data-blok-item-name="bulleted-list"]:not([data-blok-hidden]), ' +
      '[data-blok-item-name="numbered-list"]:not([data-blok-hidden]), ' +
      '[data-blok-item-name="check-list"]:not([data-blok-hidden])'
    );

    await expect(visibleListEntries).toHaveCount(0);

    // The paragraph tool should still be visible in the toolbox
    const paragraphEntry = toolboxPopover.locator(
      '[data-blok-item-name="paragraph"]:not([data-blok-hidden])'
    );

    await expect(paragraphEntry).toBeVisible();
  });

  test('Multiple blocks can exist in a single cell', async ({ page }) => {
    // 1. Initialize editor with a 2x2 table
    await create2x2Table(page);

    // 2. Click the first cell's editable, type 'First line'
    await getCellEditable(page, 0, 0).click();
    await page.keyboard.type('First line');

    // 3. Press Enter
    await page.keyboard.press('Enter');

    // 4. Type 'Second line'
    await page.keyboard.type('Second line');

    // Both 'First line' and 'Second line' should be visible in the first cell
    const firstCell = getCell(page, 0, 0);

    await expect(firstCell).toContainText('First line');
    await expect(firstCell).toContainText('Second line');

    // Verify focus remains in the first cell (not moved to next row)
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

    expect(focusedCellIndex).toBe(0);
  });

  test('Each cell always has at least one empty paragraph block', async ({ page }) => {
    // 1. Initialize editor with a 2x2 table with empty cells and paragraph tool
    await createBlok(page, {
      tools: {
        table: {
          className: 'Blok.Table',
        },
        paragraph: {
          className: 'Blok.Paragraph',
        },
      },
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

    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // 2. Inspect the blocks container of each cell
    // Every cell should have a data-blok-table-cell-blocks container with exactly one block element
    const cellBlocksContainers = page.locator('[data-blok-table-cell-blocks]');

    await expect(cellBlocksContainers).toHaveCount(4);

    // Each container should have exactly one paragraph block (the default empty block)
    for (let index = 0; index < 4; index++) {
      // eslint-disable-next-line playwright/no-nth-methods -- nth(i) is required to iterate cell containers by index
      const container = cellBlocksContainers.nth(index);

      await expect(container.locator('[data-blok-tool="paragraph"]')).toHaveCount(1);
    }
  });

  test('Deleting all content in a cell leaves it with an empty paragraph block', async ({ page }) => {
    // Detect platform modifier key
    const modKey = await page.evaluate(() => {
      const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
      const platform = (nav.userAgentData?.platform ?? nav.platform ?? '').toLowerCase();

      return platform.includes('mac') ? 'Meta' : 'Control';
    });

    // 1. Initialize a 3x3 table with content ['A1'..'C3']
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [
                ['A1', 'B1', 'C1'],
                ['A2', 'B2', 'C2'],
                ['A3', 'B3', 'C3'],
              ],
            },
          },
        ],
      },
    });

    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // 2. Click into the editable area of cell (0, 0) to focus it
    await getCellEditable(page, 0, 0).click();

    // 3. Select all text in the cell
    await page.keyboard.press(`${modKey}+a`);

    // 4. Press Backspace to delete all content
    await page.keyboard.press('Backspace');

    // 5. Verify cell (0, 0) still has exactly 1 contenteditable block element
    const cellBlocksContainer = getCell(page, 0, 0).locator('[data-blok-table-cell-blocks]');
    const editableBlocks = cellBlocksContainer.locator('[contenteditable="true"]');

    await expect(editableBlocks).toHaveCount(1);

    // 6. Verify that block is empty (has no text content)
    await expect(editableBlocks.first()).toHaveText('');
  });
});
