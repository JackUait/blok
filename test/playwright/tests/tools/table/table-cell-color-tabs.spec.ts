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

const hoverPill = async (page: Page): Promise<void> => {
  const pill = page.locator('[data-blok-table-selection-pill]');

  await expect(pill).toBeAttached();
  const pillBox = assertBoundingBox(await pill.boundingBox(), 'selection pill');

  await page.mouse.move(pillBox.x + pillBox.width / 2, pillBox.y + pillBox.height / 2);
};

const openColorPicker = async (page: Page): Promise<void> => {
  await hoverPill(page);

  const pill = page.locator('[data-blok-table-selection-pill]');

  await expect(pill).toBeVisible();
  await pill.click();

  const colorItem = page.getByText('Color');

  await expect(colorItem).toBeVisible();

  const colorBox = assertBoundingBox(await colorItem.boundingBox(), 'Color item');

  await page.mouse.move(colorBox.x + colorBox.width / 2, colorBox.y + colorBox.height / 2);

  const colorPicker = page.locator('[data-blok-testid="cell-color-picker"]');

  await expect(colorPicker).toBeVisible();
};

const clickSwatch = async (page: Page, name: string): Promise<void> => {
  const swatch = page.locator(`[data-blok-testid="cell-color-swatch-${name}"]`);

  await expect(swatch).toBeVisible();
  await swatch.click({ force: true });
};

const switchColorTab = async (page: Page, mode: 'textColor' | 'backgroundColor'): Promise<void> => {
  const tab = page.locator(`[data-blok-testid="cell-color-tab-${mode}"]`);

  await expect(tab).toBeVisible();
  await tab.click();
};

