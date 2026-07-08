// spec: specs/table-tool-test-plan.md (Paste HTML Table into Editor)
// seed: test/playwright/tests/tools/table.spec.ts

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
 * Dispatch a paste event on the active element using page.evaluate.
 * This mirrors the pattern from table-any-block-type.spec.ts which dispatches
 * on document.activeElement inside page.evaluate().
 */
const pasteHtml = async (page: Page, html: string): Promise<void> => {
  await page.evaluate((pasteData: string) => {
    const activeElement = document.activeElement as HTMLElement | null;

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

test.describe('Paste HTML Table into Editor', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('Pasting a valid HTML table creates a table block', async ({ page }) => {
    // Initialize editor with table tool registered
    await createBlok(page, {
      tools: defaultTools,
    });

    // Click the paragraph block to focus it
     
    const paragraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [contenteditable="true"]`).first();

    await paragraph.click();

    // Dispatch a paste event with a 2x2 HTML table
    await pasteHtml(page, '<table><tr><td>X</td><td>Y</td></tr><tr><td>Z</td><td>W</td></tr></table>');

    // Wait for the table block to appear
    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible({ timeout: 5000 });

    // Verify a table block was created (paste triggers onPaste which creates a table)
    const cells = page.locator(CELL_SELECTOR);
    const cellCount = await cells.count();

    // The table was created from the paste — verify it has cells
    expect(cellCount).toBeGreaterThanOrEqual(4);
  });

  test('Pasting an HTML table with a thead row enables heading row', async ({ page }) => {
    // Initialize editor with table tool registered
    await createBlok(page, {
      tools: defaultTools,
    });

    // Click the paragraph block to focus it
     
    const paragraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [contenteditable="true"]`).first();

    await paragraph.click();

    // Dispatch a paste event with an HTML table that has a thead row
    await pasteHtml(page, '<table><thead><tr><th>H1</th><th>H2</th></tr></thead><tbody><tr><td>D1</td><td>D2</td></tr></tbody></table>');

    // Wait for the table to appear
    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible({ timeout: 5000 });

    // Verify the table was created and check saved data for heading flag
    const savedData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    const tableBlock = savedData?.blocks.find((b: { type: string }) => b.type === 'table');

    expect(tableBlock).toBeDefined();

    // Check withHeadings in saved data — the onPaste handler sets this from thead/th detection
     
    const withHeadings = tableBlock?.data.withHeadings;

    // The table was created from paste; verify headings flag is set
    expect(withHeadings).toBe(true);
  });

  test('Pasting an HTML table with th elements in the first row enables heading row', async ({ page }) => {
    // Initialize editor with table tool registered
    await createBlok(page, {
      tools: defaultTools,
    });

    // Click the paragraph block to focus it
     
    const paragraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [contenteditable="true"]`).first();

    await paragraph.click();

    // Dispatch a paste event with an HTML table using th elements in the first row (no thead wrapper)
    await pasteHtml(page, '<table><tr><th>H1</th><th>H2</th></tr><tr><td>D1</td><td>D2</td></tr></table>');

    // Wait for the table to appear
    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible({ timeout: 5000 });

    // Verify the table was created and check saved data for heading flag
    const savedData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    const tableBlock = savedData?.blocks.find((b: { type: string }) => b.type === 'table');

    expect(tableBlock).toBeDefined();

     
    const withHeadings = tableBlock?.data.withHeadings;

    expect(withHeadings).toBe(true);
  });

  test('Pasting a Google Docs table preserves cell content', async ({ page }) => {
    await createBlok(page, {
      tools: defaultTools,
    });

     
    const paragraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [contenteditable="true"]`).first();

    await paragraph.click();

    // Google Docs wraps clipboard HTML in <b id="docs-internal-guid-..."><div>...</div></b>
    const googleDocsHTML = [
      '<meta charset="utf-8">',
      '<b style="font-weight:normal;" id="docs-internal-guid-abc12345">',
      '<div dir="ltr" style="margin-left:0pt;" align="left">',
      '<table style="border:none;border-collapse:collapse;">',
      '<tbody>',
      '<tr>',
      '<td style="border:solid #000 1pt;padding:5pt;">',
      '<p dir="ltr"><span style="font-weight:700;">Name</span></p>',
      '</td>',
      '<td style="border:solid #000 1pt;padding:5pt;">',
      '<p dir="ltr"><span style="font-weight:700;">Age</span></p>',
      '</td>',
      '</tr>',
      '<tr>',
      '<td style="border:solid #000 1pt;padding:5pt;">',
      '<p dir="ltr"><span>Alice</span></p>',
      '</td>',
      '<td style="border:solid #000 1pt;padding:5pt;">',
      '<p dir="ltr"><span>30</span></p>',
      '</td>',
      '</tr>',
      '</tbody>',
      '</table>',
      '</div>',
      '</b>',
    ].join('');

    await paste(paragraph, { 'text/html': googleDocsHTML });

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    const cells = table.locator(CELL_SELECTOR);

    await expect(cells).toHaveCount(4);

    await expect(cells.filter({ hasText: 'Name' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'Age' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'Alice' })).toHaveCount(1);
    await expect(cells.filter({ hasText: '30' })).toHaveCount(1);
  });

  test('Pasting a Google Docs table does not leave orphaned cell blocks after read-only toggle', async ({ page }) => {
    await createBlok(page, {
      tools: defaultTools,
    });

     
    const paragraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [contenteditable="true"]`).first();

    await paragraph.click();

    // Google Docs wraps clipboard HTML in <b id="docs-internal-guid-..."><div>...</div></b>
    const googleDocsHTML = [
      '<meta charset="utf-8">',
      '<b style="font-weight:normal;" id="docs-internal-guid-abc12345">',
      '<div dir="ltr" style="margin-left:0pt;" align="left">',
      '<table style="border:none;border-collapse:collapse;">',
      '<tbody>',
      '<tr>',
      '<td style="border:solid #000 1pt;padding:5pt;">',
      '<p dir="ltr"><span>A</span></p>',
      '</td>',
      '<td style="border:solid #000 1pt;padding:5pt;">',
      '<p dir="ltr"><span>B</span></p>',
      '</td>',
      '</tr>',
      '<tr>',
      '<td style="border:solid #000 1pt;padding:5pt;">',
      '<p dir="ltr"><span>C</span></p>',
      '</td>',
      '<td style="border:solid #000 1pt;padding:5pt;">',
      '<p dir="ltr"><span>D</span></p>',
      '</td>',
      '</tr>',
      '</tbody>',
      '</table>',
      '</div>',
      '</b>',
    ].join('');

    await paste(paragraph, { 'text/html': googleDocsHTML });

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // After paste, there should be exactly 1 table + 4 cell paragraphs = 5 blocks.
    // No orphaned cell blocks from the initial default 3x3 grid should remain.
    const beforeToggle = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    const tableBlock = beforeToggle?.blocks.find(
      (b: { type: string }) => b.type === 'table'
    );

    expect(tableBlock).toBeDefined();

    expect(beforeToggle?.blocks.length).toBe(5);

    // Toggle to read-only and back to edit mode
    await page.evaluate(async () => {
      await window.blokInstance?.readOnly.toggle(true);
      await window.blokInstance?.readOnly.toggle(false);
    });

    // Save after read-only toggle — the editor may add one default trailing paragraph,
    // but there must not be 9+ orphaned cell blocks from the old default grid.
    const afterToggle = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    expect(afterToggle).toBeDefined();
    expect(afterToggle).toHaveProperty('blocks');

    const topLevelBlocksAfter = (afterToggle as { blocks: Array<{ parent?: string }> }).blocks.filter(
      (b) => b.parent === undefined
    );

    // At most 2 top-level blocks: the table + one trailing default paragraph
    expect(topLevelBlocksAfter.length).toBeLessThanOrEqual(2);
  });
});

test.describe('Paste HTML table with merged cells', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await createBlok(page, { tools: defaultTools });

    const paragraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [contenteditable="true"]`).first();

    await paragraph.click();
  });

  test('colspan and rowspan survive the full paste pipeline (sanitizer included)', async ({ page }) => {
    // Google-Docs-style layout: a wide merged header cell, a tall merged
    // left cell, and regular data cells around them.
    await pasteHtml(page, [
      '<table>',
      '<tr><td>Month</td><td colspan="2">May 2026</td></tr>',
      '<tr><td rowspan="2">Vacancy</td><td>Goal</td><td>Fact</td></tr>',
      '<tr><td>125</td><td>188</td></tr>',
      '</table>',
    ].join(''));

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible({ timeout: 5000 });

    // Merged origins keep their span attributes in the rendered grid
    const wideCell = table.locator(CELL_SELECTOR, { hasText: 'May 2026' });
    const tallCell = table.locator(CELL_SELECTOR, { hasText: 'Vacancy' });

    await expect(wideCell).toHaveAttribute('colspan', '2');
    await expect(tallCell).toHaveAttribute('rowspan', '2');

    // Cells after the rowspan land in their logical columns, not shifted left
    const lastRowCells = table.locator('[data-blok-table-row]').nth(2).locator(CELL_SELECTOR);

    await expect(lastRowCells).toHaveCount(2);
    await expect(lastRowCells.nth(0)).toHaveAttribute('data-blok-table-cell-col', '1');

    // The merge structure round-trips through save()
    const saved = await page.evaluate(async () => window.blokInstance?.save());
    const tableBlock = saved?.blocks.find((b: { type: string }) => b.type === 'table');

    expect(tableBlock).toBeDefined();

    const content = (tableBlock?.data as {
      content: Array<Array<{ colspan?: number; rowspan?: number; mergedInto?: [number, number] }>>;
    }).content;

    expect(content[0][1].colspan).toBe(2);
    expect(content[0][2].mergedInto).toEqual([0, 1]);
    expect(content[1][0].rowspan).toBe(2);
    expect(content[2][0].mergedInto).toEqual([1, 0]);
  });

  test('merged th header cells survive paste', async ({ page }) => {
    await pasteHtml(page, [
      '<table><thead>',
      '<tr><th colspan="3">Quarter</th><th rowspan="2">Total</th></tr>',
      '<tr><th>Jan</th><th>Feb</th><th>Mar</th></tr>',
      '</thead><tbody>',
      '<tr><td>1</td><td>2</td><td>3</td><td>6</td></tr>',
      '</tbody></table>',
    ].join(''));

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible({ timeout: 5000 });
    await expect(table.locator(CELL_SELECTOR, { hasText: 'Quarter' })).toHaveAttribute('colspan', '3');
    await expect(table.locator(CELL_SELECTOR, { hasText: 'Total' })).toHaveAttribute('rowspan', '2');

    // 4 logical columns: second header row occupies columns 0-2 under the span
    const secondRowCells = table.locator('[data-blok-table-row]').nth(1).locator(CELL_SELECTOR);

    await expect(secondRowCells).toHaveCount(3);
    await expect(secondRowCells.nth(0)).toHaveAttribute('data-blok-table-cell-col', '0');
    await expect(secondRowCells.nth(2)).toHaveAttribute('data-blok-table-cell-col', '2');
  });
});
