// spec: Data Normalizer Edge Cases
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

const defaultTools: Record<string, SerializableToolConfig> = {
  table: {
    className: 'Blok.Table',
  },
};

test.describe('Data Normalizer Edge Cases', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('table with missing withHeadings field defaults to false', async ({ page }) => {
    // Initialize editor with table data that omits withHeadings
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              content: [['A', 'B'], ['C', 'D']],
            },
          },
        ],
      },
    });

    // Verify table renders correctly
    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // Verify no heading row styling — no [data-blok-table-heading] attribute present
    const headingRow = page.locator('[data-blok-table-heading]');

    await expect(headingRow).toHaveCount(0);

    // Verify all 4 cells render
    const cells = page.locator(CELL_SELECTOR);

    await expect(cells).toHaveCount(4);

    // Verify save() returns withHeadings: false (the normalized default)
    const savedData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    const tableBlock = savedData?.blocks.find((b: { type: string }) => b.type === 'table');

    expect(tableBlock).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(tableBlock?.data.withHeadings).toBe(false);
  });

  test('table with missing withHeadingColumn field defaults to false', async ({ page }) => {
    // Initialize editor with table data omitting withHeadingColumn (only withHeadings provided)
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

    // Verify table renders correctly
    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // Verify no heading column styling — no data-blok-table-heading-col attributes present
    const headingColCells = page.locator('[data-blok-table-heading-col]');

    await expect(headingColCells).toHaveCount(0);

    // Verify save() returns withHeadingColumn: false (the normalized default)
    const savedData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    const tableBlock = savedData?.blocks.find((b: { type: string }) => b.type === 'table');

    expect(tableBlock).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(tableBlock?.data.withHeadingColumn).toBe(false);
  });

  test('table data normalizer handles undefined content gracefully', async ({ page }) => {
    const errors: string[] = [];

    // Capture any page JS errors
    page.on('pageerror', (err) => errors.push(err.message));

    // Initialize editor with table data that has no content field
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
            },
          },
        ],
      },
    });

    // Verify no JS errors occurred during initialization
    expect(errors).toHaveLength(0);

    // Verify table renders without error
    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // Verify save() resolves without throwing
    const savedData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    expect(savedData).toBeDefined();

    // Verify the saved output contains a valid table block
    const tableBlock = savedData?.blocks.find((b: { type: string }) => b.type === 'table');

    expect(tableBlock).toBeDefined();

    // Verify no errors were captured throughout
    expect(errors).toHaveLength(0);
  });
});
