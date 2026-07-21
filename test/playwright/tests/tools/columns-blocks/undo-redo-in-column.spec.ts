import type { Page } from '@playwright/test';
import type { OutputData } from '@/types';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';
import {
  ensureBlokBundleBuilt,
  createBlok,
  saveBlok,
} from './_helpers';

/**
 * Undo/redo of edits, inserts, and deletes performed INSIDE a column.
 *
 * The exhaustive block-in-column suite (commit eace7b0b) only loads pre-built
 * fixtures; it never exercises live history operations while a block is nested
 * inside a column. History snapshots, caret restore, and the index-based
 * inverse-op replay are all container-sensitive: an undo can re-render the
 * block and lose its column parentId, leave a half-removed block, or restore a
 * deleted block at root / in the wrong column. These tests assert the block
 * stays correctly parented to the SAME column across the full undo/redo cycle.
 */

const UNDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
// Yjs UndoManager coalesces edits within a 500ms capture window. Pace past it
// so each user action becomes a distinct, independently-undoable operation.
const YJS_CAPTURE_TIMEOUT = 600;

const waitForDelay = async (page: Page, delayMs: number): Promise<void> => {
  await page.evaluate(
    async (timeout) => {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, timeout);
      });
    },
    delayMs
  );
};

/**
 * Live parentId of a block, read from the running BlockManager (not the saved
 * model). Proves real placement, dodging model-vs-DOM divergence.
 */
const liveParentId = async (page: Page, id: string): Promise<string | null | undefined> => {
  return await page.evaluate((blockId) => {
    const instance = window.blokInstance;

    if (!instance) {
      throw new Error('Blok instance not found');
    }

    const blocksApi = (instance as unknown as {
      blocks: { getById?: (id: string) => { parentId: string | null } | null };
    }).blocks;

    return blocksApi.getById?.(blockId)?.parentId ?? null;
  }, id);
};

/**
 * Saved parentId, plus the ordered list of column ids and each column's content
 * ordering — the structural snapshot the assertions compare against.
 */
const structure = (saved: OutputData): {
  columnIds: string[];
  columnListIds: string[];
  parentOf: (id: string) => string | undefined;
  contentOf: (id: string) => string[];
} => {
  const columnIds = saved.blocks.filter((b) => b.type === 'column').map((b) => b.id ?? '');
  const columnListIds = saved.blocks.filter((b) => b.type === 'column_list').map((b) => b.id ?? '');

  return {
    columnIds,
    columnListIds,
    parentOf: (id) =>
      (saved.blocks.find((b) => b.id === id) as { parent?: string } | undefined)?.parent,
    contentOf: (id) =>
      ((saved.blocks.find((b) => b.id === id) as { content?: string[] } | undefined)?.content) ?? [],
  };
};

/**
 * 2-column layout: c1 holds two paragraphs (p1a, p1b), c2 holds one (p2).
 */
