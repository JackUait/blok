/**
 * Reproduction test for paste-into-cell bugs.
 *
 * Verifies:
 * 1. Pasting into a table cell replaces content correctly without duplication
 * 2. No orphaned block IDs remain in the table's contentIds after paste
 */

import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TEST_PAGE_URL = 'http://localhost:4444/test/playwright/fixtures/test.html';
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

interface SavedBlock {
  id: string;
  type: string;
  data: Record<string, unknown>;
  parent?: string;
  content?: string[];
}

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

/**
 * Dispatch a paste event on a specific locator element with typed clipboard data.
 */
const paste = async (locator: Locator, data: Record<string, string>): Promise<void> => {
  await locator.evaluate((element: HTMLElement, pasteData: Record<string, string>) => {
    const pasteEvent = Object.assign(new Event('paste', {
      bubbles: true,
      cancelable: true,
    }), {
      clipboardData: {
        getData: (type: string): string => pasteData[type] ?? '',
        types: Object.keys(pasteData),
      },
    });

    element.dispatchEvent(pasteEvent);
  }, data);
};

const defaultTools: Record<string, SerializableToolConfig> = {
  table: {
    className: 'Blok.Table',
  },
};

/**
 * Resolve block text from saved data.
 * Content cells store block IDs; look up each ID to get its text.
 */
function resolveBlockText(blocks: SavedBlock[], blockId: string): string {
  const block = blocks.find(b => b.id === blockId);

  return typeof block?.data?.text === 'string' ? block.data.text : '';
}

/**
 * Wait for paste processing to complete by polling until new block content appears.
 */
async function waitForPasteComplete(page: Page, expectedText: string): Promise<void> {
  await page.waitForFunction(
    (text: string) => {
      const editables = document.querySelectorAll('[contenteditable="true"]');

      return Array.from(editables).some(el => el.textContent?.includes(text));
    },
    expectedText,
    { timeout: 5000 }
  );
}

