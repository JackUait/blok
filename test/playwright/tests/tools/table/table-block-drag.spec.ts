/**
 * Regression test: dragging a table block to a new position via the block-level
 * drag handle (☰ settings toggler) must not corrupt the flat block array ordering.
 *
 * Bug: after a block-level drag of a table, cell blocks end up scattered at wrong
 * positions relative to the table block in the flat array. For example, some cell
 * blocks appear before the table block and others appear after unrelated blocks.
 * The flat array ordering affects the output of save() and the block IDs used
 * for rendering.
 *
 * Expected: all cell blocks (blocks with parent === tableId) must be contiguous
 * with the table block in the flat array (immediately before or after the table,
 * not scattered among top-level blocks).
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { DATA_ATTR, createSelector } from '../../../../../src/components/constants';

const HOLDER_ID = 'blok';
const SETTINGS_BUTTON_SELECTOR = `${createSelector(DATA_ATTR.interface)} [data-blok-testid="settings-toggler"]`;

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
    Blok: new (...args: unknown[]) => Blok;
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
        holder,
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
 * Helper function to get bounding box and throw if it doesn't exist.
 */
const getBoundingBox = async (
  locator: ReturnType<Page['locator']>
): Promise<{ x: number; y: number; width: number; height: number }> => {
  const box = await locator.boundingBox();

  if (!box) {
    throw new Error('Could not get bounding box for element');
  }

  return box;
};

/**
 * Drag a block (via its settings-toggler drag handle) and drop it onto a target block.
 * Mirrors the approach used in drag-drop-touch.spec.ts.
 */
const performBlockDragDrop = async (
  page: Page,
  sourceLocator: ReturnType<Page['locator']>,
  targetLocator: ReturnType<Page['locator']>,
  targetVerticalPosition: 'top' | 'bottom'
): Promise<void> => {
  const sourceBox = await getBoundingBox(sourceLocator);
  const targetBox = await getBoundingBox(targetLocator);

  const sourceX = sourceBox.x + sourceBox.width / 2;
  const sourceY = sourceBox.y + sourceBox.height / 2;
  const targetX = targetBox.x + targetBox.width / 2;
  const targetY = targetVerticalPosition === 'top'
    ? targetBox.y + 1
    : targetBox.y + targetBox.height - 1;

  // Press and hold on the drag handle
  await page.mouse.move(sourceX, sourceY);
  await page.mouse.down();

  // Move to target position with steps to simulate continuous drag movement
  await page.mouse.move(targetX, targetY, { steps: 10 });

  // Wait for drag state to be active (confirms drag threshold was passed)
  await page.waitForFunction(() => {
    const wrapper = document.querySelector('[data-blok-interface=blok]');

    return wrapper?.getAttribute('data-blok-dragging') === 'true';
  }, { timeout: 2000 });

  // Release to complete the drop
  await page.mouse.up();

  // Wait for drag state to be cleared (drop completed)
  await page.waitForFunction(() => {
    const wrapper = document.querySelector('[data-blok-interface=blok]');

    return wrapper?.getAttribute('data-blok-dragging') !== 'true';
  }, { timeout: 5000 });
};

const defaultTools: Record<string, SerializableToolConfig> = {
  table: {
    className: 'Blok.Table',
  },
};

test.describe('Table block-level drag reorder', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('dragging table block does not scatter cell blocks in the flat array', async ({ page }) => {
    // Setup: Before (paragraph) | Table 2x2 (A,B,C,D) | After (paragraph)
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: { text: 'Before' },
          },
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['A', 'B'], ['C', 'D']],
            },
          },
          {
            type: 'paragraph',
            data: { text: 'After' },
          },
        ],
      },
    });

    // Hover over the table block to reveal its block-level drag handle (settings toggler)
    const tableBlock = page.getByTestId('block-wrapper').filter({ has: page.locator('[data-blok-tool="table"]') });

    await tableBlock.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    await expect(settingsButton).toBeVisible();

    // Drag the table to the BOTTOM of the "After" paragraph (move table to last position)
    const afterBlock = page.getByTestId('block-wrapper').filter({ hasText: 'After' });

    await performBlockDragDrop(page, settingsButton, afterBlock, 'bottom');

    // Collect the full save output to verify the flat block array structure
    const savedData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    expect(savedData).toBeDefined();
    const safeData = savedData as NonNullable<typeof savedData>;

    // Find the table block in the save output
    const tableOutputBlock = safeData.blocks.find(
      (b) => b.type === 'table'
    );

    expect(tableOutputBlock).toBeDefined();
    const tableId = (tableOutputBlock as { id: string }).id;

    // Identify the table's position in the flat array
    const tableIndex = safeData.blocks.findIndex(
      (b) => b.id === tableId
    );

    expect(tableIndex).toBeGreaterThanOrEqual(0);

    // Identify all cell block IDs (blocks with parent === tableId)
    const cellBlocks = safeData.blocks.filter(
      (b) => (b as { parent?: string }).parent === tableId
    );

    // There should be 4 cell blocks (one per cell in the 2x2 table)
    expect(cellBlocks.length).toBeGreaterThanOrEqual(4);

    // All cell blocks must be contiguous with the table in the flat array.
    // In a correct implementation, table + cell blocks form a single contiguous group
    // (e.g. [TABLE, cell, cell, cell, cell] or [cell, cell, cell, cell, TABLE]).
    //
    // The bug: after drag, the flat array looks like:
    //   [B(cell), Before, C(cell), TABLE, D(cell), After, A(cell)]
    // Cell blocks are scattered with foreign blocks interspersed.
    const cellBlockIndices = cellBlocks.map((cellBlock) =>
      safeData.blocks.findIndex((b) => b.id === (cellBlock as { id: string }).id)
    );

    const tableGroupIds = new Set([
      tableId,
      ...cellBlocks.map((b) => (b as { id: string }).id),
    ]);

    // Compute the full group range including the table's own index
    const minGroupIndex = Math.min(tableIndex, ...cellBlockIndices);
    const maxGroupIndex = Math.max(tableIndex, ...cellBlockIndices);

    // The group must be exactly contiguous: no gaps, no foreign blocks
    const expectedGroupSize = cellBlocks.length + 1; // cells + table
    const actualGroupSpan = maxGroupIndex - minGroupIndex + 1;

    expect(
      actualGroupSpan === expectedGroupSize,
      `Table group spans indices [${minGroupIndex}, ${maxGroupIndex}] (${actualGroupSpan} slots) ` +
      `but should span exactly ${expectedGroupSize} slots (table + ${cellBlocks.length} cells). ` +
      `Cell indices: [${cellBlockIndices.join(', ')}], table index: ${tableIndex}. ` +
      'The flat array is corrupted: foreign blocks are interspersed between the table and its cells.'
    ).toBe(true);

    // Every index in the group range must belong to the table group
    for (let i = minGroupIndex; i <= maxGroupIndex; i++) {
      const blockAtIndex = safeData.blocks[i] as { id: string };

      expect(
        tableGroupIds.has(blockAtIndex.id),
        `Block at index ${i} (id: "${blockAtIndex.id}") is NOT part of the table group, ` +
        `but falls within the table group range [${minGroupIndex}, ${maxGroupIndex}]. ` +
        'This means the flat array is corrupted: foreign blocks are interspersed between the table and its cells.'
      ).toBe(true);
    }
  });
});
