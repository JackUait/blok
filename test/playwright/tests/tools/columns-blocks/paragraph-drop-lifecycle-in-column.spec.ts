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
  editParagraphLikeText,
} from './_helpers';

const BLOK = '[data-blok-interface=blok]';
const SETTINGS_BUTTON = `${BLOK} [data-blok-testid="settings-toggler"]`;

/**
 * Drag the block whose drag handle is `sourceHandle` onto the left/right edge of
 * `targetBlock` (its vertical mid-band) to trigger a column (side) drop. Copied
 * verbatim from container-drag-in-column.spec.ts so this spec is standalone.
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
 * LIVE DOM placement, not merely the saved model. Copied verbatim from
 * container-drag-in-column.spec.ts so this spec is standalone.
 */
const domColumnIndexById = async (page: Page, ids: string[]): Promise<Record<string, number>> => {
  return await page.evaluate((blockIds: string[]) => {
    const columnHolders = Array.from(document.querySelectorAll('[data-blok-columns] > [data-blok-element]'));
    const out: Record<string, number> = {};

    for (const id of blockIds) {
      const holder = document.querySelector(`[data-blok-id="${id}"]`);

      if (!(holder instanceof HTMLElement)) {
        out[id] = -2; // not in DOM at all
        continue;
      }

      const ownColumn = holder.closest('[data-blok-column]')?.closest('[data-blok-element]') ?? null;
      out[id] = ownColumn instanceof HTMLElement ? columnHolders.indexOf(ownColumn) : -1;
    }

    return out;
  }, ids);
};

/**
 * Reveal a LEAF block's drag handle: hover the block wrapper so the hover
 * controller surfaces the settings toggler (which doubles as the drag handle),
 * then return it. A paragraph is a leaf, so this is the reveal path (not
 * grabContainerHandle, which is only for container blocks).
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

/**
 * Two plain root paragraphs: a stationary "Target" and the mover whose id is
 * `para1`. No column_list yet — the side-drop must CREATE it. The paragraph
 * `data` shape is exactly `{ text }` (a paragraph is a leaf: no content,
 * no children).
 */
const twoRootParagraphsFixture = (): OutputData => ({
  blocks: [
    { id: 'target', type: 'paragraph', data: { text: 'Target' } },
    { id: 'para1', type: 'paragraph', data: { text: 'Dropped paragraph' } },
  ],
});

/**
 * Drive the canonical DROP: build the two-paragraph fixture, side-drop `para1`
 * onto the RIGHT edge of "Target", and return the saved model once a 2-column
 * column_list exists. Shared by the SAVE / RELOAD / EDIT / REMOVE stages so each
 * starts from a real, live-dragged column layout (not a hand-authored fixture).
 */
const dropParagraphBesideTarget = async (page: Page): Promise<OutputData> => {
  await createBlok(page, twoRootParagraphsFixture());

  await expect(page.locator('[data-blok-column]')).toHaveCount(0);

  const handle = await grabLeafHandle(page, 'para1');
  const target = page.getByTestId('block-wrapper').filter({ hasText: 'Target' }).first();

  await performSideDrop(page, handle, target, 'right');

  await expect(page.locator('[data-blok-column]')).toHaveCount(2);

  return await saveBlok(page);
};

/**
 * The id of the column that `para1` is parented to in a given saved model. Used
 * to locate "para1's column" without assuming a fixed column id (the side-drop
 * mints fresh column_list/column ids at runtime).
 */
