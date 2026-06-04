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
} from './_helpers';

const BLOK = '[data-blok-interface=blok]';
const CALLOUT = `${BLOK} [data-blok-component="callout"]`;
const CALLOUT_CHILD_EDITABLE = `${CALLOUT} [data-blok-toggle-children] [data-blok-component="paragraph"] [contenteditable]`;

/**
 * Minimal-but-realistic two-column layout where the FIRST column holds a callout
 * (with one child paragraph) and the SECOND column holds a plain paragraph. The
 * callout's rich text lives in its child block via the parent/content tree, not
 * in `data` — `data` only carries { emoji, textColor, backgroundColor }.
 */
const buildLayout = (): OutputData => ({
  blocks: [
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },

    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['callout1'] },
    {
      id: 'callout1',
      type: 'callout',
      data: { emoji: '💡', textColor: null, backgroundColor: null },
      parent: 'c1',
      content: ['callout1-child'],
    },
    { id: 'callout1-child', type: 'paragraph', data: { text: 'Note inside a column' }, parent: 'callout1' },

    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['p2'] },
    { id: 'p2', type: 'paragraph', data: { text: 'Right column' }, parent: 'c2' },
  ],
});

type TextData = { text?: string };
type CalloutData = { emoji?: string; textColor?: string | null; backgroundColor?: string | null };

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Callout inside a column', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('renders inside the first column', async ({ page }) => {
    await createBlok(page, buildLayout());

    await expect(page.getByTestId('column-list')).toBeVisible();

    const columns = page.locator('[data-blok-column]');
    await expect(columns).toHaveCount(2);

    // The callout block renders inside the FIRST column, not the second.
    const calloutInFirstColumn = columns.first().locator('[data-blok-component="callout"]');
    await expect(calloutInFirstColumn).toBeVisible();
    await expect(columns.nth(1).locator('[data-blok-component="callout"]')).toHaveCount(0);

    // Callout chrome + child content render correctly inside the column.
    await expect(page.getByTestId('callout-emoji-btn')).toHaveText('💡');
    await expect(page.locator(CALLOUT).getByText('Note inside a column')).toBeVisible();

    // The right column keeps its own paragraph.
    await expect(columns.nth(1).getByText('Right column')).toBeVisible();
  });

  test('@smoke saves the nested tree intact', async ({ page }) => {
    await createBlok(page, buildLayout());

    const saved = await saveBlok(page);

    // The column_list + its two columns survive.
    expect(findBlock(saved, 'cl1')?.type).toBe('column_list');
    expect(childrenOf(saved, 'cl1')).toEqual(['c1', 'c2']);

    const callout = findBlock(saved, 'callout1');
    expect(callout?.type).toBe('callout');
    // The callout is parented to the first column.
    expect(callout?.parent).toBe('c1');

    // Container children round-trip: the callout still owns its child paragraph
    // (correct parent + listed under the callout's content).
    expect(childrenOf(saved, 'callout1')).toEqual(['callout1-child']);
    expect(findBlock(saved, 'callout1-child')?.parent).toBe('callout1');

    // The callout's own data round-trips (key fields preserved).
    const data = callout?.data as CalloutData;
    expect(data.emoji).toBe('💡');

    // The callout's child paragraph keeps its text.
    expect((findBlock(saved, 'callout1-child')?.data as TextData).text).toBe('Note inside a column');

    // The neighbour column's paragraph is untouched.
    expect(findBlock(saved, 'p2')?.parent).toBe('c2');
    expect((findBlock(saved, 'p2')?.data as TextData).text).toBe('Right column');
  });

  test('survives a save -> reload -> save round-trip unchanged', async ({ page }) => {
    await createBlok(page, buildLayout());

    const before = await saveBlok(page);
    const after = await reloadFromSave(page);

    // Compare the meaningful subset (id, type, parent links) for every block, in
    // saved-array order — this catches re-render/serialization breakage that only
    // appears when the callout is nested inside a column.
    const skeleton = (data: OutputData): Array<{ id?: string; type: string; parent?: string }> =>
      data.blocks.map((block) => ({ id: block.id, type: block.type, parent: block.parent }));

    expect(skeleton(after)).toEqual(skeleton(before));

    // Column membership is identical after the round-trip.
    expect(childrenOf(after, 'cl1')).toEqual(childrenOf(before, 'cl1'));
    expect(childrenOf(after, 'c1')).toEqual(childrenOf(before, 'c1'));
    expect(childrenOf(after, 'c2')).toEqual(childrenOf(before, 'c2'));
    expect(childrenOf(after, 'callout1')).toEqual(childrenOf(before, 'callout1'));

    // The callout's primary data fields and its child's text survive unchanged.
    const beforeCallout = findBlock(before, 'callout1')?.data as CalloutData;
    const afterCallout = findBlock(after, 'callout1')?.data as CalloutData;
    expect(afterCallout.emoji).toBe(beforeCallout.emoji);

    expect((findBlock(after, 'callout1-child')?.data as TextData).text).toBe(
      (findBlock(before, 'callout1-child')?.data as TextData).text
    );
  });

  test('edits to the block\'s content persist through save', async ({ page }) => {
    await createBlok(page, buildLayout());

    // The callout itself has no contenteditable; edit its child paragraph (its
    // primary content) inside the column. Append rather than clear-and-backspace
    // to avoid the empty-callout backspace-unwrap delegation.
    const childEditable = page.locator(CALLOUT_CHILD_EDITABLE);
    await childEditable.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' edited');

    await expect(page.locator(CALLOUT).getByText('Note inside a column edited')).toBeVisible();

    const saved = await saveBlok(page);

    // The edit lands in the child paragraph's data.text, NOT in callout data.
    expect((findBlock(saved, 'callout1-child')?.data as TextData).text).toBe('Note inside a column edited');

    // The callout (and its child) is still inside the first column after editing.
    expect(findBlock(saved, 'callout1')?.parent).toBe('c1');
    expect(findBlock(saved, 'callout1-child')?.parent).toBe('callout1');
  });

  test('removing the block leaves the column_list intact with the remaining paragraph', async ({ page }) => {
    await createBlok(page, buildLayout());

    // Delete the callout by its flat index.
    await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }
      const idx = window.blokInstance.blocks.getBlockIndex('callout1');

      if (idx !== undefined) {
        await window.blokInstance.blocks.delete(idx);
      }
    });

    // Wait until the deletion is reflected in the flat block array.
    await page.waitForFunction(
      () => window.blokInstance !== undefined && window.blokInstance.blocks.getBlockIndex('callout1') === undefined
    );

    const saved = await saveBlok(page);

    // The callout block is gone.
    expect(findBlock(saved, 'callout1')).toBeUndefined();

    // The second column and its paragraph survive untouched.
    expect(findBlock(saved, 'c2')?.parent).toBe('cl1');
    expect(findBlock(saved, 'p2')?.parent).toBe('c2');
    expect((findBlock(saved, 'p2')?.data as TextData).text).toBe('Right column');

    // The column_list is still valid: it still owns both columns. (Removing a
    // column's child block does not unwrap the column — only removing a *column*
    // does — so c1 survives as a still-valid column.)
    expect(findBlock(saved, 'cl1')?.type).toBe('column_list');
    expect(childrenOf(saved, 'cl1')).toEqual(['c1', 'c2']);

    // The callout's child is PROMOTED to root (not cascade-deleted): it survives
    // with no parent rather than leaving an orphan still pointing at the callout.
    const promoted = findBlock(saved, 'callout1-child');
    expect(promoted).toBeDefined();
    expect(promoted?.parent).toBeUndefined();

    // No block remains orphaned under the deleted callout.
    expect(childrenOf(saved, 'callout1')).toEqual([]);
  });

  test('the block\'s own children stay correctly parented after a reload inside the column', async ({ page }) => {
    await createBlok(page, buildLayout());

    const after = await reloadFromSave(page);

    // Model: the inner child keeps its parent id (the callout), and the callout
    // keeps its column parent.
    expect(findBlock(after, 'callout1-child')?.parent).toBe('callout1');
    expect(findBlock(after, 'callout1')?.parent).toBe('c1');
    expect(childrenOf(after, 'callout1')).toEqual(['callout1-child']);

    // LIVE DOM: the inner child paragraph is mounted inside the callout's child
    // container, the callout is inside the first column — a fully nested chain
    // column[0] -> callout -> child, proving no DOM-vs-model divergence after the
    // re-render that the round-trip triggers.
    const nested = await page.evaluate(
      ({ blokSelector, childText, calloutText }: { blokSelector: string; childText: string; calloutText: string }) => {
        const editables = Array.from(document.querySelectorAll(`${blokSelector} [data-blok-component="paragraph"] [contenteditable]`));
        const childEditable = editables.find((el) => (el.textContent ?? '').includes(childText));

        if (!(childEditable instanceof HTMLElement)) {
          return { inChildContainer: false, inCallout: false, inFirstColumn: false };
        }

        const childContainer = childEditable.closest('[data-blok-toggle-children]');
        const callout = childEditable.closest('[data-blok-component="callout"]');
        const ownColumn = childEditable.closest('[data-blok-column]');
        const columns = Array.from(document.querySelectorAll('[data-blok-column]'));

        return {
          inChildContainer: childContainer !== null,
          inCallout: callout instanceof HTMLElement && (callout.textContent ?? '').includes(calloutText),
          inFirstColumn: ownColumn !== null && columns.indexOf(ownColumn) === 0,
        };
      },
      { blokSelector: BLOK, childText: 'Note inside a column', calloutText: 'Note inside a column' }
    );

    expect(nested.inChildContainer).toBe(true);
    expect(nested.inCallout).toBe(true);
    expect(nested.inFirstColumn).toBe(true);
  });
});
