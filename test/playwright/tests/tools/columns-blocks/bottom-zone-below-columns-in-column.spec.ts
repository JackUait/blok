import { expect, test } from '@playwright/test';
import type { OutputData } from '@/types';
import {
  createBlok,
  ensureBlokBundleBuilt,
  findBlock,
  saveBlok,
  TEST_PAGE_URL,
} from './_helpers';

/**
 * Notion-parity: clicking the empty editor bottom zone BELOW a trailing column
 * layout must insert a new full-width block at page ROOT (after the column_list),
 * never a block nested inside one of the columns. This is the "get past the
 * columns" affordance a KB user needed. Locked here because the behavior is
 * emergent from `UI.bottomZoneClicked` -> `insertAtEnd({ forceTopLevel: true })`
 * plus `lastBlock` resolving to the top-level column_list.
 */
const trailingColumns = (): OutputData => ({
  blocks: [
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['c1p'] },
    { id: 'c1p', type: 'paragraph', data: { text: 'Left column' }, parent: 'c1' },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['c2p'] },
    { id: 'c2p', type: 'paragraph', data: { text: 'Right column' }, parent: 'c2' },
  ],
});

/** Ids of blocks that live at page root (no parent), in saved-array order. */
const rootIds = (saved: OutputData): string[] =>
  saved.blocks
    .filter((block) => block.parent === undefined || block.parent === null)
    .map((block) => block.id)
    .filter((id): id is string => id !== undefined);

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Clicking below a trailing column layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('adds a new full-width block at root, not inside a column', async ({ page }) => {
    await createBlok(page, trailingColumns());

    // Precondition: the column_list is the only root block.
    const before = await saveBlok(page);
    expect(rootIds(before)).toEqual(['cl1']);
    await expect(page.locator('[data-blok-columns]')).toHaveCount(1);

    // Click the empty area below the columns.
    await page.getByTestId('bottom-zone').click();

    const after = await saveBlok(page);

    // A second root block now exists, AFTER the column_list.
    const roots = rootIds(after);
    expect(roots).toHaveLength(2);
    expect(roots[0]).toBe('cl1');

    const newRootId = roots[1];
    const newRootBlock = findBlock(after, newRootId);

    // It is a full-width, top-level default (paragraph) block — parent-less.
    expect(newRootBlock?.type).toBe('paragraph');
    expect(newRootBlock?.parent ?? null).toBeNull();

    // The columns are untouched: still one column_list with its two columns.
    expect(after.blocks.filter((b) => b.type === 'column_list')).toHaveLength(1);
    expect(after.blocks.filter((b) => b.type === 'column')).toHaveLength(2);

    // Caret landed in a TOP-LEVEL block — not inside any column.
    const focusedInsideColumn = await page.evaluate(() => {
      const active = document.activeElement;

      if (!(active instanceof HTMLElement)) {
        return null;
      }

      return active.closest('[data-blok-columns]') !== null;
    });

    expect(focusedInsideColumn).toBe(false);
  });
});
