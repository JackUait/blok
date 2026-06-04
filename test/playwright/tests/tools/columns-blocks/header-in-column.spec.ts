import { expect, test } from '@playwright/test';
import type { OutputData } from '@/types';
import {
  childrenOf,
  createBlok,
  ensureBlokBundleBuilt,
  findBlock,
  reloadFromSave,
  saveBlok,
  TEST_PAGE_URL,
} from './_helpers';

/**
 * Fixture: a 2-column layout whose first column holds a single plain (non-toggle)
 * Header block, and whose second column holds a paragraph. Mirrors the demo
 * `header`-in-`column` preset (index.html:2079-2086).
 *
 * The header `data` is exactly `{ text, level }` — a plain header is NOT a
 * container, so it carries no `content` and no child blocks.
 */
const headerInColumnFixture = (): OutputData => ({
  blocks: [
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, content: ['header1'], parent: 'cl1' },
    { id: 'header1', type: 'header', data: { text: 'Features', level: 3 }, parent: 'c1' },
    { id: 'c2', type: 'column', data: {}, content: ['c2-p'], parent: 'cl1' },
    { id: 'c2-p', type: 'paragraph', data: { text: 'Second column.' }, parent: 'c2' },
  ],
});

type HeaderData = { text?: string; level?: number };

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Header inside a column', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('renders inside the first column', async ({ page }) => {
    await createBlok(page, headerInColumnFixture());

    // Two columns are laid out.
    const columns = page.locator('[data-blok-column]');
    await expect(columns).toHaveCount(2);

    // The header renders as a real heading with its text, and it lives INSIDE a column.
    const heading = page.getByRole('heading', { name: 'Features' });
    await expect(heading).toBeVisible();

    const headerInColumn = page.locator('[data-blok-column] [data-blok-tool="header"]');
    await expect(headerInColumn).toHaveCount(1);
    await expect(headerInColumn).toContainText('Features');

    // The header is rendered at the correct heading level (h3).
    const tagName = await headerInColumn.evaluate(el => el.tagName);
    expect(tagName).toBe('H3');

    // The header is mounted within the FIRST column (index 0), beside nothing else;
    // the paragraph lives in the second column.
    const headerColumnIndex = await page.evaluate(() => {
      const columnHolders = Array.from(document.querySelectorAll('[data-blok-columns] > [data-blok-element]'));
      const header = document.querySelector('[data-blok-tool="header"]');
      const ownColumn = header?.closest('[data-blok-column]')?.closest('[data-blok-element]');

      if (!(ownColumn instanceof HTMLElement)) {
        return -1;
      }

      return columnHolders.indexOf(ownColumn);
    });
    expect(headerColumnIndex).toBe(0);

    await expect(page.getByText('Second column.')).toBeVisible();
  });

  test('@smoke saves the nested tree intact', async ({ page }) => {
    await createBlok(page, headerInColumnFixture());

    const saved = await saveBlok(page);

    // The column_list wrapper survives with its two columns.
    const list = findBlock(saved, 'cl1');
    expect(list?.type).toBe('column_list');
    expect(saved.blocks.filter(b => b.type === 'column')).toHaveLength(2);
    expect(childrenOf(saved, 'cl1')).toEqual(['c1', 'c2']);

    // The header is parented to the first column.
    const header = findBlock(saved, 'header1');
    expect(header?.type).toBe('header');
    expect(header?.parent).toBe('c1');
    expect(childrenOf(saved, 'c1')).toEqual(['header1']);

    // A plain header is not a container — it must round-trip with NO content/children.
    expect(header?.content).toBeUndefined();
    expect(childrenOf(saved, 'header1')).toEqual([]);

    // The header's primary data fields round-trip exactly.
    const headerData = header?.data as HeaderData;
    expect(headerData.text).toBe('Features');
    expect(headerData.level).toBe(3);

    // The second column keeps its paragraph.
    expect(childrenOf(saved, 'c2')).toEqual(['c2-p']);
    expect((findBlock(saved, 'c2-p')?.data as { text?: string }).text).toBe('Second column.');
  });

  test('survives a save -> reload -> save round-trip unchanged', async ({ page }) => {
    await createBlok(page, headerInColumnFixture());

    const before = await saveBlok(page);
    const after = await reloadFromSave(page);

    // Compare only the meaningful, non-volatile subset: id, type, parent, content,
    // and each block's primary data field(s). This catches re-render/serialization
    // breakage that only surfaces when the block is nested in a column.
    const normalize = (data: OutputData): unknown =>
      data.blocks.map((block) => {
        const raw = (block.data ?? {}) as Record<string, unknown>;
        const data_: Record<string, unknown> = {};

        if (block.type === 'header') {
          data_.text = raw.text;
          data_.level = raw.level;
        } else if (block.type === 'paragraph') {
          data_.text = raw.text;
        } else if (block.type === 'column' && raw.widthRatio !== undefined) {
          data_.widthRatio = raw.widthRatio;
        }

        return {
          id: block.id,
          type: block.type,
          parent: block.parent ?? null,
          content: block.content ?? null,
          data: data_,
        };
      });

    expect(normalize(after)).toEqual(normalize(before));

    // Sanity: the header is still present, typed, parented to c1, and at level 3.
    const header = findBlock(after, 'header1');
    expect(header?.type).toBe('header');
    expect(header?.parent).toBe('c1');
    expect((header?.data as HeaderData).level).toBe(3);
  });

  test('edits to the block\'s content persist through save', async ({ page }) => {
    await createBlok(page, headerInColumnFixture());

    // The <h3> element is itself the editable surface. Select all, then retype.
    const heading = page.locator('[data-blok-tool="header"]');

    await heading.click();

    const isMac = process.platform === 'darwin';

    await page.keyboard.press(isMac ? 'Meta+A' : 'Control+A');
    await page.keyboard.type('Roadmap');

    // The edited text is visible in the DOM before we trust the save.
    await expect(page.getByRole('heading', { name: 'Roadmap' })).toBeVisible();

    const saved = await saveBlok(page);
    const header = findBlock(saved, 'header1');

    // The edited value persists, and the header is still inside the first column.
    expect((header?.data as HeaderData).text).toBe('Roadmap');
    expect((header?.data as HeaderData).level).toBe(3);
    expect(header?.parent).toBe('c1');
  });

  test('removing the block leaves the column_list intact with the remaining paragraph', async ({ page }) => {
    await createBlok(page, headerInColumnFixture());

    // Delete the header by its flat index.
    await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }
      const index = window.blokInstance.blocks.getBlockIndex('header1');

      await window.blokInstance.blocks.delete(index);
    });

    // The delete + column re-seed is async; wait until the header is gone from the
    // flat block array.
    await page.waitForFunction(
      () => window.blokInstance !== undefined &&
        window.blokInstance.blocks.getBlockIndex('header1') === undefined
    );

    const saved = await saveBlok(page);

    // The header block is gone.
    expect(findBlock(saved, 'header1')).toBeUndefined();

    // Both columns survive, so the column_list stays — deleting the sole child of a
    // column does not unwrap the layout.
    expect(findBlock(saved, 'cl1')?.type).toBe('column_list');
    expect(findBlock(saved, 'c1')?.parent).toBe('cl1');
    const columnOrder = saved.blocks.filter(b => b.type === 'column').map(b => b.id);

    expect(columnOrder).toEqual(['c1', 'c2']);

    // The second column's paragraph survives untouched.
    expect(findBlock(saved, 'c2-p')?.parent).toBe('c2');
    expect((findBlock(saved, 'c2-p')?.data as { text?: string }).text).toBe('Second column.');

    // The now-empty first column does not re-seed or unwrap: it may be left
    // child-less, or hold a single empty paragraph. Either way it gains no stray
    // children beyond that single optional seed, and every survivor under it must be
    // an empty paragraph still parented to c1.
    const c1Children = childrenOf(saved, 'c1');

    expect(c1Children.length).toBeLessThanOrEqual(1);

    const c1Survivors = c1Children.map((childId) => {
      const seeded = findBlock(saved, childId);

      return {
        type: seeded?.type,
        text: (seeded?.data as { text?: string }).text ?? '',
      };
    });
    const expectedSurvivors = c1Children.map(() => ({ type: 'paragraph', text: '' }));

    expect(c1Survivors).toEqual(expectedSurvivors);

    // No orphaned blocks: every non-root block points at a parent that still exists.
    const allIds = new Set(saved.blocks.map(b => b.id));
    const orphans = saved.blocks.filter(b => b.parent !== undefined && !allIds.has(b.parent));

    expect(orphans).toEqual([]);
  });
});
