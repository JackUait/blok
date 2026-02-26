// spec: specs/plan.md (Column Resizing suite)
// seed: test/playwright/tests/tools/table.spec.ts

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

const tableData = {
  withHeadings: false,
  content: [['A', 'B'], ['C', 'D']],
};

test.describe('Column Resizing', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('Dragging a resize handle to the right expands the column width', async ({ page }) => {
    // Initialize editor with 2x2 table
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: tableData,
          },
        ],
      },
    });

    // Locate the first data-blok-table-resize handle and verify it is attached
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first handle
    const handle = page.locator(RESIZE_HANDLE_SELECTOR).first();

    await expect(handle).toBeAttached();

    const handleBox = assertBoundingBox(await handle.boundingBox(), 'Resize handle');

    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;

    // Capture initial first column width
    const initialFirstWidth = await page.evaluate(() => {
      const cells = document.querySelectorAll('[data-blok-table-cell]');

      return (cells[0] as HTMLElement).getBoundingClientRect().width;
    });

    // Hover the handle and drag 100px to the right to expand the column
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 100, startY, { steps: 5 });
    await page.mouse.up();

    // Verify first column is wider than it was initially
    const finalFirstWidth = await page.evaluate(() => {
      const cells = document.querySelectorAll('[data-blok-table-cell]');

      return (cells[0] as HTMLElement).getBoundingClientRect().width;
    });

    expect(finalFirstWidth).toBeGreaterThan(initialFirstWidth + 50);
  });

  test('Dragging a resize handle to the left narrows the column width', async ({ page }) => {
    // Initialize editor with 2x2 table
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: tableData,
          },
        ],
      },
    });

    // Locate the first data-blok-table-resize handle
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first handle
    const handle = page.locator(RESIZE_HANDLE_SELECTOR).first();

    await expect(handle).toBeAttached();

    const handleBox = assertBoundingBox(await handle.boundingBox(), 'Resize handle');

    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;

    // Capture initial first column width
    const initialFirstWidth = await page.evaluate(() => {
      const cells = document.querySelectorAll('[data-blok-table-cell]');

      return (cells[0] as HTMLElement).getBoundingClientRect().width;
    });

    // Drag the resize handle 100px to the left to shrink the column
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 100, startY, { steps: 5 });
    await page.mouse.up();

    // Verify the first column is narrower than it was initially
    const finalFirstWidth = await page.evaluate(() => {
      const cells = document.querySelectorAll('[data-blok-table-cell]');

      return (cells[0] as HTMLElement).getBoundingClientRect().width;
    });

    expect(finalFirstWidth).toBeLessThan(initialFirstWidth - 50);
  });

  test('Column widths are saved in colWidths array after resize', async ({ page }) => {
    // Initialize editor with 2x2 table
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: tableData,
          },
        ],
      },
    });

    // Locate the first data-blok-table-resize handle
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first handle
    const handle = page.locator(RESIZE_HANDLE_SELECTOR).first();

    await expect(handle).toBeAttached();

    const handleBox = assertBoundingBox(await handle.boundingBox(), 'Resize handle');

    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;

    // Drag the resize handle 100px to the right
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 100, startY, { steps: 5 });
    await page.mouse.up();

    // Call save() and verify colWidths array in saved data
    const savedData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    const tableBlock = savedData?.blocks.find((b: { type: string }) => b.type === 'table');

    expect(tableBlock).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(Array.isArray(tableBlock?.data.colWidths)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect((tableBlock?.data.colWidths as number[]).length).toBe(2);
  });

  test('Resize handles are not present in readOnly mode', async ({ page }) => {
    // Initialize editor with 2x2 table
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: tableData,
          },
        ],
      },
    });

    // Verify handles exist before toggling readOnly
    const handlesBefore = page.locator(RESIZE_HANDLE_SELECTOR);

    // eslint-disable-next-line playwright/no-nth-methods -- nth(0) is the clearest way to verify at least one handle exists
    await expect(handlesBefore.nth(0)).toBeAttached();

    // Toggle readOnly mode via blokInstance.readOnly.toggle()
    await page.evaluate(async () => {
      await window.blokInstance?.readOnly.toggle();
    });

    // After toggle, verify no data-blok-table-resize elements exist in the DOM
    const handles = page.locator(RESIZE_HANDLE_SELECTOR);

    await expect(handles).toHaveCount(0);
  });

  test('Initial colWidths config renders correct column pixel widths', async ({ page }) => {
    // Initialize editor with colWidths: [400, 200]
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

    // Verify the table is visible
    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // Measure first column width via inline style set by TableResize.applyWidths()
    const firstCellWidth = await page.evaluate(() => {
      const cell = document.querySelector('[data-blok-table-cell]') as HTMLElement;

      return cell?.style.width;
    });

    expect(firstCellWidth).toBe('400px');

    // Measure second column width
    const secondCellWidth = await page.evaluate(() => {
      const cells = document.querySelectorAll('[data-blok-table-cell]');

      return (cells[1] as HTMLElement).style.width;
    });

    expect(secondCellWidth).toBe('200px');
  });

  test('Dragging a resize handle cannot shrink a column below 50px minimum width', async ({ page }) => {
    // Initialize editor with 2x2 table and explicit colWidths of 100px each
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['A', 'B'], ['C', 'D']],
              colWidths: [100, 100],
            },
          },
        ],
      },
    });

    // Locate the first data-blok-table-resize handle
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first handle
    const handle = page.locator(RESIZE_HANDLE_SELECTOR).first();

    await expect(handle).toBeAttached();

    const handleBox = assertBoundingBox(await handle.boundingBox(), 'Resize handle');

    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;

    // Drag the resize handle 200px to the left — well past the 50px minimum
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 200, startY, { steps: 5 });
    await page.mouse.up();

    // Verify the first column's rendered width is at least 50px (the enforced minimum)
    const finalFirstWidth = await page.evaluate(() => {
      const cells = document.querySelectorAll('[data-blok-table-cell]');

      return (cells[0] as HTMLElement).getBoundingClientRect().width;
    });

    expect(finalFirstWidth).toBeGreaterThanOrEqual(50);
  });

  test('First resize on a percent-width table transitions columns to pixel widths', async ({ page }) => {
    // Initialize editor with 2x2 table WITHOUT colWidths (starts with equal percent widths)
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

    // Verify cells do NOT have an inline width style with px before resize
    const hasPixelWidthBefore = await page.evaluate(() => {
      const cells = document.querySelectorAll('[data-blok-table-cell]');
      const firstRow = [cells[0], cells[1]] as HTMLElement[];

      return firstRow.some((cell) => cell.style.width?.includes('px'));
    });

    expect(hasPixelWidthBefore).toBe(false);

    // Locate the first data-blok-table-resize handle
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first handle
    const handle = page.locator(RESIZE_HANDLE_SELECTOR).first();

    await expect(handle).toBeAttached();

    const handleBox = assertBoundingBox(await handle.boundingBox(), 'Resize handle');

    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;

    // Drag the resize handle 50px to the right
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 50, startY, { steps: 5 });
    await page.mouse.up();

    // Verify all cells in the first row now have inline width style containing px
    const firstRowPixelWidths = await page.evaluate(() => {
      const cells = document.querySelectorAll('[data-blok-table-cell]');
      const firstRow = [cells[0], cells[1]] as HTMLElement[];

      return firstRow.map((cell) => cell.style.width?.includes('px') ?? false);
    });

    expect(firstRowPixelWidths).toEqual([true, true]);
  });
});
