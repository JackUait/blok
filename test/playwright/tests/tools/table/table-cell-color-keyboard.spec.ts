// spec: test/playwright/tests/tools/table/table-cell-color-edge-cases.plan.md
// seed: test/playwright/tests/seed.spec.ts

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

const assertBoundingBox = (
  box: { x: number; y: number; width: number; height: number } | null,
  label: string
): { x: number; y: number; width: number; height: number } => {
  expect(box, `${label} should have a bounding box`).toBeTruthy();

  return box as { x: number; y: number; width: number; height: number };
};

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
 * Helper to open the pill popover by hovering and clicking the pill.
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
 * Helper to hover over the Color item to trigger the nested color picker popover.
 */
const hoverColorItem = async (page: Page): Promise<void> => {
  const colorItem = page.getByText('Color');

  await expect(colorItem).toBeVisible();

  const colorBox = assertBoundingBox(await colorItem.boundingBox(), 'Color item');

  await page.mouse.move(colorBox.x + colorBox.width / 2, colorBox.y + colorBox.height / 2);

  const colorPicker = page.locator('[data-blok-testid="cell-color-picker"]');

  await expect(colorPicker).toBeVisible();
};

/**
 * Full helper: select cell, open pill popover, hover Color item to reveal color picker.
 */
const openColorPicker = async (page: Page): Promise<void> => {
  await openPillPopover(page);
  await hoverColorItem(page);
};

test.describe('Color Picker Keyboard Accessibility', () => {
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

  test('Escape key closes the entire popover tree including color picker and pill popover', async ({ page }) => {
    // 1. Initialize the editor with a 3x3 table and wait for the table to be visible
    await create3x3TableWithContent(page);

    // 2. Click on cell (0,0) to select it
    await selectSingleCell(page, 0, 0);

    const pill = page.locator('[data-blok-table-selection-pill]');

    await expect(pill).toBeAttached();

    // 3. Hover over the pill to expand it, then click the pill to open the popover
    await openPillPopover(page);

    await expect(page.getByText('Copy')).toBeVisible();
    await expect(page.getByText('Clear')).toBeVisible();
    await expect(page.getByText('Color')).toBeVisible();

    // 4. Hover over the 'Color' menu item to trigger the nested color picker popover
    await hoverColorItem(page);

    const colorPicker = page.locator('[data-blok-testid="cell-color-picker"]');

    await expect(colorPicker).toBeVisible();

    // 5. Press the Escape key once on the keyboard
    // Actual behavior: Escape closes the entire popover tree via PopoverRegistry.closeTopmost(),
    // which calls hide() on the root pill popover. The root popover's hide() also destroys
    // the nested color picker popover. Both close in a single Escape press.
    await page.keyboard.press('Escape');

    // expect: The color picker nested popover is no longer visible
    await expect(colorPicker).not.toBeVisible();

    // expect: The parent pill popover is also closed (entire tree closes on one Escape)
    await expect(page.getByText('Copy')).not.toBeVisible();
    await expect(page.getByText('Color')).not.toBeVisible();
  });

  test('Click outside color picker while it is open clears selection and closes all popovers', async ({ page }) => {
    // 1. Initialize the editor with a 3x3 table and select cell (0,0)
    await create3x3TableWithContent(page);

    await selectSingleCell(page, 0, 0);

    const pill = page.locator('[data-blok-table-selection-pill]');

    await expect(pill).toBeAttached();

    // Open the pill popover and hover Color to reveal the color picker
    await openColorPicker(page);

    const colorPicker = page.locator('[data-blok-testid="cell-color-picker"]');

    await expect(colorPicker).toBeVisible();

    // 2. Click at coordinates (10, 10) — far outside the table and any popover
    await page.mouse.click(10, 10);

    // expect: The color picker nested popover is no longer visible
    await expect(colorPicker).not.toBeVisible();

    // expect: The pill popover is also closed
    await expect(page.getByText('Copy')).not.toBeVisible();

    // expect: The cell selection is cleared — no data-blok-table-cell-selected attribute on any cell
    const selectedCells = page.locator('[data-blok-table-cell-selected]');

    await expect(selectedCells).toHaveCount(0);
  });
});
