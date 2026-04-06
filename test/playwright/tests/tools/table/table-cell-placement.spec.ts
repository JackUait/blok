// spec: Cell Placement via Pill Popover
// seed: test/playwright/tests/tools/table/table-cell-color.spec.ts

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

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

const HOLDER_ID = 'blok';
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;

/**
 * Assert a bounding box is non-null and return it with narrowed type.
 */
const assertBoundingBox = (
  box: { x: number; y: number; width: number; height: number } | null,
  label: string
): { x: number; y: number; width: number; height: number } => {
  expect(box, `${label} should have a bounding box`).toBeTruthy();

  return box as { x: number; y: number; width: number; height: number };
};

/**
 * Returns a locator for a specific cell in the table grid.
 */
const getCell = (page: Page, row: number, col: number): ReturnType<Page['locator']> =>
  page
    .locator(`${TABLE_SELECTOR} >> [data-blok-table-row] >> nth=${row}`)
    .locator(`[data-blok-table-cell] >> nth=${col}`);

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
  paragraph: {
    className: 'Blok.Paragraph',
  },
};

/**
 * Helper to create a 3x3 table with labeled cells.
 */
const create3x3TableWithContent = async (page: Page): Promise<void> => {
  await createBlok(page, {
    tools: defaultTools,
    data: {
      blocks: [
        {
          type: 'table',
          data: {
            withHeadings: false,
            content: [
              ['A1', 'B1', 'C1'],
              ['A2', 'B2', 'C2'],
              ['A3', 'B3', 'C3'],
            ],
          },
        },
      ],
    },
  });

  await expect(page.locator(TABLE_SELECTOR)).toBeVisible();
};

/**
 * Helper to select a single cell by clicking on it.
 */
const selectSingleCell = async (page: Page, row: number, col: number): Promise<void> => {
  const cell = getCell(page, row, col);
  const box = assertBoundingBox(await cell.boundingBox(), `cell [${row},${col}]`);

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};

/**
 * Helper to hover over the selection pill and click it to open the popover.
 */
const openPillPopover = async (page: Page): Promise<void> => {
  const pill = page.locator('[data-blok-table-selection-pill]');

  await expect(pill).toBeAttached();
  const pillBox = assertBoundingBox(await pill.boundingBox(), 'selection pill');

  await page.mouse.move(pillBox.x + pillBox.width / 2, pillBox.y + pillBox.height / 2);
  await expect(pill).toBeVisible();
  await pill.click();
};

/**
 * Helper to open the placement picker submenu via the pill popover.
 * Returns once the placement grid is visible.
 */
const openPlacementPicker = async (page: Page): Promise<void> => {
  await openPillPopover(page);

  const placementItem = page.getByText('Placement');

  await expect(placementItem).toBeVisible();

  const itemBox = assertBoundingBox(await placementItem.boundingBox(), 'Placement item');

  await page.mouse.move(itemBox.x + itemBox.width / 2, itemBox.y + itemBox.height / 2);

  // Wait for the placement grid to appear in the submenu
  const gridCell = page.locator('[data-placement="bottom-right"]');

  await expect(gridCell).toBeVisible();
};

test.describe('Cell Placement', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.afterEach(async ({ page }) => {
    await resetBlok(page);
  });

  test('sets placement on a cell via pill popover', async ({ page }) => {
    await create3x3TableWithContent(page);

    // Select cell (0,0)
    await selectSingleCell(page, 0, 0);

    const pill = page.locator('[data-blok-table-selection-pill]');

    await expect(pill).toBeAttached();

    // Open pill popover → hover Placement → pick bottom-right
    await openPlacementPicker(page);

    const gridCell = page.locator('[data-placement="bottom-right"]');

    await gridCell.click({ force: true });

    // Verify the data-blok-cell-placement attribute is set on the cell's blocks container
    const placementAttr = await getCell(page, 0, 0).evaluate((cell) => {
      const blocksContainer = cell.querySelector('[data-blok-table-cell-blocks]');

      return blocksContainer?.getAttribute('data-blok-cell-placement') ?? null;
    });

    expect(placementAttr).toBe('bottom-right');
  });

  test('placement persists through save', async ({ page }) => {
    await create3x3TableWithContent(page);

    // Select cell (0,1) (second cell in first row)
    await selectSingleCell(page, 0, 1);

    const pill = page.locator('[data-blok-table-selection-pill]');

    await expect(pill).toBeAttached();

    // Open placement picker and select middle-center
    await openPlacementPicker(page);

    const gridCell = page.locator('[data-placement="middle-center"]');

    await gridCell.click({ force: true });

    // Save and verify the placement is in the saved data
    const savedData = await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('blokInstance is not initialized');
      }

      return window.blokInstance.save();
    });

    const tableBlock = savedData.blocks[0];

    expect(tableBlock.type).toBe('table');

    type CellData = { placement?: string; blocks?: string[] };
    const content = (tableBlock.data as { content: CellData[][] }).content;
    const cell01 = content[0][1];

    expect(cell01).toHaveProperty('placement');
    expect(cell01.placement).toBe('middle-center');
  });
});
