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
  readOnly?: boolean;
};

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const HOLDER_ID = 'blok';
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;

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

test.describe('Cell colors in readonly mode', () => {
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

  test('Background color is applied to cells when initialized in readonly mode', async ({ page }) => {
    // 1. Create editor in edit mode, apply color, save data
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [
                [{ blocks: [], color: '#f97316' }, 'B1'],
                ['A2', 'B2'],
              ],
            },
          },
        ],
      },
    });

    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // Save to get block-based format with color preserved
    const savedData = await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('blokInstance not found');
      }

      return window.blokInstance.save();
    });

    // 2. Re-create in readonly mode with the saved data
    await createBlok(page, {
      tools: defaultTools,
      readOnly: true,
      data: savedData,
    });

    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // 3. Verify cell (0,0) has backgroundColor applied
    const cellBg = await getCell(page, 0, 0).evaluate(
      (el) => (el as HTMLElement).style.backgroundColor
    );

    expect(cellBg, 'Cell (0,0) should have backgroundColor in readonly mode').toBeTruthy();

    // 4. Verify cell (0,1) does NOT have backgroundColor
    const cell01Bg = await getCell(page, 0, 1).evaluate(
      (el) => (el as HTMLElement).style.backgroundColor
    );

    expect(cell01Bg, 'Cell (0,1) should NOT have backgroundColor').toBe('');
  });

  test('Text color is applied to cells when initialized in readonly mode', async ({ page }) => {
    // 1. Create editor in edit mode with textColor, save data
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [
                [{ blocks: [], textColor: '#3b82f6' }, 'B1'],
                ['A2', 'B2'],
              ],
            },
          },
        ],
      },
    });

    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    const savedData = await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('blokInstance not found');
      }

      return window.blokInstance.save();
    });

    // 2. Re-create in readonly mode
    await createBlok(page, {
      tools: defaultTools,
      readOnly: true,
      data: savedData,
    });

    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // 3. Verify cell (0,0) has text color applied
    const cellColor = await getCell(page, 0, 0).evaluate(
      (el) => (el as HTMLElement).style.color
    );

    expect(cellColor, 'Cell (0,0) should have text color in readonly mode').toBeTruthy();

    // 4. Verify cell (0,1) does NOT have text color
    const cell01Color = await getCell(page, 0, 1).evaluate(
      (el) => (el as HTMLElement).style.color
    );

    expect(cell01Color, 'Cell (0,1) should NOT have text color').toBe('');
  });

  test('Both color and textColor are applied together in readonly mode', async ({ page }) => {
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [
                [{ blocks: [], color: '#f97316', textColor: '#3b82f6' }, 'B1'],
                ['A2', 'B2'],
              ],
            },
          },
        ],
      },
    });

    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    const savedData = await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('blokInstance not found');
      }

      return window.blokInstance.save();
    });

    await createBlok(page, {
      tools: defaultTools,
      readOnly: true,
      data: savedData,
    });

    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    const styles = await getCell(page, 0, 0).evaluate(
      (el) => ({
        backgroundColor: (el as HTMLElement).style.backgroundColor,
        color: (el as HTMLElement).style.color,
      })
    );

    expect(styles.backgroundColor, 'Cell (0,0) should have backgroundColor in readonly').toBeTruthy();
    expect(styles.color, 'Cell (0,0) should have text color in readonly').toBeTruthy();
  });

  test('Cell colors are preserved when toggling from edit to readonly mode', async ({ page }) => {
    // 1. Create in edit mode with color
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [
                [{ blocks: [], color: '#f97316', textColor: '#3b82f6' }, 'B1'],
                ['A2', 'B2'],
              ],
            },
          },
        ],
      },
    });

    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // Verify colors in edit mode
    const editStyles = await getCell(page, 0, 0).evaluate(
      (el) => ({
        backgroundColor: (el as HTMLElement).style.backgroundColor,
        color: (el as HTMLElement).style.color,
      })
    );

    expect(editStyles.backgroundColor, 'Cell should have bg color in edit mode').toBeTruthy();
    expect(editStyles.color, 'Cell should have text color in edit mode').toBeTruthy();

    // 2. Toggle to readonly
    await page.evaluate(async () => {
      const blok = window.blokInstance;

      if (!blok) {
        throw new Error('Blok instance not found');
      }

      await blok.readOnly.toggle(true);
    });

    await page.waitForFunction(() => window.blokInstance?.readOnly.isEnabled === true);

    // 3. Verify colors are still applied after toggle
    const readonlyStyles = await getCell(page, 0, 0).evaluate(
      (el) => ({
        backgroundColor: (el as HTMLElement).style.backgroundColor,
        color: (el as HTMLElement).style.color,
      })
    );

    expect(readonlyStyles.backgroundColor, 'Cell should retain bg color in readonly mode').toBeTruthy();
    expect(readonlyStyles.color, 'Cell should retain text color in readonly mode').toBeTruthy();
  });
});