test.describe('Color Picker Tab Switching', () => {
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

  test('Switching from Background to Text tab resets swatch selection without clearing applied color', async ({ page }) => {
    // 1. Initialize the editor and select cell (0,0); open the color picker (Background tab by default)
    await create3x3TableWithContent(page);

    await selectSingleCell(page, 0, 0);

    const pill = page.locator('[data-blok-table-selection-pill]');

    await expect(pill).toBeAttached();
    await openColorPicker(page);

    // Verify Background tab is active by default
    const backgroundTab = page.locator('[data-blok-testid="cell-color-tab-backgroundColor"]');

    await expect(backgroundTab).toBeVisible();

    // 2. Click the orange background swatch
    await clickSwatch(page, 'orange');

    const cellBgAfterOrange = await getCell(page, 0, 0).evaluate(
      (el) => (el as HTMLElement).style.backgroundColor
    );

    expect(cellBgAfterOrange, 'Cell (0,0) should have non-empty backgroundColor after orange swatch').toBeTruthy();

    // 3. Without closing the picker, switch to the Text Color tab
    await switchColorTab(page, 'textColor');

    // Cell backgroundColor should still be non-empty after tab switch
    const cellBgAfterTabSwitch = await getCell(page, 0, 0).evaluate(
      (el) => (el as HTMLElement).style.backgroundColor
    );

    expect(cellBgAfterTabSwitch, 'Cell (0,0) backgroundColor should remain after switching to Text tab').toBeTruthy();
    expect(cellBgAfterTabSwitch).toBe(cellBgAfterOrange);

    // Text tab swatches should be visible
    const colorPicker = page.locator('[data-blok-testid="cell-color-picker"]');

    await expect(colorPicker).toBeVisible();

    // 4. Click the blue text color swatch
    await clickSwatch(page, 'blue');

    const styles = await getCell(page, 0, 0).evaluate(
      (el) => ({
        backgroundColor: (el as HTMLElement).style.backgroundColor,
        color: (el as HTMLElement).style.color,
      })
    );

    expect(styles.color, 'Cell (0,0) should have non-empty text color after blue swatch').toBeTruthy();
    expect(styles.backgroundColor, 'Cell (0,0) backgroundColor should remain after applying text color').toBeTruthy();
  });

  test('Default button in Background tab only removes background color, not text color', async ({ page }) => {
    // 1. Initialize, apply orange background and blue text color to cell (0,0)
    await create3x3TableWithContent(page);

    await selectSingleCell(page, 0, 0);

    const pill = page.locator('[data-blok-table-selection-pill]');

    await expect(pill).toBeAttached();

    // Apply background color first
    await openColorPicker(page);
    await clickSwatch(page, 'orange');

    // Switch to text tab and apply blue text color
    await switchColorTab(page, 'textColor');
    await clickSwatch(page, 'blue');

    // Click outside to close
    await page.mouse.click(10, 10);

    // Verify both colors are set
    const stylesBefore = await getCell(page, 0, 0).evaluate(
      (el) => ({
        backgroundColor: (el as HTMLElement).style.backgroundColor,
        color: (el as HTMLElement).style.color,
      })
    );

    expect(stylesBefore.backgroundColor, 'Cell (0,0) should have backgroundColor before default').toBeTruthy();
    expect(stylesBefore.color, 'Cell (0,0) should have text color before default').toBeTruthy();

    // 2. Re-select cell and open color picker; ensure Background tab is active; click Default
    await selectSingleCell(page, 0, 0);
    await expect(pill).toBeAttached();
    await openColorPicker(page);

    // Ensure Background tab is active
    const backgroundTab = page.locator('[data-blok-testid="cell-color-tab-backgroundColor"]');

    await expect(backgroundTab).toBeVisible();
    await backgroundTab.click();

    const defaultBtn = page.locator('[data-blok-testid="cell-color-default-btn"]');

    await expect(defaultBtn).toBeVisible();
    await defaultBtn.click();

    // Verify backgroundColor is empty but text color remains
    const stylesAfter = await getCell(page, 0, 0).evaluate(
      (el) => ({
        backgroundColor: (el as HTMLElement).style.backgroundColor,
        color: (el as HTMLElement).style.color,
      })
    );

    expect(stylesAfter.backgroundColor, 'Cell (0,0) backgroundColor should be empty after Default on Background tab').toBe('');
    expect(stylesAfter.color, 'Cell (0,0) text color should remain after Default on Background tab').toBeTruthy();
  });

  test('Default button in Text tab only removes text color, not background color', async ({ page }) => {
    // 1. Initialize, apply orange background and blue text color to cell (0,0)
    await create3x3TableWithContent(page);

    await selectSingleCell(page, 0, 0);

    const pill = page.locator('[data-blok-table-selection-pill]');

    await expect(pill).toBeAttached();

    // Apply background color
    await openColorPicker(page);
    await clickSwatch(page, 'orange');

    // Switch to text tab and apply text color
    await switchColorTab(page, 'textColor');
    await clickSwatch(page, 'blue');

    // Click outside to close
    await page.mouse.click(10, 10);

    // Verify both colors are set
    const stylesBefore = await getCell(page, 0, 0).evaluate(
      (el) => ({
        backgroundColor: (el as HTMLElement).style.backgroundColor,
        color: (el as HTMLElement).style.color,
      })
    );

    expect(stylesBefore.backgroundColor, 'Cell (0,0) should have backgroundColor before default').toBeTruthy();
    expect(stylesBefore.color, 'Cell (0,0) should have text color before default').toBeTruthy();

    // 2. Re-select cell, open color picker, switch to Text tab, click Default
    await selectSingleCell(page, 0, 0);
    await expect(pill).toBeAttached();
    await openColorPicker(page);
    await switchColorTab(page, 'textColor');

    const defaultBtn = page.locator('[data-blok-testid="cell-color-default-btn"]');

    await expect(defaultBtn).toBeVisible();
    await defaultBtn.click();

    // Verify text color is empty but backgroundColor remains
    const stylesAfter = await getCell(page, 0, 0).evaluate(
      (el) => ({
        backgroundColor: (el as HTMLElement).style.backgroundColor,
        color: (el as HTMLElement).style.color,
      })
    );

    expect(stylesAfter.color, 'Cell (0,0) text color should be empty after Default on Text tab').toBe('');
    expect(stylesAfter.backgroundColor, 'Cell (0,0) backgroundColor should remain after Default on Text tab').toBeTruthy();
  });
});
