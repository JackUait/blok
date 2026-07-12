import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { OutputData } from '@/types';
import {
  createBlok,
  saveBlok,
  childrenOf,
  findBlock,
  ensureBlokBundleBuilt,
  TEST_PAGE_URL,
} from '../columns-blocks/_helpers';

/**
 * Exiting a table with Tab must stay inside the table's own container.
 *
 * Tree under test:
 *   cl1 (column_list)
 *   ├─ c1 (column) → t1 (table)          ← table is the LAST block of the column
 *   └─ c2 (column) → p2 "Right column"
 *
 * Tab out of the last cell must create a paragraph as the table's next sibling
 * INSIDE the left column — both in the DOM and in saveBlok() output. The old
 * flat-array/DOM-based exit path either teleported the caret into the right
 * column or created the block at root while rendering it inside the column.
 */
const CELL_IDS = ['tp-r0c0', 'tp-r0c1', 'tp-r1c0', 'tp-r1c1'];

const TABLE_IN_COLUMN: OutputData = {
  blocks: [
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['t1'] },
    {
      id: 't1',
      type: 'table',
      data: {
        withHeadings: false,
        withHeadingColumn: false,
        content: [
          [{ blocks: ['tp-r0c0'] }, { blocks: ['tp-r0c1'] }],
          [{ blocks: ['tp-r1c0'] }, { blocks: ['tp-r1c1'] }],
        ],
      },
      parent: 'c1',
      content: CELL_IDS,
    },
    { id: 'tp-r0c0', type: 'paragraph', data: { text: 'Cell A1' }, parent: 't1' },
    { id: 'tp-r0c1', type: 'paragraph', data: { text: 'Cell B1' }, parent: 't1' },
    { id: 'tp-r1c0', type: 'paragraph', data: { text: 'Cell A2' }, parent: 't1' },
    { id: 'tp-r1c1', type: 'paragraph', data: { text: 'Cell B2' }, parent: 't1' },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['p2'] },
    { id: 'p2', type: 'paragraph', data: { text: 'Right column' }, parent: 'c2' },
  ],
};

/**
 * Reports where the focused block lives, straight from the live DOM:
 * its block id, whether it sits inside a table cell, whether it is inside the
 * same column as the table, and whether it directly follows the table holder.
 */
const focusedBlockPlacement = async (page: Page): Promise<{
  id: string | null;
  insideTableCell: boolean;
  insideTableColumn: boolean;
  followsTable: boolean;
}> => {
  return await page.evaluate(() => {
    const active = document.activeElement;
    const holder = active?.closest('[data-blok-id]') ?? null;
    const tableHolder = document.querySelector('[data-blok-id="t1"]');
    const tableColumn = tableHolder?.closest('[data-blok-column]') ?? null;

    return {
      id: holder?.getAttribute('data-blok-id') ?? null,
      insideTableCell: holder?.closest('[data-blok-table-cell]') !== null && holder !== null,
      insideTableColumn: tableColumn !== null && holder !== null && tableColumn.contains(holder),
      followsTable: tableHolder?.nextElementSibling === holder,
    };
  });
};

test.describe('Table exit inside a column', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('Tab out of the last cell creates a paragraph inside the column, after the table', async ({ page }) => {
    await createBlok(page, TABLE_IN_COLUMN);

    const lastCell = page.locator('[data-blok-table-cell]').last();

    await lastCell.locator('[contenteditable="true"]').first().click();
    await page.keyboard.press('Tab');

    await expect.poll(async () => (await focusedBlockPlacement(page)).id).not.toBeNull();

    const placement = await focusedBlockPlacement(page);

    expect(placement.insideTableCell).toBe(false);
    expect(placement.insideTableColumn).toBe(true);
    expect(placement.followsTable).toBe(true);

    const newBlockId = placement.id;

    expect(newBlockId).not.toBeNull();

    if (newBlockId === null) {
      return;
    }

    // save() strips empty paragraphs, so give the new block content before saving.
    await page.keyboard.type('After the table');

    // saveBlok() must agree with the DOM: the new block is a child of the left
    // column, right after the table — not a root block, not in the right column.
    const saved = await saveBlok(page);
    const created = findBlock(saved, newBlockId);

    expect(created?.parent).toBe('c1');
    expect(childrenOf(saved, 'c1')).toEqual(['t1', newBlockId]);
    expect(childrenOf(saved, 'c2')).toEqual(['p2']);
    // The table keeps its own cell subtree — the new block is not one of them.
    expect(childrenOf(saved, 't1')).toEqual(CELL_IDS);

    const rootIds = saved.blocks.filter(block => block.parent === undefined).map(block => block.id);

    expect(rootIds).not.toContain(newBlockId);
  });

  test('Tab out of the last cell never moves the caret into the neighbouring column', async ({ page }) => {
    await createBlok(page, TABLE_IN_COLUMN);

    const lastCell = page.locator('[data-blok-table-cell]').last();

    await lastCell.locator('[contenteditable="true"]').first().click();
    await page.keyboard.press('Tab');

    const placement = await focusedBlockPlacement(page);

    expect(placement.id).not.toBe('p2');
    expect(placement.id).not.toBe('c2');
    expect(placement.insideTableColumn).toBe(true);
  });
});
