import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const HOLDER_ID = 'blok';
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;
const SELECTED_CELL_SELECTOR = `${TABLE_SELECTOR} [data-blok-table-cell-selected]`;
const SELECTED_BLOCK_SELECTOR = '[data-blok-selected="true"]';

const getCell = (page: Page, row: number, col: number): ReturnType<Page['locator']> =>
  page
    .locator(`${TABLE_SELECTOR} [data-blok-table-row]`).nth(row)
    .locator('[data-blok-table-cell]').nth(col);

const getCellEditable = (page: Page, row: number, col: number): ReturnType<Page['locator']> =>
  getCell(page, row, col).locator('[contenteditable="true"]').first();

const TABLE_DATA: OutputData = {
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
};

const create3x3Table = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder, data }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);

    const resolveTool = (path: string): unknown =>
      path
        .split('.')
        .reduce((obj: unknown, key: string) => (obj as Record<string, unknown>)?.[key], window as unknown);

    const blokConfig: Record<string, unknown> = {
      holder,
      data,
      tools: {
        table: { class: resolveTool('Blok.Table') },
        paragraph: { class: resolveTool('Blok.Paragraph') },
      },
    };

    const blok = new window.Blok(blokConfig);

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, data: TABLE_DATA });

  await expect(page.locator(TABLE_SELECTOR)).toBeVisible();
};

/**
 * Put the caret at the end of a cell's text.
 */
const caretAtEndOf = async (page: Page, row: number, col: number): Promise<void> => {
  await getCellEditable(page, row, col).click();
  await page.keyboard.press('End');
};

test.describe('Table keyboard cell selection', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await create3x3Table(page);
  });

  test('Shift+ArrowRight twice selects three cells and creates no cross-block selection', async ({ page }) => {
    await caretAtEndOf(page, 0, 0);

    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');

    await expect(page.locator(SELECTED_CELL_SELECTOR)).toHaveCount(3);
    await expect(page.locator(SELECTED_BLOCK_SELECTOR)).toHaveCount(0);
  });

  test('Shift+ArrowDown extends the rectangle downward', async ({ page }) => {
    await caretAtEndOf(page, 0, 0);

    await page.keyboard.press('Shift+ArrowDown');

    await expect(page.locator(SELECTED_CELL_SELECTOR)).toHaveCount(2);
    await expect(page.locator(SELECTED_BLOCK_SELECTOR)).toHaveCount(0);
  });

  test('Shift+ArrowRight then Shift+ArrowDown selects a 2x2 rectangle', async ({ page }) => {
    await caretAtEndOf(page, 0, 0);

    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');

    await expect(page.locator(SELECTED_CELL_SELECTOR)).toHaveCount(4);
  });

  test('Cmd/Ctrl+B bolds every cell of the rectangle in one undo step', async ({ page }) => {
    await caretAtEndOf(page, 0, 0);
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(page.locator(SELECTED_CELL_SELECTOR)).toHaveCount(4);

    await page.keyboard.press('ControlOrMeta+b');

    for (const [row, col] of [[0, 0], [0, 1], [1, 0], [1, 1]] as const) {
      await expect(getCellEditable(page, row, col).getByRole('strong')).toHaveCount(1);
    }

    await page.keyboard.press('ControlOrMeta+z');

    // A single undo must revert ALL four cells, not just the last one.
    await expect
      .poll(async () => page.locator(TABLE_SELECTOR).getByRole('strong').count())
      .toBe(0);
  });

  test('Cmd/Ctrl+R fills the leftmost column right across the rectangle', async ({ page }) => {
    await caretAtEndOf(page, 0, 0);
    await page.keyboard.press('Shift+ArrowRight');
    await expect(page.locator(SELECTED_CELL_SELECTOR)).toHaveCount(2);

    await page.keyboard.press('ControlOrMeta+r');

    await expect(getCellEditable(page, 0, 1)).toHaveText('A1');
    await expect(getCellEditable(page, 0, 0)).toHaveText('A1');
  });

  test('Cmd/Ctrl+D fills the top row down across the rectangle', async ({ page }) => {
    await caretAtEndOf(page, 0, 0);
    await page.keyboard.press('Shift+ArrowDown');
    await expect(page.locator(SELECTED_CELL_SELECTOR)).toHaveCount(2);

    await page.keyboard.press('ControlOrMeta+d');

    await expect(getCellEditable(page, 1, 0)).toHaveText('A1');
  });

  /**
   * The cell box belongs to the cell that holds the caret. It used to be
   * painted only from pointerup, so it was pointer-only state: Tab moved the
   * caret to the next cell and the box stayed behind on the clicked cell.
   */
  test('Tab moves the cell box along with the caret', async ({ page }) => {
    await caretAtEndOf(page, 0, 0);

    await expect(getCell(page, 0, 0)).toHaveAttribute('data-blok-table-cell-selected', '');

    await page.keyboard.press('Tab');

    await expect(getCell(page, 0, 1)).toHaveAttribute('data-blok-table-cell-selected', '');
    await expect(page.locator(SELECTED_CELL_SELECTOR)).toHaveCount(1);
    await expect(getCell(page, 0, 0)).not.toHaveAttribute('data-blok-table-cell-selected', '');
  });

  test('Shift+Tab moves the cell box back with the caret', async ({ page }) => {
    await caretAtEndOf(page, 1, 1);

    await page.keyboard.press('Shift+Tab');

    await expect(getCell(page, 1, 0)).toHaveAttribute('data-blok-table-cell-selected', '');
    await expect(page.locator(SELECTED_CELL_SELECTOR)).toHaveCount(1);
  });

  /**
   * Tabbing out of the last cell moves the caret to the block below, so no cell
   * holds it any more. The box used to stay painted on the last cell, leaving
   * the table looking like it still owned the focus.
   */
  test('Tab out of the last cell leaves no box behind in the table', async ({ page }) => {
    await caretAtEndOf(page, 2, 2);

    await expect(page.locator(SELECTED_CELL_SELECTOR)).toHaveCount(1);

    await page.keyboard.press('Tab');

    await expect(page.locator(SELECTED_CELL_SELECTOR)).toHaveCount(0);
    await expect(page.locator(`${TABLE_SELECTOR} [data-blok-table-selection-overlay]`)).toHaveCount(0);
  });

  test('Shift+Arrow mid-text extends the TEXT selection, not the cell rectangle', async ({ page }) => {
    await getCellEditable(page, 0, 0).click();
    await page.keyboard.press('Home');

    // Clicking a cell paints a 1x1 selection while the caret edits its text.
    await expect(page.locator(SELECTED_CELL_SELECTOR)).toHaveCount(1);

    await page.keyboard.press('Shift+ArrowRight');

    // The rectangle must NOT grow — the keystroke belongs to the text.
    await expect(page.locator(SELECTED_CELL_SELECTOR)).toHaveCount(1);
    await expect
      .poll(async () => page.evaluate(() => window.getSelection()?.toString() ?? ''))
      .toBe('A');
  });
});
