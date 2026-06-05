import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { createBlok, ensureBlokBundleBuilt, TEST_PAGE_URL } from './_helpers';

/**
 * Caret keyboard navigation while blocks are nested inside columns.
 *
 * The single-container nesting (table/callout) caret logic flattens
 * predecessor/successor across the whole tree. With the two-level
 * `column_list > column` nest plus HORIZONTAL column layout, the flat
 * neighbor of a block can belong to the OTHER column — so vertical/horizontal
 * arrow navigation can teleport the caret sideways into a sibling column
 * instead of staying in the intended one.
 *
 * These tests assert the CORRECT behavior. Failures surface real columns bugs.
 */

/**
 * Returns the editable content element of the block whose saved id is `id`.
 * The block holder carries data-blok-id; its first [contenteditable] is the
 * text surface we type into and inspect the caret within.
 */
const editableById = (page: Page, id: string): Locator => {
  return page
    .locator(`[data-blok-element][data-blok-id="${id}"]`)
    .locator('[contenteditable="true"]')
    .first();
};

/**
 * Reads the current caret position from the live selection: which block id the
 * caret sits in (resolved via the enclosing [data-blok-id] holder), which
 * column index (0-based, in document order) that block belongs to — or null if
 * the caret is not inside any column — and the caret character offset.
 */
const readCaret = async (
  page: Page
): Promise<{ blockId: string | null; columnIndex: number | null; offset: number } | null> => {
  return page.evaluate(() => {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const node = range.startContainer;
    const element = node instanceof Element ? node : node.parentElement;

    if (!element) {
      return null;
    }

    const holder = element.closest('[data-blok-element][data-blok-id]');
    const blockId = holder?.getAttribute('data-blok-id') ?? null;

    // The column HOLDER is the direct child of [data-blok-columns] and carries
    // data-blok-id; data-blok-column sits on the inner wrapper inside it. Index
    // the caret's enclosing column by its holder so document order is preserved.
    const columnHolders = Array.from(
      document.querySelectorAll('[data-blok-columns] > [data-blok-element][data-blok-id]')
    );
    const ownColumnInner = element.closest('[data-blok-column]');
    const ownColumnHolder =
      ownColumnInner instanceof Element
        ? ownColumnInner.closest('[data-blok-columns] > [data-blok-element][data-blok-id]')
        : null;
    const columnIndex =
      ownColumnHolder instanceof Element ? columnHolders.indexOf(ownColumnHolder) : -1;

    return {
      blockId,
      columnIndex: columnIndex === -1 ? null : columnIndex,
      offset: range.startOffset,
    };
  });
};

/**
 * Polls until the live caret reports the given block id (auto-waiting for the
 * async caret move to settle), then returns the final caret reading.
 */
const expectCaretInBlock = async (
  page: Page,
  expectedBlockId: string
): Promise<{ blockId: string | null; columnIndex: number | null; offset: number }> => {
  await expect
    .poll(async () => (await readCaret(page))?.blockId ?? null, {
      message: `Expected caret to land in block "${expectedBlockId}"`,
    })
    .toBe(expectedBlockId);

  const caret = await readCaret(page);

  if (!caret) {
    throw new Error('Caret reading unavailable after navigation');
  }

  return caret;
};

