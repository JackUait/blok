// spec: Table Configuration - Stretched Option
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

test.describe('Table Configuration - Stretched Option', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('table with stretched:true in saved data persists through save-load cycle', async ({ page }) => {
    // 1. Init editor with table data including stretched: true, content: [['A','B'],['C','D']]
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
              stretched: true,
              content: [['A', 'B'], ['C', 'D']],
            },
          },
        ],
      },
    });

    // 2. Wait for the table to be visible
    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // 3. Call editor.save()
    const savedData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    // Verify: saved table block data has stretched: true
    const tableBlock = savedData?.blocks.find((b: { type: string }) => b.type === 'table');

    expect(tableBlock).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(tableBlock?.data.stretched).toBe(true);
  });

  test('config stretched:true is reflected in saved data for new tables', async ({ page }) => {
    // 1. Init editor with table tool configured: config: { stretched: true }
    await createBlok(page, {
      tools: {
        table: {
          className: 'Blok.Table',
          config: { stretched: true },
        },
      },
    });

    // 2. Click the first empty paragraph block
    const firstParagraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [contenteditable="true"] >> nth=0`);

    await firstParagraph.click();

    // 3. Type '/' to open the slash menu
    await page.keyboard.type('/');

    // 4. Wait for the toolbox popover to open via DOM attribute, then force-click the 'Table' entry
    await page.waitForFunction(
      () => document.querySelector('[data-blok-testid="toolbox-popover"][data-blok-popover-opened="true"]') !== null,
      { timeout: 3000 }
    );

    const tableToolboxItem = page.locator('[data-blok-item-name="table"]');

    await tableToolboxItem.click({ force: true });

    // 5. Wait for the table block to appear in the editor
    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // Verify: default 3x3 dimensions (9 cells)
    const cells = page.locator(CELL_SELECTOR);

    await expect(cells).toHaveCount(9);

    // 6. Call save()
    const savedData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    // Verify: saved table block has stretched: true
    const tableBlock = savedData?.blocks.find((b: { type: string }) => b.type === 'table');

    expect(tableBlock).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(tableBlock?.data.stretched).toBe(true);
  });
});
