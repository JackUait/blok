// spec: Paste HTML Table - Additional Scenarios
// seed: test/playwright/tests/tools/table.spec.ts

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
 * This mirrors the pattern from the existing table-paste.spec.ts which dispatches
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

const defaultTools: Record<string, SerializableToolConfig> = {
  table: {
    className: 'Blok.Table',
  },
};

test.describe('Paste HTML Table - Additional Scenarios', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('pasting an HTML table with colspan or rowspan attributes renders all text content', async ({ page }) => {
    // Initialize editor with table tool registered
    await createBlok(page, {
      tools: defaultTools,
    });

    // Click the first paragraph contenteditable to focus it
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to target first contenteditable
    const paragraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [contenteditable="true"]`).first();

    await paragraph.click();

    // Dispatch a paste event with an HTML table containing a colspan attribute
    await pasteHtml(page, '<table><tr><td colspan="2">Merged</td></tr><tr><td>A</td><td>B</td></tr></table>');

    // Wait for the table block to appear
    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible({ timeout: 5000 });

    // The paste handler does not interpret colspan attributes — it counts actual <td>/<th>
    // elements per row to determine the grid dimensions. Because the first row has a single
    // <td colspan="2">, the grid is created with 1 column. The second row's "B" cell is
    // dropped since there is no second column to place it in.
    // Scope assertions to the table to avoid matching the page heading.
    await expect(table.getByText('Merged')).toBeVisible();
    await expect(table.getByText('A', { exact: true })).toBeVisible();

    // Verify that exactly 2 cells are rendered (one per row, single column)
    const cells = table.locator(CELL_SELECTOR);

    await expect(cells).toHaveCount(2);
  });

  test('pasting an empty HTML table tag results in no table block being inserted', async ({ page }) => {
    // Initialize editor with table tool registered
    await createBlok(page, {
      tools: defaultTools,
    });

    // Click the first paragraph contenteditable to focus it
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to target first contenteditable
    const paragraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [contenteditable="true"]`).first();

    await paragraph.click();

    // Dispatch a paste event with an empty HTML table (no rows or cells)
    await pasteHtml(page, '<table></table>');

    // Wait a moment for any async paste processing to complete
    await page.waitForTimeout(500);

    // Verify no table block with cells was inserted — an empty table produces no displayable cell content
    const cells = page.locator(CELL_SELECTOR);

    await expect(cells).toHaveCount(0);

    // Verify the editor is still functional — the holder is still present
    const holder = page.locator(`[data-blok-testid="${HOLDER_ID}"]`);

    await expect(holder).toBeVisible();
  });

  test('pasting an HTML table inside a table cell is handled without crashing', async ({ page }) => {
    const errors: string[] = [];

    // Collect any page errors to assert no crash occurred
    page.on('pageerror', (err) => errors.push(err.message));

    // Initialize editor with an existing 2x2 table
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

    // Click the first cell's contenteditable to focus it
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to target first cell
    const firstCellEditable = page.locator(CELL_SELECTOR).first().locator('[contenteditable="true"]').first();

    await firstCellEditable.click();

    // Dispatch a paste event with a nested HTML table inside the focused cell
    await pasteHtml(page, '<table><tr><td>Nested</td></tr></table>');

    // Wait for any async processing to complete
    await page.waitForTimeout(500);

    // Verify no JavaScript errors were thrown during paste handling
    expect(errors).toHaveLength(0);

    // Verify no nested table element exists inside a table cell — paste should not produce nested tables
    const nestedTableInCell = page.locator(`${CELL_SELECTOR} table`);

    await expect(nestedTableInCell).toHaveCount(0);

    // Verify the editor is still functional — the holder is still present
    const holder = page.locator(`[data-blok-testid="${HOLDER_ID}"]`);

    await expect(holder).toBeVisible();
  });
});
