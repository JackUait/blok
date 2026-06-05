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

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

/**
 * Fixture: a 2-column layout where the first column holds a single Divider block
 * and the second column holds a paragraph. The divider is a void/contentless
 * block (no editable content, no children, `data` is always `{}`), so the
 * sibling paragraph carries the only editable text we can assert against.
 */
const dividerInColumnFixture: OutputData = {
  blocks: [
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['divider1'] },
    { id: 'divider1', type: 'divider', data: {}, parent: 'c1' },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['c2-p'] },
    { id: 'c2-p', type: 'paragraph', data: { text: 'Right column.' }, parent: 'c2' },
  ],
};

test.describe('Divider inside a column', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('renders inside the first column', async ({ page }) => {
    await createBlok(page, dividerInColumnFixture);

    const columns = page.locator('[data-blok-column]');
    await expect(columns).toHaveCount(2);
    await expect(page.getByTestId('column-list')).toBeVisible();

    // The divider sets no testid/role/text — its <hr> carries a stable
    // data-blok-divider hook. It must live inside the FIRST column, exactly once.
    const firstColumnRule = columns.nth(0).locator('[data-blok-divider]');
    await expect(firstColumnRule).toHaveCount(1);
    await expect(firstColumnRule).toBeVisible();

    // The divider must NOT leak into the second column.
    await expect(columns.nth(1).locator('[data-blok-divider]')).toHaveCount(0);

    // The sibling paragraph in the second column survived the layout.
    await expect(page.getByText('Right column.')).toBeVisible();
  });

  test('@smoke saves the nested tree intact', async ({ page }) => {
    await createBlok(page, dividerInColumnFixture);

    const saved = await saveBlok(page);

    // column_list + exactly two columns present.
    const columnList = findBlock(saved, 'cl1');
    expect(columnList?.type).toBe('column_list');
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(2);

    // The divider block survives, parented to the first column.
    const divider = findBlock(saved, 'divider1');
    expect(divider).toBeDefined();
    expect(divider?.type).toBe('divider');
    expect(divider?.parent).toBe('c1');

    // The divider's data round-trips as an empty object (it has no content).
    expect(divider?.data).toEqual({});

    // The first column lists the divider as its only child; the second holds the paragraph.
    expect(childrenOf(saved, 'c1')).toEqual(['divider1']);
    expect(childrenOf(saved, 'c2')).toEqual(['c2-p']);

    // Both columns are parented to the column_list.
    expect(childrenOf(saved, 'cl1')).toEqual(['c1', 'c2']);

    // The sibling paragraph keeps its text.
    expect((findBlock(saved, 'c2-p')?.data as { text?: string }).text).toBe('Right column.');
  });

  test('survives a save -> reload -> save round-trip unchanged', async ({ page }) => {
    await createBlok(page, dividerInColumnFixture);

    const before = await saveBlok(page);
    const after = await reloadFromSave(page);

    // Compare the meaningful subset (id, type, parent, content, primary data) so a
    // re-render/serialization regression when nested in a column surfaces here.
    type Shape = {
      id: string | undefined;
      type: string;
      parent: string | undefined;
      content: string[];
      text: string | undefined;
    };

    const normalize = (data: OutputData): Shape[] =>
      data.blocks.map((block) => ({
        id: block.id,
        type: block.type,
        parent: block.parent,
        content: childrenOf(data, block.id ?? ''),
        text: (block.data as { text?: string }).text,
      }));

    expect(normalize(after)).toEqual(normalize(before));

    // Concretely: the divider stays parented to the first column after reload.
    expect(findBlock(after, 'divider1')?.parent).toBe('c1');
    expect(findBlock(after, 'divider1')?.type).toBe('divider');
    expect(after.blocks.filter((b) => b.type === 'column')).toHaveLength(2);

    // And the live DOM still renders exactly one <hr> inside the first column.
    const columns = page.locator('[data-blok-column]');
    await expect(columns).toHaveCount(2);
    await expect(columns.nth(0).locator('[data-blok-divider]')).toHaveCount(1);
  });

  test('edits to the block content persist through save', async ({ page }) => {
    await createBlok(page, dividerInColumnFixture);

    // The divider has no editable content, so the only text in the layout is the
    // sibling paragraph inside the second column. Editing it must persist while the
    // divider stays put in its own column.
    await editParagraphLikeText(page, 'Right column.', 'Edited right column.');

    const saved = await saveBlok(page);

    expect((findBlock(saved, 'c2-p')?.data as { text?: string }).text).toBe('Edited right column.');

    // The divider is untouched and still inside the first column.
    expect(findBlock(saved, 'divider1')?.parent).toBe('c1');
    expect(findBlock(saved, 'divider1')?.data).toEqual({});
    expect(findBlock(saved, 'c2-p')?.parent).toBe('c2');

    // Still exactly one divider rule, still in the first column.
    await expect(page.locator('[data-blok-column]').nth(0).locator('[data-blok-divider]')).toHaveCount(1);
  });

  test('removing the block collapses the emptied column and unwraps the layout', async ({ page }) => {
    await createBlok(page, dividerInColumnFixture);

    await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }
      const index = window.blokInstance.blocks.getBlockIndex('divider1');
      await window.blokInstance.blocks.delete(index);
    });

    // Deleting the sole child empties the column, which is removed; the list drops
    // to one column and unwraps. The unwrap is fire-and-forget async.
    await page.waitForFunction(
      () => window.blokInstance !== undefined && window.blokInstance.blocks.getBlockIndex('cl1') === undefined
    );

    const saved = await saveBlok(page);

    // The divider is gone.
    expect(findBlock(saved, 'divider1')).toBeUndefined();
    expect(saved.blocks.some((b) => b.type === 'divider')).toBe(false);
    expect(saved.blocks.filter((b) => b.type === 'column_list')).toHaveLength(0);
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(0);

    // The other column's paragraph is promoted to ROOT, content intact.
    const survivor = findBlock(saved, 'c2-p');
    expect(survivor?.parent ?? null).toBeNull();
    expect((survivor?.data as { text?: string }).text).toBe('Right column.');

    // No block references a non-existent parent (no orphans).
    const allIds = new Set(saved.blocks.map((b) => b.id));
    const orphans = saved.blocks.filter(
      (b) => b.parent !== undefined && b.parent !== null && !allIds.has(b.parent)
    );

    expect(orphans).toEqual([]);

    // The remaining paragraph is still visible in the live DOM.
    await expect(page.getByText('Right column.')).toBeVisible();
  });
});
