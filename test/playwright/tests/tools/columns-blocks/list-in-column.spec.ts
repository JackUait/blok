import type { OutputData } from '@/types';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';
import {
  ensureBlokBundleBuilt,
  createBlok,
  saveBlok,
  reloadFromSave,
  findBlock,
  childrenOf,
  editParagraphLikeText,
} from './_helpers';

/**
 * Builds the nested tree under test: a 2-column layout where column c1 holds a
 * single unordered `list` block (depth 0) and column c2 holds a paragraph.
 *
 * List is a FLAT leaf model: a list item is its own `list` block, content lives
 * entirely in `data` ({ text, style, checked?, depth? }). It has no children and
 * does not use parent/content for its own content. The single unordered depth-0
 * item is the cross-column-safe case (it dodges ordered-numbering and flat-index
 * depth-inference hazards), so any failure here is a genuine column regression.
 */
const buildTree = (): OutputData => ({
  blocks: [
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['list1'] },
    {
      id: 'list1',
      type: 'list',
      data: {
        text: 'First column list item',
        style: 'unordered',
        checked: false,
        depth: 0,
      },
      parent: 'c1',
    },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['p2'] },
    { id: 'p2', type: 'paragraph', data: { text: 'Second column paragraph' }, parent: 'c2' },
  ],
});

interface ListData {
  text?: string;
  style?: string;
  checked?: boolean;
  depth?: number;
}

const listDataOf = (saved: OutputData, id: string): ListData => {
  const block = findBlock(saved, id);

  return (block?.data ?? {});
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('List inside a column', () => {
  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('renders inside the first column', async ({ page }) => {
    await createBlok(page, buildTree());

    // Column scaffolding is present: the column_list wrapper plus two columns.
    await expect(page.getByTestId('column-list')).toBeVisible();
    const columns = page.locator('[data-blok-column]');
    await expect(columns).toHaveCount(2);

    // The list block is rendered as a `list` tool with its unordered/depth-0 attrs.
    const listBlock = page.locator('[data-blok-tool="list"]');
    await expect(listBlock).toHaveCount(1);
    await expect(listBlock).toHaveAttribute('data-list-style', 'unordered');
    await expect(listBlock).toHaveAttribute('data-list-depth', '0');

    // Its editable content container holds the item text.
    const content = page.getByTestId('list-content-container');
    await expect(content).toBeVisible();
    await expect(content).toHaveText('First column list item');

    // The list lives inside the FIRST column (index 0), the paragraph in the second.
    const listColumnIndex = await page.evaluate(() => {
      const columnHolders = Array.from(
        document.querySelectorAll('[data-blok-columns] > [data-blok-element]')
      );
      const listWrapper = document.querySelector('[data-blok-tool="list"]');
      const ownColumn = listWrapper?.closest('[data-blok-column]')?.closest('[data-blok-element]');

      return ownColumn instanceof HTMLElement ? columnHolders.indexOf(ownColumn) : -1;
    });

    expect(listColumnIndex).toBe(0);
    await expect(page.getByText('Second column paragraph')).toBeVisible();
  });

  test('@smoke saves the nested tree intact', async ({ page }) => {
    await createBlok(page, buildTree());

    const saved = await saveBlok(page);

    // Column scaffolding survives the save.
    const types = saved.blocks.map((b) => b.type);
    expect(types.includes('column_list')).toBe(true);
    expect(types.filter((t) => t === 'column')).toHaveLength(2);

    // The column_list still owns exactly its two columns, in order.
    expect(childrenOf(saved, 'cl1')).toEqual(['c1', 'c2']);

    // The list block is parented to the first column and is the sole child of c1.
    const list = findBlock(saved, 'list1');
    expect(list).toBeDefined();
    expect(list?.type).toBe('list');
    expect(list?.parent).toBe('c1');
    expect(childrenOf(saved, 'c1')).toEqual(['list1']);

    // The second column keeps its paragraph.
    expect(childrenOf(saved, 'c2')).toEqual(['p2']);

    // The list's own data round-trips its key fields.
    const data = listDataOf(saved, 'list1');
    expect(data.text).toBe('First column list item');
    expect(data.style).toBe('unordered');
    expect(data.depth ?? 0).toBe(0);
  });

  test('survives a save -> reload -> save round-trip unchanged', async ({ page }) => {
    await createBlok(page, buildTree());

    const before = await saveBlok(page);
    const after = await reloadFromSave(page);

    // Compare the meaningful subset (ids, types, parent links, content membership,
    // and the list's primary data fields) — not volatile fields. This is the core
    // check that catches re-render/serialization breakage when nested in a column.
    const subset = (saved: OutputData): unknown =>
      saved.blocks.map((b) => {
        const base = { id: b.id, type: b.type, parent: b.parent ?? null, content: b.content ?? null };

        if (b.type === 'list') {
          const d = b.data as ListData;

          return {
            ...base,
            data: { text: d.text, style: d.style, depth: d.depth ?? 0 },
          };
        }

        return base;
      });

    expect(subset(after)).toEqual(subset(before));

    // The list is still inside the first column after the round-trip.
    expect(findBlock(after, 'list1')?.parent).toBe('c1');
    expect(childrenOf(after, 'cl1')).toEqual(['c1', 'c2']);
    expect(childrenOf(after, 'c1')).toEqual(['list1']);
  });

  test('edits to the block\'s content persist through save', async ({ page }) => {
    await createBlok(page, buildTree());

    // Edit the list item text in place inside the column. The content container is
    // a paragraph-like contenteditable, so the shared select-all + type helper works.
    await editParagraphLikeText(page, 'First column list item', 'Edited list text');

    // Blur out of the editable so the tool syncs its DOM into data before save.
    // Clicking the other column's paragraph moves focus off the list item.
    await page.getByText('Second column paragraph').click();

    const saved = await saveBlok(page);

    // The edited value is persisted, and the block is still parented to c1.
    expect(listDataOf(saved, 'list1').text).toBe('Edited list text');
    expect(findBlock(saved, 'list1')?.parent).toBe('c1');

    // It remains a single unordered list block inside two surviving columns.
    expect(saved.blocks.filter((b) => b.type === 'list')).toHaveLength(1);
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(2);
  });

  test('removing the block collapses the emptied column and unwraps the layout', async ({ page }) => {
    await createBlok(page, buildTree());

    // Delete the list block (the sole child of column c1) by its flat index.
    await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }
      const index = window.blokInstance.blocks.getBlockIndex('list1');

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
    expect(findBlock(saved, 'list1')).toBeUndefined();
    expect(saved.blocks.filter((b) => b.type === 'column_list')).toHaveLength(0);
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(0);

    // The other column's paragraph is promoted to ROOT, content intact.
    expect(findBlock(saved, 'p2')?.parent ?? null).toBeNull();
    expect((findBlock(saved, 'p2')?.data as { text?: string }).text).toBe('Second column paragraph');

    // No orphaned blocks.
    const allIds = new Set(saved.blocks.map((b) => b.id));
    const orphans = saved.blocks.filter((b) => b.parent !== undefined && b.parent !== null && !allIds.has(b.parent));

    expect(orphans).toEqual([]);
  });
});
