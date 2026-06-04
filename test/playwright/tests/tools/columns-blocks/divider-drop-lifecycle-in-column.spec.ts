import { expect, test } from '@playwright/test';
import type { Page, Locator } from '@playwright/test';
import type { OutputData } from '@/types';
import {
  ensureBlokBundleBuilt,
  TEST_PAGE_URL,
  createBlok,
  saveBlok,
  reloadFromSave,
  findBlock,
  childrenOf,
} from './_helpers';

const BLOK = '[data-blok-interface=blok]';
const SETTINGS_BUTTON = `${BLOK} [data-blok-testid="settings-toggler"]`;

/**
 * Drag the block whose drag handle is `sourceHandle` onto the left/right edge of
 * `targetBlock` (its vertical mid-band) to trigger a column (side) drop. Mirrors
 * performSideDrop in container-drag-in-column.spec.ts — copied locally so this
 * spec is standalone.
 */
const performSideDrop = async (
  page: Page,
  sourceHandle: Locator,
  targetBlock: Locator,
  side: 'left' | 'right'
): Promise<void> => {
  const sourceBox = await sourceHandle.boundingBox();
  const targetBox = await targetBlock.locator('[data-blok-element-content]').first().boundingBox();

  if (!sourceBox || !targetBox) {
    throw new Error('missing bounding box for side drop');
  }

  const sourceX = sourceBox.x + sourceBox.width / 2;
  const sourceY = sourceBox.y + sourceBox.height / 2;
  const targetX = side === 'right' ? targetBox.x + targetBox.width - 4 : targetBox.x + 4;
  const targetY = targetBox.y + targetBox.height / 2;

  await page.mouse.move(sourceX, sourceY);
  await page.mouse.down();
  await page.mouse.move(targetX, targetY, { steps: 15 });

  await page.waitForFunction(
    () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') === 'true',
    { timeout: 2000 }
  );

  await page.mouse.up();

  await page.waitForFunction(
    () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') !== 'true',
    { timeout: 2000 }
  );
};

/**
 * For each given block id, report whether its holder is mounted inside any
 * [data-blok-column], and if so, which column index (document order). Proves the
 * LIVE DOM placement, not merely the saved model. -1 = at root (no column),
 * -2 = gone from the DOM.
 */
const domColumnIndexById = async (page: Page, ids: string[]): Promise<Record<string, number>> => {
  return await page.evaluate((blockIds: string[]) => {
    const columnHolders = Array.from(document.querySelectorAll('[data-blok-columns] > [data-blok-element]'));
    const out: Record<string, number> = {};

    for (const id of blockIds) {
      const holder = document.querySelector(`[data-blok-id="${id}"]`);

      if (!(holder instanceof HTMLElement)) {
        out[id] = -2;
        continue;
      }

      const ownColumn = holder.closest('[data-blok-column]')?.closest('[data-blok-element]') ?? null;
      out[id] = ownColumn instanceof HTMLElement ? columnHolders.indexOf(ownColumn) : -1;
    }

    return out;
  }, ids);
};

/**
 * Reveal a LEAF block's drag handle: hover the block wrapper (by data-blok-id) and
 * read the single visible settings-toggler.
 */
