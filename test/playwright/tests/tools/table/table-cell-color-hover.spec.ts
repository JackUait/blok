// spec: Cell color picker opens on hover and appears to the right of pill popover
// Regression: color picker should open when hovering the Color item (not clicking)
// and should be positioned to the right of the pill popover.

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

const selectSingleCell = async (page: Page, row: number, col: number): Promise<void> => {
  const cell = getCell(page, row, col);
  const box = assertBoundingBox(await cell.boundingBox(), `cell [${row},${col}]`);

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};

const openPillPopover = async (page: Page): Promise<void> => {
  const pill = page.locator('[data-blok-table-selection-pill]');

  await expect(pill).toBeAttached();
  const pillBox = assertBoundingBox(await pill.boundingBox(), 'selection pill');

  await page.mouse.move(pillBox.x + pillBox.width / 2, pillBox.y + pillBox.height / 2);
  await expect(pill).toBeVisible();
  await pill.click();
};

/**
 * Helper: hover over the Color item in the pill popover to trigger the color picker.
 */
const hoverColorItem = async (page: Page): Promise<void> => {
  const colorItem = page.getByText('Color');

  await expect(colorItem).toBeVisible();

  const colorBox = assertBoundingBox(await colorItem.boundingBox(), 'Color item');

  await page.mouse.move(colorBox.x + colorBox.width / 2, colorBox.y + colorBox.height / 2);
};

test.describe('Cell color picker hover behavior', () => {
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

  test('color picker opens on hover over Color item', async ({ page }) => {
    await create3x3TableWithContent(page);

    // Select cell and open pill popover
    await selectSingleCell(page, 0, 0);
    await openPillPopover(page);

    // Hover over the Color item (not click)
    await hoverColorItem(page);

    // Color picker should appear
    const colorPicker = page.locator('[data-blok-testid="cell-color-picker"]');

    await expect(colorPicker).toBeVisible();
  });

  test('color picker is rendered inside a nested popover', async ({ page }) => {
    await create3x3TableWithContent(page);

    await selectSingleCell(page, 0, 0);
    await openPillPopover(page);
    await hoverColorItem(page);

    const colorPicker = page.locator('[data-blok-testid="cell-color-picker"]');

    await expect(colorPicker).toBeVisible();

    // The color picker should be inside a proper nested popover (data-blok-nested="true")
    const nestedPopover = page.locator('[data-blok-nested="true"]');

    await expect(nestedPopover).toBeAttached();

    // The color picker should be contained within the nested popover
    await expect(nestedPopover.locator('[data-blok-testid="cell-color-picker"]')).toBeVisible();
  });

  test('hovering a swatch in the color picker applies color', async ({ page }) => {
    await create3x3TableWithContent(page);

    await selectSingleCell(page, 0, 0);
    await openPillPopover(page);
    await hoverColorItem(page);

    const colorPicker = page.locator('[data-blok-testid="cell-color-picker"]');

    await expect(colorPicker).toBeVisible();

    // Click a swatch
    const swatch = page.locator('[data-blok-testid="cell-color-swatch-orange"]');

    await expect(swatch).toBeVisible();
    await swatch.click({ force: true });

    // Verify cell has background color applied
    const cellBg = await getCell(page, 0, 0).evaluate(
      (el) => (el as HTMLElement).style.backgroundColor
    );

    expect(cellBg).toBeTruthy();
  });

  test('color picker closes when the parent popover closes', async ({ page }) => {
    await create3x3TableWithContent(page);

    await selectSingleCell(page, 0, 0);
    await openPillPopover(page);
    await hoverColorItem(page);

    const colorPicker = page.locator('[data-blok-testid="cell-color-picker"]');

    await expect(colorPicker).toBeVisible();

    // Press Escape to close the entire popover tree
    await page.keyboard.press('Escape');

    // Both parent and nested popover should be closed
    await expect(colorPicker).not.toBeVisible();
  });

  test('color picker is positioned to the right of the parent popover', async ({ page }) => {
    await create3x3TableWithContent(page);

    await selectSingleCell(page, 0, 0);
    await openPillPopover(page);
    await hoverColorItem(page);

    const colorPicker = page.locator('[data-blok-testid="cell-color-picker"]');

    await expect(colorPicker).toBeVisible();

    // Get the parent popover container (the one with Copy item, not the nested color picker)
    const parentContainer = page.locator('[data-blok-popover-container]').filter({ has: page.getByText('Copy') });
    const parentBox = assertBoundingBox(await parentContainer.boundingBox(), 'parent popover');

    // Get the color picker bounding box
    const pickerBox = assertBoundingBox(await colorPicker.boundingBox(), 'color picker');

    // The color picker should be positioned to the right of the parent popover
    // Allow small overlap (nested-popover-overlap is 4px)
    expect(pickerBox.x).toBeGreaterThanOrEqual(parentBox.x + parentBox.width - 10);
  });

  test('color picker stays visible when mouse moves from Color item to picker', async ({ page }) => {
    await create3x3TableWithContent(page);

    await selectSingleCell(page, 0, 0);
    await openPillPopover(page);
    await hoverColorItem(page);

    const colorPicker = page.locator('[data-blok-testid="cell-color-picker"]');

    await expect(colorPicker).toBeVisible();

    // Move mouse from Color item into the color picker
    const pickerBox = assertBoundingBox(await colorPicker.boundingBox(), 'color picker');

    await page.mouse.move(pickerBox.x + pickerBox.width / 2, pickerBox.y + pickerBox.height / 2);

    // Color picker should still be visible
    await expect(colorPicker).toBeVisible();
  });
});
