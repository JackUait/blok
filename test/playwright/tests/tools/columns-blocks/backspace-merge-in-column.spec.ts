import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { OutputData } from '@/types';
import {
  childrenOf,
  createBlok,
  ensureBlokBundleBuilt,
  findBlock,
  saveBlok,
  TEST_PAGE_URL,
} from './_helpers';

/**
 * Backspace/Delete merge behavior for blocks nested inside a column.
 *
 * A column is an independent vertical stack. A Backspace at the start of the
 * FIRST block of a column must never reach across the column boundary into a
 * sibling column or into the column/column_list wrapper — exactly the same
 * boundary guarantee table cells and toggles already enforce. The flat block
 * array makes the previousBlock of a column's first child either the previous
 * column's last child or a wrapper, so an unguarded merge crosses the boundary.
 *
 * These tests drive the LIVE editor (real caret + Backspace) and assert on
 * save(), the public contract that reveals model corruption.
 */

type ParagraphData = { text?: string };

/**
 * Place the caret at offset 0 of the block whose holder carries `blockId`,
 * then press Backspace. Clicks the block's content surface, uses Home to
 * guarantee offset 0 (so the merge-at-boundary path is exercised), then
 * Backspace.
 */
const backspaceAtStartOf = async (page: Page, blockId: string): Promise<void> => {
  const holder = page.locator(`[data-blok-id="${blockId}"]`).first();

  await holder.locator('[data-blok-element-content]').first().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
};

const textOf = (saved: OutputData, id: string): string | undefined =>
  (findBlock(saved, id)?.data as ParagraphData | undefined)?.text;

