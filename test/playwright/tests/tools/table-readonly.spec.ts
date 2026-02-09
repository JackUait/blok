import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;
const CELL_SELECTOR = '[data-blok-table-cell]';
const CELL_BLOCKS_CONTAINER_SELECTOR = '[data-blok-table-cell-blocks]';

type SerializableToolConfig = {
  className?: string;
  config?: Record<string, unknown>;
};

type CreateBlokOptions = {
  data?: OutputData;
  tools?: Record<string, SerializableToolConfig>;
  readOnly?: boolean;
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
  const { data = null, tools = {}, readOnly = false } = options;

  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  const serializedTools = Object.entries(tools).map(([name, tool]) => ({
    name,
    className: tool.className ?? null,
    config: tool.config ?? {},
  }));

  await page.evaluate(
    async ({ holder, data: initialData, serializedTools: toolsConfig, readOnly: isReadOnly }) => {
      const blokConfig: Record<string, unknown> = {
        holder: holder,
        readOnly: isReadOnly,
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
            // Handle dot notation (e.g., 'Blok.Header')
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
      readOnly,
    }
  );
};

const defaultTools: Record<string, SerializableToolConfig> = {
  table: {
    className: 'Blok.Table',
  },
};

test.describe('table readonly mode', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('renders legacy string content in readonly mode', async ({ page }) => {
    // Create Blok in editing mode with legacy string content
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [
                ['Legacy Cell A', 'Legacy Cell B'],
                ['Legacy Cell C', 'Legacy Cell D'],
              ],
            },
          },
        ],
      },
    });

    // Save the data
    const savedData = await page.evaluate(async () => {
      const blok = window.blokInstance;

      if (!blok) {
        throw new Error('Blok instance not found');
      }

      return await blok.save();
    });

    // Destroy and recreate in readonly mode
    await createBlok(page, {
      tools: defaultTools,
      data: savedData,
      readOnly: true,
    });

    // Verify table is rendered
    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // Verify all cells are visible with correct text
    const cells = page.locator(CELL_SELECTOR);

    await expect(cells).toHaveCount(4);
    await expect(cells.filter({ hasText: 'Legacy Cell A' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'Legacy Cell B' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'Legacy Cell C' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'Legacy Cell D' })).toHaveCount(1);

    // Verify cell blocks containers are not empty
    const cellBlocksContainers = page.locator(CELL_BLOCKS_CONTAINER_SELECTOR);

    await expect(cellBlocksContainers).toHaveCount(4);

    // Each container should have rendered blocks (not be empty)
    const allContainers = await cellBlocksContainers.all();

    for (const container of allContainers) {
      const blockWrapper = container.locator('[data-blok-testid="block-wrapper"]');

      await expect(blockWrapper).toHaveCount(1);
    }

    // Verify cells are not editable in readonly mode
    // eslint-disable-next-line playwright/no-nth-methods -- Need first cell to check readonly attribute
    const firstCell = cells.first();
    const contentEditable = firstCell.locator('[contenteditable]');

    await expect(contentEditable).toHaveAttribute('contenteditable', 'false');
  });

  test('renders modern block-based content in readonly mode', async ({ page }) => {
    // Create Blok in editing mode with legacy string content (will be converted to blocks)
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: true,
              content: [
                ['Header 1', 'Header 2'],
                ['Data 1', 'Data 2'],
              ],
            },
          },
        ],
      },
    });

    // Save the data - this will convert to modern block-based format
    const savedData = await page.evaluate(async () => {
      const blok = window.blokInstance;

      if (!blok) {
        throw new Error('Blok instance not found');
      }

      return await blok.save();
    });

    // Destroy and recreate in readonly mode with the block-based saved data
    await createBlok(page, {
      tools: defaultTools,
      data: savedData,
      readOnly: true,
    });

    // Verify table is rendered
    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // Verify heading row is present
    const headingRow = page.locator('[data-blok-table-heading]');

    await expect(headingRow).toBeVisible();

    // Verify all cells are visible with correct text
    const cells = page.locator(CELL_SELECTOR);

    await expect(cells).toHaveCount(4);
    await expect(cells.filter({ hasText: 'Header 1' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'Header 2' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'Data 1' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'Data 2' })).toHaveCount(1);

    // Verify cell blocks containers have rendered blocks
    const cellBlocksContainers = page.locator(CELL_BLOCKS_CONTAINER_SELECTOR);

    await expect(cellBlocksContainers).toHaveCount(4);

    const allContainers = await cellBlocksContainers.all();

    for (const container of allContainers) {
      const blockWrapper = container.locator('[data-blok-testid="block-wrapper"]');

      await expect(blockWrapper).toHaveCount(1);
    }

    // Verify cells are not editable in readonly mode
    // eslint-disable-next-line playwright/no-nth-methods -- Need first cell to check readonly attribute
    const firstCell = cells.first();
    const contentEditable = firstCell.locator('[contenteditable]');

    await expect(contentEditable).toHaveAttribute('contenteditable', 'false');
  });

  test('renders mixed content (some cells with content, some empty) in readonly mode', async ({ page }) => {
    // Create Blok with mixed content: some cells with strings, some empty
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [
                ['Cell with content', ''],
                ['', 'Another cell'],
              ],
            },
          },
        ],
      },
    });

    // Save the data
    const savedData = await page.evaluate(async () => {
      const blok = window.blokInstance;

      if (!blok) {
        throw new Error('Blok instance not found');
      }

      return await blok.save();
    });

    // Destroy and recreate in readonly mode
    await createBlok(page, {
      tools: defaultTools,
      data: savedData,
      readOnly: true,
    });

    // Verify table is rendered
    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // Verify all cells are present
    const cells = page.locator(CELL_SELECTOR);

    await expect(cells).toHaveCount(4);

    // Verify cells with content are visible (use locator chaining instead of filter)
    const cellsWithText = cells.locator('text="Cell with content"');
    const anotherCell = cells.locator('text="Another cell"');

    await expect(cellsWithText).toBeVisible();
    await expect(anotherCell).toBeVisible();

    // Verify all cell blocks containers have rendered blocks (even empty ones)
    const cellBlocksContainers = page.locator(CELL_BLOCKS_CONTAINER_SELECTOR);

    await expect(cellBlocksContainers).toHaveCount(4);

    const allContainers = await cellBlocksContainers.all();

    for (const container of allContainers) {
      const blockWrapper = container.locator('[data-blok-testid="block-wrapper"]');

      // Empty cells should still have a block wrapper (empty paragraph)
      await expect(blockWrapper).toHaveCount(1);
    }
  });

  test('does not duplicate content when rendered multiple times in readonly mode', async ({ page }) => {
    // Create Blok in readonly mode with legacy string content
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [
                ['Test Cell A', 'Test Cell B'],
              ],
            },
          },
        ],
      },
      readOnly: true,
    });

    // Get initial state
    const cells = page.locator(CELL_SELECTOR);
    await expect(cells).toHaveCount(2);

    // Count blocks in first cell initially
    const firstCellContainer = page.locator(CELL_BLOCKS_CONTAINER_SELECTOR).first();
    const initialBlocks = firstCellContainer.locator('[data-blok-id]');
    await expect(initialBlocks).toHaveCount(1);

    // Manually trigger rendered() lifecycle again to simulate the bug scenario
    await page.evaluate(async () => {
      const blok = window.blokInstance;
      if (!blok) throw new Error('Blok not found');

      // Get the table block
      const blockCount = blok.blocks.getBlocksCount();
      for (let i = 0; i < blockCount; i++) {
        const block = blok.blocks.getBlockByIndex(i);
        if (block && block.name === 'table') {
          // Manually call rendered() again (simulating lifecycle re-trigger)
          if (typeof block.rendered === 'function') {
            block.rendered();
          }
          break;
        }
      }
    });

    // Wait a bit for any DOM updates
    await page.waitForTimeout(100);

    // Verify blocks are still only 1 per cell (not duplicated)
    const blocksAfterSecondRender = firstCellContainer.locator('[data-blok-id]');
    await expect(blocksAfterSecondRender).toHaveCount(1);

    // Verify content is not duplicated
    const firstCellText = await firstCellContainer.textContent();
    expect(firstCellText).toBe('Test Cell A');
    expect(firstCellText).not.toContain('Test Cell ATest Cell A');

    // Verify all cells still have exactly 1 block wrapper each
    const allContainers = await page.locator(CELL_BLOCKS_CONTAINER_SELECTOR).all();
    for (const container of allContainers) {
      const blockWrappers = container.locator('[data-blok-testid="block-wrapper"]');
      await expect(blockWrappers).toHaveCount(1);
    }
  });
});
