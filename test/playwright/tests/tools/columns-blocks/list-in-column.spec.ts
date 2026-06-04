import { expect, test } from '@playwright/test';
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

  return (block?.data ?? {}) as ListData;
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('List inside a column', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
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

  test('removing the block leaves the column_list intact with the remaining paragraph', async ({ page }) => {
    await createBlok(page, buildTree());

    // Delete the list block by its flat index (delete is index-based).
    await page.evaluate(async () => {
      if (!window.blokInstance) {
        return;
      }
      const index = window.blokInstance.blocks.getBlockIndex('list1');

      await window.blokInstance.blocks.delete(index);
    });

    // Wait until the list block is gone from the flat array.
    await page.waitForFunction(
      () => window.blokInstance !== undefined &&
        window.blokInstance.blocks.getBlockIndex('list1') === undefined
    );

    const saved = await saveBlok(page);

    // The list block is gone.
    expect(findBlock(saved, 'list1')).toBeUndefined();
    expect(saved.blocks.some((b) => b.type === 'list')).toBe(false);

    // The column_list and both columns survive (a grandchild removal does not
    // collapse the layout); c2's paragraph is untouched.
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(2);
    expect(childrenOf(saved, 'cl1')).toEqual(['c1', 'c2']);
    expect(findBlock(saved, 'p2')?.parent).toBe('c2');
    expect(childrenOf(saved, 'c2')).toEqual(['p2']);

    // c1 either becomes empty or re-seeds a single empty paragraph — never a
    // dangling orphan. Whatever remains under c1 must still be parented to c1.
    const c1Children = childrenOf(saved, 'c1');
    expect(c1Children.length).toBeLessThanOrEqual(1);

    // Describe every survivor under c1. In the 0-child case this is an empty
    // array; in the 1-child case it must be a single empty paragraph. Comparing
    // against an array of empty-paragraph descriptors of the same length asserts
    // both cases unconditionally without weakening either branch.
    const c1Survivors = c1Children.map((childId) => {
      const seeded = findBlock(saved, childId);

      return {
        type: seeded?.type,
        text: (seeded?.data as { text?: string }).text ?? '',
      };
    });
    const expectedSurvivors = c1Children.map(() => ({ type: 'paragraph', text: '' }));

    expect(c1Survivors).toEqual(expectedSurvivors);

    // No orphaned children: every non-root block points at an existing parent.
    const ids = new Set(saved.blocks.map((b) => b.id));
    const orphanParents = saved.blocks
      .filter((block) => block.parent !== undefined)
      .map((block) => block.parent)
      .filter((parent) => !ids.has(parent));

    expect(orphanParents).toEqual([]);
  });
});
