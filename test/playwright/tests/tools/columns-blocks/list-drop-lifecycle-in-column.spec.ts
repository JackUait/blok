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
 * container-drag-in-column.spec.ts.
 *   -1 => mounted at root (not in any column)
 *   -2 => not in DOM at all
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

interface ListData {
  text?: string;
  style?: string;
  checked?: boolean;
  depth?: number;
}

const listDataOf = (saved: OutputData, id: string): ListData => {
  const block = findBlock(saved, id);

  return (block?.data ?? {}) as ListData;
};

/**
 * A LEAF `list` block: a single unordered depth-0 item. Its content lives entirely
 * in `data` ({ text, style, checked, depth }); it has no parent/content of its own.
 * Data shape copied from list-in-column.spec.ts. A leaf block's drag handle is
 * revealed by hovering its wrapper and reading the visible settings toggler.
 */
const revealLeafHandle = async (page: Page, blockId: string): Promise<Locator> => {
  const wrapper = page.locator(`[data-blok-id="${blockId}"]`).first();

  await wrapper.hover();

  const handle = page.locator(SETTINGS_BUTTON);
  await expect(handle).toBeVisible();

  return handle;
};

/**
 * Builds two root blocks: a plain target paragraph 'Target' and the leaf `list`
 * block we will side-drop. No columns exist yet.
 */
const buildFlatRoots = (): OutputData => ({
  blocks: [
    { id: 'target', type: 'paragraph', data: { text: 'Target' } },
    {
      id: 'list1',
      type: 'list',
      data: {
        text: 'List item text',
        style: 'unordered',
        checked: false,
        depth: 0,
      },
    },
  ],
} as OutputData);

/**
 * Drives the real pointer side-drop of `list1` onto the RIGHT edge of 'Target',
 * wrapping both into a fresh 2-column column_list: [Target | list1]. Returns the
 * column ids in document order so callers can assert membership.
 */
