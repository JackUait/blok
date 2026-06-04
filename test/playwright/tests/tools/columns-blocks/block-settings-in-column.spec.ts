import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  ensureBlokBundleBuilt,
  TEST_PAGE_URL,
  createBlok,
  saveBlok,
  childrenOf,
  findBlock,
} from './_helpers';

const BLOK_INTERFACE = '[data-blok-interface=blok]';
const SETTINGS_BUTTON = `${BLOK_INTERFACE} [data-blok-testid="settings-toggler"]`;
const POPOVER_CONTAINER = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';

/**
 * Returns, for every block holder mounted inside a [data-blok-column] wrapper,
 * which 0-based column index it lives in — keyed by the block's text. Proves the
 * LIVE DOM placement, not just the saved model. A "model-correct, DOM-wrong"
 * column bug would pass a save()-only assertion but fail here.
 */
const domColumnMembership = async (page: Page): Promise<Record<string, number>> => {
  return await page.evaluate(() => {
    const columnHolders = Array.from(document.querySelectorAll('[data-blok-columns] > [data-blok-element]'));
    const membership: Record<string, number> = {};

    document.querySelectorAll('[data-blok-column] [data-blok-element]').forEach((holder) => {
      const ownColumn = holder.closest('[data-blok-column]')?.closest('[data-blok-element]');

      if (!(ownColumn instanceof HTMLElement)) {
        return;
      }

      const columnIndex = columnHolders.indexOf(ownColumn);
      const text = (holder.textContent ?? '').trim();

      if (text.length > 0 && columnIndex !== -1) {
        membership[text] = columnIndex;
      }
    });

    return membership;
  });
};

/**
 * Resolve a block's current flat index from its id, the same lookup the block
 * settings menu uses before invoking a move/delete.
 */
const flatIndexOf = async (page: Page, id: string): Promise<number> => {
  return await page.evaluate((blockId) => {
    const index = window.blokInstance?.blocks.getBlockIndex(blockId);

    if (index === undefined) {
      throw new Error(`Block ${blockId} not found`);
    }

    return index;
  }, id);
};

/**
 * Focus a block by its text so the toolbar + settings toggler target it, open
 * the block settings popover, and return the popover container locator.
 */
const openBlockSettingsFor = async (page: Page, blockText: string): Promise<ReturnType<Page['locator']>> => {
  const wrapper = page.getByTestId('block-wrapper').filter({ hasText: blockText }).last();
  const content = wrapper.locator('[data-blok-element-content]').first();

  await content.click();

  const settingsButton = page.locator(SETTINGS_BUTTON);

  await expect(settingsButton).toBeVisible();
  await settingsButton.click();

  const popover = page.locator(POPOVER_CONTAINER);

  await expect(popover).toBeVisible();

  return popover;
};

