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
 * Reveal a container block's OWN drag handle. Hovering a child of the container
 * would surface the child's handle, so we hover the container holder by its
 * data-blok-id (the top-left of its own holder, away from child content) and
 * then read the single visible settings toggler.
 */
const grabContainerHandle = async (page: Page, containerId: string): Promise<Locator> => {
  const holder = page.locator(`[data-blok-id="${containerId}"]`).first();
  const box = await holder.boundingBox();

  if (!box) {
    throw new Error(`missing bounding box for container ${containerId}`);
  }

  // Hover the container holder's own top edge (above/clear of nested child
  // content) so the hover controller resolves the container itself, not a child.
  await page.mouse.move(box.x + box.width / 2, box.y + 2);

  const handle = page.locator(SETTINGS_BUTTON);
  await expect(handle).toBeVisible();

  return handle;
};

/**
 * For each given block id, report whether its holder is mounted inside any
 * [data-blok-column], and if so, which column index (document order). Proves the
 * LIVE DOM placement, not merely the saved model.
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
 * Drag the block whose handle is `sourceHandle` onto the top/bottom REORDER edge
 * of `targetBlock` — a vertical (stack) drop that lands the source as a sibling
 * inside the target's container. We aim at the bottom edge of the target's
 * content so the source stacks beneath it, inside the same column.
 */
const performStackDrop = async (
  page: Page,
  sourceHandle: Locator,
  targetBlock: Locator
): Promise<void> => {
  const sourceBox = await sourceHandle.boundingBox();
  const targetBox = await targetBlock.locator('[data-blok-element-content]').first().boundingBox();

  if (!sourceBox || !targetBox) {
    throw new Error('missing bounding box for stack drop');
  }

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height - 2,
    { steps: 18 }
  );

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

const TABLE_CHILD_IDS = ['tp-r0c0', 'tp-r0c1', 'tp-r1c0', 'tp-r1c1'];

/**
 * A 2x2 table seeded in column 0, with an anchor paragraph in column 1. The
 * table is a container whose cells reference child paragraphs parented to the
 * table — moving the table across columns must carry the whole subtree.
 *
 * Column 0 also holds a plain "keeper" paragraph alongside the table: moving the
 * table OUT of column 0 must not empty it, since an emptied column now deletes
 * itself (collapsing the layout). The keeper keeps column 0 alive so this test
 * stays focused on the cross-column move landing in the destination column.
 */
const tableAcrossColumnsData = (): OutputData => ({
  blocks: [
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['c1keeper', 'table1'] },
    { id: 'c1keeper', type: 'paragraph', data: { text: 'Left keeper' }, parent: 'c1' },
    {
      id: 'table1',
      type: 'table',
      parent: 'c1',
      data: {
        withHeadings: false,
        withHeadingColumn: false,
        content: [
          [{ blocks: ['tp-r0c0'] }, { blocks: ['tp-r0c1'] }],
          [{ blocks: ['tp-r1c0'] }, { blocks: ['tp-r1c1'] }],
        ],
      },
      content: TABLE_CHILD_IDS,
    },
    { id: 'tp-r0c0', type: 'paragraph', data: { text: 'Cell A1' }, parent: 'table1' },
    { id: 'tp-r0c1', type: 'paragraph', data: { text: 'Cell B1' }, parent: 'table1' },
    { id: 'tp-r1c0', type: 'paragraph', data: { text: 'Cell A2' }, parent: 'table1' },
    { id: 'tp-r1c1', type: 'paragraph', data: { text: 'Cell B2' }, parent: 'table1' },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['anchor'] },
    { id: 'anchor', type: 'paragraph', data: { text: 'Right anchor' }, parent: 'c2' },
  ],
});

/**
 * An image seeded in column 0, with an anchor paragraph in column 1. The image
 * uses a real loadable url so it stays in the "rendered" state.
 *
 * As with the table fixture, column 0 also holds a plain "keeper" paragraph so
 * moving the image OUT of column 0 leaves it non-empty — an emptied column now
 * deletes itself, which would collapse the layout and defeat this test's focus
 * on the cross-column move.
 */
const imageAcrossColumnsData = (): OutputData => ({
  blocks: [
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['c1keeper', 'image1'] },
    { id: 'c1keeper', type: 'paragraph', data: { text: 'Left keeper' }, parent: 'c1' },
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
      parent: 'c1',
    },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['anchor'] },
    { id: 'anchor', type: 'paragraph', data: { text: 'Right anchor' }, parent: 'c2' },
  ],
});

