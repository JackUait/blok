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

const selectCells = async (
  page: Page,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number
): Promise<void> => {
  const startCell = getCell(page, startRow, startCol);
  const endCell = getCell(page, endRow, endCol);

  const startBox = assertBoundingBox(await startCell.boundingBox(), `cell [${startRow},${startCol}]`);
  const endBox = assertBoundingBox(await endCell.boundingBox(), `cell [${endRow},${endCol}]`);

  const isSingleColumn = startCol === endCol;
  const startX = isSingleColumn ? startBox.x + 5 : startBox.x + startBox.width / 2;
  const startY = startBox.y + startBox.height / 2;
  const endX = isSingleColumn ? endBox.x + 5 : endBox.x + endBox.width / 2;
  const endY = endBox.y + endBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();
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

/**
 * Helper to apply a background color to a specific cell, then click outside to close the popover.
 */
const applyColorToCell = async (
  page: Page,
  row: number,
  col: number,
  swatchName: string
): Promise<void> => {
  await selectSingleCell(page, row, col);

  const pill = page.locator('[data-blok-table-selection-pill]');

  await expect(pill).toBeAttached();
  await openColorPicker(page);
  await clickSwatch(page, swatchName);

  // Click outside to close the popover
  await page.mouse.click(10, 10);
};

test.describe('Multiple Different Colors Across Cells', () => {
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

  test('Different background colors can be applied to multiple individual cells independently', async ({ page }) => {
    // 1. Initialize a 3x3 table
    await create3x3TableWithContent(page);

    // 2. Apply orange to cell (0,0)
    await applyColorToCell(page, 0, 0, 'orange');

    const cell00Bg = await getCell(page, 0, 0).evaluate(
      (el) => (el as HTMLElement).style.backgroundColor
    );

    expect(cell00Bg, 'Cell (0,0) should have orange backgroundColor').toBeTruthy();

    // 3. Apply blue to cell (1,1)
    await applyColorToCell(page, 1, 1, 'blue');

    const cell11Bg = await getCell(page, 1, 1).evaluate(
      (el) => (el as HTMLElement).style.backgroundColor
    );

    expect(cell11Bg, 'Cell (1,1) should have blue backgroundColor').toBeTruthy();

    // 4. Apply red to cell (2,2)
    await applyColorToCell(page, 2, 2, 'red');

    const cell22Bg = await getCell(page, 2, 2).evaluate(
      (el) => (el as HTMLElement).style.backgroundColor
    );

    expect(cell22Bg, 'Cell (2,2) should have red backgroundColor').toBeTruthy();

    // 5. Verify all three colored cells have distinct, non-empty backgroundColor values
    expect(cell00Bg, 'Cell (0,0) backgroundColor should be non-empty').toBeTruthy();
    expect(cell11Bg, 'Cell (1,1) backgroundColor should be non-empty').toBeTruthy();
    expect(cell22Bg, 'Cell (2,2) backgroundColor should be non-empty').toBeTruthy();
    expect(cell00Bg).not.toBe(cell11Bg);
    expect(cell11Bg).not.toBe(cell22Bg);

    // Verify uncolored cells have empty backgroundColor
    const uncoloredCells: Array<[number, number]> = [
      [0, 1], [0, 2],
      [1, 0], [1, 2],
      [2, 0], [2, 1],
    ];

    for (const [row, col] of uncoloredCells) {
      const bg = await getCell(page, row, col).evaluate(
        (el) => (el as HTMLElement).style.backgroundColor
      );

      expect(bg, `Cell (${row},${col}) should NOT have backgroundColor`).toBe('');
    }

    // 6. Save and verify color data in the content array
    const savedData = await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('blokInstance is not initialized');
      }

      return window.blokInstance.save();
    });

    const content = (savedData.blocks[0].data as {
      content: Array<Array<{ color?: string }>>;
    }).content;

    expect(content[0][0].color, 'content[0][0].color should be truthy').toBeTruthy();
    expect(content[1][1].color, 'content[1][1].color should be truthy').toBeTruthy();
    expect(content[2][2].color, 'content[2][2].color should be truthy').toBeTruthy();
    expect(content[0][0].color).not.toBe(content[1][1].color);
    expect(content[1][1].color).not.toBe(content[2][2].color);
  });

  test('Overwriting a cell color with a different color updates correctly', async ({ page }) => {
    // 1. Initialize a 3x3 table and apply orange to cell (0,0)
    await create3x3TableWithContent(page);

    await applyColorToCell(page, 0, 0, 'orange');

    const cellBgOrange = await getCell(page, 0, 0).evaluate(
      (el) => (el as HTMLElement).style.backgroundColor
    );

    expect(cellBgOrange, 'Cell (0,0) should have orange backgroundColor initially').toBeTruthy();

    // 2. Select cell (0,0) again and apply blue to overwrite orange
    await selectSingleCell(page, 0, 0);

    const pill = page.locator('[data-blok-table-selection-pill]');

    await expect(pill).toBeAttached();
    await openColorPicker(page);
    await clickSwatch(page, 'blue');

    // Click outside to close
    await page.mouse.click(10, 10);

    const cellBgBlue = await getCell(page, 0, 0).evaluate(
      (el) => (el as HTMLElement).style.backgroundColor
    );

    expect(cellBgBlue, 'Cell (0,0) should have blue backgroundColor after overwrite').toBeTruthy();
    expect(cellBgBlue, 'Cell (0,0) backgroundColor should have changed from orange to blue').not.toBe(cellBgOrange);

    // 3. Save and verify the color is the blue value
    const savedData = await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('blokInstance is not initialized');
      }

      return window.blokInstance.save();
    });

    const content = (savedData.blocks[0].data as {
      content: Array<Array<{ color?: string }>>;
    }).content;

    expect(content[0][0].color, 'Saved content[0][0].color should be the blue value').toBeTruthy();
    // The saved color should correspond to blue swatch, not the original orange
    expect(content[0][0].color).not.toBe(cellBgOrange);
  });

  test('A multi-cell drag selection applies the same color to all selected cells', async ({ page }) => {
    // 1. Initialize a 3x3 table and pre-color cell (0,0) with orange and (2,2) with blue
    await create3x3TableWithContent(page);

    await applyColorToCell(page, 0, 0, 'orange');
    await applyColorToCell(page, 2, 2, 'blue');

    const cell00BgBefore = await getCell(page, 0, 0).evaluate(
      (el) => (el as HTMLElement).style.backgroundColor
    );

    const cell22BgBefore = await getCell(page, 2, 2).evaluate(
      (el) => (el as HTMLElement).style.backgroundColor
    );

    expect(cell00BgBefore, 'Cell (0,0) should have orange backgroundColor').toBeTruthy();
    expect(cell22BgBefore, 'Cell (2,2) should have blue backgroundColor').toBeTruthy();

    // 2. Drag-select from (0,0) to (1,1) to create a 2x2 selection, then apply green
    await selectCells(page, 0, 0, 1, 1);

    const selected = page.locator('[data-blok-table-cell-selected]');

    await expect(selected).toHaveCount(4);

    await openColorPicker(page);
    await clickSwatch(page, 'green');

    // Click outside to close
    await page.mouse.click(10, 10);

    // Verify cells (0,0), (0,1), (1,0), (1,1) all have green backgroundColor
    for (const [row, col] of [[0, 0], [0, 1], [1, 0], [1, 1]] as Array<[number, number]>) {
      const bg = await getCell(page, row, col).evaluate(
        (el) => (el as HTMLElement).style.backgroundColor
      );

      expect(bg, `Cell (${row},${col}) should have green backgroundColor`).toBeTruthy();
    }

    // Cell (0,0) previously orange should now have green (overwritten)
    const cell00BgAfter = await getCell(page, 0, 0).evaluate(
      (el) => (el as HTMLElement).style.backgroundColor
    );

    expect(cell00BgAfter, 'Cell (0,0) orange should be overwritten with green').not.toBe(cell00BgBefore);

    // Cell (2,2) should retain its blue backgroundColor (not in the drag selection)
    const cell22BgAfter = await getCell(page, 2, 2).evaluate(
      (el) => (el as HTMLElement).style.backgroundColor
    );

    expect(cell22BgAfter, 'Cell (2,2) should retain its blue backgroundColor').toBeTruthy();
    expect(cell22BgAfter).toBe(cell22BgBefore);

    // 3. Save and verify the content array
    const savedData = await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('blokInstance is not initialized');
      }

      return window.blokInstance.save();
    });

    const content = (savedData.blocks[0].data as {
      content: Array<Array<{ color?: string }>>;
    }).content;

    const greenColor = content[0][0].color;

    expect(greenColor, 'content[0][0].color should be green').toBeTruthy();
    expect(content[0][1].color, 'content[0][1].color should be green').toBe(greenColor);
    expect(content[1][0].color, 'content[1][0].color should be green').toBe(greenColor);
    expect(content[1][1].color, 'content[1][1].color should be green').toBe(greenColor);
    expect(content[2][2].color, 'content[2][2].color should be blue').toBeTruthy();
    expect(content[2][2].color, 'content[2][2].color should differ from green').not.toBe(greenColor);
  });
});