test.describe('Block settings on a block inside a column operate within the column', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('Move-down from settings reorders blocks WITHIN the column only', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    // Left column has three stacked blocks; right column has one. Moving the
    // first left-column block down must swap it with the second WITHIN the left
    // column — never cross into the right column or escape to root.
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['l1', 'l2', 'l3'] },
        { id: 'l1', type: 'paragraph', data: { text: 'Left one' }, parent: 'c1' },
        { id: 'l2', type: 'paragraph', data: { text: 'Left two' }, parent: 'c1' },
        { id: 'l3', type: 'paragraph', data: { text: 'Left three' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['r1'] },
        { id: 'r1', type: 'paragraph', data: { text: 'Right one' }, parent: 'c2' },
      ],
    });

    // Move "Left one" down one slot (flat move from its index to index+1), the
    // same operation a settings "move down" performs.
    const fromIndex = await flatIndexOf(page, 'l1');

    await page.evaluate((idx) => {
      window.blokInstance?.blocks.move(idx + 1, idx);
    }, fromIndex);

    await page.waitForFunction(() => {
      const blok = window.blokInstance;

      if (!blok) {
        return false;
      }

      const oneIndex = blok.blocks.getBlockIndex('l1');
      const twoIndex = blok.blocks.getBlockIndex('l2');

      return oneIndex !== undefined && twoIndex !== undefined && oneIndex > twoIndex;
    });

    const saved = await saveBlok(page);

    // Both still children of the same left column, in swapped order. The right
    // column is untouched.
    expect(childrenOf(saved, 'c1')).toEqual(['l2', 'l1', 'l3']);
    expect(childrenOf(saved, 'c2')).toEqual(['r1']);
    expect(findBlock(saved, 'l1')?.parent).toBe('c1');

    // LIVE DOM: every left-column block stays in column 0, right stays in column 1.
    const membership = await domColumnMembership(page);

    expect(membership['Left one']).toBe(0);
    expect(membership['Left two']).toBe(0);
    expect(membership['Left three']).toBe(0);
    expect(membership['Right one']).toBe(1);
  });

  test('Move-down on the LAST block of a column does not eject it into the next column or root', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    // The left column's last block sits immediately before the right column's
    // first child in the flat array. A naive flat move-down would swap it across
    // the boundary into the right column; it must instead clamp / no-op.
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['l1', 'l2'] },
        { id: 'l1', type: 'paragraph', data: { text: 'Left one' }, parent: 'c1' },
        { id: 'l2', type: 'paragraph', data: { text: 'Left last' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['r1'] },
        { id: 'r1', type: 'paragraph', data: { text: 'Right one' }, parent: 'c2' },
      ],
    });

    // Move-down the last block of the left column.
    const fromIndex = await flatIndexOf(page, 'l2');

    await page.evaluate((idx) => {
      window.blokInstance?.blocks.move(idx + 1, idx);
    }, fromIndex);

    const saved = await saveBlok(page);

    // "Left last" stays the last child of the left column; it did NOT jump into
    // the right column or pop out to root.
    expect(findBlock(saved, 'l2')?.parent).toBe('c1');
    expect(childrenOf(saved, 'c1')).toEqual(['l1', 'l2']);
    expect(childrenOf(saved, 'c2')).toEqual(['r1']);

    // LIVE DOM: "Left last" remains in column 0, not column 1.
    const membership = await domColumnMembership(page);

    expect(membership['Left last']).toBe(0);
    expect(membership['Right one']).toBe(1);
  });

  test('Delete from settings removes only the targeted block and keeps the column_list well-formed', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    // Left column has two blocks so deleting one leaves the column non-empty and
    // the column_list intact (no collapse/unwrap is triggered).
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['l1', 'l2'] },
        { id: 'l1', type: 'paragraph', data: { text: 'Delete me' }, parent: 'c1' },
        { id: 'l2', type: 'paragraph', data: { text: 'Keep me left' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['r1'] },
        { id: 'r1', type: 'paragraph', data: { text: 'Keep me right' }, parent: 'c2' },
      ],
    });

    const popover = await openBlockSettingsFor(page, 'Delete me');
    const deleteItem = popover.locator('[data-blok-testid="popover-item"][data-blok-item-name="delete"]');

    await expect(deleteItem).toBeVisible();
    await deleteItem.click();

    await page.waitForFunction(
      () => window.blokInstance?.blocks.getBlockIndex('l1') === undefined
    );

    const saved = await saveBlok(page);

    // Only "Delete me" is gone. Both columns survive with their remaining blocks
    // correctly parented — no orphaned siblings, no collapsed column_list.
    expect(findBlock(saved, 'l1')).toBeUndefined();
    expect(saved.blocks.filter((b) => b.type === 'column_list')).toHaveLength(1);
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(2);
    expect(childrenOf(saved, 'c1')).toEqual(['l2']);
    expect(childrenOf(saved, 'c2')).toEqual(['r1']);
    expect(findBlock(saved, 'l2')?.parent).toBe('c1');
    expect(findBlock(saved, 'r1')?.parent).toBe('c2');

    // LIVE DOM: survivors stay in their columns.
    const membership = await domColumnMembership(page);

    expect(membership['Keep me left']).toBe(0);
    expect(membership['Keep me right']).toBe(1);
  });

  test('Duplicate from settings places the copy directly below, inside the same column', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['l1'] },
        { id: 'l1', type: 'paragraph', data: { text: 'Original left' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['r1'] },
        { id: 'r1', type: 'paragraph', data: { text: 'Right one' }, parent: 'c2' },
      ],
    });

    // Duplicate "Original left": copy its data and insert at the flat slot
    // immediately after it — the exact operation a settings "duplicate" performs.
    const sourceIndex = await flatIndexOf(page, 'l1');

    await page.evaluate((idx) => {
      const blok = window.blokInstance;

      if (!blok) {
        throw new Error('Blok instance not found');
      }

      const source = blok.blocks.getBlockByIndex(idx);

      if (source === undefined) {
        throw new Error('Source block not found');
      }

      blok.blocks.insert(source.name, { text: 'Original left' }, {}, idx + 1, false);
    }, sourceIndex);

    await page.waitForFunction(() => {
      const blok = window.blokInstance;

      if (!blok) {
        return false;
      }

      const count = blok.blocks.getBlocksCount();
      let copies = 0;

      for (let i = 0; i < count; i += 1) {
        const block = blok.blocks.getBlockByIndex(i);

        // Count only leaf paragraphs — container holders (column_list, column)
        // aggregate their children's text, so matching on their textContent
        // would over-count and the condition could never settle at 2.
        if (block?.name === 'paragraph' && block.holder.textContent?.trim() === 'Original left') {
          copies += 1;
        }
      }

      return copies === 2;
    });

    const saved = await saveBlok(page);

    // The copy is parented to the SAME column as the original — not dropped to
    // root — and sits immediately after the original within that column.
    const leftChildren = childrenOf(saved, 'c1');

    expect(leftChildren).toHaveLength(2);
    expect(leftChildren[0]).toBe('l1');

    const copyId = leftChildren[1];
    const copy = findBlock(saved, copyId);

    // New id, same data.
    expect(copyId).not.toBe('l1');
    expect((copy?.data as { text?: string }).text).toBe('Original left');
    expect(copy?.parent).toBe('c1');

    // The right column is untouched; still exactly two columns.
    expect(childrenOf(saved, 'c2')).toEqual(['r1']);
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(2);

    // LIVE DOM: both the original and its copy live in column 0.
    const copyColumn = await page.evaluate((id) => {
      const columnHolders = Array.from(document.querySelectorAll('[data-blok-columns] > [data-blok-element]'));
      const holder = columnHolders
        .flatMap((col) => Array.from(col.querySelectorAll('[data-blok-element]')))
        .find((el) => el.getAttribute('data-blok-id') === id);

      if (!(holder instanceof HTMLElement)) {
        return -1;
      }

      const ownColumn = holder.closest('[data-blok-column]')?.closest('[data-blok-element]');

      return ownColumn instanceof HTMLElement ? columnHolders.indexOf(ownColumn) : -1;
    }, copyId);

    expect(copyColumn).toBe(0);
  });
});
