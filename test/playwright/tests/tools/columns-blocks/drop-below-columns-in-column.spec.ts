import type { Page, Locator } from '@playwright/test';
import type { OutputData } from '@/types';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';
import {
  ensureBlokBundleBuilt,
  createBlok,
  saveBlok,
  reloadFromSave,
  findBlock,
  childrenOf,
} from './_helpers';

const BLOK = '[data-blok-interface=blok]';
const SETTINGS_BUTTON = `${BLOK} [data-blok-testid="settings-toggler"]`;

/**
 * A column layout whose FIRST column is short (one line) and whose SECOND column
 * is tall (many lines). Because columns stretch to equal heights, the first
 * column has a large EMPTY region below its single line of content that still
 * lives inside the columns row. Below the whole layout is a root "Mover"
 * paragraph. This is the exact shape from the reported bug: the user drags a
 * block toward the bottom of the columns and it wrongly lands inside the first
 * column (and then can't be moved back out).
 */
const tallColumnsFixture = (): OutputData => ({
  blocks: [
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['c1p'] },
    { id: 'c1p', type: 'paragraph', data: { text: 'Short left' }, parent: 'c1' },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['c2p'] },
    {
      id: 'c2p',
      type: 'paragraph',
      data: {
        text: 'Tall right line one<br>line two<br>line three<br>line four<br>line five<br>line six',
      },
      parent: 'c2',
    },
    { id: 'mover', type: 'paragraph', data: { text: 'Mover block' } },
  ],
});

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

/** Finish the drag: release, and wait for the drag + ghost to settle. */
const finishDrag = async (page: Page): Promise<void> => {
  await page.waitForFunction(
    () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') === 'true',
    { timeout: 2000 }
  );

  await page.mouse.up();

  await page.waitForFunction(
    () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') !== 'true',
    { timeout: 2000 }
  );

  await page.waitForFunction(
    () => document.querySelector('[data-blok-testid="drag-preview"]') === null,
    { timeout: 2000 }
  );
};

/**
 * Drag `sourceHandle` and drop it at the empty bottom-left region of the columns
 * row — below the first column's single line of content but still inside the
 * stretched columns row. In Notion this drops the block at page ROOT below the
 * columns; the bug nested it inside the first column.
 */
const dropBelowFirstColumn = async (page: Page, sourceHandle: Locator): Promise<void> => {
  const sourceBox = await sourceHandle.boundingBox();
  const columnsRow = await page.locator('[data-blok-columns]').boundingBox();

  if (!sourceBox || !columnsRow) {
    throw new Error('missing bounding box for drop-below-columns');
  }

  const dropX = columnsRow.x + columnsRow.width * 0.15;
  const dropY = columnsRow.y + columnsRow.height - 6;

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(dropX, dropY, { steps: 20 });

  await finishDrag(page);
};

/**
 * Report, for a block id, whether its holder is mounted inside any column and
 * (as a second signal) whether it sits directly in the editor working area,
 * below the column_list holder.
 */
