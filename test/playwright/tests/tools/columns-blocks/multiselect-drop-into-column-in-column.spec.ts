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

  // The drop motion (ghost settle) finishes before assertions run.
  await page.waitForFunction(
    () => document.querySelector('[data-blok-testid="drag-preview"]') === null,
    { timeout: 2000 }
  );
};

/**
 * Reveal a specific block's OWN drag handle by id. Hovering a child of a
 * container would surface the child's handle, so we hover the holder of the
 * requested block (by its data-blok-id) near its top edge and read the single
 * visible settings toggler. Used here to grab the handle of a block that is part
 * of a live multi-selection without disturbing that selection.
 */
const grabContainerHandle = async (page: Page, containerId: string): Promise<Locator> => {
  const holder = page.locator(`[data-blok-id="${containerId}"]`).first();
  const box = await holder.boundingBox();

  if (!box) {
    throw new Error(`missing bounding box for container ${containerId}`);
  }

  await page.mouse.move(box.x + box.width / 2, box.y + 2);

  const handle = page.locator(SETTINGS_BUTTON);
  await expect(handle).toBeVisible();

  return handle;
};

/**
 * For each given block id, report whether its holder is mounted inside any
 * [data-blok-column], and if so, which column index (document order). Proves the
 * LIVE DOM placement, not merely the saved model. -1 = at root (no column),
 * -2 = absent from the DOM entirely.
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
 * Place the caret at the END of a block's editable content, then extend the
 * block selection downward `times` rows with Shift+ArrowDown so a contiguous run
 * of root blocks becomes multi-selected. Returns once every requested wrapper
 * carries data-blok-selected=true.
 */