const paraColumnId = (saved: OutputData): string | undefined => findBlock(saved, 'para1')?.parent;

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Paragraph drop lifecycle inside a column (live drag)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('DROP: side-dropping a paragraph onto a block right edge wraps both into a 2-column list with the paragraph in the 2nd column (model + live DOM)', async ({ page }) => {
    const saved = await dropParagraphBesideTarget(page);

    // A column_list with exactly two columns was minted by the drop.
    const list = saved.blocks.find((b) => b.type === 'column_list');
    expect(list).toBeDefined();
    const columnIds = saved.blocks
      .filter((b) => b.type === 'column')
      .map((b) => b.id)
      .filter((id): id is string => id !== undefined);
    expect(columnIds).toHaveLength(2);
    expect(childrenOf(saved, list?.id ?? '')).toEqual(columnIds);

    const [firstColumn, secondColumn] = columnIds;

    // MODEL: the dropped paragraph is parented to the SECOND column (target | dropped).
    const para = findBlock(saved, 'para1');
    expect(para?.type).toBe('paragraph');
    expect(para?.parent).toBe(secondColumn);
    expect(childrenOf(saved, secondColumn ?? '')).toEqual(['para1']);

    // The stationary "Target" rode into the FIRST column.
    expect(findBlock(saved, 'target')?.parent).toBe(firstColumn);
    expect(childrenOf(saved, firstColumn ?? '')).toEqual(['target']);

    // A leaf paragraph carries no children of its own.
    expect(para?.content).toBeUndefined();
    expect(childrenOf(saved, 'para1')).toEqual([]);

    // LIVE DOM: both holders sit in distinct columns — target in col 0, para1 in col 1.
    // (Prior breaks left the dropped holder stranded in the row or in the wrong column.)
    const placement = await domColumnIndexById(page, ['target', 'para1']);
    expect(placement['target']).toBe(0);
    expect(placement['para1']).toBe(1);

    // The dropped paragraph's text is still rendered, inside a column.
    const paraInColumn = page.locator('[data-blok-column] [data-blok-id="para1"]');
    await expect(paraInColumn).toHaveCount(1);
    await expect(paraInColumn).toContainText('Dropped paragraph');
  });

  test('SAVE: the dropped paragraph saves with correct column_list -> column -> paragraph nesting', async ({ page }) => {
    const saved = await dropParagraphBesideTarget(page);

    const list = saved.blocks.find((b) => b.type === 'column_list');
    expect(list).toBeDefined();

    const columnId = paraColumnId(saved);
    expect(columnId).toBeDefined();

    // The full parent chain holds: column_list owns the column, the column owns para1.
    expect(findBlock(saved, columnId ?? '')?.type).toBe('column');
    expect(findBlock(saved, columnId ?? '')?.parent).toBe(list?.id);
    expect(findBlock(saved, 'para1')?.parent).toBe(columnId);

    // The paragraph's primary content round-trips through save exactly.
    expect((findBlock(saved, 'para1')?.data as { text?: string }).text).toBe('Dropped paragraph');

    // No orphans: every non-root block points at a parent that still exists.
    const ids = new Set(saved.blocks.map((b) => b.id));
    const orphans = saved.blocks.filter((b) => b.parent !== undefined && b.parent !== null && !ids.has(b.parent));
    expect(orphans).toEqual([]);
  });

  test('RELOAD: after a save -> reload -> save round-trip the paragraph stays in its column (model + live DOM)', async ({ page }) => {
    const before = await dropParagraphBesideTarget(page);
    const beforeColumn = paraColumnId(before);
    expect(beforeColumn).toBeDefined();

    const after = await reloadFromSave(page);

    // MODEL: still a 2-column list, still parented to a real column owned by the list.
    const list = after.blocks.find((b) => b.type === 'column_list');
    expect(list).toBeDefined();
    const columnIds = after.blocks.filter((b) => b.type === 'column').map((b) => b.id);
    expect(columnIds).toHaveLength(2);

    const para = findBlock(after, 'para1');
    expect(para?.parent).toBe(beforeColumn);
    expect(columnIds).toContain(para?.parent);
    expect(findBlock(after, para?.parent ?? '')?.parent).toBe(list?.id);
    expect((para?.data as { text?: string }).text).toBe('Dropped paragraph');

    // LIVE DOM: the rebuilt editor still mounts para1 inside the second column.
    await expect(page.locator('[data-blok-column]')).toHaveCount(2);
    const placement = await domColumnIndexById(page, ['para1']);
    expect(placement['para1']).toBe(1);
  });

  test('EDIT: editing the in-column paragraph persists the new text and keeps it in its column (model + live DOM)', async ({ page }) => {
    const saved = await dropParagraphBesideTarget(page);
    const columnId = paraColumnId(saved);
    expect(columnId).toBeDefined();

    await editParagraphLikeText(page, 'Dropped paragraph', 'Edited in column');

    // The new text is visible in the DOM before we trust the save.
    await expect(page.locator('[data-blok-column] [data-blok-id="para1"]')).toContainText('Edited in column');

    const afterEdit = await saveBlok(page);

    // The edit persisted, and the paragraph did NOT migrate out of its column.
    expect((findBlock(afterEdit, 'para1')?.data as { text?: string }).text).toBe('Edited in column');
    expect(findBlock(afterEdit, 'para1')?.parent).toBe(columnId);
    expect(childrenOf(afterEdit, columnId ?? '')).toEqual(['para1']);

    // LIVE DOM: still in the second column after the edit.
    const placement = await domColumnIndexById(page, ['para1']);
    expect(placement['para1']).toBe(1);
  });

  test('REMOVE: deleting the column\'s sole paragraph leaves both columns standing, the empty one not unwrapped (model + live DOM)', async ({ page }) => {
    const saved = await dropParagraphBesideTarget(page);
    const list = saved.blocks.find((b) => b.type === 'column_list');
    const columnIds = saved.blocks.filter((b) => b.type === 'column').map((b) => b.id);
    expect(columnIds).toHaveLength(2);
    const paraColumn = paraColumnId(saved);
    expect(columnIds).toContain(paraColumn);

    // Delete the paragraph through the public API (index-based, async).
    await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }
      const index = window.blokInstance.blocks.getBlockIndex('para1');

      if (index === undefined) {
        throw new Error('para1 not found');
      }
      await window.blokInstance.blocks.delete(index);
    });

    await page.waitForFunction(
      () => window.blokInstance !== undefined && window.blokInstance.blocks.getBlockIndex('para1') === undefined,
      { timeout: 3000 }
    );

    const afterRemove = await saveBlok(page);

    // The paragraph is gone.
    expect(findBlock(afterRemove, 'para1')).toBeUndefined();

    // Both columns survive — deleting the sole child of ONE column does NOT unwrap
    // the layout (unwrap fires only when a whole COLUMN is removed leaving one).
    expect(findBlock(afterRemove, list?.id ?? '')?.type).toBe('column_list');
    const columnsAfter = afterRemove.blocks.filter((b) => b.type === 'column').map((b) => b.id);
    expect(columnsAfter).toEqual(columnIds);

    // The now-empty column does not re-home the other column's content: it is left
    // childless OR re-seeded with a single EMPTY paragraph still parented to it.
    const emptyChildren = childrenOf(afterRemove, paraColumn ?? '');
    expect(emptyChildren.length).toBeLessThanOrEqual(1);

    const seed = emptyChildren.length === 1 ? findBlock(afterRemove, emptyChildren[0]) : undefined;
    const wellFormed =
      emptyChildren.length === 0 ||
      (seed?.type === 'paragraph' &&
        ((seed?.data as { text?: string }).text ?? '') === '' &&
        seed?.parent === paraColumn);
    expect(wellFormed).toBe(true);

    // The sibling column keeps "Target", untouched.
    const otherColumn = columnIds.find((id) => id !== paraColumn);
    expect(childrenOf(afterRemove, otherColumn ?? '')).toEqual(['target']);
    expect((findBlock(afterRemove, 'target')?.data as { text?: string }).text).toBe('Target');

    // No orphans after the delete.
    const ids = new Set(afterRemove.blocks.map((b) => b.id));
    const orphans = afterRemove.blocks.filter((b) => b.parent !== undefined && b.parent !== null && !ids.has(b.parent));
    expect(orphans).toEqual([]);

    // LIVE DOM: still two columns mounted; the deleted paragraph holder is gone.
    await expect(page.locator('[data-blok-column]')).toHaveCount(2);
    const placement = await domColumnIndexById(page, ['para1', 'target']);
    expect(placement['para1']).toBe(-2);
    expect(placement['target']).toBeGreaterThanOrEqual(0);
  });
});
