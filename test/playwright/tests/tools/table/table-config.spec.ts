// spec: specs/table-tool-test-plan.md
// seed: test/playwright/tests/tools/table.spec.ts

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;
const CELL_SELECTOR = '[data-blok-table-cell]';
const TOOLBOX_POPOVER_SELECTOR = '[data-blok-testid="toolbox-popover"]';

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

test.describe('Table Configuration Options', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('Config rows and cols set the initial table dimensions', async ({ page }) => {
    // 1. Initialize editor with the table tool configured: { rows: 5, cols: 4 }
    await createBlok(page, {
      tools: {
        table: {
          className: 'Blok.Table',
          config: { rows: 5, cols: 4 },
        },
      },
    });

    // 2. Click the first empty paragraph block
    const firstParagraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [contenteditable="true"]`).first();

    await firstParagraph.click();

    // 3. Type '/' to open the slash menu
    await page.keyboard.type('/');

    // 4. Wait for the toolbox popover to open via DOM attribute, then force-click the 'Table' entry
    await page.waitForFunction(
      () => document.querySelector('[data-blok-testid="toolbox-popover"][data-blok-popover-opened="true"]') !== null,
      { timeout: 3000 }
    );

    const tableToolboxItem = page.locator('[data-blok-item-name="table"]');

    // eslint-disable-next-line playwright/no-force-option -- popover container intercepting pointer events
    await tableToolboxItem.click({ force: true });

    // 5. Wait for the table block to appear in the editor
    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // Verify: The new table has 5 rows
    const rows = page.locator('[data-blok-table-row]');

    await expect(rows).toHaveCount(5);

    // Verify: All 20 cells are present (5 rows x 4 cols)
    const cells = page.locator(CELL_SELECTOR);

    await expect(cells).toHaveCount(20);
  });

  test('Config withHeadings: true starts new tables with heading row enabled', async ({ page }) => {
    // 1. Initialize editor with table tool configured: { withHeadings: true }
    await createBlok(page, {
      tools: {
        table: {
          className: 'Blok.Table',
          config: { withHeadings: true },
        },
      },
    });

    // 2. Click the first empty paragraph block
    const firstParagraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [contenteditable="true"]`).first();

    await firstParagraph.click();

    // 3. Type '/' to open the slash menu
    await page.keyboard.type('/');

    // 4. Wait for the toolbox popover to open via DOM attribute, then force-click the 'Table' entry
    await page.waitForFunction(
      () => document.querySelector('[data-blok-testid="toolbox-popover"][data-blok-popover-opened="true"]') !== null,
      { timeout: 3000 }
    );

    const tableToolboxItem = page.locator('[data-blok-item-name="table"]');

    // eslint-disable-next-line playwright/no-force-option -- popover container intercepting pointer events
    await tableToolboxItem.click({ force: true });

    // 5. Wait for the table block to appear in the editor
    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // Verify: The first row has data-blok-table-heading attribute without user interaction
    const headingRow = page.locator('[data-blok-table-heading]');

    await expect(headingRow).toBeVisible();

    // Verify: Saved data has withHeadings: true
    const savedData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    const tableBlock = savedData?.blocks.find((b: { type: string }) => b.type === 'table');

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(tableBlock?.data.withHeadings).toBe(true);
  });

  test('Config restrictedTools excludes specified tools from cell toolbox', async ({ page }) => {
    // 1. Initialize editor with table tool configured: { restrictedTools: ['list'] }
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

    // 2. Click the first empty paragraph block to focus the editor
    const firstParagraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [contenteditable="true"]`).first();

    await firstParagraph.click();

    // 3. Insert a table via the slash menu
    await page.keyboard.type('/');

    await page.waitForFunction(
      () => document.querySelector('[data-blok-testid="toolbox-popover"][data-blok-popover-opened="true"]') !== null,
      { timeout: 3000 }
    );

    const tableToolboxItem = page.locator('[data-blok-item-name="table"]');

    // eslint-disable-next-line playwright/no-force-option -- popover container intercepting pointer events
    await tableToolboxItem.click({ force: true });

    // 4. Wait for the table to appear and click into the first cell
    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
    const firstCellEditable = page.locator(CELL_SELECTOR).first().locator('[contenteditable="true"]').first();

    await firstCellEditable.click();

    // 5. Type '/' to open the toolbox inside the cell
    await page.keyboard.type('/');

    // 6. Wait for the toolbox popover to open via DOM attribute
    await page.waitForFunction(
      () => document.querySelector('[data-blok-testid="toolbox-popover"][data-blok-popover-opened="true"]') !== null,
      { timeout: 3000 }
    );

    const toolboxPopover = page.locator(TOOLBOX_POPOVER_SELECTOR);

    // Verify: The list tool items are absent from the toolbox popover (restricted)
    const visibleListItems = toolboxPopover.locator(
      '[data-blok-item-name="bulleted-list"]:not([data-blok-hidden]), [data-blok-item-name="numbered-list"]:not([data-blok-hidden]), [data-blok-item-name="check-list"]:not([data-blok-hidden])'
    );

    await expect(visibleListItems).toHaveCount(0);

    // Verify: The 'Text' (paragraph) item is still visible in the toolbox
    const paragraphItem = toolboxPopover.locator('[data-blok-item-name="paragraph"]:not([data-blok-hidden])');

    await expect(paragraphItem).toBeVisible();
  });

  test('Invalid colWidths (length mismatch with column count) is ignored on load', async ({ page }) => {
    // Capture any JavaScript errors on the page
    const errors: string[] = [];

    page.on('pageerror', (err) => errors.push(err.message));

    // 1. Initialize editor with table data where colWidths has 3 values but only 2 columns exist
    await createBlok(page, {
      tools: {
        table: {
          className: 'Blok.Table',
        },
      },
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['A', 'B'], ['C', 'D']],
              colWidths: [200, 300, 400],
            },
          },
        ],
      },
    });

    // 2. Wait for the table to be visible
    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // Verify: No JavaScript error is thrown
    expect(errors).toHaveLength(0);

    // Verify: The table renders with 2 rows and 4 cells (2x2 content is preserved)
    const cells = page.locator(CELL_SELECTOR);

    await expect(cells).toHaveCount(4);

    // Verify: Cells render with equal widths (invalid colWidths are dropped)
    const cellWidths = await page.evaluate(() => {
      const allCells = document.querySelectorAll('[data-blok-table-cell]');

      return Array.from(allCells).slice(0, 2).map(cell => (cell as HTMLElement).style.width);
    });

    // With a mismatched colWidths, the table should fall back to equal widths (no pixel widths applied)
    // Both cells in the first row should have the same width style (either empty or equal px value)
    expect(cellWidths[0]).toBe(cellWidths[1]);
  });
});
