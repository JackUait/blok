// spec: specs/table-tool-test-plan.md
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

const toggleReadOnly = async (page: Page, state: boolean): Promise<void> => {
  await page.evaluate(async ({ targetState }) => {
    const blok = window.blokInstance ?? (() => {
      throw new Error('Blok instance not found');
    })();

    await blok.readOnly.toggle(targetState);
  }, { targetState: state });
};

const waitForReadOnlyState = async (page: Page, expected: boolean): Promise<void> => {
  await page.waitForFunction(({ expectedState }) => {
    return window.blokInstance?.readOnly.isEnabled === expectedState;
  }, { expectedState: expected });
};

const defaultTools: Record<string, SerializableToolConfig> = {
  table: {
    className: 'Blok.Table',
  },
};

test.describe('Read-Only Mode', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('Table renders correctly in initial read-only mode', async ({ page }) => {
    // 1. Initialize the editor in read-only mode (readOnly: true) with a 2x2 table containing ['A','B','C','D']
    await createBlok(page, {
      tools: defaultTools,
      readOnly: true,
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

    // 2. Wait for the editor to be ready - verify the table block is visible
    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // Verify the table wrapper has data-blok-table-readonly attribute
    await expect(table).toHaveAttribute('data-blok-table-readonly', '');

    // Verify all cells are visible
    const cells = page.locator(CELL_SELECTOR);

    await expect(cells).toHaveCount(4);

    // Verify cell content A, B, C, D is rendered
    await expect(cells.filter({ hasText: 'A' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'B' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'C' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'D' })).toHaveCount(1);

    // Verify cells are not contenteditable (should be contenteditable="false")
    // eslint-disable-next-line playwright/no-nth-methods -- Need first cell to check readonly attribute
    const firstCell = cells.first();
    const contentEditable = firstCell.locator('[contenteditable]');

    await expect(contentEditable).toHaveAttribute('contenteditable', 'false');

    // Verify no grip elements exist in the DOM
    const grips = page.locator('[data-blok-table-grip-col], [data-blok-table-grip-row]');

    await expect(grips).toHaveCount(0);

    // Verify no resize handle elements exist in the DOM
    const resizeHandles = page.locator('[data-blok-table-resize]');

    await expect(resizeHandles).toHaveCount(0);

    // Verify no add-row or add-column control elements exist in the DOM
    const addControls = page.locator('[data-blok-table-add-row], [data-blok-table-add-col]');

    await expect(addControls).toHaveCount(0);
  });

  test('Heading row is displayed in read-only mode', async ({ page }) => {
    // 1. Initialize editor in read-only mode with withHeadings: true
    await createBlok(page, {
      tools: defaultTools,
      readOnly: true,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: true,
              content: [
                ['H1', 'H2'],
                ['D1', 'D2'],
              ],
            },
          },
        ],
      },
    });

    // 2. Inspect the first row - verify data-blok-table-heading attribute
    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    const headingRow = page.locator('[data-blok-table-heading]');

    await expect(headingRow).toBeVisible();

    // Verify heading content is rendered
    await expect(headingRow).toContainText('H1');
    await expect(headingRow).toContainText('H2');
  });

  test('Heading column is displayed in read-only mode', async ({ page }) => {
    // 1. Initialize editor in read-only mode with withHeadingColumn: true
    await createBlok(page, {
      tools: defaultTools,
      readOnly: true,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              withHeadingColumn: true,
              content: [
                ['ColH1', 'B'],
                ['ColH2', 'D'],
              ],
            },
          },
        ],
      },
    });

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // Each first cell has data-blok-table-heading-col attribute
    const headingCols = page.locator('[data-blok-table-heading-col]');

    await expect(headingCols).toHaveCount(2);

    // Verify heading column content is rendered
    await expect(headingCols.first()).toContainText('ColH1');
    await expect(headingCols.last()).toContainText('ColH2');
  });

  test('Toggling read-only mode removes interactive controls', async ({ page }) => {
    // 1. Initialize editor in edit mode with a 2x2 table
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

    // 2. Verify interactive elements exist in edit mode
    // Cells should be contenteditable=true in edit mode
    const cells = page.locator(CELL_SELECTOR);

    // eslint-disable-next-line playwright/no-nth-methods -- Need first cell to check edit mode attribute
    const firstCellEditable = cells.first().locator('[contenteditable]');

    await expect(firstCellEditable).toHaveAttribute('contenteditable', 'true');

    // 3. Toggle read-only mode via readOnly.toggle()
    await toggleReadOnly(page, true);
    await waitForReadOnlyState(page, true);

    // 4. Verify interactive elements are removed after toggling
    // No grip elements should exist
    const grips = page.locator('[data-blok-table-grip-col], [data-blok-table-grip-row]');

    await expect(grips).toHaveCount(0);

    // No add-row or add-column buttons should exist
    const addControls = page.locator('[data-blok-table-add-row], [data-blok-table-add-col]');

    await expect(addControls).toHaveCount(0);

    // No resize handles should exist
    const resizeHandles = page.locator('[data-blok-table-resize]');

    await expect(resizeHandles).toHaveCount(0);

    // Cells become non-editable
    const cellEditable = cells.first().locator('[contenteditable]');

    await expect(cellEditable).toHaveAttribute('contenteditable', 'false');
  });

  test('Blocks inside cells render correctly in read-only mode', async ({ page }) => {
    // 1. Initialize editor in editing mode first to get block-based cell data
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [
                ['Block Content A', 'Block Content B'],
                ['Block Content C', 'Block Content D'],
              ],
            },
          },
        ],
      },
    });

    // Save the data - this converts to modern block-based format
    const savedData = await page.evaluate(async () => {
      const blok = window.blokInstance;

      if (!blok) {
        throw new Error('Blok instance not found');
      }

      return await blok.save();
    });

    // Initialize in read-only mode with block-based cell data
    await createBlok(page, {
      tools: defaultTools,
      readOnly: true,
      data: savedData,
    });

    // 2. Inspect cells for rendered block content
    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // Cell blocks containers are present
    const cellBlocksContainers = page.locator(CELL_BLOCKS_CONTAINER_SELECTOR);

    await expect(cellBlocksContainers).toHaveCount(4);

    // Block content is visible and readable
    const cells = page.locator(CELL_SELECTOR);

    await expect(cells.filter({ hasText: 'Block Content A' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'Block Content B' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'Block Content C' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'Block Content D' })).toHaveCount(1);

    // No contenteditable attributes on blocks inside read-only cells (should be false)
    // eslint-disable-next-line playwright/no-nth-methods -- Need first cell to check readonly attribute
    const firstCell = cells.first();
    const contentEditable = firstCell.locator('[contenteditable]');

    await expect(contentEditable).toHaveAttribute('contenteditable', 'false');

    // Each container should have rendered block wrappers
    const allContainers = await cellBlocksContainers.all();

    for (const container of allContainers) {
      const blockWrapper = container.locator('[data-blok-testid="block-wrapper"]');

      await expect(blockWrapper).toHaveCount(1);
    }
  });
});
