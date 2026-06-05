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

interface ImageData {
  url?: string;
  caption?: string;
  alt?: string;
  width?: number;
  alignment?: string;
}

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
 * LIVE DOM placement, not merely the saved model. -1 = at root, -2 = not in DOM.
 * Copied verbatim from container-drag-in-column.spec.ts.
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
 * Reveal a LEAF block's drag handle: hover its block wrapper (by data-blok-id) so
 * the hover controller surfaces the settings toggler for THAT block, then return
 * the single visible toggler. The image url is a real loadable host so the <img>
 * actually renders rather than sitting in the empty-upload state.
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
 * Two root blocks: a plain target paragraph and a standalone image block. The
 * image url is the same loadable host the passing image-in-column tests use so
 * the block reaches the "rendered" state. Data shape copied from
 * image-in-column.spec.ts.
 */
const dropFixture = (): OutputData => ({
  blocks: [
    { id: 'target', type: 'paragraph', data: { text: 'Target' } },
    {
      id: 'image1',
      type: 'image',
      data: {
        url: 'https://placehold.co/600x400.png',
        caption: 'Blok logotype',
        alt: 'Blok logotype',
        width: 40,
        alignment: 'center',
      },
    },
  ],
});

/** Side-drop the root image onto the RIGHT edge of "Target" -> [target | image]. */
const dropImageBesideTarget = async (page: Page): Promise<void> => {
  await expect(page.locator('[data-blok-column]')).toHaveCount(0);

  const handle = await grabLeafHandle(page, 'image1');
  const target = page.getByTestId('block-wrapper').filter({ hasText: 'Target' }).first();

  await performSideDrop(page, handle, target, 'right');

  await expect(page.locator('[data-blok-column]')).toHaveCount(2);
};