const selectAdjacentBlocks = async (page: Page, startId: string, ids: string[]): Promise<void> => {
  const startContent = page
    .locator(`[data-blok-id="${startId}"] [data-blok-element-content]`)
    .first();

  await startContent.click();
  await startContent.evaluate((element) => {
    const doc = element.ownerDocument;
    const selection = doc?.getSelection();

    if (!selection) {
      return;
    }

    const range = doc.createRange();
    const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let lastTextNode: Text | null = null;

    while (walker.nextNode()) {
      lastTextNode = walker.currentNode as Text;
    }

    if (lastTextNode) {
      range.setStart(lastTextNode, lastTextNode.length ?? 0);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  });

  await page.keyboard.down('Shift');
  for (let i = 0; i < ids.length - 1; i++) {
    await page.keyboard.press('ArrowDown');
  }
  await page.keyboard.up('Shift');

  for (const id of ids) {
    const wrapper = page.locator(`[data-blok-id="${id}"]`).first();

    await expect(wrapper).toHaveAttribute('data-blok-selected', 'true');
  }
};

/**
 * Builds three contiguous root blocks of mixed type (header + paragraph + list)
 * followed by a plain paragraph anchor used as the side-drop target.
 *
 * Data shapes copied from the per-type specs:
 *   header — { text, level }          (header-in-column.spec.ts)
 *   list   — { text, style, checked, depth } flat leaf  (list-in-column.spec.ts)
 */
const buildTree = (): OutputData => ({
  blocks: [
    { id: 'sel-header', type: 'header', data: { text: 'Section title', level: 3 } },
    { id: 'sel-para', type: 'paragraph', data: { text: 'A middle paragraph' } },
    {
      id: 'sel-list',
      type: 'list',
      data: { text: 'A bullet item', style: 'unordered', checked: false, depth: 0 },
    },
    { id: 'anchor', type: 'paragraph', data: { text: 'Right anchor' } },
  ],
});

const SELECTED = ['sel-header', 'sel-para', 'sel-list'];

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Multi-selecting several root blocks and side-dropping them into a column', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await gotoTestPage(page);
  });

  test('all three selected blocks (header + paragraph + list) land inside ONE column in order', async ({ page }) => {
    await createBlok(page, buildTree());

    await expect(page.locator('[data-blok-column]')).toHaveCount(0);

    // Multi-select the three contiguous root blocks (header, paragraph, list).
    await selectAdjacentBlocks(page, 'sel-header', SELECTED);

    // Grab the handle of one selected block and side-drop the whole selection
    // onto the RIGHT edge of the "Right anchor" paragraph -> [anchor | selection].
    const handle = await grabContainerHandle(page, 'sel-header');
    const target = page.getByTestId('block-wrapper').filter({ hasText: 'Right anchor' }).last();
    await performSideDrop(page, handle, target, 'right');

    // A 2-column layout now exists.
    await expect(page.locator('[data-blok-column]')).toHaveCount(2);

    const saved = await saveBlok(page);

    // Exactly one column_list with two columns was created.
    expect(saved.blocks.filter((b) => b.type === 'column_list')).toHaveLength(1);
    const columnIds = saved.blocks.filter((b) => b.type === 'column').map((b) => b.id);
    expect(columnIds).toHaveLength(2);

    // MODEL: all three dropped blocks share ONE column parent.
    const parents = SELECTED.map((id) => findBlock(saved, id)?.parent);
    expect(columnIds).toContain(parents[0]);
    expect(new Set(parents).size).toBe(1);
    const sharedColumn = parents[0] as string;

    // MODEL: that column holds exactly the three blocks, in selection order.
    expect(childrenOf(saved, sharedColumn)).toEqual(SELECTED);

    // The anchor sits in the OTHER column (the layout is target | selection).
    const anchorColumn = findBlock(saved, 'anchor')?.parent;
    expect(columnIds).toContain(anchorColumn);
    expect(anchorColumn).not.toBe(sharedColumn);

    // LIVE DOM: all three holders sit in the SAME single column, none stranded
    // in the row or left at root.
    const placement = await domColumnIndexById(page, [...SELECTED, 'anchor']);
    expect(placement['sel-header']).toBeGreaterThanOrEqual(0);
    expect(placement['sel-para']).toBe(placement['sel-header']);
    expect(placement['sel-list']).toBe(placement['sel-header']);
    expect(placement['anchor']).toBeGreaterThanOrEqual(0);
    expect(placement['anchor']).not.toBe(placement['sel-header']);

    // LIVE DOM: document order of the three holders inside their column is
    // header, then paragraph, then list.
    const domOrder = await page.evaluate((ids: string[]) => {
      const column = document.querySelector(`[data-blok-id="${ids[0]}"]`)?.closest('[data-blok-column]');

      if (!column) {
        return [];
      }

      const holders = Array.from(column.querySelectorAll('[data-blok-id]'));

      return ids
        .map((id) => holders.findIndex((h) => h.getAttribute('data-blok-id') === id))
        .reduce<number[]>((acc, idx) => [...acc, idx], []);
    }, SELECTED);
    expect(domOrder[0]).toBeGreaterThanOrEqual(0);
    expect(domOrder[1]).toBeGreaterThan(domOrder[0]);
    expect(domOrder[2]).toBeGreaterThan(domOrder[1]);
  });

  test('save -> reload round-trip preserves the column membership and order of the dropped selection', async ({ page }) => {
    await createBlok(page, buildTree());

    await selectAdjacentBlocks(page, 'sel-header', SELECTED);

    const handle = await grabContainerHandle(page, 'sel-header');
    const target = page.getByTestId('block-wrapper').filter({ hasText: 'Right anchor' }).last();
    await performSideDrop(page, handle, target, 'right');

    await expect(page.locator('[data-blok-column]')).toHaveCount(2);

    // Capture the shared column before the round-trip for an order assertion.
    const before = await saveBlok(page);
    const sharedColumnBefore = findBlock(before, 'sel-header')?.parent as string;
    expect(childrenOf(before, sharedColumnBefore)).toEqual(SELECTED);

    // Round-trip: save -> rebuild editor from saved -> save.
    const after = await reloadFromSave(page);

    // MODEL survives: still one column_list, three blocks share one column in order.
    expect(after.blocks.filter((b) => b.type === 'column_list')).toHaveLength(1);
    const columnIdsAfter = after.blocks.filter((b) => b.type === 'column').map((b) => b.id);
    const parentsAfter = SELECTED.map((id) => findBlock(after, id)?.parent);
    expect(new Set(parentsAfter).size).toBe(1);
    const sharedColumnAfter = parentsAfter[0] as string;
    expect(columnIdsAfter).toContain(sharedColumnAfter);
    expect(childrenOf(after, sharedColumnAfter)).toEqual(SELECTED);

    // LIVE DOM after the rebuild: all three holders are co-located in one column.
    const placement = await domColumnIndexById(page, SELECTED);
    expect(placement['sel-header']).toBeGreaterThanOrEqual(0);
    expect(placement['sel-para']).toBe(placement['sel-header']);
    expect(placement['sel-list']).toBe(placement['sel-header']);

    // The block content is intact in the DOM after reload.
    await expect(page.getByRole('heading', { name: 'Section title' })).toBeVisible();
    await expect(page.getByText('A middle paragraph')).toBeVisible();
    await expect(page.getByText('A bullet item')).toBeVisible();
  });

  test('editing one and removing another of the dropped blocks leaves the rest inside the same column', async ({ page }) => {
    await createBlok(page, buildTree());

    await selectAdjacentBlocks(page, 'sel-header', SELECTED);

    const handle = await grabContainerHandle(page, 'sel-header');
    const target = page.getByTestId('block-wrapper').filter({ hasText: 'Right anchor' }).last();
    await performSideDrop(page, handle, target, 'right');

    await expect(page.locator('[data-blok-column]')).toHaveCount(2);

    const dropped = await saveBlok(page);
    const sharedColumn = findBlock(dropped, 'sel-header')?.parent as string;
    expect(childrenOf(dropped, sharedColumn)).toEqual(SELECTED);

    // EDIT: retype the middle paragraph's text in place (same block id).
    const paraContent = page
      .locator('[data-blok-id="sel-para"] [data-blok-element-content]')
      .first();

    await paraContent.click();
    const isMac = process.platform === 'darwin';
    await page.keyboard.press(isMac ? 'Meta+A' : 'Control+A');
    await page.keyboard.type('Edited middle paragraph');

    // REMOVE: delete the list block via the API so the column keeps the other two.
    await page.evaluate(async () => {
      const blok = window.blokInstance;

      if (!blok) {
        throw new Error('Blok instance not found');
      }

      const index = blok.blocks.getBlockIndex('sel-list');

      await blok.blocks.delete(index);
    });

    const saved = await saveBlok(page);

    // The edited paragraph kept its id and its new text, still in the column.
    expect(findBlock(saved, 'sel-para')?.parent).toBe(sharedColumn);
    expect((findBlock(saved, 'sel-para')?.data as { text?: string }).text).toBe('Edited middle paragraph');

    // The removed list block is gone from the model entirely.
    expect(findBlock(saved, 'sel-list')).toBeUndefined();

    // The surviving two blocks remain in the same column, header before paragraph.
    expect(findBlock(saved, 'sel-header')?.parent).toBe(sharedColumn);
    expect(childrenOf(saved, sharedColumn)).toEqual(['sel-header', 'sel-para']);

    // LIVE DOM: the two survivors are co-located in one column; the list is gone.
    const placement = await domColumnIndexById(page, SELECTED);
    expect(placement['sel-header']).toBeGreaterThanOrEqual(0);
    expect(placement['sel-para']).toBe(placement['sel-header']);
    expect(placement['sel-list']).toBe(-2);

    // The edited text is visible and the removed item's text is gone.
    await expect(page.getByText('Edited middle paragraph')).toBeVisible();
    await expect(page.getByText('A bullet item')).toHaveCount(0);
  });
});
