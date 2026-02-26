// spec: specs/table-tool-test-plan.md (Data Save and Load suite)
// seed: test/playwright/tests/tools/table.spec.ts

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;
const CELL_SELECTOR = '[data-blok-table-cell]';
const ROW_GRIP_SELECTOR = '[data-blok-table-grip-row]';

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
};

test.describe('Data Save and Load', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('Save returns correct JSON structure for a table with content', async ({ page }) => {
    // 1. Initialize 2x2 table with ['Name','Value','foo','bar'] and withHeadings:true
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

    // 2. Call save() and verify output structure: type 'table', withHeadings true, content is 2x2 with blocks arrays
    const savedData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    const tableBlock = savedData?.blocks.find((b: { type: string }) => b.type === 'table');

    expect(tableBlock).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(tableBlock?.data.withHeadings).toBe(true);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const content = tableBlock?.data.content as { blocks: string[] }[][];

    // 3. Verify content is 2x2 with blocks arrays
    expect(content).toHaveLength(2);
    expect(content[0]).toHaveLength(2);
    expect(content[1]).toHaveLength(2);

    // Each cell should have a blocks array with at least one block ID
    for (const row of content) {
      for (const cell of row) {
        expect(cell).toHaveProperty('blocks');
        expect(cell.blocks.length).toBeGreaterThanOrEqual(1);
      }
    }

    // 4. Verify paragraph blocks contain the original text
    const paragraphBlocks = savedData?.blocks.filter((b: { type: string }) => b.type === 'paragraph');
    const paragraphTexts = paragraphBlocks?.map((b: { data: { text: string } }) => b.data.text) as string[];

    expect(paragraphTexts).toContain('Name');
    expect(paragraphTexts).toContain('Value');
    expect(paragraphTexts).toContain('foo');
    expect(paragraphTexts).toContain('bar');
  });

  test('Column widths persist through save, destroy, and reinitialize', async ({ page }) => {
    // 1. Initialize with colWidths:[400,200] and save()
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

    const savedData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    // 2. Destroy and reinitialize with saved data
    await page.evaluate(async (data) => {
      await window.blokInstance?.destroy();
      window.blokInstance = undefined;

      const blok = new window.Blok({
        holder: 'blok',
        data,
        tools: {
          table: {
            class: (window as unknown as Record<string, Record<string, unknown>>).Blok.Table,
          },
        },
      });

      window.blokInstance = blok;
      await blok.isReady;
    }, savedData);

    // 3. Verify first column is still 400px and second column is 200px
    const firstCellWidth = await page.evaluate(() => {
      const cell = document.querySelector('[data-blok-table-cell]') as HTMLElement;

      return cell?.style.width;
    });

    expect(firstCellWidth).toBe('400px');

    const secondCellWidth = await page.evaluate(() => {
      const cells = document.querySelectorAll('[data-blok-table-cell]');

      return (cells[1] as HTMLElement)?.style.width;
    });

    expect(secondCellWidth).toBe('200px');
  });

  test('Legacy string content is migrated to block format on load', async ({ page }) => {
    // 1. Initialize with legacy string content [['A','B'],['C','D']]
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

    // 2. Verify rendered text is visible in cells
    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    const cells = page.locator(CELL_SELECTOR);

    await expect(cells.filter({ hasText: 'A' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'B' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'C' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'D' })).toHaveCount(1);

    // 3. Call save() and verify migrated to block format
    const savedData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    const tableBlock = savedData?.blocks.find((b: { type: string }) => b.type === 'table');

    expect(tableBlock).toBeDefined();

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const content = tableBlock?.data.content as { blocks: string[] }[][];

    // 4. Verify saved content uses block format (each cell has a blocks array)
    for (const row of content) {
      for (const cell of row) {
        expect(cell).toHaveProperty('blocks');
        expect(Array.isArray(cell.blocks)).toBe(true);
        expect(cell.blocks.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  test('Deleting table block removes it and all orphaned blocks from saved output', async ({ page }) => {
    // 1. Initialize 2x2 table and type text in first cell
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

    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell editable
    const firstCellEditable = page.locator(CELL_SELECTOR).first().locator('[contenteditable="true"]').first();

    await firstCellEditable.click();
    await page.keyboard.type('Hello');

    // 2. Delete table block via API (blocks.delete at index 0)
    await page.evaluate(async () => {
      await window.blokInstance?.blocks.delete(0);
    });

    // 3. Call save() and verify no table block in output
    const savedData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    const tableBlock = savedData?.blocks.find((b: { type: string }) => b.type === 'table');

    expect(tableBlock).toBeUndefined();

    // 4. Verify no orphaned paragraph blocks remain that were cell contents
    // After deletion, only a default empty paragraph (from the editor) may remain,
    // but no paragraph with text 'Hello' that belonged to the deleted table cell
    const paragraphBlocks = savedData?.blocks.filter((b: { type: string }) => b.type === 'paragraph');
    const paragraphTexts = (paragraphBlocks ?? []).map((b: { data: { text: string } }) => b.data.text);

    expect(paragraphTexts).not.toContain('Hello');
  });

  test('Insert row via grip popover and verify 3 rows in saved data', async ({ page }) => {
    // 1. Initialize 2x2 table
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

    // 2. Click first cell to show row grip
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
    const firstCell = page.locator(CELL_SELECTOR).first();

    await firstCell.click();

    // 3. Click row grip to open popover
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible row grip
    const rowGrip = page.locator(ROW_GRIP_SELECTOR).first();

    await expect(rowGrip).toBeVisible({ timeout: 2000 });
    await rowGrip.click();

    // 4. Click 'Insert Row Below'
    await page.getByText('Insert Row Below').click();

    // Verify 3 rows are now rendered
    const rows = page.locator('[data-blok-table-row]');

    await expect(rows).toHaveCount(3);

    // 5. Call save() and verify saved content has 3 rows
    const savedData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    const tableBlock = savedData?.blocks.find((b: { type: string }) => b.type === 'table');

    expect(tableBlock).toBeDefined();

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const content = tableBlock?.data.content as { blocks: string[] }[][];

    // 6. Verify 3 rows in saved data
    expect(content).toHaveLength(3);

    // Each row should have 2 cells
    for (const row of content) {
      expect(row).toHaveLength(2);
    }
  });
});
