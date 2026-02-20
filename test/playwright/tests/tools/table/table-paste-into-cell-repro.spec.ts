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
const TEST_PAGE_URL = 'http://localhost:3303/test/playwright/fixtures/test.html';
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

    const allBlocks = (savedData?.blocks ?? []) as SavedBlock[];

    // Should have exactly one table block
    const tableBlocks = allBlocks.filter(b => b.type === 'table');

    expect(tableBlocks.length).toBe(1);

    const tableBlock = tableBlocks[0];

    // Get the contentIds from the table block
    const contentIds = tableBlock.content ?? [];

    // All contentIds should reference existing blocks
    const existingBlockIds = new Set(allBlocks.map(b => b.id));

    const orphanedIds = contentIds.filter(id => !existingBlockIds.has(id));

    expect(orphanedIds).toEqual([]);

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

    const allBlocks = (savedData?.blocks ?? []) as SavedBlock[];
    const tableBlocks = allBlocks.filter(b => b.type === 'table');

    expect(tableBlocks.length).toBe(1);

    const tableBlock = tableBlocks[0];
    const contentIds = tableBlock.content ?? [];

    // All contentIds should reference existing blocks (no orphans)
    const existingBlockIds = new Set(allBlocks.map(b => b.id));
    const orphanedIds = contentIds.filter(id => !existingBlockIds.has(id));

    expect(orphanedIds).toEqual([]);

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

  test('Pasting a single Google Docs row into the first cell does not duplicate content in the last row', async ({ page, context }) => {
    // Regression test: copying one row (4 cells) from Google Docs and pasting into
    // cell (0,0) of a default 3×3 empty table should insert content only in the
    // first row — not also in the last row — and should expand to 4 cols, not 8.

    // Grant clipboard permissions for real paste simulation
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

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

    // Write HTML content to clipboard and trigger real paste via keyboard
    await page.evaluate(async (html: string) => {
      const blob = new Blob([html], { type: 'text/html' });
      const plainBlob = new Blob(['test\ttest\tpeach test\tnew column'], { type: 'text/plain' });

      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': blob,
          'text/plain': plainBlob,
        }),
      ]);
    }, googleDocsHTML);

    // Trigger real paste via keyboard shortcut
    await page.keyboard.press('Meta+v');

    // Wait for pasted content to appear in the DOM
    await waitForPasteComplete(page, 'new column');

    // Save and check results
    const savedData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    const allBlocks = (savedData?.blocks ?? []) as SavedBlock[];

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

    expect(row0Texts).toEqual(['test', 'test', 'peach test', 'new column']);

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

    const allBlocks = (savedData?.blocks ?? []) as SavedBlock[];
    const tableBlocks = allBlocks.filter(b => b.type === 'table');

    expect(tableBlocks.length).toBe(1);

    const contentIds = tableBlocks[0].content ?? [];
    const existingBlockIds = new Set(allBlocks.map(b => b.id));
    const orphanedIds = contentIds.filter(id => !existingBlockIds.has(id));

    // After fix: no orphaned contentIds should remain
    expect(orphanedIds).toEqual([]);
  });

  test('Caret is placed at the end of the last pasted cell after grid paste', async ({ page, context }) => {
    // After pasting a multi-cell payload, the caret should land at the end of
    // the last (bottom-right) pasted cell, not at some random empty cell.

    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

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

    await page.evaluate(async (html: string) => {
      const blob = new Blob([html], { type: 'text/html' });
      const plainBlob = new Blob(['alpha\tbeta\tgamma'], { type: 'text/plain' });

      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': blob,
          'text/plain': plainBlob,
        }),
      ]);
    }, googleDocsHTML);

    await page.keyboard.press('Meta+v');

    await waitForPasteComplete(page, 'gamma');

    // The caret should be in the last pasted cell: row 0, col 2 (the "gamma" cell)
    const lastPastedCell = cells.nth(2);
    const lastCellEditable = lastPastedCell.locator('[contenteditable="true"]');

    // The focused element should be inside the last pasted cell
    await expect(lastCellEditable).toBeFocused({ timeout: 2000 });
  });
});
