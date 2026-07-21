import type { OutputData } from '@/types';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';
import {
  childrenOf,
  createBlok,
  ensureBlokBundleBuilt,
  findBlock,
  reloadFromSave,
  saveBlok,
} from './_helpers';

/**
 * The nested tree under test: a 2-column layout where the FIRST column holds a
 * single Quote block (a leaf — it stores its text in `data.text`, it is NOT a
 * container) and the SECOND column holds a plain paragraph.
 */
const nestedTree = (): OutputData => ({
  blocks: [
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['quote1'] },
    {
      id: 'quote1',
      type: 'quote',
      data: { text: 'Everything is a block.', size: 'default' },
      parent: 'c1',
    },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['c2p1'] },
    { id: 'c2p1', type: 'paragraph', data: { text: 'Second column.' }, parent: 'c2' },
  ],
});

/** Reads `data.text` off a saved block without resorting to `any`. */
const quoteText = (block: { data: unknown } | undefined): string | undefined => {
  if (!block) {
    return undefined;
  }
  const data = block.data as { text?: string };

  return data.text;
};

/** Reads `data.size` off a saved block without resorting to `any`. */
const quoteSize = (block: { data: unknown } | undefined): string | undefined => {
  if (!block) {
    return undefined;
  }
  const data = block.data as { size?: string };

  return data.size;
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Quote inside a column', () => {
  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('renders inside the first column', async ({ page }) => {
    await createBlok(page, nestedTree());

    // Two columns are laid out side by side.
    const columns = page.locator('[data-blok-column]');
    await expect(columns).toHaveCount(2);

    // The quote tool renders a native <blockquote data-blok-tool="quote">.
    const quote = page.locator('[data-blok-tool="quote"]');
    await expect(quote).toHaveCount(1);
    await expect(quote).toBeVisible();
    await expect(quote).toContainText('Everything is a block.');

    // The quote text is visible (rendered) inside the page.
    await expect(page.getByText('Everything is a block.')).toBeVisible();

    // The quote's holder physically lives inside the FIRST column (index 0), and
    // the second column shows its paragraph — proving the quote did not leak out
    // of its column or steal the other column's content.
    const quoteColumnIndex = await page.evaluate(() => {
      const columnHolders = Array.from(
        document.querySelectorAll('[data-blok-columns] > [data-blok-element]')
      );
      const quoteEl = document.querySelector('[data-blok-tool="quote"]');
      const ownColumn = quoteEl?.closest('[data-blok-column]')?.closest('[data-blok-element]');

      return ownColumn instanceof HTMLElement ? columnHolders.indexOf(ownColumn) : -1;
    });

    expect(quoteColumnIndex).toBe(0);
    await expect(page.getByText('Second column.')).toBeVisible();
  });

  test('@smoke saves the nested tree intact', async ({ page }) => {
    await createBlok(page, nestedTree());

    const saved = await saveBlok(page);

    // column_list + exactly two columns survive.
    const list = findBlock(saved, 'cl1');
    expect(list?.type).toBe('column_list');
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(2);

    // The quote is parented to the first column and is that column's only child.
    const quote = findBlock(saved, 'quote1');
    expect(quote?.type).toBe('quote');
    expect(quote?.parent).toBe('c1');
    expect(childrenOf(saved, 'c1')).toEqual(['quote1']);

    // The quote is a leaf — it owns no children in the parent/content tree.
    expect(childrenOf(saved, 'quote1')).toEqual([]);

    // The second column keeps its own paragraph.
    expect(childrenOf(saved, 'c2')).toEqual(['c2p1']);

    // Both columns are referenced by the column_list, in order.
    expect(list?.content).toEqual(['c1', 'c2']);

    // The quote's primary data round-trips: text preserved, size preserved.
    expect(quoteText(quote)).toBe('Everything is a block.');
    expect(quoteSize(quote)).toBe('default');
  });

  test('survives a save -> reload -> save round-trip unchanged', async ({ page }) => {
    await createBlok(page, nestedTree());

    const before = await saveBlok(page);
    const after = await reloadFromSave(page);

    // Reduce each save to the meaningful, non-volatile subset and deep-compare.
    const meaningful = (data: OutputData): unknown =>
      data.blocks.map((block) => ({
        id: block.id,
        type: block.type,
        parent: block.parent,
        content: block.content,
        text: quoteText(block),
        size: block.type === 'quote' ? quoteSize(block) : undefined,
      }));

    expect(meaningful(after)).toEqual(meaningful(before));

    // Explicit spot-checks on the nested quote after the round-trip.
    const quoteAfter = findBlock(after, 'quote1');
    expect(quoteAfter?.parent).toBe('c1');
    expect(quoteText(quoteAfter)).toBe('Everything is a block.');
    expect(after.blocks.filter((b) => b.type === 'column')).toHaveLength(2);

    // The quote still renders inside the first column in the reloaded DOM.
    await expect(page.locator('[data-blok-column]')).toHaveCount(2);
    await expect(page.locator('[data-blok-tool="quote"]')).toContainText('Everything is a block.');
  });

  test('edits to the block content persist through save', async ({ page }) => {
    await createBlok(page, nestedTree());

    // The editable element IS the <blockquote> itself (contentEditable=true); there
    // is no inner content wrapper to click, so target the tool element directly.
    const quote = page.locator('[data-blok-tool="quote"]');
    await quote.click();

    const isMac = process.platform === 'darwin';
    const selectAll = isMac ? 'Meta+A' : 'Control+A';

    await page.keyboard.press(selectAll);
    await page.keyboard.type('A block is everything.');

    await expect(quote).toContainText('A block is everything.');

    const saved = await saveBlok(page);
    const quoteBlock = findBlock(saved, 'quote1');

    // The edited text is in the saved data, and the quote is still inside the column.
    expect(quoteText(quoteBlock)).toBe('A block is everything.');
    expect(quoteBlock?.parent).toBe('c1');
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(2);
  });

  test('removing the block collapses the emptied column and unwraps the layout', async ({ page }) => {
    await createBlok(page, nestedTree());

    // Delete the quote (the sole child of column c1) by its flat index.
    await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }
      const index = window.blokInstance.blocks.getBlockIndex('quote1');
      await window.blokInstance.blocks.delete(index);
    });

    // Deleting the sole child empties c1, so the column is removed; the list now
    // has a single column and unwraps. The unwrap is fire-and-forget async — wait
    // for the whole scaffold to dissolve before saving.
    await page.waitForFunction(
      () => window.blokInstance !== undefined && window.blokInstance.blocks.getBlockIndex('cl1') === undefined
    );

    const saved = await saveBlok(page);

    // The deleted block is gone and no column/column_list survives.
    expect(findBlock(saved, 'quote1')).toBeUndefined();
    expect(saved.blocks.filter((b) => b.type === 'column_list')).toHaveLength(0);
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(0);

    // The other column's paragraph is promoted to ROOT, content intact.
    expect(findBlock(saved, 'c2p1')?.parent ?? null).toBeNull();
    expect(quoteText(findBlock(saved, 'c2p1'))).toBe('Second column.');

    // No orphaned blocks.
    const allIds = new Set(saved.blocks.map((b) => b.id));
    const orphans = saved.blocks.filter((b) => b.parent !== undefined && b.parent !== null && !allIds.has(b.parent));

    expect(orphans).toEqual([]);

    // The entire columns scaffold has dissolved in the live DOM.
    await expect(page.locator('[data-blok-column]')).toHaveCount(0);
  });
});
