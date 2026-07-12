// spec: Table block settings menu (header toggles / fit to page width / full width)
// seed: test/playwright/tests/tools/table/table-config-stretched.spec.ts

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;
const CELL_SELECTOR = '[data-blok-table-cell]';
const SETTINGS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const RESIZE_HANDLE_SELECTOR = '[data-blok-table-resize]';

type CreateBlokOptions = {
  data?: OutputData;
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

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page, options: CreateBlokOptions = {}): Promise<void> => {
  const { data = null } = options;

  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, data: initialData }) => {
      const tableClass = (window as unknown as Record<string, Record<string, unknown>>).Blok.Table;

      const blok = new window.Blok({
        holder,
        tools: { table: { class: tableClass } },
        ...(initialData ? { data: initialData } : {}),
      } as never);

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID,
      data }
  );
};

const seedTable = async (page: Page, tableData: Record<string, unknown>): Promise<void> => {
  await createBlok(page, {
    data: {
      blocks: [
        {
          type: 'table',
          data: {
            withHeadings: false,
            content: [['A', 'B'], ['C', 'D']],
            ...tableData,
          },
        },
      ],
    } as OutputData,
  });

  await expect(page.locator(TABLE_SELECTOR)).toBeVisible();
};

const openTableSettings = async (page: Page): Promise<void> => {
  await page.locator(CELL_SELECTOR).first().click();
  await page.locator(SETTINGS_BUTTON_SELECTOR).click();
  await expect(page.locator('[data-blok-item-name="table-fit-to-page-width"]')).toBeVisible();
};

const activateSetting = async (page: Page, name: string): Promise<void> => {
  await page.locator(`[data-blok-item-name="${name}"]`).click();
};

const savedTableData = async (page: Page): Promise<Record<string, unknown>> => {
  const saved = await page.evaluate(async () => window.blokInstance?.save());
  const tableBlock = saved?.blocks.find((block: { type: string }) => block.type === 'table');

  expect(tableBlock).toBeDefined();

  return tableBlock?.data ?? {};
};

/**
 * Read the rendered <table> element's inline style / column units.
 * Done inside evaluate() so the spec never needs a raw CSS element selector.
 */
const readGridWidths = async (page: Page): Promise<{ width: string; minWidth: string; cols: string[] }> =>
  page.locator(TABLE_SELECTOR).evaluate(wrapper => {
    const grid = wrapper.querySelector('table');

    return {
      width: grid instanceof HTMLElement ? grid.style.width : '',
      minWidth: grid instanceof HTMLElement ? grid.style.minWidth : '',
      cols: grid
        ? Array.from(grid.querySelectorAll('col')).map(col => col.style.width)
        : [],
    };
  });

test.describe('Table block settings menu', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('Fit to page width resets a resized table back to fluid width', async ({ page }) => {
    await seedTable(page, { colWidths: [400, 150] });

    expect((await readGridWidths(page)).width).toBe('551px');

    await openTableSettings(page);
    await activateSetting(page, 'table-fit-to-page-width');

    await expect.poll(async () => (await readGridWidths(page)).width).toBe('100%');

    const data = await savedTableData(page);

    expect(data.colWidths).toBeUndefined();

    const { cols, minWidth } = await readGridWidths(page);

    expect(cols).toEqual(['50%', '50%']);
    expect(minWidth).toBe('100px');
  });

  test('Fit to page width undoes a resize drag', async ({ page }) => {
    await seedTable(page, {});

    const handle = page.locator(RESIZE_HANDLE_SELECTOR).first();
    const box = await handle.boundingBox();

    expect(box).not.toBeNull();

    const handleBox = box ?? { x: 0,
      y: 0,
      width: 0,
      height: 0 };

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width / 2 + 80, handleBox.y + handleBox.height / 2, { steps: 5 });
    await page.mouse.up();

    await expect(async () => {
      const data = await savedTableData(page);

      expect(data.colWidths).toBeDefined();
    }).toPass();

    await openTableSettings(page);
    await activateSetting(page, 'table-fit-to-page-width');

    await expect.poll(async () => (await readGridWidths(page)).width).toBe('100%');

    const data = await savedTableData(page);

    expect(data.colWidths).toBeUndefined();
  });

  test('Full width toggles the stretched flag', async ({ page }) => {
    await seedTable(page, {});

    await openTableSettings(page);
    await activateSetting(page, 'table-full-width');

    const stretchedData = await savedTableData(page);

    expect(stretchedData.stretched).toBe(true);

    await openTableSettings(page);
    await activateSetting(page, 'table-full-width');

    const restoredData = await savedTableData(page);

    expect(restoredData.stretched).toBe(false);
  });

  test('Header row and header column toggles are available from the block menu', async ({ page }) => {
    await seedTable(page, {});

    await openTableSettings(page);
    await activateSetting(page, 'table-heading-row');

    await expect(page.locator('[data-blok-table-row][data-blok-table-heading]')).toHaveCount(1);
    expect((await savedTableData(page)).withHeadings).toBe(true);

    await openTableSettings(page);
    await activateSetting(page, 'table-heading-column');

    await expect(page.locator('[data-blok-table-heading-col]')).toHaveCount(2);
    expect((await savedTableData(page)).withHeadingColumn).toBe(true);
  });
});
