import type { Page } from '@playwright/test';
import { createBlok, saveBlok, findBlock, childrenOf, editParagraphLikeText, ensureBlokBundleBuilt} from './_helpers';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';

/**
 * A nested column_list living INSIDE a column of an outer column_list. When the
 * nested list collapses or is deleted, its survivors must be promoted to the
 * ENCLOSING outer column — NOT to the document root.
 *
 * These are TDD probes for the documented nested-columns bug:
 * unwrapColumnListIfCollapsed promotes children with setBlockParent(child, null)
 * (to ROOT, not to the parent column). The index-based delete then shifts onto
 * the wrong blocks, flinging rogue column blocks to root and corrupting the
 * outer column_list. Assertions below encode the CORRECT behavior, so a failing
 * assertion that surfaces the bug is the intended outcome.
 *
 * Layout under test (outer list, left column holds a nested list):
 *
 *   outer (column_list)
 *   ├── oc1 (column)                      <- ENCLOSING column
 *   │   └── ncl (column_list)             <- NESTED list
 *   │       ├── nc1 (column) -> np1
 *   │       └── nc2 (column) -> np2
 *   └── oc2 (column) -> op2
 */

/**
 * Delete a block by id through the public API. `delete` is index-based, so the
 * id is resolved to its current flat index first (the columns.spec.ts pattern).
 */
const deleteBlockById = async (page: Page, blockId: string): Promise<void> => {
  await page.evaluate(async (id) => {
    if (!window.blokInstance) {
      throw new Error('Blok instance not found');
    }
    const index = window.blokInstance.blocks.getBlockIndex(id);

    if (index === undefined) {
      throw new Error(`block ${id} not found`);
    }
    await window.blokInstance.blocks.delete(index);
  }, blockId);
};

/**
 * Wait until a block id is gone from the flat block array. The nested-list
 * unwrap is fire-and-forget async inside removed(), so deletions that trigger an
 * unwrap settle a tick later.
 */
const waitForBlockGone = async (page: Page, blockId: string): Promise<void> => {
  await page.waitForFunction(
    (id) => window.blokInstance !== undefined && window.blokInstance.blocks.getBlockIndex(id) === undefined,
    blockId,
    { timeout: 3000 }
  );
};

/**
 * Build the outer/nested two-level column layout. The nested column_list sits as
 * the sole child of the outer list's left column (oc1); the outer list's right
 * column (oc2) holds a plain paragraph.
 */
const createNestedLayout = async (page: Page): Promise<void> => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await createBlok(page, {
    blocks: [
      { id: 'outer', type: 'column_list', data: {}, content: ['oc1', 'oc2'] },
      { id: 'oc1', type: 'column', data: {}, parent: 'outer', content: ['ncl'] },
      { id: 'ncl', type: 'column_list', data: {}, parent: 'oc1', content: ['nc1', 'nc2'] },
      { id: 'nc1', type: 'column', data: {}, parent: 'ncl', content: ['np1'] },
      { id: 'np1', type: 'paragraph', data: { text: 'Nested left' }, parent: 'nc1' },
      { id: 'nc2', type: 'column', data: {}, parent: 'ncl', content: ['np2'] },
      { id: 'np2', type: 'paragraph', data: { text: 'Nested right' }, parent: 'nc2' },
      { id: 'oc2', type: 'column', data: {}, parent: 'outer', content: ['op2'] },
      { id: 'op2', type: 'paragraph', data: { text: 'Outer right body' }, parent: 'oc2' },
    ],
  });
};

/**
 * Assert that every block that declares a parent resolves to a live parent block
 * — i.e. there are no orphans pointing at a deleted/missing parent id.
 */