const grabLeafHandle = async (page: Page, blockId: string): Promise<Locator> => {
  const holder = page.locator(`[data-blok-id="${blockId}"]`).first();
  const box = await holder.boundingBox();

  if (!box) {
    throw new Error(`missing bounding box for leaf ${blockId}`);
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  const handle = page.locator(SETTINGS_BUTTON);
  await expect(handle).toBeVisible();

  return handle;
};

// Two-root fixture: a plain target paragraph and a root divider to side-drop.
const twoRootFixture: OutputData = {
  blocks: [
    { id: 'target', type: 'paragraph', data: { text: 'Target' } },
    { id: 'divider1', type: 'divider', data: {} },
  ],
};

/**
 * From a fresh editor, side-drop the root divider onto the RIGHT edge of the
 * target paragraph, wrapping both into a new 2-column column_list. Returns once
 * the layout has settled. The divider ends up in the SECOND column (index 1).
 */
const dropDividerBesideTarget = async (page: Page): Promise<void> => {
  await createBlok(page, twoRootFixture);

  await expect(page.locator('[data-blok-column]')).toHaveCount(0);

  const handle = await grabLeafHandle(page, 'divider1');
  const target = page.getByTestId('block-wrapper').filter({ hasText: 'Target' }).first();
  await performSideDrop(page, handle, target, 'right');

  await expect(page.locator('[data-blok-column]')).toHaveCount(2);
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Divider drop lifecycle inside a column', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(TEST_PAGE_URL);
  });

  test('DROP: side-dropping a root divider beside a block wraps both into columns with the divider in the second column', async ({ page }) => {
    await dropDividerBesideTarget(page);

    await expect(page.getByTestId('column-list')).toBeVisible();

    const saved = await saveBlok(page);

    // A column_list with exactly two columns now exists.
    const list = saved.blocks.find((b) => b.type === 'column_list');
    expect(list).toBeDefined();
    const columnIds = saved.blocks.filter((b) => b.type === 'column').map((b) => b.id);
    expect(columnIds).toHaveLength(2);

    // MODEL: the divider is parented to the SECOND column; the target sits in the first.
    const listChildren = childrenOf(saved, list?.id ?? '');
    expect(listChildren).toHaveLength(2);
    const [firstCol, secondCol] = listChildren;
    expect(childrenOf(saved, firstCol)).toEqual(['target']);
    expect(childrenOf(saved, secondCol)).toEqual(['divider1']);
    expect(findBlock(saved, 'divider1')?.parent).toBe(secondCol);
    expect(findBlock(saved, 'divider1')?.type).toBe('divider');

    // LIVE DOM: the divider holder is mounted inside the second column (index 1),
    // and its <hr> rule renders there — not stranded in the columns row or column 0.
    const placement = await domColumnIndexById(page, ['target', 'divider1']);
    expect(placement['target']).toBe(0);
    expect(placement['divider1']).toBe(1);

    const columns = page.locator('[data-blok-column]');
    await expect(columns.nth(0).locator('[data-blok-divider]')).toHaveCount(0);
    await expect(columns.nth(1).locator('[data-blok-divider]')).toHaveCount(1);
    await expect(columns.nth(1).locator('[data-blok-divider]')).toBeVisible();
  });

  test('SAVE: the saved model nests column_list -> column -> divider correctly', async ({ page }) => {
    await dropDividerBesideTarget(page);

    const saved = await saveBlok(page);

    const list = saved.blocks.find((b) => b.type === 'column_list');
    expect(list).toBeDefined();

    // Two columns, both parented to the column_list, in order.
    const listChildren = childrenOf(saved, list?.id ?? '');
    expect(listChildren).toHaveLength(2);
    const [firstCol, secondCol] = listChildren;
    expect(findBlock(saved, firstCol)?.type).toBe('column');
    expect(findBlock(saved, secondCol)?.type).toBe('column');
    expect(findBlock(saved, firstCol)?.parent).toBe(list?.id);
    expect(findBlock(saved, secondCol)?.parent).toBe(list?.id);

    // The divider is the sole child of the second column and serializes data: {}.
    expect(childrenOf(saved, secondCol)).toEqual(['divider1']);
    expect(findBlock(saved, 'divider1')?.parent).toBe(secondCol);
    expect(findBlock(saved, 'divider1')?.data).toEqual({});

    // No orphans: every block's parent (if any) exists in the saved model.
    const liveIds = new Set(saved.blocks.map((b) => b.id));
    const orphans = saved.blocks.filter((b) => b.parent !== undefined && !liveIds.has(b.parent));
    expect(orphans).toEqual([]);
  });

  test('RELOAD: the divider stays inside its column in model and live DOM after a round-trip', async ({ page }) => {
    await dropDividerBesideTarget(page);

    const before = await saveBlok(page);
    const beforeList = before.blocks.find((b) => b.type === 'column_list');
    const beforeSecondCol = childrenOf(before, beforeList?.id ?? '')[1];

    const after = await reloadFromSave(page);

    // MODEL: still a column_list with two columns; divider still in the 2nd column.
    const afterList = after.blocks.find((b) => b.type === 'column_list');
    expect(afterList).toBeDefined();
    expect(after.blocks.filter((b) => b.type === 'column')).toHaveLength(2);

    const afterCols = childrenOf(after, afterList?.id ?? '');
    expect(afterCols).toHaveLength(2);
    const afterSecondCol = afterCols[1];
    expect(findBlock(after, 'divider1')?.parent).toBe(afterSecondCol);
    expect(findBlock(after, 'divider1')?.type).toBe('divider');
    expect(childrenOf(after, afterCols[0])).toEqual(['target']);
    expect(childrenOf(after, afterSecondCol)).toEqual(['divider1']);

    // The column ids are stable across the round-trip (no reseed/rewrap).
    expect(afterSecondCol).toBe(beforeSecondCol);

    // LIVE DOM: divider holder is mounted inside the second column after reload.
    const placement = await domColumnIndexById(page, ['target', 'divider1']);
    expect(placement['target']).toBe(0);
    expect(placement['divider1']).toBe(1);

    const columns = page.locator('[data-blok-column]');
    await expect(columns).toHaveCount(2);
    await expect(columns.nth(1).locator('[data-blok-divider]')).toHaveCount(1);
    await expect(columns.nth(0).locator('[data-blok-divider]')).toHaveCount(0);
  });

  test('EDIT: focusing the divider in its column leaves it intact and in-column, sibling edit persists', async ({ page }) => {
    await dropDividerBesideTarget(page);

    // The divider is a void block with no editable content. "Editing" it means
    // focusing it via its column holder: it must stay intact and in its column.
    const dividerRule = page.locator('[data-blok-column]').nth(1).locator('[data-blok-divider]');
    await dividerRule.click();

    // Edit the sibling target paragraph (the only editable text) and confirm the
    // divider is undisturbed by neighbour edits.
    // .last() = the innermost paragraph wrapper. After the divider is wrapped into
    // columns, the column_list and column wrappers also match hasText 'Target'
    // (a container wrapper's textContent aggregates its descendants), and .first()
    // would grab the outer column_list wrapper — clicking it focuses a container
    // input, not the paragraph contenteditable.
    const targetContent = page
      .getByTestId('block-wrapper')
      .filter({ hasText: 'Target' })
      .last()
      .locator('[data-blok-element-content]')
      .first();
    await targetContent.click();
    const isMac = process.platform === 'darwin';
    await page.keyboard.press(isMac ? 'Meta+A' : 'Control+A');
    await page.keyboard.type('Edited target');

    const saved = await saveBlok(page);

    // The sibling edit persisted.
    expect((findBlock(saved, 'target')?.data as { text?: string }).text).toBe('Edited target');

    // MODEL: the divider is untouched and still in the second column.
    const list = saved.blocks.find((b) => b.type === 'column_list');
    const secondCol = childrenOf(saved, list?.id ?? '')[1];
    expect(findBlock(saved, 'divider1')?.parent).toBe(secondCol);
    expect(findBlock(saved, 'divider1')?.data).toEqual({});
    expect(childrenOf(saved, secondCol)).toEqual(['divider1']);

    // LIVE DOM: still exactly one divider rule, still in the second column.
    const placement = await domColumnIndexById(page, ['divider1']);
    expect(placement['divider1']).toBe(1);
    await expect(page.locator('[data-blok-column]').nth(1).locator('[data-blok-divider]')).toHaveCount(1);
    await expect(page.locator('[data-blok-column]').nth(0).locator('[data-blok-divider]')).toHaveCount(0);
  });

  test('REMOVE: deleting the divider leaves its column childless without unwrapping the layout', async ({ page }) => {
    await dropDividerBesideTarget(page);

    const beforeDelete = await saveBlok(page);
    const list = beforeDelete.blocks.find((b) => b.type === 'column_list');
    const listId = list?.id ?? '';
    const [firstCol, secondCol] = childrenOf(beforeDelete, listId);

    await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }
      const index = window.blokInstance.blocks.getBlockIndex('divider1');
      await window.blokInstance.blocks.delete(index);
    });

    await page.waitForFunction(
      () => window.blokInstance !== undefined &&
        window.blokInstance.blocks.getBlockIndex('divider1') === undefined
    );

    const saved = await saveBlok(page);

    // The divider is gone entirely.
    expect(findBlock(saved, 'divider1')).toBeUndefined();
    expect(saved.blocks.some((b) => b.type === 'divider')).toBe(false);

    // The column_list survives with BOTH columns — deleting a column's sole child
    // does NOT unwrap the layout (unwrap only fires when a whole COLUMN is removed
    // leaving one). The columns keep their identity.
    const savedList = findBlock(saved, listId);
    expect(savedList?.type).toBe('column_list');
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(2);
    expect(childrenOf(saved, listId)).toEqual([firstCol, secondCol]);
    expect(findBlock(saved, firstCol)?.parent).toBe(listId);
    expect(findBlock(saved, secondCol)?.parent).toBe(listId);

    // The target paragraph survives in the first column.
    expect(childrenOf(saved, firstCol)).toEqual(['target']);
    expect((findBlock(saved, 'target')?.data as { text?: string }).text).toBe('Target');

    // The emptied second column does not re-seed or vanish: at most one child
    // remains, and every survivor must be an empty paragraph (no reseed of content).
    const secondColChildren = childrenOf(saved, secondCol);
    expect(secondColChildren.length).toBeLessThanOrEqual(1);
    const secondColSurvivors = secondColChildren.map((childId) => {
      const seeded = findBlock(saved, childId);

      return { type: seeded?.type, text: (seeded?.data as { text?: string }).text ?? '' };
    });
    const expectedSurvivors = secondColChildren.map(() => ({ type: 'paragraph', text: '' }));
    expect(secondColSurvivors).toEqual(expectedSurvivors);

    // No orphans after the delete.
    const liveIds = new Set(saved.blocks.map((b) => b.id));
    const orphans = saved.blocks.filter((b) => b.parent !== undefined && !liveIds.has(b.parent));
    expect(orphans).toEqual([]);

    // LIVE DOM: two columns remain, no divider rule anywhere, target still visible.
    const columns = page.locator('[data-blok-column]');
    await expect(columns).toHaveCount(2);
    await expect(page.locator('[data-blok-column] [data-blok-divider]')).toHaveCount(0);
    await expect(page.getByText('Target')).toBeVisible();
  });
});
