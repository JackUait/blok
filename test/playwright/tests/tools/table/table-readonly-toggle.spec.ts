// spec: Read-Only Mode Toggle Roundtrip
// seed: test/playwright/tests/tools/table-readonly.spec.ts

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;
const CELL_SELECTOR = '[data-blok-table-cell]';
const CELL_BLOCKS_CONTAINER_SELECTOR = '[data-blok-table-cell-blocks]';
const COL_GRIP_SELECTOR = '[data-blok-table-grip-col]';
const ROW_GRIP_SELECTOR = '[data-blok-table-grip-row]';

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
      readOnly,
    }
  );
};

const defaultTools: Record<string, SerializableToolConfig> = {
  table: {
    className: 'Blok.Table',
  },
};

test.describe('Read-Only Mode Toggle Roundtrip', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('table in read-only mode renders cell block content as non-editable text', async ({ page }) => {
    // 1. Init editor in edit mode with a 2x2 table to get block-format cell data
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [
                ['Alpha', 'Beta'],
                ['Gamma', 'Delta'],
              ],
            },
          },
        ],
      },
    });

    // 2. Save the data to get modern block-based cell format
    const savedData = await page.evaluate(async () => {
      const blok = window.blokInstance;

      if (!blok) {
        throw new Error('Blok instance not found');
      }

      return await blok.save();
    });

    // 3. Recreate editor in readOnly:true with block-format cell data
    await createBlok(page, {
      tools: defaultTools,
      readOnly: true,
      data: savedData,
    });

    // 4. Verify table is visible
    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // 5. Verify data-blok-table-readonly attribute is present on table wrapper
    await expect(table).toHaveAttribute('data-blok-table-readonly', '');

    // 6. Verify all four cells are visible with correct text content
    const cells = page.locator(CELL_SELECTOR);

    await expect(cells).toHaveCount(4);
    await expect(cells.filter({ hasText: 'Alpha' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'Beta' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'Gamma' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'Delta' })).toHaveCount(1);

    // 7. Verify cell blocks containers are present and contain rendered block wrappers
    const cellBlocksContainers = page.locator(CELL_BLOCKS_CONTAINER_SELECTOR);

    await expect(cellBlocksContainers).toHaveCount(4);

    const allContainers = await cellBlocksContainers.all();

    for (const container of allContainers) {
      const blockWrapper = container.locator('[data-blok-testid="block-wrapper"]');

      await expect(blockWrapper).toHaveCount(1);
    }

    // 8. Verify no contenteditable='true' exists inside the table cells (cells are non-editable)
    // eslint-disable-next-line playwright/no-nth-methods -- Need first cell to check readonly attribute
    const firstCell = cells.first();
    const contentEditable = firstCell.locator('[contenteditable]');

    await expect(contentEditable).toHaveAttribute('contenteditable', 'false');

    // 9. Verify no interactive grip controls exist in read-only mode
    const grips = page.locator('[data-blok-table-grip-col], [data-blok-table-grip-row]');

    await expect(grips).toHaveCount(0);

    // 10. Verify no resize handles exist in read-only mode
    const resizeHandles = page.locator('[data-blok-table-resize]');

    await expect(resizeHandles).toHaveCount(0);

    // 11. Verify no add-row or add-column controls exist in read-only mode
    const addControls = page.locator('[data-blok-table-add-row], [data-blok-table-add-col]');

    await expect(addControls).toHaveCount(0);
  });

  test('toggling from read-only back to edit mode restores interactive controls', async ({ page }) => {
    // 1. Init editor in edit mode with a 2x2 table
    await createBlok(page, {
      tools: defaultTools,
      readOnly: false,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [
                ['A', 'B'],
                ['C', 'D'],
              ],
            },
          },
        ],
      },
    });

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // 2. Verify cells are editable in initial edit mode
    const cells = page.locator(CELL_SELECTOR);

    // eslint-disable-next-line playwright/no-nth-methods -- Need first cell to check edit mode attribute
    const firstCellEditable = cells.first().locator('[contenteditable]');

    await expect(firstCellEditable).toHaveAttribute('contenteditable', 'true');

    // 3. Toggle readOnly on via readOnly.toggle()
    await page.evaluate(async () => {
      await window.blokInstance?.readOnly.toggle();
    });

    // 4. Wait for readOnly state to be enabled
    await page.waitForFunction(() => window.blokInstance?.readOnly.isEnabled === true);

    // 5. Verify interactive grip controls are removed after switching to read-only
    const colGripsAfterToggleOn = page.locator(COL_GRIP_SELECTOR);
    const rowGripsAfterToggleOn = page.locator(ROW_GRIP_SELECTOR);

    await expect(colGripsAfterToggleOn).toHaveCount(0);
    await expect(rowGripsAfterToggleOn).toHaveCount(0);

    // 6. Verify resize handles are removed
    const resizeHandlesAfterToggleOn = page.locator('[data-blok-table-resize]');

    await expect(resizeHandlesAfterToggleOn).toHaveCount(0);

    // 7. Verify add-row and add-column buttons are removed
    const addControlsAfterToggleOn = page.locator('[data-blok-table-add-row], [data-blok-table-add-col]');

    await expect(addControlsAfterToggleOn).toHaveCount(0);

    // 8. Verify cells become non-editable after toggle to read-only
    const cellEditableAfterToggleOn = cells.locator('[contenteditable] >> nth=0');

    await expect(cellEditableAfterToggleOn).toHaveAttribute('contenteditable', 'false');

    // 9. Verify data-blok-table-readonly attribute is applied to the table wrapper
    await expect(table).toHaveAttribute('data-blok-table-readonly', '');

    // 10. Toggle readOnly off via readOnly.toggle() to restore edit mode
    await page.evaluate(async () => {
      await window.blokInstance?.readOnly.toggle();
    });

    // 11. Wait for readOnly state to be disabled
    await page.waitForFunction(() => window.blokInstance?.readOnly.isEnabled === false);

    // 12. Verify data-blok-table-readonly attribute is removed from the table wrapper
    await expect(table).not.toHaveAttribute('data-blok-table-readonly');

    // 13. Verify cells are editable again after switching back to edit mode
    const cellEditableAfterToggleOff = cells.locator('[contenteditable] >> nth=0');

    await expect(cellEditableAfterToggleOff).toHaveAttribute('contenteditable', 'true');

    // 14. Click first cell to trigger grip appearance (grips are shown on cell interaction)
    // eslint-disable-next-line playwright/no-nth-methods -- Need first cell to trigger grip controls
    await cells.first().click();

    // 15. Verify column grip is restored and visible after returning to edit mode
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible grip
    const colGripRestored = page.locator(COL_GRIP_SELECTOR).first();

    await expect(colGripRestored).toBeVisible({ timeout: 2000 });

    // 16. Verify row grip is restored and visible after returning to edit mode
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first visible grip
    const rowGripRestored = page.locator(ROW_GRIP_SELECTOR).first();

    await expect(rowGripRestored).toBeVisible({ timeout: 2000 });
  });

  test('toggling to readonly does not add extra blocks to saved data', async ({ page }) => {
    // 1. Init editor in edit mode with a table + paragraph after it
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [
                ['Alpha', 'Beta'],
                ['Gamma', 'Delta'],
              ],
            },
          },
          {
            type: 'paragraph',
            data: { text: 'Trailing paragraph' },
          },
        ],
      },
    });

    // 2. Save data before toggling — count the root blocks
    const beforeData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    const blockCountBefore = beforeData?.blocks.length ?? 0;

    // 3. Toggle to readOnly
    await page.evaluate(async () => {
      await window.blokInstance?.readOnly.toggle();
    });
    await page.waitForFunction(() => window.blokInstance?.readOnly.isEnabled === true);

    // 4. Toggle back to edit mode
    await page.evaluate(async () => {
      await window.blokInstance?.readOnly.toggle();
    });
    await page.waitForFunction(() => window.blokInstance?.readOnly.isEnabled === false);

    // 5. Save data after round-trip
    const afterData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    const blockCountAfter = afterData?.blocks.length ?? 0;

    // 6. Block count must be identical — no extra paragraphs added
    expect(blockCountAfter).toBe(blockCountBefore);

    // 7. Verify no unexpected paragraph blocks appeared
    const paragraphBlocks = afterData?.blocks.filter(b => b.type === 'paragraph') ?? [];
    const trailingParagraphs = paragraphBlocks.filter(
      b => (b.data as { text?: string }).text === 'Trailing paragraph'
    );

    // There should be exactly one trailing paragraph (the original)
    expect(trailingParagraphs.length).toBe(1);
  });
});