/** Resolve the id of the column the image is parented to in the given save. */
const imageColumnId = (saved: OutputData): string | undefined => findBlock(saved, 'image1')?.parent;

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Image block: full drag-drop lifecycle inside a column', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(TEST_PAGE_URL);
  });

  test('DROP: side-dropping a root image beside a block wraps both into columns with the image in the 2nd column (model + live DOM)', async ({ page }) => {
    await createBlok(page, dropFixture());

    await dropImageBesideTarget(page);

    // A column_list with exactly two columns now exists.
    await expect(page.getByTestId('column-list')).toBeVisible();

    const saved = await saveBlok(page);

    const list = saved.blocks.find((b) => b.type === 'column_list');
    expect(list).toBeDefined();

    const columnIds = saved.blocks.filter((b) => b.type === 'column').map((b) => b.id);
    expect(columnIds).toHaveLength(2);

    // MODEL: target is in the FIRST column, image is in the SECOND column.
    const targetColumn = findBlock(saved, 'target')?.parent;
    const imageColumn = imageColumnId(saved);
    expect(columnIds).toContain(targetColumn);
    expect(columnIds).toContain(imageColumn);
    expect(targetColumn).toBe(columnIds[0]);
    expect(imageColumn).toBe(columnIds[1]);
    expect(childrenOf(saved, imageColumn as string)).toEqual(['image1']);

    // LIVE DOM: image holder sits inside the 2nd column (index 1), target in 1st.
    const placement = await domColumnIndexById(page, ['target', 'image1']);
    expect(placement['target']).toBe(0);
    expect(placement['image1']).toBe(1);
  });

  test('SAVE: the saved model nests column_list -> 2nd column -> image with intact image data', async ({ page }) => {
    await createBlok(page, dropFixture());

    await dropImageBesideTarget(page);

    const saved = await saveBlok(page);

    const columnIds = saved.blocks.filter((b) => b.type === 'column').map((b) => b.id);
    const list = saved.blocks.find((b) => b.type === 'column_list');

    // column_list owns exactly the two columns, in order.
    expect(childrenOf(saved, list?.id as string)).toEqual(columnIds);

    // The image is the sole child of the second column.
    const imageColumn = imageColumnId(saved);
    expect(imageColumn).toBe(columnIds[1]);
    expect(childrenOf(saved, imageColumn as string)).toEqual(['image1']);

    // The image's primary data survived the wrap.
    const data = findBlock(saved, 'image1')?.data as ImageData;
    expect(data.url).toBe('https://placehold.co/600x400.png');
    expect(data.caption).toBe('Blok logotype');
    expect(data.alt).toBe('Blok logotype');
    expect(data.width).toBe(40);
    expect(data.alignment).toBe('center');
  });

  test('RELOAD: a save -> reload -> save round-trip keeps the image inside its column (model + live DOM)', async ({ page }) => {
    await createBlok(page, dropFixture());

    await dropImageBesideTarget(page);

    const before = await saveBlok(page);
    const beforeColumn = imageColumnId(before);

    const after = await reloadFromSave(page);

    // MODEL: image still parented to the same column, still its sole child.
    const afterColumn = imageColumnId(after);
    expect(afterColumn).toBe(beforeColumn);
    expect(after.blocks.filter((b) => b.type === 'column')).toHaveLength(2);
    expect(childrenOf(after, afterColumn as string)).toEqual(['image1']);

    // The image data round-trips unchanged.
    const data = findBlock(after, 'image1')?.data as ImageData;
    expect(data.url).toBe('https://placehold.co/600x400.png');
    expect(data.caption).toBe('Blok logotype');

    // LIVE DOM: after the rebuild the image holder is still inside the 2nd column.
    await expect(page.locator('[data-blok-column]')).toHaveCount(2);
    const placement = await domColumnIndexById(page, ['target', 'image1']);
    expect(placement['target']).toBe(0);
    expect(placement['image1']).toBe(1);
  });

  test('EDIT: editing the image caption after the drop persists and the image stays in its column (model + live DOM)', async ({ page }) => {
    await createBlok(page, dropFixture());

    await dropImageBesideTarget(page);

    const beforeEdit = await saveBlok(page);
    const imageColumn = imageColumnId(beforeEdit);

    // The image's editable surface is its caption (a contenteditable). Commit
    // happens on blur, so type then blur by clicking the target paragraph.
    const caption = page
      .locator('[data-blok-id="image1"]')
      .locator('[contenteditable="true"]')
      .first();

    await caption.click();

    const isMac = process.platform === 'darwin';
    const selectAll = isMac ? 'Meta+A' : 'Control+A';

    await page.keyboard.press(selectAll);
    await page.keyboard.type('Edited caption after drop');

    // Blur the caption to flush the change into block data.
    await page.getByText('Target').click();

    const saved = await saveBlok(page);
    const data = findBlock(saved, 'image1')?.data as ImageData;

    // The edit persisted.
    expect(data.caption).toBe('Edited caption after drop');

    // MODEL: the image is still the sole child of the same column.
    expect(imageColumnId(saved)).toBe(imageColumn);
    expect(childrenOf(saved, imageColumn as string)).toEqual(['image1']);

    // LIVE DOM: still mounted in the 2nd column.
    const placement = await domColumnIndexById(page, ['image1']);
    expect(placement['image1']).toBe(1);
  });

  test('REMOVE: deleting the image collapses the emptied column and unwraps the layout', async ({ page }) => {
    await createBlok(page, dropFixture());

    await dropImageBesideTarget(page);

    // Delete the image by its flat index through the public blocks API.
    await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }
      const index = window.blokInstance.blocks.getBlockIndex('image1');
      await window.blokInstance.blocks.delete(index);
    });

    // Deleting the sole child empties its column, which is removed; the list drops
    // to one column and unwraps. The unwrap is fire-and-forget async.
    await expect
      .poll(async () => (await saveBlok(page)).blocks.filter((b) => b.type === 'column_list').length, { timeout: 3000 })
      .toBe(0);

    const saved = await saveBlok(page);

    expect(findBlock(saved, 'image1')).toBeUndefined();
    expect(saved.blocks.filter((b) => b.type === 'column_list')).toHaveLength(0);
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(0);

    // The pre-existing target paragraph is promoted to ROOT, content intact.
    expect(findBlock(saved, 'target')?.parent ?? null).toBeNull();
    expect((findBlock(saved, 'target')?.data as { text?: string }).text).toBe('Target');

    const allIds = new Set(saved.blocks.map((b) => b.id));
    const orphans = saved.blocks.filter((b) => b.parent !== undefined && b.parent !== null && !allIds.has(b.parent));
    expect(orphans).toEqual([]);

    // LIVE DOM: no columns remain.
    await expect(page.locator('[data-blok-column]')).toHaveCount(0);
  });
});