const buildTree = (): OutputData => ({
  blocks: [
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['p1a', 'p1b'] },
    { id: 'p1a', type: 'paragraph', data: { text: 'Left top' }, parent: 'c1' },
    { id: 'p1b', type: 'paragraph', data: { text: 'Left bottom' }, parent: 'c1' },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['p2'] },
    { id: 'p2', type: 'paragraph', data: { text: 'Right only' }, parent: 'c2' },
  ],
});

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Undo/redo inside a column', () => {
  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('Undo of a text edit inside a column restores the prior text without re-parenting', async ({ page }) => {
    await createBlok(page, buildTree());

    const editable = page.locator('[data-blok-id="p1a"] [contenteditable="true"]').first();

    await editable.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' EDITED');
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    await expect(editable).toHaveText('Left top EDITED');
    // Sanity: the block is still parented to its column before any undo.
    expect(await liveParentId(page, 'p1a')).toBe('c1');

    // Undo restores the original text...
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 200);

    await expect(editable).toHaveText('Left top');

    // ...and the block stays parented to the SAME column (no root promotion,
    // no re-parent into the other column from a caret-restore re-render).
    expect(await liveParentId(page, 'p1a')).toBe('c1');

    const savedAfterUndo = await saveBlok(page);
    const sUndo = structure(savedAfterUndo);

    expect(sUndo.parentOf('p1a')).toBe('c1');
    expect(sUndo.columnIds).toEqual(['c1', 'c2']);
    expect(sUndo.contentOf('c1')).toEqual(['p1a', 'p1b']);

    // Redo reapplies the edit, still inside the same column.
    await page.keyboard.press(REDO_SHORTCUT);
    await waitForDelay(page, 200);

    await expect(editable).toHaveText('Left top EDITED');
    expect(await liveParentId(page, 'p1a')).toBe('c1');
  });

  test('Undo of inserting a block inside a column removes the inserted block and keeps the column intact', async ({ page }) => {
    await createBlok(page, buildTree());

    // Insert a new paragraph inside column c1 by pressing Enter at the end of
    // p1a, then typing — the canonical user gesture for "add a block here". The
    // new block must be born inside c1 (between p1a and p1b).
    const editable = page.locator('[data-blok-id="p1a"] [contenteditable="true"]').first();

    await editable.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    // Pace past the Yjs capture window so the block creation (Enter) and the
    // text edit (typing) become two distinct, independently-undoable entries.
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);
    await page.keyboard.type('Inserted in column');
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    const savedAfterInsert = await saveBlok(page);
    const sIns = structure(savedAfterInsert);
    const inserted = savedAfterInsert.blocks.find(
      (b) => (b.data as { text?: string })?.text === 'Inserted in column'
    );

    expect(inserted).toBeDefined();
    const insertedId = inserted?.id ?? '';

    // Precondition: the inserted block lives inside the SAME column as p1a.
    expect(sIns.parentOf(insertedId)).toBe('c1');
    expect(sIns.columnIds).toEqual(['c1', 'c2']);

    // The Enter (block creation) and the typing (text edit) are two distinct
    // undo entries, so undo TWICE: the first reverts the text, the second
    // removes the inserted block. The column scaffolding survives both.
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 200);
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 200);

    const savedAfterUndo = await saveBlok(page);
    const sUndo = structure(savedAfterUndo);

    // The inserted block is gone — no orphan left dangling at root or elsewhere.
    expect(savedAfterUndo.blocks.find((b) => b.id === insertedId)).toBeUndefined();
    // Both columns and the column_list are unchanged.
    expect(sUndo.columnListIds).toEqual(['cl1']);
    expect(sUndo.columnIds).toEqual(['c1', 'c2']);
    expect(sUndo.contentOf('c1')).toEqual(['p1a', 'p1b']);
    expect(sUndo.contentOf('c2')).toEqual(['p2']);
    // No block was orphaned to root.
    expect(savedAfterUndo.blocks.filter((b) => (b as { parent?: string }).parent === undefined)).toHaveLength(1);

    // Redo mirrors the two undos: the first redo re-creates the block, the
    // second re-applies its text. Both land back in the SAME column c1.
    await page.keyboard.press(REDO_SHORTCUT);
    await waitForDelay(page, 200);
    await page.keyboard.press(REDO_SHORTCUT);
    await waitForDelay(page, 200);

    const savedAfterRedo = await saveBlok(page);
    const sRedo = structure(savedAfterRedo);
    const reInserted = savedAfterRedo.blocks.find(
      (b) => (b.data as { text?: string })?.text === 'Inserted in column'
    );

    expect(reInserted).toBeDefined();
    expect(sRedo.parentOf(reInserted?.id ?? '')).toBe('c1');
    expect(sRedo.columnIds).toEqual(['c1', 'c2']);
  });

  test('Undo of deleting a block inside a column restores it back into the SAME column position', async ({ page }) => {
    await createBlok(page, buildTree());

    // Delete p1b (the second block in column c1) via the index-based API, the
    // same path the column tests use for deletions.
    await page.evaluate(async () => {
      const instance = window.blokInstance;

      if (!instance) {
        throw new Error('Blok instance not found');
      }

      const index = instance.blocks.getBlockIndex('p1b');

      await instance.blocks.delete(index);
    });
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    const savedAfterDelete = await saveBlok(page);

    // Precondition: p1b is gone, c1 now holds only p1a, the right column is untouched.
    expect(savedAfterDelete.blocks.find((b) => b.id === 'p1b')).toBeUndefined();
    expect(structure(savedAfterDelete).contentOf('c1')).toEqual(['p1a']);
    expect(structure(savedAfterDelete).contentOf('c2')).toEqual(['p2']);

    // Undo restores the deleted block back into its original column position.
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 200);

    const savedAfterUndo = await saveBlok(page);
    const sUndo = structure(savedAfterUndo);

    // The block reappears, parented to c1, at its original index (after p1a).
    expect(savedAfterUndo.blocks.find((b) => b.id === 'p1b')).toBeDefined();
    expect(sUndo.parentOf('p1b')).toBe('c1');
    expect(sUndo.contentOf('c1')).toEqual(['p1a', 'p1b']);
    // The right column is untouched throughout.
    expect(sUndo.contentOf('c2')).toEqual(['p2']);
    expect(sUndo.columnIds).toEqual(['c1', 'c2']);

    // Live model agrees: the restored block is genuinely a child of c1, not root.
    expect(await liveParentId(page, 'p1b')).toBe('c1');
    // Its text is restored too.
    await expect(page.locator('[data-blok-id="p1b"] [contenteditable="true"]').first()).toHaveText('Left bottom');
  });
});