const expectNoOrphans = (saved: Awaited<ReturnType<typeof saveBlok>>): void => {
  const ids = new Set(saved.blocks.map(b => b.id));
  for (const block of saved.blocks) {
    if (block.parent !== undefined && block.parent !== null) {
      expect(ids.has(block.parent)).toBe(true);
    }
  }
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Nested column_list removal inside a column', () => {
  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('deleting a nested column_list empties its enclosing column, collapsing the whole layout', async ({ page }) => {
    await createNestedLayout(page);

    // Two outer columns; inside the left one, two nested columns → 4 total.
    await expect(page.locator('[data-blok-column]')).toHaveCount(4);

    // Delete the entire nested column_list — the SOLE child of the outer-left
    // column oc1. That empties oc1, so oc1 is removed; the outer list then has a
    // single column and unwraps, promoting the outer-right paragraph to root.
    // The whole nested + outer scaffold dissolves.
    await deleteBlockById(page, 'ncl');
    await waitForBlockGone(page, 'outer');

    const saved = await saveBlok(page);

    // No column_list or column survives anywhere.
    expect(saved.blocks.filter(b => b.type === 'column_list')).toHaveLength(0);
    expect(saved.blocks.filter(b => b.type === 'column')).toHaveLength(0);

    // The outer-right paragraph is promoted to ROOT, content intact.
    expect(findBlock(saved, 'op2')?.parent ?? null).toBeNull();
    expect((findBlock(saved, 'op2')?.data as { text?: string }).text).toBe('Outer right body');

    // The nested subtree and every wrapper are fully gone — nothing re-homed.
    for (const id of ['ncl', 'nc1', 'nc2', 'np1', 'np2', 'oc1', 'oc2', 'outer']) {
      expect(findBlock(saved, id)).toBeUndefined();
    }

    // No orphans: every parented block resolves to a live parent.
    expectNoOrphans(saved);
  });

  test('removing one inner column of the nested list promotes the survivor into the enclosing outer column, not root', async ({ page }) => {
    await createNestedLayout(page);

    await expect(page.locator('[data-blok-column]')).toHaveCount(4);

    // Delete one inner column of the NESTED list. The nested list now has a
    // single column → it must collapse, promoting its surviving paragraph into
    // the ENCLOSING outer column (oc1), staying visually inside that column.
    await deleteBlockById(page, 'nc2');
    await waitForBlockGone(page, 'ncl');

    const saved = await saveBlok(page);

    // The outer list and both its columns still own the layout.
    expect(findBlock(saved, 'outer')).toBeDefined();
    expect(childrenOf(saved, 'outer')).toEqual(['oc1', 'oc2']);

    // The nested list and its columns dissolved.
    expect(findBlock(saved, 'ncl')).toBeUndefined();
    expect(findBlock(saved, 'nc1')).toBeUndefined();
    expect(findBlock(saved, 'nc2')).toBeUndefined();

    // The surviving nested paragraph is re-parented to the ENCLOSING outer
    // column (oc1) — NOT promoted to root.
    const survivor = findBlock(saved, 'np1');
    expect(survivor).toBeDefined();
    expect(survivor?.parent).toBe('oc1');
    expect((survivor?.data as { text?: string }).text).toBe('Nested left');
    expect(childrenOf(saved, 'oc1')).toEqual(['np1']);

    // The doomed inner column's content is gone, not re-homed.
    expect(findBlock(saved, 'np2')).toBeUndefined();

    // No rogue column at root; no orphans.
    const rootColumns = saved.blocks.filter(
      b => b.type === 'column' && (b.parent === undefined || b.parent === null)
    );
    expect(rootColumns).toHaveLength(0);
    expectNoOrphans(saved);
  });

  test('editing inside the nested list then deleting it leaves the outer layout and siblings consistent', async ({ page }) => {
    await createNestedLayout(page);

    await expect(page.locator('[data-blok-column]')).toHaveCount(4);

    // Edit a nested leaf (re-render path), then delete the whole nested list.
    await editParagraphLikeText(page, 'Nested left', 'Edited nested leaf');
    await deleteBlockById(page, 'ncl');
    await waitForBlockGone(page, 'outer');

    const saved = await saveBlok(page);

    // Deleting the nested list empties oc1 → oc1 removed → outer collapses and
    // unwraps: no column_list or column survives, the edit did not corrupt it.
    expect(saved.blocks.filter(b => b.type === 'column_list')).toHaveLength(0);
    expect(saved.blocks.filter(b => b.type === 'column')).toHaveLength(0);

    // The outer-right paragraph is promoted to root, content intact.
    expect(findBlock(saved, 'op2')?.parent ?? null).toBeNull();
    expect((findBlock(saved, 'op2')?.data as { text?: string }).text).toBe('Outer right body');

    // No ghost of the (edited) nested subtree lingers anywhere.
    for (const id of ['ncl', 'nc1', 'nc2', 'np1', 'np2', 'oc1', 'oc2', 'outer']) {
      expect(findBlock(saved, id)).toBeUndefined();
    }
    const editedGhost = saved.blocks.find(
      b => (b.data as { text?: string } | undefined)?.text === 'Edited nested leaf'
    );
    expect(editedGhost).toBeUndefined();

    // No orphans after the edit+delete combo.
    expectNoOrphans(saved);
  });
});