test.describe('caret navigation within and across columns', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await page.setViewportSize({ width: 1024, height: 800 });
  });

  test('ArrowDown/ArrowUp move between stacked blocks WITHIN one column, never into the other column', async ({ page }) => {
    // Left column has TWO stacked blocks; right column has one. Navigating down
    // from the first left block must land in the SECOND LEFT block (same column),
    // and back up returns to the first — the right column is never touched.
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['l1', 'l2'] },
        { id: 'l1', type: 'paragraph', data: { text: 'Left top' }, parent: 'c1' },
        { id: 'l2', type: 'paragraph', data: { text: 'Left bottom' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['r1'] },
        { id: 'r1', type: 'paragraph', data: { text: 'Right only' }, parent: 'c2' },
      ],
    });

    const leftTop = editableById(page, 'l1');

    await leftTop.click();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowDown');

    const afterDown = await expectCaretInBlock(page, 'l2');

    // Stayed in the left column (index 0), did NOT jump to the right column.
    expect(afterDown.columnIndex).toBe(0);

    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowUp');

    const afterUp = await expectCaretInBlock(page, 'l1');

    expect(afterUp.columnIndex).toBe(0);
  });

  test('ArrowDown from the LAST block of a column exits the column_list to the root block below', async ({ page }) => {
    // Caret at end of the last block of the left column; a root paragraph sits
    // below the whole column_list. ArrowDown must exit the entire layout into
    // that root block — not slide into the sibling right column.
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['l1'] },
        { id: 'l1', type: 'paragraph', data: { text: 'Left only' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['r1'] },
        { id: 'r1', type: 'paragraph', data: { text: 'Right only' }, parent: 'c2' },
        { id: 'below', type: 'paragraph', data: { text: 'Root below' } },
      ],
    });

    await editableById(page, 'l1').click();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowDown');

    const caret = await expectCaretInBlock(page, 'below');

    // Landed at root, outside every column.
    expect(caret.columnIndex).toBeNull();
  });

  test('ArrowUp from the FIRST block of a column exits upward to the root block above the column_list', async ({ page }) => {
    // Caret at start of the first block of the right column; a root paragraph
    // sits above the column_list. ArrowUp must exit upward into that root block,
    // not into the left column's block.
    await createBlok(page, {
      blocks: [
        { id: 'above', type: 'paragraph', data: { text: 'Root above' } },
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['l1'] },
        { id: 'l1', type: 'paragraph', data: { text: 'Left only' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['r1'] },
        { id: 'r1', type: 'paragraph', data: { text: 'Right only' }, parent: 'c2' },
      ],
    });

    await editableById(page, 'r1').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowUp');

    const caret = await expectCaretInBlock(page, 'above');

    expect(caret.columnIndex).toBeNull();
  });

  test('ArrowRight at end of a column block moves into the next column', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['l1'] },
        { id: 'l1', type: 'paragraph', data: { text: 'Left only' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['r1'] },
        { id: 'r1', type: 'paragraph', data: { text: 'Right only' }, parent: 'c2' },
      ],
    });

    await editableById(page, 'l1').click();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowRight');

    const caret = await expectCaretInBlock(page, 'r1');

    expect(caret.columnIndex).toBe(1);
  });

  test('ArrowLeft at start of a column block moves into the previous column', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['l1'] },
        { id: 'l1', type: 'paragraph', data: { text: 'Left only' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['r1'] },
        { id: 'r1', type: 'paragraph', data: { text: 'Right only' }, parent: 'c2' },
      ],
    });

    await editableById(page, 'r1').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowLeft');

    const caret = await expectCaretInBlock(page, 'l1');

    expect(caret.columnIndex).toBe(0);
  });

  test('ArrowRight in the RIGHTMOST column exits the layout instead of crossing', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['l1'] },
        { id: 'l1', type: 'paragraph', data: { text: 'Left only' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['r1'] },
        { id: 'r1', type: 'paragraph', data: { text: 'Right only' }, parent: 'c2' },
        { id: 'below', type: 'paragraph', data: { text: 'Root below' } },
      ],
    });

    await editableById(page, 'r1').click();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowRight');

    const caret = await expectCaretInBlock(page, 'below');

    expect(caret.columnIndex).toBeNull();
  });

  test('ArrowLeft in the LEFTMOST column exits the layout instead of crossing', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'above', type: 'paragraph', data: { text: 'Root above' } },
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['l1'] },
        { id: 'l1', type: 'paragraph', data: { text: 'Left only' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['r1'] },
        { id: 'r1', type: 'paragraph', data: { text: 'Right only' }, parent: 'c2' },
      ],
    });

    await editableById(page, 'l1').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowLeft');

    const caret = await expectCaretInBlock(page, 'above');

    expect(caret.columnIndex).toBeNull();
  });
});
