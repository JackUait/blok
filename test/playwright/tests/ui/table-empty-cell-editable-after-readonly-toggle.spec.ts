import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

/**
 * Locate a table cell by its (row, col) data attributes. These are stable data
 * attributes emitted by the table tool (not CSS classes), so they are safe
 * semantic locators.
 */
const cellLocator = (page: Page, row: number, col: number) =>
  page.locator(
    `${BLOK_INTERFACE_SELECTOR} [data-blok-table-cell-row="${row}"][data-blok-table-cell-col="${col}"]`
  );

/**
 * Boot a Blok instance in READ-ONLY mode with a blocks-format table that
 * mirrors the published-KB-article data shape: filled cells reference child
 * paragraph blocks by id, and an EMPTY cell is stored as `{ blocks: [] }`
 * (the shape produced by migrating an empty source cell). Cell (0,1) is the
 * empty one.
 */
const createReadOnlyTableWithEmptyCell = async (page: Page): Promise<void> => {
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

  const data: OutputData = {
    blocks: [
      {
        id: 'tbl1',
        type: 'table',
        data: {
          withHeadings: false,
          withHeadingColumn: false,
          content: [
            [{ blocks: ['p1'] }, { blocks: [] }],
            [{ blocks: ['p2'] }, { blocks: ['p3'] }],
          ],
        },
      },
      { id: 'p1', type: 'paragraph', data: { text: 'Position' }, parent: 'tbl1' },
      { id: 'p2', type: 'paragraph', data: { text: '31.05' }, parent: 'tbl1' },
      { id: 'p3', type: 'paragraph', data: { text: 'sell until notice' }, parent: 'tbl1' },
    ],
  };

  await page.evaluate(
    async ({ holder, data: initialData }) => {
      const tableClass = (window.Blok as unknown as Record<string, unknown>).Table;
      const blok = new window.Blok({
        holder,
        tools: {
          table: { class: tableClass },
        },
        data: initialData,
        readOnly: true,
      });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, data }
  );
};

test.describe('table empty cell editable after read-only → edit toggle', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  /**
   * Regression for the published-KB-article bug: a table rendered read-only and
   * then toggled to edit left cells stored as `{ blocks: [] }` with no editable
   * target. Clicking the cell focused nothing and typing inserted nothing — the
   * cell was permanently non-editable. setReadOnly(false) now synthesizes a
   * paragraph for every empty cell so it can receive a caret and text.
   */
  test('user can click an empty cell and type after switching from read-only to edit', async ({ page }) => {
    await createReadOnlyTableWithEmptyCell(page);

    const emptyCell = cellLocator(page, 0, 1);

    await expect(emptyCell).toBeVisible();

    // In read-only mode the empty cell has no editable target.
    await expect(emptyCell.locator('[contenteditable="true"]')).toHaveCount(0);

    // Toggle the editor to edit mode in place (the user pressing "edit").
    await page.evaluate(async () => {
      await window.blokInstance?.readOnly.toggle(false);
    });

    // After the toggle the empty cell must expose an editable paragraph.
    const editable = emptyCell.locator('[contenteditable="true"]');

    await expect(editable).toHaveCount(1);

    // The real user flow that was broken: click the cell, then type.
    await emptyCell.click();
    await page.keyboard.type('FILLED IN');

    await expect(emptyCell).toContainText('FILLED IN');

    // The previously-filled cells must keep their content (no loss/duplication).
    await expect(cellLocator(page, 0, 0)).toContainText('Position');
    await expect(cellLocator(page, 1, 0)).toContainText('31.05');
    await expect(cellLocator(page, 1, 1)).toContainText('sell until notice');

    // And exactly one editable target per filled cell — the empty-cell repair
    // must not have duplicated paragraphs into populated cells.
    await expect(cellLocator(page, 0, 0).locator('[contenteditable="true"]')).toHaveCount(1);
    await expect(cellLocator(page, 1, 1).locator('[contenteditable="true"]')).toHaveCount(1);
  });
});