interface ImageData {
  url?: string;
  caption?: string;
  alt?: string;
  width?: number;
  alignment?: string;
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Dragging a block ACROSS columns (column A -> column B)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(TEST_PAGE_URL);
  });

  test('a table dragged from column 0 to column 1 moves its subtree into column 1 (model + live DOM)', async ({ page }) => {
    await createBlok(page, tableAcrossColumnsData());

    await expect(page.locator('[data-blok-column]')).toHaveCount(2);

    // Precondition: the table and every cell paragraph live in column 0.
    const before = await domColumnIndexById(page, ['table1', ...TABLE_CHILD_IDS]);
    expect(before['table1']).toBe(0);
    for (const id of TABLE_CHILD_IDS) {
      expect(before[id]).toBe(0);
    }

    // Drag the table onto the bottom reorder edge of the "Right anchor" block in
    // column 1 so it stacks INTO column 1.
    const handle = await grabContainerHandle(page, 'table1');
    const target = page.getByTestId('block-wrapper').filter({ hasText: 'Right anchor' }).last();
    await performStackDrop(page, handle, target);

    const saved = await saveBlok(page);

    // Layout intact: still exactly two columns.
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(2);

    // MODEL: the table's parent switched to column c2; its cells ride along.
    expect(findBlock(saved, 'table1')?.parent).toBe('c2');
    expect(childrenOf(saved, 'c2')).toContain('table1');
    expect(childrenOf(saved, 'c1')).not.toContain('table1');
    expect(childrenOf(saved, 'table1')).toEqual(TABLE_CHILD_IDS);
    for (const id of TABLE_CHILD_IDS) {
      expect(findBlock(saved, id)?.parent).toBe('table1');
    }

    // The cell-reference grid is preserved.
    const grid = (findBlock(saved, 'table1')?.data as {
      content?: Array<Array<{ blocks: string[] }>>;
    }).content?.map((row) => row.map((cell) => cell.blocks));
    expect(grid).toEqual([
      [['tp-r0c0'], ['tp-r0c1']],
      [['tp-r1c0'], ['tp-r1c1']],
    ]);

    // LIVE DOM: the table and all of its cell paragraphs now sit in column index
    // 1 — NOT stranded in the columns row (-1), NOT gone (-2), NOT still in 0.
    const after = await domColumnIndexById(page, ['table1', ...TABLE_CHILD_IDS]);
    expect(after['table1']).toBe(1);
    for (const id of TABLE_CHILD_IDS) {
      expect(after[id]).toBe(1);
    }

    // Each cell paragraph is still mounted inside the table element.
    const cellsInsideTable = await page.evaluate((ids: string[]) => {
      return ids.every((id) => {
        const cell = document.querySelector(`[data-blok-id="${id}"]`);

        return cell instanceof HTMLElement && cell.closest('[data-blok-tool="table"]') !== null;
      });
    }, TABLE_CHILD_IDS);
    expect(cellsInsideTable).toBe(true);
  });

  test('a table moved to column 1 persists there across save -> reload (model + live DOM)', async ({ page }) => {
    await createBlok(page, tableAcrossColumnsData());

    const handle = await grabContainerHandle(page, 'table1');
    const target = page.getByTestId('block-wrapper').filter({ hasText: 'Right anchor' }).last();
    await performStackDrop(page, handle, target);

    // Sanity: the move landed in column 1 before we reload.
    const moved = await domColumnIndexById(page, ['table1']);
    expect(moved['table1']).toBe(1);

    const after = await reloadFromSave(page);

    // MODEL persists: table still parented to c2, subtree intact.
    expect(findBlock(after, 'table1')?.parent).toBe('c2');
    expect(childrenOf(after, 'c2')).toContain('table1');
    expect(childrenOf(after, 'c1')).not.toContain('table1');
    expect(childrenOf(after, 'table1')).toEqual(TABLE_CHILD_IDS);
    for (const id of TABLE_CHILD_IDS) {
      expect(findBlock(after, id)?.parent).toBe('table1');
    }

    // LIVE DOM persists: table + cells in column index 1 after the round-trip.
    const placement = await domColumnIndexById(page, ['table1', ...TABLE_CHILD_IDS]);
    expect(placement['table1']).toBe(1);
    for (const id of TABLE_CHILD_IDS) {
      expect(placement[id]).toBe(1);
    }
  });

  test('a table moved to column 1 can still be edited and removed there', async ({ page }) => {
    await createBlok(page, tableAcrossColumnsData());

    const handle = await grabContainerHandle(page, 'table1');
    const target = page.getByTestId('block-wrapper').filter({ hasText: 'Right anchor' }).last();
    await performStackDrop(page, handle, target);

    // Edit: change the child paragraph in cell A1 in place.
    const cell = page.locator('[data-blok-id="tp-r0c0"]').locator('[contenteditable="true"]').first();
    await cell.click();
    const isMac = process.platform === 'darwin';
    await page.keyboard.press(isMac ? 'Meta+A' : 'Control+A');
    await page.keyboard.type('Edited A1 in col1');
    // Blur to flush.
    await page.getByText('Right anchor').click();

    const edited = await saveBlok(page);
    expect((findBlock(edited, 'tp-r0c0')?.data as { text?: string }).text).toBe('Edited A1 in col1');
    // The edit did not relocate the table out of column 1.
    expect(findBlock(edited, 'table1')?.parent).toBe('c2');
    const editedDom = await domColumnIndexById(page, ['table1', 'tp-r0c0']);
    expect(editedDom['table1']).toBe(1);
    expect(editedDom['tp-r0c0']).toBe(1);

    // Remove: delete the table by its flat index.
    await page.evaluate(async () => {
      if (!window.blokInstance) {
        return;
      }
      const index = window.blokInstance.blocks.getBlockIndex('table1');
      await window.blokInstance.blocks.delete(index);
    });
    await page.waitForFunction(
      () => window.blokInstance !== undefined && window.blokInstance.blocks.getBlockIndex('table1') === undefined
    );

    const removed = await saveBlok(page);

    // The table and its entire subtree are gone; no orphans dangling.
    expect(findBlock(removed, 'table1')).toBeUndefined();
    for (const id of TABLE_CHILD_IDS) {
      expect(findBlock(removed, id)).toBeUndefined();
    }
    expect(childrenOf(removed, 'table1')).toEqual([]);

    // The column_list survives with both columns; the anchor stays in column 1.
    expect(findBlock(removed, 'cl1')?.type).toBe('column_list');
    expect(removed.blocks.filter((b) => b.type === 'column')).toHaveLength(2);
    expect(findBlock(removed, 'anchor')?.parent).toBe('c2');

    // LIVE DOM: no table element remains; the anchor still sits in column 1.
    await expect(page.locator('[data-blok-tool="table"]')).toHaveCount(0);
    const anchorDom = await domColumnIndexById(page, ['anchor']);
    expect(anchorDom['anchor']).toBe(1);
  });

  test('an image dragged from column 0 to column 1 moves into column 1 (model + live DOM)', async ({ page }) => {
    await createBlok(page, imageAcrossColumnsData());

    await expect(page.locator('[data-blok-column]')).toHaveCount(2);

    // Precondition: the image is in column 0.
    const before = await domColumnIndexById(page, ['image1']);
    expect(before['image1']).toBe(0);

    // Drag the image (a leaf) — reveal its handle by hovering its wrapper and
    // reading the visible settings toggler — onto the bottom reorder edge of the
    // "Right anchor" block in column 1.
    const imageWrapper = page.locator('[data-blok-tool="image"]').first();
    const wrapperBox = await imageWrapper.boundingBox();
    if (!wrapperBox) {
      throw new Error('missing bounding box for image wrapper');
    }
    await page.mouse.move(wrapperBox.x + wrapperBox.width / 2, wrapperBox.y + 4);
    const handle = page.locator(SETTINGS_BUTTON);
    await expect(handle).toBeVisible();

    const target = page.getByTestId('block-wrapper').filter({ hasText: 'Right anchor' }).last();
    await performStackDrop(page, handle, target);

    const saved = await saveBlok(page);

    // Layout intact.
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(2);

    // MODEL: image's parent switched to column c2.
    expect(findBlock(saved, 'image1')?.parent).toBe('c2');
    expect(childrenOf(saved, 'c2')).toContain('image1');
    expect(childrenOf(saved, 'c1')).not.toContain('image1');

    // Image data round-trips unchanged.
    const data = findBlock(saved, 'image1')?.data as ImageData;
    expect(data.url).toBe('https://placehold.co/600x400.png');
    expect(data.caption).toBe('Blok logotype');

    // LIVE DOM: the image holder now lives in column index 1 — not stranded in
    // the columns row, not gone, not still in column 0.
    const after = await domColumnIndexById(page, ['image1']);
    expect(after['image1']).toBe(1);
  });

  test('an image moved to column 1 persists there across save -> reload (model + live DOM)', async ({ page }) => {
    await createBlok(page, imageAcrossColumnsData());

    const imageWrapper = page.locator('[data-blok-tool="image"]').first();
    const wrapperBox = await imageWrapper.boundingBox();
    if (!wrapperBox) {
      throw new Error('missing bounding box for image wrapper');
    }
    await page.mouse.move(wrapperBox.x + wrapperBox.width / 2, wrapperBox.y + 4);
    const handle = page.locator(SETTINGS_BUTTON);
    await expect(handle).toBeVisible();

    const target = page.getByTestId('block-wrapper').filter({ hasText: 'Right anchor' }).last();
    await performStackDrop(page, handle, target);

    // Sanity: landed in column 1 before reload.
    const moved = await domColumnIndexById(page, ['image1']);
    expect(moved['image1']).toBe(1);

    const after = await reloadFromSave(page);

    // MODEL persists: image still parented to c2.
    expect(findBlock(after, 'image1')?.parent).toBe('c2');
    expect(childrenOf(after, 'c2')).toContain('image1');
    expect(childrenOf(after, 'c1')).not.toContain('image1');

    // LIVE DOM persists: image holder in column index 1 after the round-trip.
    const placement = await domColumnIndexById(page, ['image1']);
    expect(placement['image1']).toBe(1);
  });

  test('an image moved to column 1 can still be edited and removed there', async ({ page }) => {
    await createBlok(page, imageAcrossColumnsData());

    const imageWrapper = page.locator('[data-blok-tool="image"]').first();
    const wrapperBox = await imageWrapper.boundingBox();
    if (!wrapperBox) {
      throw new Error('missing bounding box for image wrapper');
    }
    await page.mouse.move(wrapperBox.x + wrapperBox.width / 2, wrapperBox.y + 4);
    const handle = page.locator(SETTINGS_BUTTON);
    await expect(handle).toBeVisible();

    const target = page.getByTestId('block-wrapper').filter({ hasText: 'Right anchor' }).last();
    await performStackDrop(page, handle, target);

    // Edit: change the image caption in place. It lives in column 1 now.
    const caption = page
      .locator('[data-blok-id="image1"]')
      .locator('[contenteditable="true"]')
      .first();
    await caption.click();
    const isMac = process.platform === 'darwin';
    await page.keyboard.press(isMac ? 'Meta+A' : 'Control+A');
    await page.keyboard.type('Edited caption in col1');
    // Blur to flush.
    await page.getByText('Right anchor').click();

    const edited = await saveBlok(page);
    expect((findBlock(edited, 'image1')?.data as ImageData).caption).toBe('Edited caption in col1');
    // The edit did not relocate the image out of column 1.
    expect(findBlock(edited, 'image1')?.parent).toBe('c2');
    const editedDom = await domColumnIndexById(page, ['image1']);
    expect(editedDom['image1']).toBe(1);

    // Remove: delete the image by its flat index.
    await page.evaluate(async () => {
      if (!window.blokInstance) {
        return;
      }
      const index = window.blokInstance.blocks.getBlockIndex('image1');
      await window.blokInstance.blocks.delete(index);
    });
    await page.waitForFunction(
      () => window.blokInstance !== undefined && window.blokInstance.blocks.getBlockIndex('image1') === undefined
    );

    const removed = await saveBlok(page);

    // The image is gone; no orphans dangling.
    expect(findBlock(removed, 'image1')).toBeUndefined();
    expect(removed.blocks.some((b) => b.type === 'image')).toBe(false);
    const ids = new Set(removed.blocks.map((b) => b.id));
    const orphans = removed.blocks.filter((b) => b.parent !== undefined && !ids.has(b.parent));
    expect(orphans).toStrictEqual([]);

    // The column_list survives with both columns; the anchor stays in column 1.
    expect(findBlock(removed, 'cl1')?.type).toBe('column_list');
    expect(removed.blocks.filter((b) => b.type === 'column')).toHaveLength(2);
    expect(findBlock(removed, 'anchor')?.parent).toBe('c2');

    // LIVE DOM: no image element remains; the anchor still sits in column 1.
    await expect(page.locator('[data-blok-tool="image"]')).toHaveCount(0);
    const anchorDom = await domColumnIndexById(page, ['anchor']);
    expect(anchorDom['anchor']).toBe(1);
  });
});
