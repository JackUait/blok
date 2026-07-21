import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

/**
 * Regression: blocks (e.g. images) inserted at the TOP of a table cell
 * drifted to the BOTTOM of the cell after editor.save(), and kept reverting
 * on every subsequent save no matter how the user reordered them.
 *
 * Root cause: the table model appended every claimed block to the end of the
 * cell's block list regardless of its visible position, and save() persisted
 * that stale model order. These tests pin the WYSIWYG law: saved cell order
 * === visible DOM order, across save and reload.
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

/** Block ids mounted in a cell, in visible DOM order. */
const getCellDomBlockIds = async (page: Page, row: number, col: number): Promise<string[]> =>
  getCell(page, row, col)
    .locator('[data-blok-table-cell-blocks] [data-blok-id]')
    .evaluateAll(elements => elements.map(el => el.getAttribute('data-blok-id') ?? ''));

/** Block ids the table persisted for a cell via editor.save(). */
const getSavedCellBlockIds = async (page: Page, row: number, col: number): Promise<string[]> =>
  page.evaluate(async ({ cellRow, cellCol }) => {
    if (!window.blokInstance) {
      throw new Error('blok instance is not available');
    }

    const saved = await window.blokInstance.save();
    const tableBlock = saved.blocks.find(block => block.type === 'table');

    if (!tableBlock) {
      throw new Error('no table block in saved data');
    }

    const content = (tableBlock.data as { content: { blocks: string[] }[][] }).content;

    return content[cellRow][cellCol].blocks;
  }, { cellRow: row, cellCol: col });

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

const createBlok = async (page: Page, data: OutputData | null = null): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(async ({ holder, data: initialData }) => {
    const blokConfig: Record<string, unknown> = {
      holder,
      tools: {
        table: { class: (window as unknown as { Blok: { Table: unknown } }).Blok.Table },
      },
    };

    if (initialData) {
      blokConfig.data = initialData;
    }

    const blok = new window.Blok(blokConfig);

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, data });
};

const createTableWithCellText = async (page: Page): Promise<void> => {
  await createBlok(page, {
    blocks: [
      {
        type: 'table',
        data: {
          withHeadings: false,
          content: [['', ''], ['', '']],
        },
      },
    ],
  });

  await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

  // Type two paragraphs into the first cell: "hello" then Enter then "world".
  const editable = getCellEditable(page, 0, 0).first();

  await editable.click();
  await page.keyboard.type('hello');
  await page.keyboard.press('Enter');
  await page.keyboard.type('world');

  await expect(getCell(page, 0, 0).locator('[data-blok-id]')).toHaveCount(2);
};

test.describe('table cell block order survives save (WYSIWYG)', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('a block inserted ABOVE existing cell content saves at the top, not the bottom', async ({ page }) => {
    await createTableWithCellText(page);

    // Insert a new block above "hello": caret to start of the first block,
    // press Enter — an empty paragraph is inserted before it (the same
    // non-tail insert an image placed at the top of a cell performs).
    const firstBlockEditable = getCell(page, 0, 0)
      .locator('[data-blok-id] [contenteditable="true"]')
      .first();

    await firstBlockEditable.click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');

    await expect(getCell(page, 0, 0).locator('[data-blok-id]')).toHaveCount(3);

    const domIds = await getCellDomBlockIds(page, 0, 0);
    const savedIds = await getSavedCellBlockIds(page, 0, 0);

    expect(savedIds).toEqual(domIds);

    // Saving must be idempotent: a second save keeps the same order
    // (the original bug re-shuffled content on EVERY save).
    expect(await getSavedCellBlockIds(page, 0, 0)).toEqual(domIds);
  });

  test('the visible order survives a save → reload round trip', async ({ page }) => {
    await createTableWithCellText(page);

    const firstBlockEditable = getCell(page, 0, 0)
      .locator('[data-blok-id] [contenteditable="true"]')
      .first();

    await firstBlockEditable.click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');

    await expect(getCell(page, 0, 0).locator('[data-blok-id]')).toHaveCount(3);

    const textsBefore = await getCell(page, 0, 0)
      .locator('[data-blok-table-cell-blocks] [data-blok-id]')
      .evaluateAll(elements => elements.map(el => el.textContent?.trim() ?? ''));

    const saved = await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('blok instance is not available');
      }

      return window.blokInstance.save();
    });

    // Reload the editor from the saved data — the cell must render in the
    // same visible order the user left it in.
    await createBlok(page, saved);
    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    const textsAfter = await getCell(page, 0, 0)
      .locator('[data-blok-table-cell-blocks] [data-blok-id]')
      .evaluateAll(elements => elements.map(el => el.textContent?.trim() ?? ''));

    expect(textsAfter).toEqual(textsBefore);
  });
});
