// spec: Notion-parity arrow-key navigation between table cells
// seed: test/playwright/tests/tools/table/table-keyboard-nav.spec.ts

import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;
const CELL_SELECTOR = '[data-blok-table-cell]';

type SerializableToolConfig = { className?: string; config?: Record<string, unknown> };
type CreateBlokOptions = { data?: OutputData; tools?: Record<string, SerializableToolConfig> };

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const getCellEditable = (page: Page, row: number, col: number): ReturnType<Page['locator']> =>
  page.locator(`${TABLE_SELECTOR} >> [data-blok-table-row] >> nth=${row}`)
    .locator(`${CELL_SELECTOR} >> nth=${col}`)
    .locator('[contenteditable="true"]');

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
  const { data = null, tools = {} } = options;

  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  const serializedTools = Object.entries(tools).map(([name, tool]) => ({
    name,
    className: tool.className ?? null,
    config: tool.config ?? {},
  }));

  await page.evaluate(async ({ holder, data: initialData, serializedTools: toolsConfig }) => {
    const blokConfig: Record<string, unknown> = { holder };

    if (initialData) {
      blokConfig.data = initialData;
    }
    if (toolsConfig.length > 0) {
      blokConfig.tools = toolsConfig.reduce<Record<string, { class: unknown } & Record<string, unknown>>>(
        (accumulator, { name, className, config }) => {
          const toolClass = className
            ? className.split('.').reduce((obj: unknown, key: string) => (obj as Record<string, unknown>)?.[key], window)
            : null;

          if (!toolClass) {
            throw new Error(`Tool "${name}" is not available globally`);
          }

          return { ...accumulator, [name]: { class: toolClass, ...config } };
        }, {});
    }

    const blok = new window.Blok(blokConfig);

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, data, serializedTools });
};

const defaultTools: Record<string, SerializableToolConfig> = { table: { className: 'Blok.Table' } };

const create3x3 = async (page: Page): Promise<void> => {
  await createBlok(page, {
    tools: defaultTools,
    data: {
      blocks: [
        {
          type: 'table',
          data: {
            withHeadings: false,
            content: [
              ['a0', 'b0', 'c0'],
              ['a1', 'b1', 'c1'],
              ['a2', 'b2', 'c2'],
            ],
          },
        },
      ],
    },
  });
};

/** Row/col of the cell holding the caret, or [-1,-1] if focus left the grid. */
const focusedCell = async (page: Page): Promise<[number, number]> =>
  page.evaluate(() => {
    const cell = document.activeElement?.closest('[data-blok-table-cell]');

    if (!cell) {
      return [-1, -1] as [number, number];
    }

    return [
      Number(cell.getAttribute('data-blok-table-cell-row')),
      Number(cell.getAttribute('data-blok-table-cell-col')),
    ] as [number, number];
  });

test.describe('Arrow-key navigation between cells', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('ArrowDown moves to the cell directly below in the same column', async ({ page }) => {
    await create3x3(page);
    await getCellEditable(page, 0, 1).first().click();

    await page.keyboard.press('ArrowDown');

    await expect.poll(() => focusedCell(page)).toEqual([1, 1]);
  });

  test('ArrowUp moves to the cell directly above in the same column', async ({ page }) => {
    await create3x3(page);
    await getCellEditable(page, 2, 2).first().click();

    await page.keyboard.press('ArrowUp');

    await expect.poll(() => focusedCell(page)).toEqual([1, 2]);
  });

  test('ArrowRight at the end of a cell crosses into the next cell', async ({ page }) => {
    await create3x3(page);
    // Caret must sit at the very end of the cell text for a rightward crossing.
    await getCellEditable(page, 0, 0).first().click();
    await page.keyboard.press('End');

    await page.keyboard.press('ArrowRight');

    await expect.poll(() => focusedCell(page)).toEqual([0, 1]);
  });

  test('ArrowLeft at the start of a cell crosses into the previous cell', async ({ page }) => {
    await create3x3(page);
    await getCellEditable(page, 0, 1).first().click();
    await page.keyboard.press('Home');

    await page.keyboard.press('ArrowLeft');

    await expect.poll(() => focusedCell(page)).toEqual([0, 0]);
  });

  test('ArrowRight in the middle of cell text stays inside the cell', async ({ page }) => {
    await create3x3(page);
    await getCellEditable(page, 0, 0).first().click();
    await page.keyboard.press('Home');

    // Caret is before "a0" — one ArrowRight moves within the text, not to the next cell.
    await page.keyboard.press('ArrowRight');

    await expect.poll(() => focusedCell(page)).toEqual([0, 0]);
  });

  test('ArrowDown on the last row exits the table', async ({ page }) => {
    await create3x3(page);
    await getCellEditable(page, 2, 1).first().click();

    await page.keyboard.press('ArrowDown');

    await expect.poll(() => focusedCell(page)).toEqual([-1, -1]);
  });
});
