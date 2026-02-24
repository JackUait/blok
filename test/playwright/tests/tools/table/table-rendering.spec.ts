// spec: specs/table-tool-test-plan.md
// seed: test/playwright/tests/tools/table.spec.ts

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

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

const assertNoCriticalOrSeriousTableA11yViolations = async (page: Page): Promise<void> => {
  const { violations } = await new AxeBuilder({ page })
    .include(TABLE_SELECTOR)
    .analyze();

  const highImpactViolations = violations.filter(({ impact }) => impact === 'critical' || impact === 'serious');
  const violationSummary = highImpactViolations
    .map(({ id, impact, help }) => `${impact ?? 'unknown'}: ${id} - ${help}`)
    .join('\n');

  expect(highImpactViolations, violationSummary).toStrictEqual([]);
};

const defaultTools: Record<string, SerializableToolConfig> = {
  table: {
    className: 'Blok.Table',
  },
};

test.describe('Table Rendering and Initial State', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('Renders a default 3x3 table when inserted via slash menu with no data', async ({ page }) => {
    // 1. Initialize the editor with the table tool registered (Blok.Table)
    await createBlok(page, { tools: defaultTools });

    // 2. Click the first empty paragraph block
    const firstParagraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [contenteditable="true"] >> nth=0`);

    await firstParagraph.click();

    // 3. Type '/' to open the slash menu
    await page.keyboard.type('/');

    // 4. Wait for the toolbox popover to open via DOM attribute, then force-click the 'Table' entry
    // The popover container may be detected as hidden by Playwright despite being visually rendered,
    // so we wait for its opened attribute and force-click the item.
    await page.waitForFunction(
      () => document.querySelector('[data-blok-testid="toolbox-popover"][data-blok-popover-opened="true"]') !== null,
      { timeout: 3000 }
    );

    const tableToolboxItem = page.locator('[data-blok-item-name="table"]');

    await tableToolboxItem.click({ force: true });

    // 6. Wait for the table block to appear in the editor
    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // Verify: A table block is inserted with 3 rows and 3 columns (default dimensions)
    const rows = page.locator('[data-blok-table-row]');

    await expect(rows).toHaveCount(3);

    // Verify: All 9 cells are visible
    const cells = page.locator(CELL_SELECTOR);

    await expect(cells).toHaveCount(9);

    // Verify: No heading styles are applied by default
    const headingRows = page.locator('[data-blok-table-heading]');

    await expect(headingRows).toHaveCount(0);
  });

  test('Renders a table from saved data with correct cell content', async ({ page }) => {
    // 1. Initialize the editor with table tool and pre-loaded 2x2 table data with cells ['A','B','C','D']
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

    // 2. Wait for the editor to be ready - table block is visible
    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // Verify: 4 cells are rendered (2 rows x 2 columns)
    const cells = page.locator(CELL_SELECTOR);

    await expect(cells).toHaveCount(4);

    // Verify: Cell text content matches: A, B, C, D
    await expect(cells.filter({ hasText: 'A' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'B' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'C' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'D' })).toHaveCount(1);
  });

  test('Renders a table with heading row (first row styled distinctly)', async ({ page }) => {
    // 1. Initialize the editor with table data where withHeadings is true and content is [['H1','H2'],['D1','D2']]
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

    // 2. Wait for the editor to be ready
    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // Verify: The first row has the data-blok-table-heading attribute
    const headingRow = page.locator('[data-blok-table-heading]');

    await expect(headingRow).toBeVisible();
  });

  test('Renders a table with heading column (first column styled distinctly)', async ({ page }) => {
    // 1. Initialize the editor with table data where withHeadingColumn is true
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              withHeadingColumn: true,
              content: [['Row1Col1', 'Row1Col2'], ['Row2Col1', 'Row2Col2']],
            },
          },
        ],
      },
    });

    // 2. Wait for the editor to be ready
    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // Verify: The first cell in every row has the data-blok-table-heading-col attribute
    const headingColCells = page.locator('[data-blok-table-heading-col]');

    await expect(headingColCells).toHaveCount(2);
  });

  test('Renders column widths from saved colWidths data', async ({ page }) => {
    // 1. Initialize editor with table data containing colWidths: [400, 200]
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

    // 2. Wait for the editor to be ready
    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // Verify: The first column renders at 400px wide
    const firstCellWidth = await page.evaluate(() => {
      const cell = document.querySelector('[data-blok-table-cell]') as HTMLElement;

      return cell?.style.width;
    });

    expect(firstCellWidth).toBe('400px');

    // Verify: The second column renders at 200px wide
    const secondCellWidth = await page.evaluate(() => {
      const cells = document.querySelectorAll('[data-blok-table-cell]');

      return (cells[1] as HTMLElement)?.style.width;
    });

    expect(secondCellWidth).toBe('200px');
  });

  test('Table has no critical or serious axe-core accessibility violations in edit mode', async ({ page }) => {
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: true,
              content: [
                ['H1', 'H2', 'H3'],
                ['R1C1', 'R1C2', 'R1C3'],
                ['R2C1', 'R2C2', 'R2C3'],
              ],
            },
          },
        ],
      },
    });

    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();
    await expect(page.locator(CELL_SELECTOR)).toHaveCount(9);

    await assertNoCriticalOrSeriousTableA11yViolations(page);
  });

  test('Table auto-initializes with default grid when content array is empty', async ({ page }) => {
    // 1. Initialize an editor with a table block that has an empty content array
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [],
            },
          },
        ],
      },
    });

    // The table auto-initializes with a default 3x3 grid even when given empty content
    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // 2. Call the editor save() method
    const savedData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    // 3. Verify: The table block IS included (auto-initialized content passes validate)
    expect(savedData).toBeDefined();
    expect(savedData).toHaveProperty('blocks');

    const blocks = (savedData as { blocks: Array<{ type: string; data: Record<string, unknown> }> }).blocks;
    const tableBlock = blocks.find((b) => b.type === 'table');

    expect(tableBlock).toBeDefined();

    expect((tableBlock as { data: Record<string, unknown> }).data).toHaveProperty('content');
  });
});