const twoColumnFixture = (): OutputData => ({
  blocks: [
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['left1'] },
    { id: 'left1', type: 'paragraph', data: { text: 'Left only block' }, parent: 'c1' },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['right1'] },
    { id: 'right1', type: 'paragraph', data: { text: 'Right block' }, parent: 'c2' },
  ],
});

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Backspace/Delete merge at column boundaries', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('Backspace at start of the first block in the LEFT column does not merge across the column boundary', async ({ page }) => {
    await createBlok(page, twoColumnFixture());

    await expect(page.locator('[data-blok-column]')).toHaveCount(2);

    // Caret at offset 0 of the first (and only) block in the left column.
    await backspaceAtStartOf(page, 'left1');

    const saved = await saveBlok(page);

    // The left block stays put, unchanged, parented to its column.
    expect(findBlock(saved, 'left1')?.parent).toBe('c1');
    expect(textOf(saved, 'left1')).toBe('Left only block');

    // The right column is untouched — Backspace did NOT pull it across the boundary.
    expect(findBlock(saved, 'right1')?.parent).toBe('c2');
    expect(textOf(saved, 'right1')).toBe('Right block');

    // The whole column scaffold survives: list + both columns in order.
    expect(findBlock(saved, 'cl1')?.type).toBe('column_list');
    expect(saved.blocks.filter(b => b.type === 'column').map(b => b.id)).toEqual(['c1', 'c2']);
    expect(childrenOf(saved, 'c1')).toEqual(['left1']);
    expect(childrenOf(saved, 'c2')).toEqual(['right1']);

    // No content escaped to root.
    const rootBlocks = saved.blocks.filter(b => b.type === 'paragraph' && b.parent === undefined);
    expect(rootBlocks).toHaveLength(0);
  });

  test('Backspace between two stacked blocks in the SAME column merges them and keeps the survivor in that column', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['l1', 'l2'] },
        { id: 'l1', type: 'paragraph', data: { text: 'First' }, parent: 'c1' },
        { id: 'l2', type: 'paragraph', data: { text: 'Second' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['right1'] },
        { id: 'right1', type: 'paragraph', data: { text: 'Right block' }, parent: 'c2' },
      ],
    });

    await expect(page.locator('[data-blok-column]')).toHaveCount(2);

    // Backspace at start of the SECOND block in the left column → merges into the first.
    await backspaceAtStartOf(page, 'l2');

    const saved = await saveBlok(page);

    // l2 merged into l1; l1 survives, still parented to the same column.
    expect(findBlock(saved, 'l2')).toBeUndefined();
    expect(findBlock(saved, 'l1')?.parent).toBe('c1');
    expect(textOf(saved, 'l1')).toBe('FirstSecond');
    expect(childrenOf(saved, 'c1')).toEqual(['l1']);

    // The column_list still has two columns; the right column is untouched.
    expect(findBlock(saved, 'cl1')?.type).toBe('column_list');
    expect(saved.blocks.filter(b => b.type === 'column').map(b => b.id)).toEqual(['c1', 'c2']);
    expect(findBlock(saved, 'right1')?.parent).toBe('c2');

    // The merged survivor did not collapse to root.
    expect(findBlock(saved, 'l1')?.parent).not.toBeUndefined();
  });

  test('Backspace at start of the first block in the RIGHT column does not pull a block out of the left column', async ({ page }) => {
    await createBlok(page, twoColumnFixture());

    await expect(page.locator('[data-blok-column]')).toHaveCount(2);

    // Caret at offset 0 of the first block in the right column. Its flat-array
    // predecessor is the left column's last block — a different container.
    await backspaceAtStartOf(page, 'right1');

    const saved = await saveBlok(page);

    // Neither column's block moved, merged, or lost text.
    expect(findBlock(saved, 'left1')?.parent).toBe('c1');
    expect(textOf(saved, 'left1')).toBe('Left only block');
    expect(findBlock(saved, 'right1')?.parent).toBe('c2');
    expect(textOf(saved, 'right1')).toBe('Right block');

    // Both columns survive, in order, each keeping its single child.
    expect(saved.blocks.filter(b => b.type === 'column').map(b => b.id)).toEqual(['c1', 'c2']);
    expect(childrenOf(saved, 'c1')).toEqual(['left1']);
    expect(childrenOf(saved, 'c2')).toEqual(['right1']);

    // No orphaned blocks (every parent reference still resolves).
    const allIds = new Set(saved.blocks.map(b => b.id));
    const orphans = saved.blocks.filter(b => b.parent !== undefined && !allIds.has(b.parent));
    expect(orphans).toEqual([]);
  });

  test('Backspace on the sole emptied paragraph of a column does not promote the other column to root', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['left1'] },
        { id: 'left1', type: 'paragraph', data: { text: '' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['right1'] },
        { id: 'right1', type: 'paragraph', data: { text: 'Right block' }, parent: 'c2' },
      ],
    });

    await expect(page.locator('[data-blok-column]')).toHaveCount(2);

    // Backspace on the only (empty) block of the left column.
    await backspaceAtStartOf(page, 'left1');

    const saved = await saveBlok(page);

    // Whatever the documented empty-column behavior is, the right column's content
    // must NOT be promoted to root, and must NOT change parent or text.
    expect(findBlock(saved, 'right1')?.parent).toBe('c2');
    expect(textOf(saved, 'right1')).toBe('Right block');

    // No block escaped to root.
    const rootParagraphs = saved.blocks.filter(b => b.type === 'paragraph' && b.parent === undefined);
    expect(rootParagraphs).toHaveLength(0);

    // No orphaned blocks: every parent reference still resolves to a present block.
    const allIds = new Set(saved.blocks.map(b => b.id));
    const orphans = saved.blocks.filter(b => b.parent !== undefined && !allIds.has(b.parent));
    expect(orphans).toEqual([]);

    // The layout stays well-formed: either the column_list survives and still owns
    // the right column, OR it collapsed (single-column auto-unwrap) leaving neither
    // a column_list nor a column behind — never a half-built tree. Express both
    // valid shapes as a single boolean so there is no conditional expect.
    const listSurvives =
      childrenOf(saved, 'cl1').includes('c2') && findBlock(saved, 'c2')?.parent === 'cl1';
    const fullyCollapsed =
      !saved.blocks.some(b => b.type === 'column_list') &&
      !saved.blocks.some(b => b.type === 'column');

    expect(listSurvives || fullyCollapsed).toBe(true);
  });
});
