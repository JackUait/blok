import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

/**
 * REGRESSION MATRIX — focus must stay inside the table cell after ANY
 * content-deleting gesture performed inside it.
 *
 * Deleting cell content used to drop focus onto <body> through THREE
 * independent paths (multi-cell clear, block-selection deletion with no
 * replacement, toolbar-lasso selecting the whole table). Each row of this
 * matrix pins one user gesture. If you add a new deletion path (a new
 * keyboard handler, a new selection mode, a new clear-content action),
 * add its gesture here.
 */

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const HOLDER_ID = 'blok';
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;

const getCell = (page: Page, row: number, col: number): ReturnType<Page['locator']> =>
  page.locator(`${TABLE_SELECTOR} >> [data-blok-table-row] >> nth=${row}`)
    .locator(`[data-blok-table-cell] >> nth=${col}`);

const getCellEditable = (page: Page, row: number, col: number): ReturnType<Page['locator']> =>
  getCell(page, row, col).locator('[contenteditable="true"]');

const createBlok = async (page: Page, data: OutputData): Promise<void> => {
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

  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async ({ holder, initialData }) => {
    const BlokCtor = window.Blok as unknown as (new (config: unknown) => Blok) & {
      Table: unknown;
      Paragraph: unknown;
    };
    const blok = new BlokCtor({
      holder,
      tools: {
        table: { class: BlokCtor.Table },
        paragraph: { class: BlokCtor.Paragraph },
      },
      data: initialData,
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initialData: data });
};

/** A table surrounded by paragraphs, so an escaping caret has somewhere to go. */
const SURROUNDED_TABLE: OutputData = {
  blocks: [
    { type: 'paragraph', data: { text: 'before table' } },
    {
      type: 'table',
      data: {
        withHeadings: false,
        content: [
          ['Hello', 'B1'],
          ['A2', 'B2'],
        ],
      },
    },
    { type: 'paragraph', data: { text: 'after table' } },
  ],
};

/**
 * Assert that the focused element sits inside the given cell.
 */
const expectFocusInCell = async (page: Page, row: number, col: number): Promise<void> => {
  await expect
    .poll(async () =>
      page.evaluate(({ expectedRow, expectedCol }) => {
        const cell = document.activeElement?.closest('[data-blok-table-cell]');

        return cell?.getAttribute('data-blok-table-cell-row') === String(expectedRow)
          && cell?.getAttribute('data-blok-table-cell-col') === String(expectedCol);
      }, { expectedRow: row, expectedCol: col })
    )
    .toBe(true);
};

/**
 * Click into cell (0,0) and block-select its line via Cmd+A escalation
 * (first press selects the line's text, second selects it as a block).
 */
const blockSelectFirstCellLine = async (page: Page): Promise<void> => {
  await getCellEditable(page, 0, 0).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+a');
  await expect(page.locator('[data-blok-selected="true"]')).toHaveCount(1);
};

/**
 * Drag-select cells (0,0) through (1,1) with the mouse.
 */
const selectAllFourCells = async (page: Page): Promise<void> => {
  const startBox = await getCell(page, 0, 0).boundingBox();
  const endBox = await getCell(page, 1, 1).boundingBox();

  expect(startBox).toBeTruthy();
  expect(endBox).toBeTruthy();

  if (!startBox || !endBox) {
    return;
  }

  await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('[data-blok-table-cell-selected]')).toHaveCount(4);
};

test.describe('table cell delete-focus matrix', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await createBlok(page, SURROUNDED_TABLE);
    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();
  });

  test('character Backspace keeps focus in the cell', async ({ page }) => {
    await getCellEditable(page, 0, 0).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace');

    await expect(getCellEditable(page, 0, 0)).toHaveText('Hell');
    await expectFocusInCell(page, 0, 0);
  });

  test('text select-all + Backspace keeps focus in the cell', async ({ page }) => {
    await getCellEditable(page, 0, 0).click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');

    await expect(getCellEditable(page, 0, 0)).toHaveText('');
    await expectFocusInCell(page, 0, 0);
  });

  test('Backspace in an already-empty cell keeps focus in the cell', async ({ page }) => {
    await getCellEditable(page, 0, 0).click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await expect(getCellEditable(page, 0, 0)).toHaveText('');

    await page.keyboard.press('Backspace');

    await expectFocusInCell(page, 0, 0);
  });

  test('block-selected line + Backspace keeps focus in the cell', async ({ page }) => {
    await blockSelectFirstCellLine(page);
    await page.keyboard.press('Backspace');

    await expect(getCellEditable(page, 0, 0)).toHaveText('');
    await expectFocusInCell(page, 0, 0);
  });

  test('block-selected line + Delete keeps focus in the cell', async ({ page }) => {
    await blockSelectFirstCellLine(page);
    await page.keyboard.press('Delete');

    await expect(getCellEditable(page, 0, 0)).toHaveText('');
    await expectFocusInCell(page, 0, 0);
  });

  test('block-selected line + Cut keeps focus in the cell', async ({ page }) => {
    await blockSelectFirstCellLine(page);
    await page.keyboard.press('ControlOrMeta+x');

    await expect(getCellEditable(page, 0, 0)).toHaveText('');
    await expectFocusInCell(page, 0, 0);
  });

  test('multi-line block selection + Backspace keeps focus in the cell', async ({ page }) => {
    // Build a 3-line cell, block-select the last line, extend upward, delete
    await getCellEditable(page, 0, 0).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('line two');
    await page.keyboard.press('Enter');
    await page.keyboard.type('line three');

    // Block-select the caret line, then extend upward to a multi-line selection
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Shift+ArrowUp');
    await expect
      .poll(async () => page.locator('[data-blok-selected="true"]').count())
      .toBeGreaterThanOrEqual(2);

    await page.keyboard.press('Backspace');

    await expectFocusInCell(page, 0, 0);
  });

  test('multi-cell selection + Delete keeps focus in the anchor cell', async ({ page }) => {
    await selectAllFourCells(page);

    await page.keyboard.press('Delete');

    await expect(getCellEditable(page, 0, 0)).toHaveText('');
    await expectFocusInCell(page, 0, 0);
  });

  test('multi-cell selection + Cut keeps focus in the anchor cell', async ({ page }) => {
    await selectAllFourCells(page);

    await page.keyboard.press('ControlOrMeta+x');

    await expect(getCellEditable(page, 0, 0)).toHaveText('');
    await expectFocusInCell(page, 0, 0);
  });

  test('typing over a block-selected line keeps focus in the cell', async ({ page }) => {
    await blockSelectFirstCellLine(page);
    await page.keyboard.type('X');

    await expect(getCellEditable(page, 0, 0)).toHaveText('X');
    await expectFocusInCell(page, 0, 0);
  });

  test('deleting content never deletes the table itself', async ({ page }) => {
    await blockSelectFirstCellLine(page);
    await page.keyboard.press('Backspace');

    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();
    await expect(page.getByText('before table')).toBeVisible();
    await expect(page.getByText('after table')).toBeVisible();
  });
});