const domPlacement = async (
  page: Page,
  id: string
): Promise<{ insideColumn: boolean; insideColumnsRow: boolean; afterColumnListSibling: boolean }> => {
  return await page.evaluate((blockId) => {
    const holder = document.querySelector(`[data-blok-id="${blockId}"]`);

    if (!(holder instanceof HTMLElement)) {
      return { insideColumn: false, insideColumnsRow: false, afterColumnListSibling: false };
    }

    // insideColumn: nested in a column WRAPPER. insideColumnsRow: nested anywhere
    // in the columns ROW (catches a holder stranded as a phantom column sibling,
    // which [data-blok-column] alone would miss).
    const insideColumn = holder.closest('[data-blok-column]') !== null;
    const insideColumnsRow = holder.closest('[data-blok-columns]') !== null;

    const listHolder = document
      .querySelector('[data-blok-columns]')
      ?.closest('[data-blok-element]') ?? null;

    // afterColumnListSibling: the holder is a following SIBLING of the
    // column_list holder (same parent, later in document order) — i.e. genuinely
    // below the columns at root, not merely a descendant of the list.
    let afterColumnListSibling = false;

    if (listHolder instanceof HTMLElement) {
      const position = listHolder.compareDocumentPosition(holder);
      const isFollowing = Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING);
      const isContained = Boolean(position & Node.DOCUMENT_POSITION_CONTAINED_BY);

      afterColumnListSibling = isFollowing && !isContained &&
        holder.parentElement === listHolder.parentElement;
    }

    return { insideColumn, insideColumnsRow, afterColumnListSibling };
  }, id);
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Dropping a block at the empty bottom of a columns row', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('drops at root below the column_list, never nested inside the first column', async ({ page }) => {
    await createBlok(page, tallColumnsFixture());

    await expect(page.locator('[data-blok-column]')).toHaveCount(2);

    const handle = await grabLeafHandle(page, 'mover');
    await dropBelowFirstColumn(page, handle);

    const saved = await saveBlok(page);

    // MODEL: the mover is a parent-less root block, not adopted by any column.
    const columnIds = saved.blocks.filter((b) => b.type === 'column').map((b) => b.id);
    const moverParent = findBlock(saved, 'mover')?.parent ?? null;

    expect(columnIds).not.toContain(moverParent);
    expect(moverParent).toBeNull();

    // It sits at root AFTER the column_list (correct document order).
    const rootIds = saved.blocks
      .filter((b) => b.parent === undefined || b.parent === null)
      .map((b) => b.id);
    expect(rootIds).toEqual(['cl1', 'mover']);

    // The columns are untouched.
    expect(saved.blocks.filter((b) => b.type === 'column_list')).toHaveLength(1);
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(2);
    expect(childrenOf(saved, 'c1')).toEqual(['c1p']);
    expect(childrenOf(saved, 'c2')).toEqual(['c2p']);

    // LIVE DOM: the mover is fully OUT of the columns row (not stranded as a
    // phantom column) and sits as a root sibling below the column_list.
    const placement = await domPlacement(page, 'mover');
    expect(placement.insideColumn).toBe(false);
    expect(placement.insideColumnsRow).toBe(false);
    expect(placement.afterColumnListSibling).toBe(true);

    // And no phantom column crept into the row: still exactly two column holders.
    const columnHolderCount = await page.evaluate(
      () => document.querySelectorAll('[data-blok-columns] > [data-blok-element]').length
    );
    expect(columnHolderCount).toBe(2);

    // NOT STUCK: the drop survives a save -> reload round-trip unchanged.
    const after = await reloadFromSave(page);
    const rootAfter = after.blocks
      .filter((b) => b.parent === undefined || b.parent === null)
      .map((b) => b.id);
    expect(rootAfter).toEqual(['cl1', 'mover']);
    expect(findBlock(after, 'mover')?.parent ?? null).toBeNull();
  });

  test('the block is not stuck: after landing at root it can be dragged again', async ({ page }) => {
    await createBlok(page, tallColumnsFixture());
    await expect(page.locator('[data-blok-column]')).toHaveCount(2);

    // First drop below the columns -> root.
    const handle = await grabLeafHandle(page, 'mover');
    await dropBelowFirstColumn(page, handle);

    const firstPlacement = await domPlacement(page, 'mover');
    expect(firstPlacement.insideColumn).toBe(false);
    expect(firstPlacement.insideColumnsRow).toBe(false);

    // Now drag the mover ABOVE the columns, onto the top edge of the first
    // column's content. It must reorder freely — proving it is not wedged.
    const handle2 = await grabLeafHandle(page, 'mover');
    const sourceBox = await handle2.boundingBox();
    const targetBox = await page.locator('[data-blok-id="c1p"]').boundingBox();

    if (!sourceBox || !targetBox) {
      throw new Error('missing box for second drag');
    }

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 2, { steps: 20 });
    await finishDrag(page);

    // Landed somewhere legal and still a real, movable block (no orphaning,
    // no corruption of the columns).
    const saved = await saveBlok(page);
    expect(findBlock(saved, 'mover')).toBeDefined();
    const ids = new Set(saved.blocks.map((b) => b.id));
    const orphans = saved.blocks.filter(
      (b) => b.parent !== undefined && b.parent !== null && !ids.has(b.parent)
    );
    expect(orphans).toEqual([]);
  });

  test('PRESERVED: dropping onto a column\'s real content still stacks INTO that column', async ({ page }) => {
    await createBlok(page, tallColumnsFixture());
    await expect(page.locator('[data-blok-column]')).toHaveCount(2);

    // Drop directly over the SECOND column's content (the tall paragraph), on its
    // bottom half — a legitimate "add to this column" gesture that must NOT be
    // rerouted to root.
    const handle = await grabLeafHandle(page, 'mover');
    const sourceBox = await handle.boundingBox();
    const targetBox = await page.locator('[data-blok-id="c2p"]').boundingBox();

    if (!sourceBox || !targetBox) {
      throw new Error('missing box for into-column drop');
    }

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 4, { steps: 20 });
    await finishDrag(page);

    const saved = await saveBlok(page);

    // The mover joined the SECOND column, after its existing paragraph.
    expect(findBlock(saved, 'mover')?.parent).toBe('c2');
    expect(childrenOf(saved, 'c2')).toEqual(['c2p', 'mover']);
    expect((await domPlacement(page, 'mover')).insideColumn).toBe(true);
  });
});
