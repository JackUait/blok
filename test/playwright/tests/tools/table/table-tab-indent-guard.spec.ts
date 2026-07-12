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
 * Tab-indent nests a block under its preceding sibling. A table's children ARE
 * its cell blocks, so nesting an outside block into one made it a rogue cell
 * block — the table then rendered it inside its first cell, and the block the
 * user had just created by tabbing OUT of the table visibly teleported back IN
 * on the very next Tab.
 *
 * The rule this guards: a tool that owns its children (`ownsChildren`) can never
 * be an indent target. Tab is a no-op there, exactly as it is with no preceding
 * sibling at all.
 */
const CELL_IDS = ['tp-r0c0', 'tp-r0c1', 'tp-r1c0', 'tp-r1c1'];

const TABLE_AT_ROOT: OutputData = {
  blocks: [
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
      content: CELL_IDS,
    },
    { id: 'tp-r0c0', type: 'paragraph', data: { text: 'Cell A1' }, parent: 't1' },
    { id: 'tp-r0c1', type: 'paragraph', data: { text: 'Cell B1' }, parent: 't1' },
    { id: 'tp-r1c0', type: 'paragraph', data: { text: 'Cell A2' }, parent: 't1' },
    { id: 'tp-r1c1', type: 'paragraph', data: { text: 'Cell B2' }, parent: 't1' },
  ],
};

const COLUMNS_THEN_PARAGRAPH: OutputData = {
  blocks: [
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['p1'] },
    { id: 'p1', type: 'paragraph', data: { text: 'Left' }, parent: 'c1' },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['p2'] },
    { id: 'p2', type: 'paragraph', data: { text: 'Right' }, parent: 'c2' },
    { id: 'after', type: 'paragraph', data: { text: 'Below the columns' } },
  ],
};

/**
 * The id of the block holding the caret, and whether its holder currently sits
 * inside the table's grid — read from the live DOM, which is where the teleport
 * was visible.
 */
const focusedBlock = async (page: Page): Promise<{ id: string | null; insideTable: boolean }> => {
  return await page.evaluate(() => {
    const holder = document.activeElement?.closest('[data-blok-id]') ?? null;

    return {
      id: holder?.getAttribute('data-blok-id') ?? null,
      insideTable: holder !== null && holder.closest('[data-blok-table-cell]') !== null,
    };
  });
};

test.describe('Tab never indents a block into a tool-owned container', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('Tab out of the last cell, then Tab again — the block stays out of the table', async ({ page }) => {
    await createBlok(page, TABLE_AT_ROOT);

    await page.locator('[data-blok-table-cell]').last()
      .locator('[contenteditable="true"]')
      .first()
      .click();

    // Tab #1 exits the table, creating a new paragraph after it.
    await page.keyboard.press('Tab');
    await expect.poll(async () => (await focusedBlock(page)).id).not.toBe('tp-r1c1');

    const exited = await focusedBlock(page);
    const newBlockId = exited.id;

    expect(exited.insideTable).toBe(false);
    expect(newBlockId).not.toBeNull();

    if (newBlockId === null) {
      return;
    }

    // Tab #2 used to nest that paragraph under the table — the preceding sibling —
    // which the table rendered inside its first cell.
    await page.keyboard.press('Tab');
    await page.keyboard.type('Outside');

    const settled = await focusedBlock(page);

    expect(settled.id).toBe(newBlockId);
    expect(settled.insideTable).toBe(false);

    const saved = await saveBlok(page);

    // The table still owns exactly its four cell blocks, and the paragraph is
    // still a root-level sibling of the table.
    expect(childrenOf(saved, 't1')).toEqual(CELL_IDS);
    expect(findBlock(saved, newBlockId)?.parent).toBeUndefined();
  });

  test('Tab does not indent a paragraph into the column_list above it', async ({ page }) => {
    await createBlok(page, COLUMNS_THEN_PARAGRAPH);

    await page.locator('[data-blok-id="after"] [contenteditable="true"]').first().click();
    await page.keyboard.press('Tab');

    const saved = await saveBlok(page);

    // A column_list's children are its columns. Adopting the paragraph would make
    // it a column that is not a `column`.
    expect(childrenOf(saved, 'cl1')).toEqual(['c1', 'c2']);
    expect(findBlock(saved, 'after')?.parent).toBeUndefined();
  });
});
