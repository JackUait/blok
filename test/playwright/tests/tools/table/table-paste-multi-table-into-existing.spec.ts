/**
 * Regression test: pasting multi-table Google Docs HTML into an existing table
 * should NOT overwrite the existing table's content.
 *
 * Bug: User edits a table, pastes Google Docs content with multiple tables,
 * and the existing table's content vanishes.
 *
 * Root cause: handleGridPaste in the table tool intercepts the paste event,
 * parses only the first table via parseGenericHtmlTable, and overwrites
 * existing cells at the paste position. Additional tables are silently dropped.
 */

import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

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
 */
function resolveBlockText(blocks: SavedBlock[], blockId: string): string {
  const block = blocks.find(b => b.id === blockId);

  return typeof block?.data?.text === 'string' ? block.data.text : '';
}

/**
 * Build Google Docs HTML containing two tables.
 */
function buildMultiTableGoogleDocsHtml(): string {
  return [
    '<meta charset="utf-8">',
    '<b style="font-weight:normal;" id="docs-internal-guid-multi-table">',
    '<div dir="ltr" style="margin-left:0pt;" align="left">',
    '<table style="border:none;border-collapse:collapse;">',
    '<tbody>',
    '<tr>',
    '<td style="border:solid #000 1pt;padding:5pt;">',
    '<p dir="ltr"><span>PastedA1</span></p>',
    '</td>',
    '<td style="border:solid #000 1pt;padding:5pt;">',
    '<p dir="ltr"><span>PastedA2</span></p>',
    '</td>',
    '</tr>',
    '</tbody>',
    '</table>',
    '</div>',
    '<div dir="ltr" style="margin-left:0pt;" align="left">',
    '<table style="border:none;border-collapse:collapse;">',
    '<tbody>',
    '<tr>',
    '<td style="border:solid #000 1pt;padding:5pt;">',
    '<p dir="ltr"><span>PastedB1</span></p>',
    '</td>',
    '<td style="border:solid #000 1pt;padding:5pt;">',
    '<p dir="ltr"><span>PastedB2</span></p>',
    '</td>',
    '</tr>',
    '</tbody>',
    '</table>',
    '</div>',
    '</b>',
  ].join('');
}

test.describe('Multi-table paste into existing table — content preservation', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('Pasting multi-table Google Docs HTML into a table cell preserves existing table content', async ({ page }) => {
    // Create editor with a pre-populated 2x2 table
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
                ['Original1', 'Original2'],
                ['Original3', 'Original4'],
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

    // Click on cell (0,0) to focus it
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to target first cell
    const firstCell = cells.first();

    await firstCell.click();

    const firstCellEditable = firstCell.locator('[contenteditable="true"]');

    await expect(firstCellEditable).toBeFocused({ timeout: 2000 });

    // Paste Google Docs HTML with TWO tables
    const multiTableHtml = buildMultiTableGoogleDocsHtml();

    await paste(firstCellEditable, {
      'text/html': multiTableHtml,
      'text/plain': 'PastedA1\tPastedA2\nPastedB1\tPastedB2',
    });

    // Wait for paste processing to complete by checking the DOM for at least 2 table blocks.
    // The paste handler is fire-and-forget async, so we need to wait for the pasted tables
    // to appear in the DOM before calling save().
    await page.waitForFunction(
      () => document.querySelectorAll('[data-blok-tool="table"]').length >= 2,
      { timeout: 5000 }
    );

    // Now that the DOM is stable, save() should return the full state
    const allBlocks = await page.waitForFunction(async () => {
      const data = await window.blokInstance?.save();
      const blocks = data?.blocks;

      if (!Array.isArray(blocks) || blocks.length === 0) {
        return false;
      }

      const tableCount = blocks.filter((b: { type: string }) => b.type === 'table').length;

      if (tableCount < 2) {
        return false;
      }

      return blocks;
    }, undefined, { timeout: 5000 }).then(handle => handle.jsonValue()) as SavedBlock[];

    const tableBlocks = allBlocks.filter(b => b.type === 'table');

    // The existing table should still exist
    expect(tableBlocks.length).toBeGreaterThanOrEqual(1);

    const existingTable = tableBlocks[0];
    const cellGrid = existingTable.data.content as Array<Array<{ blocks: string[] }>>;

    // The existing table should still be 2x2
    expect(cellGrid.length).toBe(2);
    expect(cellGrid[0].length).toBe(2);

    // CRITICAL ASSERTION: The existing table's content should be preserved.
    // Cells that were NOT at the paste target should retain their original data.
    // At minimum, row 1 (Original3, Original4) should be untouched.
    const cell10Text = resolveBlockText(allBlocks, cellGrid[1][0].blocks[0]);
    const cell11Text = resolveBlockText(allBlocks, cellGrid[1][1].blocks[0]);

    expect(cell10Text).toBe('Original3');
    expect(cell11Text).toBe('Original4');

    // Ideally, the existing table's first row should also be preserved
    // (pasted tables should appear as new blocks, not overwrite existing cells)
    const cell00Text = resolveBlockText(allBlocks, cellGrid[0][0].blocks[0]);
    const cell01Text = resolveBlockText(allBlocks, cellGrid[0][1].blocks[0]);

    expect(cell00Text).toBe('Original1');
    expect(cell01Text).toBe('Original2');
  });

  test('Pasting multi-table Google Docs HTML into a table cell creates new table blocks', async ({ page }) => {
    // Create editor with a pre-populated 2x2 table
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
                ['Existing1', 'Existing2'],
                ['Existing3', 'Existing4'],
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

    // Click on cell (0,0) to focus it
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to target first cell
    const firstCell = cells.first();

    await firstCell.click();

    const firstCellEditable = firstCell.locator('[contenteditable="true"]');

    await expect(firstCellEditable).toBeFocused({ timeout: 2000 });

    // Paste Google Docs HTML with TWO tables
    const multiTableHtml = buildMultiTableGoogleDocsHtml();

    await paste(firstCellEditable, {
      'text/html': multiTableHtml,
      'text/plain': 'PastedA1\tPastedA2\nPastedB1\tPastedB2',
    });

    // Wait for paste processing to fully complete.
    // The paste handler is fire-and-forget async, and table blocks appear in
    // the DOM (with data-blok-tool="table") during insert() BEFORE onPaste()
    // populates their content. Wait for PastedB1 to appear in the DOM text,
    // which proves the last pasted table's onPaste has completed.
    await expect(page.locator(BLOK_INTERFACE_SELECTOR)).toContainText('PastedB1', { timeout: 10000 });

    // Now that paste processing is fully complete, save and verify
    const allBlocks = await page.evaluate(async () => {
      const data = await window.blokInstance?.save();

      return data?.blocks ?? [];
    }) as SavedBlock[];

    const tableBlocks = allBlocks.filter(b => b.type === 'table');

    // Should have 3 table blocks: 1 existing + 2 pasted
    expect(tableBlocks.length).toBe(3);

    // The pasted content should appear somewhere in the document
    const allParagraphTexts = allBlocks
      .filter(b => b.type === 'paragraph')
      .map(b => b.data.text as string);

    expect(allParagraphTexts).toContain('PastedA1');
    expect(allParagraphTexts).toContain('PastedA2');
    expect(allParagraphTexts).toContain('PastedB1');
    expect(allParagraphTexts).toContain('PastedB2');
  });
});
