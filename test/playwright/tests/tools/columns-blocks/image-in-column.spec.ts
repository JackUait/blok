import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
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

/**
 * Two-column layout with an Image block in the first column and a paragraph in
 * the second. The image uses a real loadable url (the same host the passing
 * root image tests use) so the <img> actually loads and the block stays in the
 * "rendered" state rather than the empty-upload or error state. The plain
 * `serve` test host does NOT map public/ to root, so a /blok-logo.png path 404s.
 */
const imageInColumnData = (): OutputData => ({
  blocks: [
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['image1'] },
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
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['p1'] },
    { id: 'p1', type: 'paragraph', data: { text: 'Second column paragraph' }, parent: 'c2' },
  ],
});

interface ImageData {
  url?: string;
  caption?: string;
  alt?: string;
  width?: number;
  alignment?: string;
}

/**
 * Scope to the image tool inside the column-list. The image tool sets no
 * dedicated testid, so the stable hooks are its attribute selectors.
 */
const imageInColumns = (page: Page): ReturnType<Page['locator']> =>
  page.getByTestId('column-list').locator('[data-blok-tool="image"]');

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Image inside a column', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('renders inside the first column', async ({ page }) => {
    await createBlok(page, imageInColumnData());

    const columns = page.locator('[data-blok-column]');
    await expect(columns).toHaveCount(2);

    // The image tool is mounted inside the column-list, in the "rendered" state.
    const image = imageInColumns(page);
    await expect(image).toHaveCount(1);
    await expect(image).toHaveAttribute('data-state', 'rendered');

    // Its visible <img> loaded the same-origin asset with the expected alt text.
    const img = image.getByRole('img');
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute('src', /placehold\.co/);
    await expect(img).toHaveAttribute('alt', 'Blok logotype');

    // The caption content renders too.
    await expect(image.getByText('Blok logotype')).toBeVisible();

    // The image holder physically lives inside the first column (index 0).
    const columnIndex = await page.evaluate(() => {
      const columnHolders = Array.from(document.querySelectorAll('[data-blok-columns] > [data-blok-element]'));
      const imageTool = document.querySelector('[data-blok-tool="image"]');

      if (!(imageTool instanceof HTMLElement)) {
        return -1;
      }
      const ownColumn = imageTool.closest('[data-blok-column]')?.closest('[data-blok-element]');

      return ownColumn instanceof HTMLElement ? columnHolders.indexOf(ownColumn) : -1;
    });

    expect(columnIndex).toBe(0);
  });

  test('@smoke saves the nested tree intact', async ({ page }) => {
    await createBlok(page, imageInColumnData());

    const saved = await saveBlok(page);

    // The column_list and both columns survive the save.
    expect(findBlock(saved, 'cl1')?.type).toBe('column_list');
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(2);
    expect(childrenOf(saved, 'cl1')).toEqual(['c1', 'c2']);

    // The image is a leaf parented to the first column.
    const image = findBlock(saved, 'image1');
    expect(image?.type).toBe('image');
    expect(image?.parent).toBe('c1');
    expect(childrenOf(saved, 'c1')).toEqual(['image1']);

    // The second column keeps its paragraph.
    expect(findBlock(saved, 'p1')?.parent).toBe('c2');
    expect(childrenOf(saved, 'c2')).toEqual(['p1']);

    // The image's key data round-trips. Allow extra keys (e.g. cached natural
    // dimensions written on img load) by asserting only the meaningful fields.
    const data = image?.data as ImageData;
    expect(data.url).toBe('https://placehold.co/600x400.png');
    expect(data.caption).toBe('Blok logotype');
    expect(data.alt).toBe('Blok logotype');
    expect(data.width).toBe(40);
    expect(data.alignment).toBe('center');
  });

  test('survives a save -> reload -> save round-trip unchanged', async ({ page }) => {
    await createBlok(page, imageInColumnData());

    const before = await saveBlok(page);
    const after = await reloadFromSave(page);

    // Compare the meaningful subset: same ids, types, parent links, and column
    // membership. Volatile/derived keys are not part of the comparison.
    const skeleton = (data: OutputData): Array<{
      id: string | undefined;
      type: string;
      parent: string | undefined;
      content: string[] | undefined;
    }> =>
      data.blocks.map((block) => ({
        id: block.id,
        type: block.type,
        parent: block.parent,
        content: (block as { content?: string[] }).content,
      }));

    expect(skeleton(after)).toEqual(skeleton(before));

    // The image's primary data fields are identical across the round-trip.
    const imageBefore = findBlock(before, 'image1')?.data as ImageData;
    const imageAfter = findBlock(after, 'image1')?.data as ImageData;

    expect(imageAfter.url).toBe(imageBefore.url);
    expect(imageAfter.caption).toBe(imageBefore.caption);
    expect(imageAfter.alt).toBe(imageBefore.alt);
    expect(imageAfter.width).toBe(imageBefore.width);
    expect(imageAfter.alignment).toBe(imageBefore.alignment);

    // And the image is still inside the first column after the reload.
    expect(findBlock(after, 'image1')?.parent).toBe('c1');
    expect(childrenOf(after, 'c1')).toEqual(['image1']);
  });

  test('edits to the block\'s content persist through save', async ({ page }) => {
    await createBlok(page, imageInColumnData());

    // The image's editable surface is its caption (a contenteditable div).
    // Commit happens on blur, so type then blur by clicking the second column.
    const caption = imageInColumns(page).locator('[contenteditable="true"]').first();

    await caption.click();

    const isMac = process.platform === 'darwin';
    const selectAll = isMac ? 'Meta+A' : 'Control+A';

    await page.keyboard.press(selectAll);
    await page.keyboard.type('Edited caption inside column');

    // Blur the caption to flush the change into block data.
    await page.getByText('Second column paragraph').click();

    const saved = await saveBlok(page);
    const image = findBlock(saved, 'image1');
    const data = image?.data as ImageData;

    expect(data.caption).toBe('Edited caption inside column');
    // Still inside the first column.
    expect(image?.parent).toBe('c1');
    expect(childrenOf(saved, 'c1')).toEqual(['image1']);
  });

  test('removing the block collapses the emptied column and unwraps the layout', async ({ page }) => {
    await createBlok(page, imageInColumnData());

    // Delete the image by its flat index.
    await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }
      const index = window.blokInstance.blocks.getBlockIndex('image1');
      await window.blokInstance.blocks.delete(index);
    });

    // Deleting the sole child empties the column, which is removed; the list drops
    // to one column and unwraps. The unwrap is fire-and-forget async.
    await page.waitForFunction(
      () => window.blokInstance !== undefined && window.blokInstance.blocks.getBlockIndex('cl1') === undefined
    );

    const saved = await saveBlok(page);

    // The image is gone.
    expect(findBlock(saved, 'image1')).toBeUndefined();
    expect(saved.blocks.some((b) => b.type === 'image')).toBe(false);
    expect(saved.blocks.filter((b) => b.type === 'column_list')).toHaveLength(0);
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(0);

    // The other column's paragraph is promoted to ROOT, content intact.
    expect(findBlock(saved, 'p1')?.parent ?? null).toBeNull();
    expect((findBlock(saved, 'p1')?.data as { text?: string }).text).toBe('Second column paragraph');

    // No orphaned children: every non-root block points at an existing parent.
    const allIds = new Set(saved.blocks.map((b) => b.id));
    const orphans = saved.blocks.filter(
      (block) => block.parent !== undefined && block.parent !== null && !allIds.has(block.parent)
    );

    expect(orphans).toEqual([]);
  });
});
