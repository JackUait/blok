// spec: Table Scroll Overflow
// seed: test/playwright/tests/seed.spec.ts

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;
const RESIZE_HANDLE_SELECTOR = '[data-blok-table-resize]';

/**
 * Assert a bounding box is non-null and return it with narrowed type.
 * Replaces conditional guards (`if (!box) throw`) to satisfy playwright/no-conditional-in-test.
 */
const assertBoundingBox = (
  box: { x: number; y: number; width: number; height: number } | null,
  label: string
): { x: number; y: number; width: number; height: number } => {
  expect(box, `${label} should have a bounding box`).toBeTruthy();

  return box as { x: number; y: number; width: number; height: number };
};

/**
 * Hover near the right edge of the table so the add-column button becomes visible.
 * The add-col button uses proximity-based visibility (within 40px of the right edge).
 */
const hoverNearRightEdge = async (
  page: Page,
  tableLocator: ReturnType<Page['locator']>
): Promise<void> => {
  const tableBox = assertBoundingBox(await tableLocator.boundingBox(), 'Table for right-edge hover');

  await page.mouse.move(
    tableBox.x + tableBox.width - 10,
    tableBox.y + tableBox.height / 2
  );
};

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

test.describe('Table Scroll Overflow', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('table wrapper gains overflow-x-auto class when colWidths are set', async ({ page }) => {
    // 1. Init editor with 2x2 table with colWidths: [400, 200]
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

    // 2. Verify the table wrapper is visible
    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // 3. Inspect table wrapper CSS classes - expect overflow-x-auto to be present
    const hasOverflowAuto = await table.evaluate((el) => {
      return el.classList.contains('overflow-x-auto');
    });

    expect(hasOverflowAuto).toBe(true);
  });

  test('table wrapper gains overflow-x-auto after dragging resize handle', async ({ page }) => {
    // 1. Init editor with 2x2 table WITHOUT colWidths
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

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // 2. Verify no overflow-x-auto class initially (no colWidths set)
    const hasOverflowAutoBefore = await table.evaluate((el) => {
      return el.classList.contains('overflow-x-auto');
    });

    expect(hasOverflowAutoBefore).toBe(false);

    // 3. Locate the first resize handle and drag it 200px to the right
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first handle
    const handle = page.locator(RESIZE_HANDLE_SELECTOR).first();

    await expect(handle).toBeAttached();

    const handleBox = assertBoundingBox(await handle.boundingBox(), 'Resize handle');

    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 200, startY, { steps: 10 });
    await page.mouse.up();

    // 4. Verify the wrapper now has overflow-x-auto after resize sets colWidths
    const hasOverflowAutoAfter = await table.evaluate((el) => {
      return el.classList.contains('overflow-x-auto');
    });

    expect(hasOverflowAutoAfter).toBe(true);
  });

  test('table auto-scrolls when column added via drag-add', async ({ page }) => {
    // 1. Init editor with 2x2 table with colWidths: [300, 300]
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['A', 'B'], ['C', 'D']],
              colWidths: [300, 300],
            },
          },
        ],
      },
    });

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // 2. Hover near the right edge to reveal the add-column button
    await hoverNearRightEdge(page, table);

    const addColBtn = page.locator('[data-blok-table-add-col]');

    await expect(addColBtn).toBeVisible();

    const addColBox = assertBoundingBox(await addColBtn.boundingBox(), 'Add-col button');
    const startX = addColBox.x + addColBox.width / 2;
    const startY = addColBox.y + addColBox.height / 2;

    // Measure the drag unit size (half average column width) to know how far to drag
    const unitSize = await page.evaluate(() => {
      const row = document.querySelector('[data-blok-table-row]');
      const cellsInRow = row ? row.querySelectorAll('[data-blok-table-cell]') : [];
      let totalWidth = 0;

      for (const cell of cellsInRow) {
        totalWidth += (cell as HTMLElement).offsetWidth;
      }

      return cellsInRow.length > 0
        ? Math.round((totalWidth / cellsInRow.length / 2) * 100) / 100
        : 150;
    });

    // 3. Drag the add-column button rightward to add a new column
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + unitSize * 1.5, startY, { steps: 10 });
    await page.mouse.up();

    // 4. Verify wrapper scrollLeft > 0 (auto-scrolled after adding column)
    const scrollLeft = await table.evaluate((el) => {
      return (el as HTMLElement).scrollLeft;
    });

    expect(scrollLeft).toBeGreaterThan(0);
  });
});
