import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createBlok, saveBlok, findBlock, childrenOf, ensureBlokBundleBuilt, TEST_PAGE_URL } from './_helpers';

/**
 * Live removal of nested blocks until a column empties / the column_list
 * collapses to a single column. Exercises the runtime delete path
 * (api.blocks.delete is index-based + async) and the unwrap heuristic in
 * src/tools/columns-shared.ts -> unwrapColumnListIfCollapsed, plus the empty
 * column re-seed in src/tools/column/index.ts rendered().
 *
 * These are TDD probes: a failing assertion that surfaces a columns bug is the
 * intended outcome — assertions encode the CORRECT behavior from the work item.
 */

/**
 * Delete a block by id through the public API. `delete` is index-based, so the
 * id is resolved to its current flat index first (the existing columns.spec.ts
 * pattern).
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
 * Wait until a block id is gone from the flat block array. The column unwrap is
 * fire-and-forget async inside removed(), so deletions that trigger an unwrap
 * settle a tick later.
 */
const waitForBlockGone = async (page: Page, blockId: string): Promise<void> => {
  await page.waitForFunction(
    (id) => window.blokInstance !== undefined && window.blokInstance.blocks.getBlockIndex(id) === undefined,
    blockId,
    { timeout: 3000 }
  );
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Removing blocks until a column empties / the list collapses', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('removing the last block of one column in a 2-column list leaves a well-formed empty column', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['p1'] },
        { id: 'p1', type: 'paragraph', data: { text: 'Left only child' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['p2'] },
        { id: 'p2', type: 'paragraph', data: { text: 'Right keep me' }, parent: 'c2' },
      ],
    });

    await expect(page.locator('[data-blok-column]')).toHaveCount(2);

    // Delete the sole child of the LEFT column. The list still has TWO columns,
    // so this must NOT trigger an unwrap — the left column simply empties (and
    // may be re-seeded with one empty paragraph).
    await deleteBlockById(page, 'p1');
    await waitForBlockGone(page, 'p1');

    const saved = await saveBlok(page);

    // The column_list and BOTH columns survive — no collapse.
    expect(findBlock(saved, 'cl1')).toBeDefined();
    expect(childrenOf(saved, 'cl1')).toEqual(['c1', 'c2']);

    // Right column is untouched: still holds exactly its original paragraph.
    expect(childrenOf(saved, 'c2')).toEqual(['p2']);
    expect((findBlock(saved, 'p2')?.data as { text?: string }).text).toBe('Right keep me');

    // Left column is well-formed: either childless or a single EMPTY paragraph
    // parented to c1 — never carrying the right column's content (no index-shift
    // orphaning). Express the valid shape as one boolean (no conditional expect).
    const leftChildren = childrenOf(saved, 'c1');
    expect(leftChildren.length).toBeLessThanOrEqual(1);

    const seed = leftChildren.length === 1 ? findBlock(saved, leftChildren[0]) : undefined;
    const leftWellFormed =
      leftChildren.length === 0 ||
      (seed?.type === 'paragraph' &&
        ((seed?.data as { text?: string }).text ?? '') === '' &&
        seed?.parent === 'c1');

    expect(leftWellFormed).toBe(true);

    // No orphans: every non-root block resolves to a live parent.
    const ids = new Set(saved.blocks.map(b => b.id));
    const orphans = saved.blocks.filter(
      b => b.parent !== undefined && b.parent !== null && !ids.has(b.parent)
    );

    expect(orphans).toEqual([]);

    // The deleted paragraph did not re-home anywhere — it is gone.
    expect(findBlock(saved, 'p1')).toBeUndefined();
  });

  test('removing an entire column so only one remains unwraps the survivor to root preserving order', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await createBlok(page, {
      blocks: [
        { id: 'before', type: 'header', data: { text: 'Before columns', level: 2 } },
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['p1'] },
        { id: 'p1', type: 'paragraph', data: { text: 'Survivor body' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['p2'] },
        { id: 'p2', type: 'paragraph', data: { text: 'Doomed column body' }, parent: 'c2' },
        { id: 'after', type: 'paragraph', data: { text: 'After columns' } },
      ],
    });

    await expect(page.locator('[data-blok-column]')).toHaveCount(2);

    // Delete the entire RIGHT column -> only the left column remains, which must
    // auto-unwrap to root via unwrapColumnListIfCollapsed.
    await deleteBlockById(page, 'c2');
    await waitForBlockGone(page, 'cl1');

    const saved = await saveBlok(page);

    // The wrappers dissolve entirely — no column or column_list left behind, and
    // no rogue/orphaned column survives at root from a mis-targeted index delete.
    expect(saved.blocks.filter(b => b.type === 'column_list')).toHaveLength(0);
    expect(saved.blocks.filter(b => b.type === 'column')).toHaveLength(0);

    // The survivor's content is promoted to ROOT (no parent), keeping order.
    const survivor = findBlock(saved, 'p1');
    expect(survivor).toBeDefined();
    expect(survivor?.parent ?? null).toBeNull();

    // Root document order is preserved: header, promoted survivor, trailing para.
    const rootOrder = saved.blocks
      .filter(b => b.parent === undefined || b.parent === null)
      .map(b => b.id);
    expect(rootOrder).toEqual(['before', 'p1', 'after']);

    // The doomed column's content is fully gone — not re-homed anywhere.
    expect(findBlock(saved, 'p2')).toBeUndefined();
    expect(findBlock(saved, 'c2')).toBeUndefined();
  });

  test('removing down to a single column with MULTIPLE survivors promotes all of them in order', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['s1', 's2', 's3'] },
        { id: 's1', type: 'header', data: { text: 'Survivor one', level: 3 }, parent: 'c1' },
        { id: 's2', type: 'paragraph', data: { text: 'Survivor two' }, parent: 'c1' },
        { id: 's3', type: 'paragraph', data: { text: 'Survivor three' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['x1'] },
        { id: 'x1', type: 'paragraph', data: { text: 'Doomed' }, parent: 'c2' },
      ],
    });

    await expect(page.locator('[data-blok-column]')).toHaveCount(2);

    // Delete the single-child right column. The left column (3 children) is the
    // sole survivor and must unwrap: ALL three children promoted to root, in
    // their original order, none dropped or reordered by the delete-index shift.
    await deleteBlockById(page, 'c2');
    await waitForBlockGone(page, 'cl1');

    const saved = await saveBlok(page);

    expect(saved.blocks.filter(b => b.type === 'column_list')).toHaveLength(0);
    expect(saved.blocks.filter(b => b.type === 'column')).toHaveLength(0);

    // All three survivors live at root, in order, none lost.
    const rootOrder = saved.blocks
      .filter(b => b.parent === undefined || b.parent === null)
      .map(b => b.id);
    expect(rootOrder).toEqual(['s1', 's2', 's3']);

    // Their content + types are intact after promotion.
    expect(findBlock(saved, 's1')?.type).toBe('header');
    expect((findBlock(saved, 's1')?.data as { text?: string }).text).toBe('Survivor one');
    expect((findBlock(saved, 's2')?.data as { text?: string }).text).toBe('Survivor two');
    expect((findBlock(saved, 's3')?.data as { text?: string }).text).toBe('Survivor three');

    // Deleting an entire column drops THAT column's own content (the column is
    // pure layout — removing it removes what it held), exactly as the canonical
    // columns.spec "Remove me" case and the sibling block-settings/nested specs
    // require. Only the SURVIVING column's children are promoted (asserted
    // above). x1 belonged to the deleted column, so it is gone — not re-homed at
    // root, which would leak the doomed content and corrupt root order.
    expect(findBlock(saved, 'x1')).toBeUndefined();
    expect(rootOrder).not.toContain('x1');
  });
});
