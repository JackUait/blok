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

test.describe('Color Rendering on Initial Page Load', () => {
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

  test('Background color is applied to cells on initial render from saved data', async ({ page }) => {
    // 1. Initialize the editor with pre-existing table data that includes color on cell (0,0)
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [
                [{ blocks: [], color: '#f97316' }, 'B1', 'C1'],
                ['A2', 'B2', 'C2'],
                ['A3', 'B3', 'C3'],
              ],
            },
          },
        ],
      },
    });

    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // 2. Without any user interaction, inspect backgroundColor of cell (0,0)
    const cellBg = await getCell(page, 0, 0).evaluate(
      (el) => (el as HTMLElement).style.backgroundColor
    );

    expect(cellBg, 'Cell (0,0) should have backgroundColor from initial data').toBeTruthy();
    expect(cellBg.length).toBeGreaterThan(0);

    // 3. Inspect backgroundColor of (0,1) and (0,2) — they had no color in initial data
    const cell01Bg = await getCell(page, 0, 1).evaluate(
      (el) => (el as HTMLElement).style.backgroundColor
    );

    expect(cell01Bg, 'Cell (0,1) should NOT have backgroundColor').toBe('');

    const cell02Bg = await getCell(page, 0, 2).evaluate(
      (el) => (el as HTMLElement).style.backgroundColor
    );

    expect(cell02Bg, 'Cell (0,2) should NOT have backgroundColor').toBe('');
  });

  test('Both background and text color are applied correctly on initial render', async ({ page }) => {
    // 1. Initialize with cell (0,0) having both color and textColor
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [
                [{ blocks: [], color: '#f97316', textColor: '#3b82f6' }, 'B1', 'C1'],
                ['A2', 'B2', 'C2'],
                ['A3', 'B3', 'C3'],
              ],
            },
          },
        ],
      },
    });

    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // 2. Inspect both backgroundColor and color styles of cell (0,0)
    const styles = await getCell(page, 0, 0).evaluate(
      (el) => ({
        backgroundColor: (el as HTMLElement).style.backgroundColor,
        color: (el as HTMLElement).style.color,
      })
    );

    expect(styles.backgroundColor, 'Cell (0,0) should have backgroundColor').toBeTruthy();
    expect(styles.color, 'Cell (0,0) should have text color').toBeTruthy();

    // 3. Verify cells without color data have empty styles
    const cell01Styles = await getCell(page, 0, 1).evaluate(
      (el) => ({
        backgroundColor: (el as HTMLElement).style.backgroundColor,
        color: (el as HTMLElement).style.color,
      })
    );

    expect(cell01Styles.backgroundColor, 'Cell (0,1) backgroundColor should be empty').toBe('');
    expect(cell01Styles.color, 'Cell (0,1) color should be empty').toBe('');
  });

  test('Color data survives a full save-then-reload cycle', async ({ page }) => {
    // 1. Initialize a 3x3 table and apply orange background color to cell (0,0)
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

    await selectSingleCell(page, 0, 0);

    const pill = page.locator('[data-blok-table-selection-pill]');

    await expect(pill).toBeAttached();
    await openColorPicker(page);
    await clickSwatch(page, 'orange');

    // Verify color applied
    const cellBgBefore = await getCell(page, 0, 0).evaluate(
      (el) => (el as HTMLElement).style.backgroundColor
    );

    expect(cellBgBefore, 'Cell (0,0) should have backgroundColor after applying orange swatch').toBeTruthy();

    // 2. Save the editor data and capture it
    const savedData = await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('blokInstance is not initialized');
      }

      return window.blokInstance.save();
    });

    const content = (savedData.blocks[0].data as {
      content: Array<Array<{ color?: string }>>;
    }).content;

    expect(content[0][0].color, 'Saved data should have color on cell (0,0)').toBeTruthy();

    // 3. Destroy and recreate the editor with the saved data
    await page.evaluate(async (data) => {
      if (window.blokInstance) {
        await window.blokInstance.destroy?.();
        window.blokInstance = undefined;
      }

      const blok = new window.Blok({
        holder: 'blok',
        tools: {
          table: { class: (window.Blok as unknown as Record<string, unknown>).Table },
          paragraph: { class: (window.Blok as unknown as Record<string, unknown>).Paragraph },
        },
        data,
      });

      window.blokInstance = blok;
      await blok.isReady;
    }, savedData);

    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // 4. Inspect backgroundColor of cell (0,0) after re-initialization
    const cellBgAfter = await getCell(page, 0, 0).evaluate(
      (el) => (el as HTMLElement).style.backgroundColor
    );

    expect(cellBgAfter, 'Cell (0,0) should still have backgroundColor after reload').toBeTruthy();

    // 5. Verify all other cells have empty backgroundColor
    const otherCells: Array<[number, number]> = [
      [0, 1], [0, 2],
      [1, 0], [1, 1], [1, 2],
      [2, 0], [2, 1], [2, 2],
    ];

    for (const [row, col] of otherCells) {
      const bg = await getCell(page, row, col).evaluate(
        (el) => (el as HTMLElement).style.backgroundColor
      );

      expect(bg, `Cell (${row},${col}) should NOT have backgroundColor after reload`).toBe('');
    }
  });
});
