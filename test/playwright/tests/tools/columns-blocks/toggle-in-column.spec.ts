import type { Page } from '@playwright/test';
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

/**
 * The seed tree: a 2-column layout where the LEFT column (c1) holds a Toggle
 * block (toggle1), which itself contains a child paragraph (tc1). The RIGHT
 * column (c2) holds a plain paragraph (p2). Toggle is a container block that
 * uses the parent/content tree — its child is a real top-level block carrying
 * `parent: 'toggle1'`, and the toggle carries `content: ['tc1']`.
 */
const seedTree = (): OutputData => ({
  blocks: [
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['toggle1'] },
    {
      id: 'toggle1',
      type: 'toggle',
      data: { text: 'Toggle title', isOpen: true },
      parent: 'c1',
      content: ['tc1'],
    },
    { id: 'tc1', type: 'paragraph', data: { text: 'Inside the toggle' }, parent: 'toggle1' },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['p2'] },
    { id: 'p2', type: 'paragraph', data: { text: 'Right column' }, parent: 'c2' },
  ],
});

/**
 * Reports, for every block holder mounted inside a [data-blok-column] wrapper,
 * which enclosing column holder it lives in — keyed by the block's id
 * (data-blok-id). Keying by id (not textContent) is essential: a container
 * block's holder textContent is the concatenation of its title, body
 * placeholder, and child text, which would never match a single block's label.
 * Proves the LIVE DOM placement, not just the saved model.
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
      const id = holder.getAttribute('data-blok-id');

      if (id && columnIndex !== -1) {
        membership[id] = columnIndex;
      }
    });

    return membership;
  });
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Toggle inside a column', () => {
  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('renders inside the first column', async ({ page }) => {
    await createBlok(page, seedTree());

    // Two columns side by side.
    const columns = page.locator('[data-blok-column]');
    await expect(columns).toHaveCount(2);

    // The toggle's title and its child are both visible (isOpen: true).
    await expect(page.getByText('Toggle title')).toBeVisible();
    await expect(page.getByText('Inside the toggle')).toBeVisible();
    await expect(page.getByText('Right column')).toBeVisible();

    // The toggle tool wrapper rendered with its container semantics intact.
    const toggleWrapper = page.locator('[data-blok-tool="toggle"]');
    await expect(toggleWrapper).toHaveCount(1);
    await expect(toggleWrapper).toHaveAttribute('data-blok-toggle-open', 'true');
    await expect(page.locator('[data-blok-toggle-arrow]')).toHaveAttribute('aria-expanded', 'true');

    // The toggle sits in the FIRST column (index 0); the plain paragraph in the second.
    const membership = await domColumnMembership(page);
    expect(membership['toggle1']).toBe(0);
    expect(membership['tc1']).toBe(0);
    expect(membership['p2']).toBe(1);

    // The toggle's child must be mounted inside the toggle's own children
    // container, NOT stranded directly under the column container.
    const childInsideToggle = await page.evaluate(() => {
      // Find the child by its block id, NOT by text: the toggle holder's
      // textContent also contains "Inside the toggle" (it wraps the child), so a
      // text match would return the toggle holder, which is NOT inside the
      // children container.
      const child = document.querySelector('[data-blok-id="tc1"]');

      if (!(child instanceof HTMLElement)) {
        return false;
      }

      return child.closest('[data-blok-toggle-children]') !== null;
    });
    expect(childInsideToggle).toBe(true);
  });

  test('@smoke saves the nested tree intact', async ({ page }) => {
    await createBlok(page, seedTree());

    const saved = await saveBlok(page);

    // Column scaffold survives the save.
    expect(findBlock(saved, 'cl1')?.type).toBe('column_list');
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(2);
    expect(findBlock(saved, 'cl1')?.content).toEqual(['c1', 'c2']);

    // The toggle is parented to the first column and is its sole content.
    const toggle = findBlock(saved, 'toggle1');
    expect(toggle?.type).toBe('toggle');
    expect(toggle?.parent).toBe('c1');
    expect(childrenOf(saved, 'c1')).toEqual(['toggle1']);

    // The toggle's primary data fields round-trip.
    const toggleData = toggle?.data as { text?: string; isOpen?: boolean };
    expect(toggleData.text).toBe('Toggle title');
    expect(toggleData.isOpen).toBe(true);

    // The toggle's child is still parented to the toggle and listed under content.
    const child = findBlock(saved, 'tc1');
    expect(child?.parent).toBe('toggle1');
    expect((child?.data as { text?: string }).text).toBe('Inside the toggle');
    expect(toggle?.content).toEqual(['tc1']);
    expect(childrenOf(saved, 'toggle1')).toEqual(['tc1']);

    // The right column keeps its paragraph.
    expect(findBlock(saved, 'p2')?.parent).toBe('c2');
    expect((findBlock(saved, 'p2')?.data as { text?: string }).text).toBe('Right column');
  });

  test('survives a save -> reload -> save round-trip unchanged', async ({ page }) => {
    await createBlok(page, seedTree());

    const before = await saveBlok(page);
    const after = await reloadFromSave(page);

    // Compare only the meaningful subset (ids, types, parent links, content, and
    // the primary data fields) — not volatile fields.
    const project = (data: OutputData): Array<{
      id: string | undefined;
      type: string;
      parent: string | undefined;
      content: string[] | undefined;
      data: { text?: string; isOpen?: boolean };
    }> =>
      data.blocks.map((b) => {
        const blockData = b.data as { text?: string; isOpen?: boolean };

        return {
          id: b.id,
          type: b.type,
          parent: b.parent,
          content: b.content,
          data: { text: blockData.text, isOpen: blockData.isOpen },
        };
      });

    expect(project(after)).toEqual(project(before));

    // Column membership is identical after the round-trip.
    expect(findBlock(after, 'toggle1')?.parent).toBe('c1');
    expect(findBlock(after, 'tc1')?.parent).toBe('toggle1');
    expect(childrenOf(after, 'c1')).toEqual(['toggle1']);
    expect(childrenOf(after, 'toggle1')).toEqual(['tc1']);
    expect(childrenOf(after, 'c2')).toEqual(['p2']);
  });

  test('edits to the block\'s content persist through save', async ({ page }) => {
    await createBlok(page, seedTree());

    // The toggle title is a contenteditable div ([data-blok-toggle-content]).
    // fill() does not work on contenteditable; click to focus, select all, type.
    const title = page.locator('[data-blok-toggle-content]').first();
    await title.click();

    const isMac = process.platform === 'darwin';
    const selectAll = isMac ? 'Meta+A' : 'Control+A';

    await page.keyboard.press(selectAll);
    await page.keyboard.type('Edited toggle title');

    const saved = await saveBlok(page);

    const toggle = findBlock(saved, 'toggle1');
    expect((toggle?.data as { text?: string }).text).toBe('Edited toggle title');

    // The toggle is still inside the first column after editing.
    expect(toggle?.parent).toBe('c1');
    expect(childrenOf(saved, 'c1')).toEqual(['toggle1']);

    // The child is untouched and still parented to the toggle.
    expect(findBlock(saved, 'tc1')?.parent).toBe('toggle1');
    expect((findBlock(saved, 'tc1')?.data as { text?: string }).text).toBe('Inside the toggle');
  });

  test('removing the block collapses the emptied column and unwraps the layout', async ({ page }) => {
    await createBlok(page, seedTree());

    // Delete the toggle (the sole child of column c1) by its flat index. Deleting
    // a container promotes its children, so tc1 survives.
    await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }
      const index = window.blokInstance.blocks.getBlockIndex('toggle1');
      await window.blokInstance.blocks.delete(index);
    });

    // Deleting the sole child empties c1, so the column is removed; the list now
    // has a single column and unwraps. The unwrap is fire-and-forget async — wait
    // for the whole scaffold to dissolve before saving.
    await page.waitForFunction(
      () => window.blokInstance !== undefined && window.blokInstance.blocks.getBlockIndex('cl1') === undefined
    );

    const saved = await saveBlok(page);

    // The deleted toggle is gone and no column/column_list survives.
    expect(findBlock(saved, 'toggle1')).toBeUndefined();
    expect(saved.blocks.some((b) => b.type === 'toggle')).toBe(false);
    expect(saved.blocks.filter((b) => b.type === 'column_list')).toHaveLength(0);
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(0);

    // The toggle's child is promoted to ROOT (not cascade-deleted), content intact.
    const promoted = findBlock(saved, 'tc1');
    expect(promoted).toBeDefined();
    expect(promoted?.parent ?? null).toBeNull();
    expect((promoted?.data as { text?: string }).text).toBe('Inside the toggle');

    // The other column's paragraph is promoted to ROOT, content intact.
    expect(findBlock(saved, 'p2')?.parent ?? null).toBeNull();
    expect((findBlock(saved, 'p2')?.data as { text?: string }).text).toBe('Right column');

    // No orphaned blocks.
    const allIds = new Set(saved.blocks.map((b) => b.id));
    const orphans = saved.blocks.filter((b) => b.parent !== undefined && b.parent !== null && !allIds.has(b.parent));

    expect(orphans).toEqual([]);
  });

  test('the block\'s own children stay correctly parented after a reload inside the column', async ({ page }) => {
    await createBlok(page, seedTree());

    const after = await reloadFromSave(page);

    // Model: the inner child keeps its parent id (the toggle), which keeps its
    // parent id (the first column).
    expect(findBlock(after, 'tc1')?.parent).toBe('toggle1');
    expect(findBlock(after, 'toggle1')?.parent).toBe('c1');
    expect(findBlock(after, 'toggle1')?.content).toEqual(['tc1']);
    expect(childrenOf(after, 'toggle1')).toEqual(['tc1']);

    // DOM: the inner child is still inside the toggle's children container, the
    // toggle is still inside the first column (index 0).
    const membership = await domColumnMembership(page);
    expect(membership['toggle1']).toBe(0);
    expect(membership['tc1']).toBe(0);

    const childInsideToggle = await page.evaluate(() => {
      // Find the child by its block id, NOT by text (the toggle holder's
      // textContent also contains the child's text and would match first).
      const child = document.querySelector('[data-blok-id="tc1"]');

      if (!(child instanceof HTMLElement)) {
        return false;
      }
      const childrenContainer = child.closest('[data-blok-toggle-children]');

      if (childrenContainer === null) {
        return false;
      }

      // ...and that toggle children container lives inside the first column.
      return childrenContainer.closest('[data-blok-column]') !== null;
    });
    expect(childInsideToggle).toBe(true);
  });
});