const dropListBesideTarget = async (page: Page): Promise<{ columnIds: string[] }> => {
  await expect(page.locator('[data-blok-column]')).toHaveCount(0);

  const handle = await revealLeafHandle(page, 'list1');
  const target = page.getByTestId('block-wrapper').filter({ hasText: 'Target' }).first();

  await performSideDrop(page, handle, target, 'right');

  await expect(page.locator('[data-blok-column]')).toHaveCount(2);
  await expect(page.getByTestId('column-list')).toBeVisible();

  const saved = await saveBlok(page);
  const columnIds = saved.blocks.filter((b) => b.type === 'column').map((b) => b.id);

  return { columnIds };
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('List block drop lifecycle inside a column', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(TEST_PAGE_URL);
  });

  test('DROP: side-dropping a root list beside a paragraph wraps both into columns with the list in the 2nd column', async ({ page }) => {
    await createBlok(page, buildFlatRoots());

    const { columnIds } = await dropListBesideTarget(page);

    const saved = await saveBlok(page);

    // A column_list with exactly two columns was created.
    const columnList = saved.blocks.find((b) => b.type === 'column_list');
    expect(columnList).toBeDefined();
    expect(columnIds).toHaveLength(2);
    expect(childrenOf(saved, columnList?.id ?? '')).toEqual(columnIds);

    // [target | list1]: the target paragraph is in the first column, the dropped
    // list is in the SECOND column. MODEL parent links.
    expect(findBlock(saved, 'target')?.parent).toBe(columnIds[0]);
    expect(findBlock(saved, 'list1')?.parent).toBe(columnIds[1]);
    expect(childrenOf(saved, columnIds[0])).toEqual(['target']);
    expect(childrenOf(saved, columnIds[1])).toEqual(['list1']);

    // The list is still a single unordered depth-0 list block.
    const data = listDataOf(saved, 'list1');
    expect(data.text).toBe('List item text');
    expect(data.style).toBe('unordered');
    expect(data.depth ?? 0).toBe(0);

    // LIVE DOM: the list holder is physically mounted inside the 2nd column,
    // not stranded in the columns row or in the first column.
    const placement = await domColumnIndexById(page, ['target', 'list1']);
    expect(placement['target']).toBe(0);
    expect(placement['list1']).toBe(1);
  });

  test('SAVE: the saved model nests column_list -> column -> list correctly', async ({ page }) => {
    await createBlok(page, buildFlatRoots());

    const { columnIds } = await dropListBesideTarget(page);

    const saved = await saveBlok(page);

    // Exactly one column_list owning exactly its two columns, in order.
    const columnLists = saved.blocks.filter((b) => b.type === 'column_list');
    expect(columnLists).toHaveLength(1);
    expect(childrenOf(saved, columnLists[0].id ?? '')).toEqual(columnIds);

    // column_list -> column[1] -> list1 chain holds in the model.
    expect(findBlock(saved, columnIds[1])?.parent).toBe(columnLists[0].id);
    expect(findBlock(saved, 'list1')?.parent).toBe(columnIds[1]);
    expect(childrenOf(saved, columnIds[1])).toEqual(['list1']);

    // No orphans: every non-root block points at an existing parent.
    const ids = new Set(saved.blocks.map((b) => b.id));
    const orphanParents = saved.blocks
      .filter((block) => block.parent !== undefined)
      .map((block) => block.parent)
      .filter((parent) => !ids.has(parent));

    expect(orphanParents).toEqual([]);
  });

  test('RELOAD: the list stays in its column after a save -> reload -> save round-trip in model and live DOM', async ({ page }) => {
    await createBlok(page, buildFlatRoots());

    await dropListBesideTarget(page);

    const before = await saveBlok(page);
    const columnIdsBefore = before.blocks.filter((b) => b.type === 'column').map((b) => b.id);
    const listColumnBefore = findBlock(before, 'list1')?.parent;

    expect(columnIdsBefore).toContain(listColumnBefore);

    const after = await reloadFromSave(page);

    // MODEL: column_list with two columns survives, the list is still its column's
    // sole child, after a full round-trip.
    const columnListAfter = after.blocks.find((b) => b.type === 'column_list');
    expect(columnListAfter).toBeDefined();
    const columnIdsAfter = after.blocks.filter((b) => b.type === 'column').map((b) => b.id);
    expect(columnIdsAfter).toHaveLength(2);

    const listColumnAfter = findBlock(after, 'list1')?.parent;
    expect(columnIdsAfter).toContain(listColumnAfter);
    expect(childrenOf(after, listColumnAfter ?? '')).toEqual(['list1']);

    // The list data round-trips intact.
    const data = listDataOf(after, 'list1');
    expect(data.text).toBe('List item text');
    expect(data.style).toBe('unordered');

    // LIVE DOM: after the rebuild the list holder is still inside a column (>= 0),
    // never stranded at root or dropped from the DOM.
    const placement = await domColumnIndexById(page, ['list1']);
    expect(placement['list1']).toBeGreaterThanOrEqual(0);
  });

  test('EDIT: editing the list text in its column persists and the list stays in-column', async ({ page }) => {
    await createBlok(page, buildFlatRoots());

    await dropListBesideTarget(page);

    const before = await saveBlok(page);
    const listColumn = findBlock(before, 'list1')?.parent;

    expect(listColumn).toBeDefined();

    // Edit the list item text in place inside the column.
    await editParagraphLikeText(page, 'List item text', 'Edited in column');

    // Blur out of the editable so the tool syncs DOM into data before save.
    await page.getByText('Target').click();

    const saved = await saveBlok(page);

    // The edit persisted.
    expect(listDataOf(saved, 'list1').text).toBe('Edited in column');

    // The list did NOT escape its column: still parented to the same column and
    // its column's sole child.
    expect(findBlock(saved, 'list1')?.parent).toBe(listColumn);
    expect(childrenOf(saved, listColumn ?? '')).toEqual(['list1']);

    // Still exactly two columns and one list block.
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(2);
    expect(saved.blocks.filter((b) => b.type === 'list')).toHaveLength(1);

    // LIVE DOM: the list holder is still inside its column.
    const placement = await domColumnIndexById(page, ['list1']);
    expect(placement['list1']).toBeGreaterThanOrEqual(0);
  });

  test('REMOVE: deleting the lone list leaves its column childless without reseed or unwrap', async ({ page }) => {
    await createBlok(page, buildFlatRoots());

    await dropListBesideTarget(page);

    const before = await saveBlok(page);
    const listColumn = findBlock(before, 'list1')?.parent;
    const targetColumn = findBlock(before, 'target')?.parent;

    expect(listColumn).toBeDefined();
    expect(targetColumn).toBeDefined();

    // Delete the list block by its flat index (delete is index-based).
    await page.evaluate(async () => {
      if (!window.blokInstance) {
        return;
      }
      const index = window.blokInstance.blocks.getBlockIndex('list1');

      await window.blokInstance.blocks.delete(index);
    });

    await page.waitForFunction(
      () => window.blokInstance !== undefined &&
        window.blokInstance.blocks.getBlockIndex('list1') === undefined
    );

    const saved = await saveBlok(page);

    // The list block is gone.
    expect(findBlock(saved, 'list1')).toBeUndefined();
    expect(saved.blocks.some((b) => b.type === 'list')).toBe(false);

    // Per product rules: deleting a column's sole child leaves the column
    // CHILDLESS — no reseed, no unwrap. Both columns survive.
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(2);
    const columnList = saved.blocks.find((b) => b.type === 'column_list');
    expect(columnList).toBeDefined();
    const survivingColumns = childrenOf(saved, columnList?.id ?? '');
    expect(survivingColumns).toHaveLength(2);
    expect(survivingColumns).toContain(targetColumn);
    expect(survivingColumns).toContain(listColumn);

    // The target column is untouched — still owns its paragraph.
    expect(findBlock(saved, 'target')?.parent).toBe(targetColumn);
    expect(childrenOf(saved, targetColumn ?? '')).toEqual(['target']);

    // The list's former column is now CHILDLESS — no reseeded paragraph, no orphan.
    expect(childrenOf(saved, listColumn ?? '')).toEqual([]);

    // No orphaned children anywhere.
    const ids = new Set(saved.blocks.map((b) => b.id));
    const orphanParents = saved.blocks
      .filter((block) => block.parent !== undefined)
      .map((block) => block.parent)
      .filter((parent) => !ids.has(parent));

    expect(orphanParents).toEqual([]);

    // LIVE DOM: the list holder is gone (-2); the target's holder still lives in a
    // column; the now-childless column is still present in the DOM.
    const placement = await domColumnIndexById(page, ['list1', 'target']);
    expect(placement['list1']).toBe(-2);
    expect(placement['target']).toBeGreaterThanOrEqual(0);

    await expect(page.locator('[data-blok-column]')).toHaveCount(2);
  });
});