test.describe('Paste into existing table cell — content integrity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('Pasting Google Docs HTML into a cell replaces content without orphaned contentIds', async ({ page }) => {
    // Create editor with a pre-populated 2x3 table
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              withHeadingColumn: false,
              content: [
                ['A1', 'B1', 'C1'],
                ['A2', 'B2', 'C2'],
              ],
            },
          },
        ],
      },
    });

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible({ timeout: 5000 });

    const cells = table.locator(CELL_SELECTOR);

    await expect(cells).toHaveCount(6);

    // Click on cell (0,0) to focus it
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to target first cell
    const firstCell = cells.first();

    await firstCell.click();

    const firstCellEditable = firstCell.locator('[contenteditable="true"]');

    await expect(firstCellEditable).toBeFocused({ timeout: 2000 });

    // Paste Google Docs-style HTML with a 1x2 table
    const googleDocsHTML = [
      '<meta charset="utf-8">',
      '<b style="font-weight:normal;" id="docs-internal-guid-abc12345">',
      '<div dir="ltr" style="margin-left:0pt;" align="left">',
      '<table style="border:none;border-collapse:collapse;">',
      '<tbody>',
      '<tr>',
      '<td style="border:solid #000 1pt;padding:5pt;">',
      '<p dir="ltr"><span>Pasted1</span></p>',
      '</td>',
      '<td style="border:solid #000 1pt;padding:5pt;">',
      '<p dir="ltr"><span>Pasted2</span></p>',
      '</td>',
      '</tr>',
      '</tbody>',
      '</table>',
      '</div>',
      '</b>',
    ].join('');

    await paste(firstCellEditable, {
      'text/html': googleDocsHTML,
      'text/plain': 'Pasted1\tPasted2',
    });

    // Wait for pasted content to appear in the DOM
    await waitForPasteComplete(page, 'Pasted1');

    // Save and check results
    const savedData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    expect(savedData).toBeDefined();
    expect(savedData).toHaveProperty('blocks');

    const allBlocks = (savedData as { blocks: SavedBlock[] }).blocks;

    // Should have exactly one table block
    const tableBlocks = allBlocks.filter(b => b.type === 'table');

    expect(tableBlocks.length).toBe(1);

    const tableBlock = tableBlocks[0];

    // Get the contentIds from the table block
    expect(tableBlock.content).toBeDefined();

    const contentIds = tableBlock.content as string[];

    // All contentIds should reference existing blocks
    const existingBlockIds = new Set(allBlocks.map(b => b.id));

    const orphanedIds = contentIds.filter(id => !existingBlockIds.has(id));

    expect(orphanedIds).toStrictEqual([]);

    // Verify the cell grid has the right content
    const cellGrid = tableBlock.data.content as Array<Array<{ blocks: string[] }>>;

    // Table should still be 2x3
    expect(cellGrid.length).toBe(2);
    expect(cellGrid[0].length).toBe(3);

    // Cell (0,0) should contain "Pasted1"
    const cell00Text = resolveBlockText(allBlocks, cellGrid[0][0].blocks[0]);

    expect(cell00Text).toBe('Pasted1');

    // Cell (0,1) should contain "Pasted2"
    const cell01Text = resolveBlockText(allBlocks, cellGrid[0][1].blocks[0]);

    expect(cell01Text).toBe('Pasted2');

    // Cell (0,2) should still contain "C1"
    const cell02Text = resolveBlockText(allBlocks, cellGrid[0][2].blocks[0]);

    expect(cell02Text).toBe('C1');

    // Row 1 should be untouched
    const cell10Text = resolveBlockText(allBlocks, cellGrid[1][0].blocks[0]);
    const cell11Text = resolveBlockText(allBlocks, cellGrid[1][1].blocks[0]);
    const cell12Text = resolveBlockText(allBlocks, cellGrid[1][2].blocks[0]);

    expect(cell10Text).toBe('A2');
    expect(cell11Text).toBe('B2');
    expect(cell12Text).toBe('C2');

    // "Pasted1" should appear exactly once across all blocks
    const allTexts = allBlocks
      .filter(b => b.type === 'paragraph')
      .map(b => b.data.text as string);

    expect(allTexts.filter(t => t === 'Pasted1').length).toBe(1);
    expect(allTexts.filter(t => t === 'Pasted2').length).toBe(1);
  });

  test('Pasting Blok custom format into a cell replaces content without orphaned contentIds', async ({ page }) => {
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              withHeadingColumn: false,
              content: [
                ['A1', 'B1', 'C1'],
                ['A2', 'B2', 'C2'],
              ],
            },
          },
        ],
      },
    });

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible({ timeout: 5000 });

    const cells = table.locator(CELL_SELECTOR);

    await expect(cells).toHaveCount(6);

    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to target first cell
    const firstCell = cells.first();

    await firstCell.click();

    const firstCellEditable = firstCell.locator('[contenteditable="true"]');

    await expect(firstCellEditable).toBeFocused({ timeout: 2000 });

    // Build custom Blok clipboard format (1x2 payload)
    const payload = {
      rows: 1,
      cols: 2,
      cells: [
        [
          { blocks: [{ tool: 'paragraph', data: { text: 'CopiedX' } }] },
          { blocks: [{ tool: 'paragraph', data: { text: 'CopiedY' } }] },
        ],
      ],
    };

    const json = JSON.stringify(payload).replace(/'/g, '&#39;');
    const customHtml = `<table data-blok-table-cells='${json}'><tr><td>CopiedX</td><td>CopiedY</td></tr></table>`;

    await paste(firstCellEditable, {
      'text/html': customHtml,
      'text/plain': 'CopiedX\tCopiedY',
    });

    // Wait for pasted content to appear in the DOM
    await waitForPasteComplete(page, 'CopiedX');

    const savedData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    expect(savedData).toBeDefined();
    expect(savedData).toHaveProperty('blocks');

    const allBlocks = (savedData as { blocks: SavedBlock[] }).blocks;
    const tableBlocks = allBlocks.filter(b => b.type === 'table');

    expect(tableBlocks.length).toBe(1);

    const tableBlock = tableBlocks[0];

    expect(tableBlock.content).toBeDefined();

    const contentIds = tableBlock.content as string[];

    // All contentIds should reference existing blocks (no orphans)
    const existingBlockIds = new Set(allBlocks.map(b => b.id));
    const orphanedIds = contentIds.filter(id => !existingBlockIds.has(id));

    expect(orphanedIds).toStrictEqual([]);

    const cellGrid = tableBlock.data.content as Array<Array<{ blocks: string[] }>>;

    expect(cellGrid.length).toBe(2);
    expect(cellGrid[0].length).toBe(3);

    const cell00Text = resolveBlockText(allBlocks, cellGrid[0][0].blocks[0]);

    expect(cell00Text).toBe('CopiedX');

    const cell01Text = resolveBlockText(allBlocks, cellGrid[0][1].blocks[0]);

    expect(cell01Text).toBe('CopiedY');

    // "CopiedX" and "CopiedY" should each appear exactly once
    const allTexts = allBlocks
      .filter(b => b.type === 'paragraph')
      .map(b => b.data.text as string);

    expect(allTexts.filter(t => t === 'CopiedX').length).toBe(1);
    expect(allTexts.filter(t => t === 'CopiedY').length).toBe(1);
  });

  test('Pasting a single Google Docs row into the first cell does not duplicate content in the last row', async ({ page }) => {
    // Regression test: copying one row (4 cells) from Google Docs and pasting into
    // cell (0,0) of a default 3×3 empty table should insert content only in the
    // first row — not also in the last row — and should expand to 4 cols, not 8.

    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              withHeadingColumn: false,
              content: [
                ['', '', ''],
                ['', '', ''],
                ['', '', ''],
              ],
            },
          },
        ],
      },
    });

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible({ timeout: 5000 });

    const cells = table.locator(CELL_SELECTOR);

    // 3 rows × 3 cols = 9 cells
    await expect(cells).toHaveCount(9);

    // Click on cell (0,0) to focus it
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to target first cell
    const firstCell = cells.first();

    await firstCell.click();

    const firstCellEditable = firstCell.locator('[contenteditable="true"]');

    await expect(firstCellEditable).toBeFocused({ timeout: 2000 });

    // Paste a single Google Docs row with 4 cells (more than the 3 table cols)
    const googleDocsHTML = [
      '<meta charset="utf-8">',
      '<b style="font-weight:normal;" id="docs-internal-guid-single-row">',
      '<div dir="ltr" style="margin-left:0pt;" align="left">',
      '<table style="border:none;border-collapse:collapse;">',
      '<tbody>',
      '<tr>',
      '<td style="border:solid #000 1pt;padding:5pt;">',
      '<p dir="ltr"><span>test</span></p>',
      '</td>',
      '<td style="border:solid #000 1pt;padding:5pt;">',
      '<p dir="ltr"><span>test</span></p>',
      '</td>',
      '<td style="border:solid #000 1pt;padding:5pt;">',
      '<p dir="ltr"><span>peach test</span></p>',
      '</td>',
      '<td style="border:solid #000 1pt;padding:5pt;">',
      '<p dir="ltr"><span>new column</span></p>',
      '</td>',
      '</tr>',
      '</tbody>',
      '</table>',
      '</div>',
      '</b>',
    ].join('');

    // Paste Google Docs HTML using synthetic paste event (works reliably in headless CI)
    await paste(firstCellEditable, {
      'text/html': googleDocsHTML,
      'text/plain': 'test\ttest\tpeach test\tnew column',
    });

    // Wait for pasted content to appear in the DOM
    await waitForPasteComplete(page, 'new column');

    // Save and check results
    const savedData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    expect(savedData).toBeDefined();
    expect(savedData).toHaveProperty('blocks');

    const allBlocks = (savedData as { blocks: SavedBlock[] }).blocks;

    // Should have exactly one table block (no new table block created)
    const tableBlocks = allBlocks.filter(b => b.type === 'table');

    expect(tableBlocks.length).toBe(1);

    const tableBlock = tableBlocks[0];
    const cellGrid = tableBlock.data.content as Array<Array<{ blocks: string[] }>>;

    // Grid expanded from 3→4 cols, rows stay at 3
    expect(cellGrid.length).toBe(3);
    expect(cellGrid[0].length).toBe(4);

    // Row 0 should have the pasted content
    const row0Texts = cellGrid[0].map(cell => resolveBlockText(allBlocks, cell.blocks[0]));

    expect(row0Texts).toStrictEqual(['test', 'test', 'peach test', 'new column']);

    // Row 2 (last row) should NOT contain any pasted text — all cells should be empty
    const row2Texts = cellGrid[2].map(cell => resolveBlockText(allBlocks, cell.blocks[0]));

    expect(row2Texts.every(t => t === '')).toBe(true);

    // "new column" should appear exactly once across all paragraph blocks
    const allTexts = allBlocks
      .filter(b => b.type === 'paragraph')
      .map(b => b.data.text as string);

    expect(allTexts.filter(t => t === 'new column').length).toBe(1);
  });

  test('No orphaned contentIds after paste + read-only toggle', async ({ page }) => {
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              withHeadingColumn: false,
              content: [
                ['A1', 'B1'],
                ['A2', 'B2'],
              ],
            },
          },
        ],
      },
    });

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible({ timeout: 5000 });

    const cells = table.locator(CELL_SELECTOR);

    await expect(cells).toHaveCount(4);

    // Click cell (0,0)
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to target first cell
    const firstCell = cells.first();

    await firstCell.click();

    const firstCellEditable = firstCell.locator('[contenteditable="true"]');

    await expect(firstCellEditable).toBeFocused({ timeout: 2000 });

    // Paste a 1x1 Google Docs table into cell (0,0)
    const googleDocsHTML = [
      '<table><tbody><tr>',
      '<td><p>Replaced</p></td>',
      '</tr></tbody></table>',
    ].join('');

    await paste(firstCellEditable, {
      'text/html': googleDocsHTML,
      'text/plain': 'Replaced',
    });

    // Wait for pasted content to appear
    await waitForPasteComplete(page, 'Replaced');

    // Toggle read-only and back
    await page.evaluate(async () => {
      await window.blokInstance?.readOnly.toggle(true);
      await window.blokInstance?.readOnly.toggle(false);
    });

    // Wait for edit mode to be re-established
    await page.waitForFunction(() => {
      const editables = document.querySelectorAll('[contenteditable="true"]');

      return editables.length > 0;
    }, { timeout: 5000 });

    const savedData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    expect(savedData).toBeDefined();
    expect(savedData).toHaveProperty('blocks');

    const allBlocks = (savedData as { blocks: SavedBlock[] }).blocks;
    const tableBlocks = allBlocks.filter(b => b.type === 'table');

    expect(tableBlocks.length).toBe(1);

    expect(tableBlocks[0].content).toBeDefined();

    const contentIds = tableBlocks[0].content as string[];
    const existingBlockIds = new Set(allBlocks.map(b => b.id));
    const orphanedIds = contentIds.filter(id => !existingBlockIds.has(id));

    // After fix: no orphaned contentIds should remain
    expect(orphanedIds).toStrictEqual([]);
  });

  test('Caret is placed at the end of the last pasted cell after grid paste', async ({ page }) => {
    // After pasting a multi-cell payload, the caret should land at the end of
    // the last (bottom-right) pasted cell, not at some random empty cell.

    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              withHeadingColumn: false,
              content: [
                ['', '', ''],
                ['', '', ''],
                ['', '', ''],
              ],
            },
          },
        ],
      },
    });

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible({ timeout: 5000 });

    const cells = table.locator(CELL_SELECTOR);

    await expect(cells).toHaveCount(9);

    // Click on cell (0,0)
    // eslint-disable-next-line playwright/no-nth-methods -- targeting first cell
    const firstCell = cells.first();

    await firstCell.click();

    const firstCellEditable = firstCell.locator('[contenteditable="true"]');

    await expect(firstCellEditable).toBeFocused({ timeout: 2000 });

    // Paste a 1×3 row (3 cells into first row starting at col 0)
    const googleDocsHTML = [
      '<meta charset="utf-8">',
      '<b style="font-weight:normal;" id="docs-internal-guid-caret-test">',
      '<div dir="ltr" style="margin-left:0pt;" align="left">',
      '<table style="border:none;border-collapse:collapse;">',
      '<tbody>',
      '<tr>',
      '<td style="border:solid #000 1pt;padding:5pt;">',
      '<p dir="ltr"><span>alpha</span></p>',
      '</td>',
      '<td style="border:solid #000 1pt;padding:5pt;">',
      '<p dir="ltr"><span>beta</span></p>',
      '</td>',
      '<td style="border:solid #000 1pt;padding:5pt;">',
      '<p dir="ltr"><span>gamma</span></p>',
      '</td>',
      '</tr>',
      '</tbody>',
      '</table>',
      '</div>',
      '</b>',
    ].join('');

    // Paste Google Docs HTML using synthetic paste event (works reliably in headless CI)
    await paste(firstCellEditable, {
      'text/html': googleDocsHTML,
      'text/plain': 'alpha\tbeta\tgamma',
    });

    await waitForPasteComplete(page, 'gamma');

    // The caret should be in the last pasted cell: row 0, col 2 (the "gamma" cell)
    // eslint-disable-next-line playwright/no-nth-methods -- nth(2) targets the specific third cell (last pasted)
    const lastPastedCell = cells.nth(2);
    const lastCellEditable = lastPastedCell.locator('[contenteditable="true"]');

    // The focused element should be inside the last pasted cell
    await expect(lastCellEditable).toBeFocused({ timeout: 2000 });
  });

  test('Pasted-into cells remain editable — typing works after a multi-cell paste', async ({ page }) => {
    // Regression: after pasting a multi-cell payload the pasted cells became
    // non-editable (contenteditable was not set or was set to "false" on the
    // new block holders inserted by pasteCellPayload).

    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              withHeadingColumn: false,
              content: [
                ['A1', 'B1', 'C1'],
                ['A2', 'B2', 'C2'],
              ],
            },
          },
        ],
      },
    });

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible({ timeout: 5000 });

    const cells = table.locator(CELL_SELECTOR);

    await expect(cells).toHaveCount(6);

    // Click cell (0,0) to focus it
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to target first cell
    const firstCell = cells.first();

    await firstCell.click();

    const firstCellEditable = firstCell.locator('[contenteditable="true"]');

    await expect(firstCellEditable).toBeFocused({ timeout: 2000 });

    // Paste a 1×2 Blok custom format into cell (0,0)
    const payload = {
      rows: 1,
      cols: 2,
      cells: [
        [
          { blocks: [{ tool: 'paragraph', data: { text: 'Pasted-A' } }] },
          { blocks: [{ tool: 'paragraph', data: { text: 'Pasted-B' } }] },
        ],
      ],
    };

    const json = JSON.stringify(payload).replace(/'/g, '&#39;');
    const customHtml = `<table data-blok-table-cells='${json}'><tr><td>Pasted-A</td><td>Pasted-B</td></tr></table>`;

    await paste(firstCellEditable, {
      'text/html': customHtml,
      'text/plain': 'Pasted-A\tPasted-B',
    });

    await waitForPasteComplete(page, 'Pasted-A');

    // After paste, verify that BOTH pasted cells still have contenteditable="true" elements
    // eslint-disable-next-line playwright/no-nth-methods -- nth(0) and nth(1) target specific paste-destination cells
    const pastedCell0 = cells.nth(0);
    // eslint-disable-next-line playwright/no-nth-methods -- nth(1) targets the second cell
    const pastedCell1 = cells.nth(1);

    const editable0 = pastedCell0.locator('[data-blok-table-cell-blocks] [contenteditable="true"]');
    const editable1 = pastedCell1.locator('[data-blok-table-cell-blocks] [contenteditable="true"]');

    await expect(editable0).toBeVisible({ timeout: 3000 });
    await expect(editable1).toBeVisible({ timeout: 3000 });

    // Click cell (0,0) and verify we can type into it
    await editable0.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' typed');

    // Verify that typing actually worked (text appeared)
    await expect(editable0).toContainText('Pasted-A typed', { timeout: 3000 });

    // Click cell (0,1) and verify we can also type into it
    await editable1.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' typed');

    await expect(editable1).toContainText('Pasted-B typed', { timeout: 3000 });
  });

  test('Pasted-into cells remain editable after read-only toggle roundtrip', async ({ page }) => {
    // Regression: after pasting and then toggling read-only on+off, pasted cells
    // should have contenteditable="true" and allow typing.

    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              withHeadingColumn: false,
              content: [
                ['A1', 'B1'],
                ['A2', 'B2'],
              ],
            },
          },
        ],
      },
    });

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible({ timeout: 5000 });

    const cells = table.locator(CELL_SELECTOR);

    await expect(cells).toHaveCount(4);

    // Click cell (0,0) to focus it
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to target first cell
    const firstCell = cells.first();

    await firstCell.click();

    const firstCellEditable = firstCell.locator('[contenteditable="true"]');

    await expect(firstCellEditable).toBeFocused({ timeout: 2000 });

    // Paste a 1×2 Blok custom format into cell (0,0)
    const payload = {
      rows: 1,
      cols: 2,
      cells: [
        [
          { blocks: [{ tool: 'paragraph', data: { text: 'Pasted-X' } }] },
          { blocks: [{ tool: 'paragraph', data: { text: 'Pasted-Y' } }] },
        ],
      ],
    };

    const json = JSON.stringify(payload).replace(/'/g, '&#39;');
    const customHtml = `<table data-blok-table-cells='${json}'><tr><td>Pasted-X</td><td>Pasted-Y</td></tr></table>`;

    await paste(firstCellEditable, {
      'text/html': customHtml,
      'text/plain': 'Pasted-X\tPasted-Y',
    });

    await waitForPasteComplete(page, 'Pasted-X');

    // Toggle read-only ON
    await page.evaluate(async () => {
      await window.blokInstance?.readOnly.toggle();
    });
    await page.waitForFunction(() => window.blokInstance?.readOnly.isEnabled === true);

    // Toggle read-only OFF
    await page.evaluate(async () => {
      await window.blokInstance?.readOnly.toggle();
    });
    await page.waitForFunction(() => window.blokInstance?.readOnly.isEnabled === false);

    // After read-only roundtrip, pasted cells must still be editable
    // eslint-disable-next-line playwright/no-nth-methods -- nth(0) and nth(1) target specific paste-destination cells
    const pastedCell0 = cells.nth(0);
    // eslint-disable-next-line playwright/no-nth-methods -- nth(1) targets second cell
    const pastedCell1 = cells.nth(1);

    const editable0 = pastedCell0.locator('[data-blok-table-cell-blocks] [contenteditable="true"]');
    const editable1 = pastedCell1.locator('[data-blok-table-cell-blocks] [contenteditable="true"]');

    await expect(editable0).toBeVisible({ timeout: 3000 });
    await expect(editable1).toBeVisible({ timeout: 3000 });

    // Click and type into first pasted cell
    await editable0.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' after-toggle');

    await expect(editable0).toContainText('Pasted-X after-toggle', { timeout: 3000 });

    // Click and type into second pasted cell
    await editable1.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' after-toggle');

    await expect(editable1).toContainText('Pasted-Y after-toggle', { timeout: 3000 });
  });

  test('Pasting twice into the same cells leaves them editable', async ({ page }) => {
    // Regression: pasting into a cell that was already pasted into should not
    // leave the cell non-editable (contenteditable="false" or missing).

    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              withHeadingColumn: false,
              content: [
                ['A1', 'B1'],
                ['A2', 'B2'],
              ],
            },
          },
        ],
      },
    });

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible({ timeout: 5000 });

    const cells = table.locator(CELL_SELECTOR);

    await expect(cells).toHaveCount(4);

    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to target first cell
    const firstCell = cells.first();
    const firstCellEditable = firstCell.locator('[contenteditable="true"]');

    // First paste
    await firstCell.click();
    await expect(firstCellEditable).toBeFocused({ timeout: 2000 });

    const payload1 = {
      rows: 1,
      cols: 2,
      cells: [
        [
          { blocks: [{ tool: 'paragraph', data: { text: 'First-A' } }] },
          { blocks: [{ tool: 'paragraph', data: { text: 'First-B' } }] },
        ],
      ],
    };
    const json1 = JSON.stringify(payload1).replace(/'/g, '&#39;');
    const html1 = `<table data-blok-table-cells='${json1}'><tr><td>First-A</td><td>First-B</td></tr></table>`;

    await paste(firstCellEditable, { 'text/html': html1, 'text/plain': 'First-A\tFirst-B' });
    await waitForPasteComplete(page, 'First-A');

    // Second paste into the same cell
    // eslint-disable-next-line playwright/no-nth-methods -- first() targets first cell after re-querying
    const firstCellEditableAfterPaste1 = cells.first().locator('[contenteditable="true"]');

    await firstCellEditableAfterPaste1.click();
    await expect(firstCellEditableAfterPaste1).toBeFocused({ timeout: 2000 });

    const payload2 = {
      rows: 1,
      cols: 2,
      cells: [
        [
          { blocks: [{ tool: 'paragraph', data: { text: 'Second-A' } }] },
          { blocks: [{ tool: 'paragraph', data: { text: 'Second-B' } }] },
        ],
      ],
    };
    const json2 = JSON.stringify(payload2).replace(/'/g, '&#39;');
    const html2 = `<table data-blok-table-cells='${json2}'><tr><td>Second-A</td><td>Second-B</td></tr></table>`;

    await paste(firstCellEditableAfterPaste1, { 'text/html': html2, 'text/plain': 'Second-A\tSecond-B' });
    await waitForPasteComplete(page, 'Second-A');

    // After second paste, cells must be editable
    // eslint-disable-next-line playwright/no-nth-methods -- nth(0) and nth(1) target specific paste-destination cells
    const pastedCell0 = cells.nth(0);
    // eslint-disable-next-line playwright/no-nth-methods -- nth(1) targets second cell
    const pastedCell1 = cells.nth(1);

    const editable0 = pastedCell0.locator('[data-blok-table-cell-blocks] [contenteditable="true"]');
    const editable1 = pastedCell1.locator('[data-blok-table-cell-blocks] [contenteditable="true"]');

    await expect(editable0).toBeVisible({ timeout: 3000 });
    await expect(editable1).toBeVisible({ timeout: 3000 });

    // Verify typing works after second paste
    await editable0.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' typed');

    await expect(editable0).toContainText('Second-A typed', { timeout: 3000 });

    await editable1.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' typed');

    await expect(editable1).toContainText('Second-B typed', { timeout: 3000 });
  });

  test('Pasting plain text (non-table clipboard) into a cell leaves the cell editable', async ({ page }) => {
    // Reproduction: user copies text from inside a table cell (produces plain text/HTML,
    // NOT Blok table format), then pastes into another cell.
    // The destination cell must remain editable after the paste.

    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              withHeadingColumn: false,
              content: [
                ['Hello World', 'Target'],
                ['A2', 'B2'],
              ],
            },
          },
        ],
      },
    });

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible({ timeout: 5000 });

    const cells = table.locator(CELL_SELECTOR);

    await expect(cells).toHaveCount(4);

    // Click the target cell (0,1)
    // eslint-disable-next-line playwright/no-nth-methods -- nth(1) targets second cell (destination)
    const targetCell = cells.nth(1);
    const targetCellEditable = targetCell.locator('[contenteditable="true"]');

    await targetCellEditable.click();
    await expect(targetCellEditable).toBeFocused({ timeout: 2000 });

    // Simulate paste of plain text from another cell (no table format, just HTML fragment)
    // This is what the browser produces when the user copies text from a contenteditable
    await paste(targetCellEditable, {
      'text/plain': 'Hello World',
      'text/html': '<span>Hello World</span>',
    });

    // Wait for the paste to be processed
    await page.waitForFunction(
      () => {
        const targetCellBlocks = document.querySelectorAll('[data-blok-table-cell-blocks]');
        // The second cell (index 1) should now contain "Hello World"
        const secondCellBlocks = targetCellBlocks[1];

        return secondCellBlocks?.textContent?.includes('Hello World') ?? false;
      },
      undefined,
      { timeout: 5000 }
    );

    // The destination cell must still have contenteditable="true" elements
    const destEditable = targetCell.locator('[data-blok-table-cell-blocks] [contenteditable="true"]');

    await expect(destEditable).toBeVisible({ timeout: 3000 });

    // Verify we can type into the destination cell
    await destEditable.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' typed');

    await expect(destEditable).toContainText('Hello World typed', { timeout: 3000 });
  });

  test('Pasting realistic browser clipboard HTML (with contenteditable attributes) into a cell leaves the cell editable', async ({ page }) => {
    // Reproduction: when a user selects text inside a table cell and copies it,
    // the browser clipboard HTML typically includes the wrapping elements with
    // data-blok-* attributes and contenteditable="true". This test verifies that
    // pasting such HTML does not break the destination cell's editability.

    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              withHeadingColumn: false,
              content: [
                ['Hello World', 'Target'],
                ['A2', 'B2'],
              ],
            },
          },
        ],
      },
    });

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible({ timeout: 5000 });

    const cells = table.locator(CELL_SELECTOR);

    await expect(cells).toHaveCount(4);

    // Intercept the actual clipboard data that would be produced by copying
    // from the first cell's contenteditable. We dispatch a copy event on the
    // source cell and capture what the browser serializes.
    // eslint-disable-next-line playwright/no-nth-methods -- nth(0) is the source cell
    const sourceCell = cells.nth(0);
    const sourceCellEditable = sourceCell.locator('[contenteditable="true"]');

    await sourceCellEditable.click();
    await expect(sourceCellEditable).toBeFocused({ timeout: 2000 });

    // Select all text in source cell
    await page.keyboard.press('Control+a');

    // Capture the clipboard HTML that the browser would produce for this selection.
    // We use a synthetic copy event to intercept the data without actually
    // touching the system clipboard (which is restricted in headless mode).
    const capturedClipboard = await page.evaluate(() => {
      const dataStore: Record<string, string> = {};
      const fakeClipboardData = {
        setData: (type: string, data: string): void => {
          dataStore[type] = data;
        },
        getData: (type: string): string => dataStore[type] ?? '',
        types: [] as string[],
      };

      const copyEvent = Object.assign(new Event('copy', {
        bubbles: true,
        cancelable: true,
      }), {
        clipboardData: fakeClipboardData,
      });

      // Dispatch on the active element (source cell's contenteditable)
      const activeElement = document.activeElement;

      if (activeElement) {
        activeElement.dispatchEvent(copyEvent);
      }

      // Also build a realistic HTML string that Chrome would generate when
      // copying selected text from a contenteditable div.
      // This simulates: <meta charset='utf-8'><div data-blok-tool="paragraph"
      //   contenteditable="true">Hello World</div>
      const activeEl = document.activeElement as HTMLElement | null;
      const nativeHtml = activeEl
        ? `<meta charset='utf-8'>${activeEl.outerHTML}`
        : '';

      return {
        blokHtml: dataStore['text/html'] ?? '',
        blokPlain: dataStore['text/plain'] ?? '',
        nativeHtml,
        nativePlain: activeEl?.textContent ?? '',
      };
    });

    // Click on the target cell (second cell)
    // eslint-disable-next-line playwright/no-nth-methods -- nth(1) is the destination cell
    const targetCell = cells.nth(1);
    const targetCellEditable = targetCell.locator('[contenteditable="true"]');

    await targetCellEditable.click();
    await expect(targetCellEditable).toBeFocused({ timeout: 2000 });

    // If the table cell selection handler captured Blok-format HTML, use that.
    // Otherwise fall back to the native browser HTML (which includes contenteditable attrs).
    const htmlToPaste = capturedClipboard.blokHtml || capturedClipboard.nativeHtml;
    const plainToPaste = capturedClipboard.blokPlain || capturedClipboard.nativePlain;

    // Simulate paste with the realistic clipboard content
    await paste(targetCellEditable, {
      'text/html': htmlToPaste,
      'text/plain': plainToPaste,
    });

    // Wait for paste to complete — some text should appear in the target cell
    await page.waitForFunction(
      () => {
        const cellBlocks = document.querySelectorAll('[data-blok-table-cell-blocks]');
        const targetCellBlocks = cellBlocks[1];

        return (targetCellBlocks?.textContent?.trim().length ?? 0) > 0;
      },
      undefined,
      { timeout: 5000 }
    );

    // The destination cell must still have contenteditable="true" elements
    const destEditable = targetCell.locator('[data-blok-table-cell-blocks] [contenteditable="true"]');

    await expect(destEditable).toBeVisible({ timeout: 3000 });

    // Verify we can type into the destination cell after pasting
    await destEditable.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' typed');

    // Cell should have content with " typed" appended
    await expect(destEditable).toContainText('typed', { timeout: 3000 });
  });
});
