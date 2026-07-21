import type { Page, Locator } from '@playwright/test';
import type { OutputData } from '@/types';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';
import {
  ensureBlokBundleBuilt,
  createBlok,
  saveBlok,
  findBlock,
  childrenOf,
} from './_helpers';

const BLOK = '[data-blok-interface=blok]';
const SETTINGS_BUTTON = `${BLOK} [data-blok-testid="settings-toggler"]`;

const UNDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
// Yjs UndoManager coalesces edits within a ~500ms capture window. Pace past it so
// each user action becomes a distinct, independently-undoable operation.
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
 * Drag the block whose drag handle is `sourceHandle` onto the left/right edge of
 * `targetBlock` (its vertical mid-band) to trigger a column (side) drop. Copied
 * verbatim from container-drag-in-column.spec.ts so this spec is standalone.
 */
const performSideDrop = async (
  page: Page,
  sourceHandle: Locator,
  targetBlock: Locator,
  side: 'left' | 'right'
): Promise<void> => {
  const sourceBox = await sourceHandle.boundingBox();
  const targetBox = await targetBlock.locator('[data-blok-element-content]').first().boundingBox();

  if (!sourceBox || !targetBox) {
    throw new Error('missing bounding box for side drop');
  }

  const sourceX = sourceBox.x + sourceBox.width / 2;
  const sourceY = sourceBox.y + sourceBox.height / 2;
  const targetX = side === 'right' ? targetBox.x + targetBox.width - 4 : targetBox.x + 4;
  const targetY = targetBox.y + targetBox.height / 2;

  await page.mouse.move(sourceX, sourceY);
  await page.mouse.down();
  await page.mouse.move(targetX, targetY, { steps: 15 });

  await page.waitForFunction(
    () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') === 'true',
    { timeout: 2000 }
  );

  await page.mouse.up();

  await page.waitForFunction(
    () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') !== 'true',
    { timeout: 2000 }
  );

  // The drop motion (ghost settle) finishes before assertions run.
  await page.waitForFunction(
    () => document.querySelector('[data-blok-testid="drag-preview"]') === null,
    { timeout: 2000 }
  );
};

/**
 * For each given block id, report whether its holder is mounted inside any
 * [data-blok-column], and if so, which column index (document order). Keyed
 * STRICTLY by data-blok-id (never textContent — a container's textContent
 * aggregates its children and never matches). Copied verbatim from
 * container-drag-in-column.spec.ts.
 *
 * Return value per id: a 0-based column index, or -1 (in DOM but not in a
 * column), or -2 (not in the DOM at all).
 */
const domColumnIndexById = async (page: Page, ids: string[]): Promise<Record<string, number>> => {
  return await page.evaluate((blockIds: string[]) => {
    const columnHolders = Array.from(document.querySelectorAll('[data-blok-columns] > [data-blok-element]'));
    const out: Record<string, number> = {};

    for (const id of blockIds) {
      const holder = document.querySelector(`[data-blok-id="${id}"]`);

      if (!(holder instanceof HTMLElement)) {
        out[id] = -2; // not in DOM at all
        continue;
      }

      const ownColumn = holder.closest('[data-blok-column]')?.closest('[data-blok-element]') ?? null;
      out[id] = ownColumn instanceof HTMLElement ? columnHolders.indexOf(ownColumn) : -1;
    }

    return out;
  }, ids);
};

/**
 * Reveal a LEAF block's (header/paragraph) own drag handle by hovering its
 * wrapper and reading the single visible settings toggler.
 */
const grabLeafHandle = async (page: Page, blockId: string): Promise<Locator> => {
  const holder = page.locator(`[data-blok-id="${blockId}"]`).first();
  const box = await holder.boundingBox();

  if (!box) {
    throw new Error(`missing bounding box for leaf ${blockId}`);
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  const handle = page.locator(SETTINGS_BUTTON);
  await expect(handle).toBeVisible();

  return handle;
};

/**
 * Resolve a block's current flat index from its id.
 */
const flatIndexOf = async (page: Page, id: string): Promise<number> => {
  return await page.evaluate((blockId) => {
    const index = window.blokInstance?.blocks.getBlockIndex(blockId);

    if (index === undefined) {
      throw new Error(`Block ${blockId} not found`);
    }

    return index;
  }, id);
};

/**
 * Count leaf header blocks whose data.text === `text`. Counts LEAF blocks only —
 * container holders aggregate their children's text, so matching their
 * textContent would over-count. We read the saved model's leaf blocks instead.
 */
const countHeaderBlocksWithText = (saved: OutputData, text: string): number => {
  return saved.blocks.filter(
    (b) => b.type === 'header' && (b.data as { text?: string }).text === text
  ).length;
};

/**
 * The id of the single column_list block, plus its ordered column ids.
 */
const columnIdsOf = (saved: OutputData): string[] =>
  saved.blocks.filter((b) => b.type === 'column').map((b) => b.id ?? '');

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Duplicate / undo / redo after dropping a block into a column', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('Duplicating a header that was side-dropped into a column places the copy in the SAME column', async ({ page }) => {
    // Two root blocks: a paragraph (the side-drop target) and a header (the
    // block we drop into a new column, then duplicate). Header `data` is exactly
    // { text, level } — a plain header is not a container (header-in-column.spec.ts).
    await createBlok(page, {
      blocks: [
        { id: 'p1', type: 'paragraph', data: { text: 'Left para' } },
        { id: 'header1', type: 'header', data: { text: 'Dropped header', level: 3 } },
      ],
    });

    // No columns yet.
    await expect(page.locator('[data-blok-column]')).toHaveCount(0);

    // Side-drop the header onto the RIGHT edge of "Left para" -> [p1 | header1].
    const handle = await grabLeafHandle(page, 'header1');
    const target = page.getByTestId('block-wrapper').filter({ hasText: 'Left para' }).first();
    await performSideDrop(page, handle, target, 'right');

    await expect(page.locator('[data-blok-column]')).toHaveCount(2);

    const afterDrop = await saveBlok(page);

    // The header is now a child of a column (the SECOND column — the dropped slot).
    const dropColumns = columnIdsOf(afterDrop);
    expect(dropColumns).toHaveLength(2);
    const headerColumn = findBlock(afterDrop, 'header1')?.parent;
    expect(dropColumns).toContain(headerColumn);

    // LIVE DOM: the header sits inside a real column.
    const dropPlacement = await domColumnIndexById(page, ['header1']);
    expect(dropPlacement['header1']).toBeGreaterThanOrEqual(0);
    const headerColumnIndex = dropPlacement['header1'];

    // Duplicate the header — the operation a settings "duplicate" performs:
    // insert a block of the same tool with the same data at the flat slot
    // immediately after the source.
    const sourceIndex = await flatIndexOf(page, 'header1');

    await page.evaluate((idx) => {
      const blok = window.blokInstance;

      if (!blok) {
        throw new Error('Blok instance not found');
      }

      const source = blok.blocks.getBlockByIndex(idx);

      if (source === undefined) {
        throw new Error('Source block not found');
      }

      blok.blocks.insert(source.name, { text: 'Dropped header', level: 3 }, {}, idx + 1, false);
    }, sourceIndex);

    // Wait until exactly two leaf header blocks named "Dropped header" exist.
    await page.waitForFunction(() => {
      const blok = window.blokInstance;

      if (!blok) {
        return false;
      }

      const count = blok.blocks.getBlocksCount();
      let copies = 0;

      for (let i = 0; i < count; i += 1) {
        const block = blok.blocks.getBlockByIndex(i);

        // Only count LEAF header blocks; container holders aggregate child text.
        if (block?.name === 'header') {
          copies += 1;
        }
      }

      return copies === 2;
    });

    const afterDup = await saveBlok(page);

    // Exactly two headers now, and BOTH are parented to the SAME column as the
    // original — the copy is NOT orphaned at root.
    expect(countHeaderBlocksWithText(afterDup, 'Dropped header')).toBe(2);

    const headerColumnId = findBlock(afterDup, 'header1')?.parent;
    expect(headerColumnId).toBeDefined();

    const columnChildren = childrenOf(afterDup, headerColumnId ?? '');
    expect(columnChildren).toContain('header1');

    // The copy is the OTHER header (a new id) and shares the column.
    const copyId = afterDup.blocks
      .filter((b) => b.type === 'header' && b.id !== 'header1')
      .map((b) => b.id ?? '')[0];

    expect(copyId).toBeTruthy();
    expect(copyId).not.toBe('header1');
    expect(findBlock(afterDup, copyId)?.parent).toBe(headerColumnId);
    expect(columnChildren).toContain(copyId);

    // Still exactly two columns; the side-drop layout is intact.
    expect(columnIdsOf(afterDup)).toHaveLength(2);

    // LIVE DOM: the original and the copy both sit in the SAME column index.
    const dupPlacement = await domColumnIndexById(page, ['header1', copyId]);
    expect(dupPlacement['header1']).toBe(headerColumnIndex);
    expect(dupPlacement[copyId]).toBe(headerColumnIndex);
  });

  // Regression: undoing the column-creating drop tears down the column_list + its columns, and
  // their leaf holders used to be wiped from the DOM along with the doomed subtree — handleYjsRemove
  // promoted children in the model only (raw parentId = null), so blocksStore.remove ->
  // column.holder.remove() destroyed the still-nested survivors (model said "at root", DOM emptied).
  // Fixed by lifting each direct child's holder out of the parent's subtree (parent-first cascade
  // walks every survivor to the document root) before the parent holder is removed.
  test('Undo then redo of the drop + duplicate keeps column membership consistent at every step', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'p1', type: 'paragraph', data: { text: 'Left para' } },
        { id: 'header1', type: 'header', data: { text: 'Dropped header', level: 3 } },
      ],
    });

    await expect(page.locator('[data-blok-column]')).toHaveCount(0);

    // Side-drop the header into a new column. Pace past the Yjs capture window so
    // the drop becomes a distinct, independently-undoable history entry.
    const handle = await grabLeafHandle(page, 'header1');
    const target = page.getByTestId('block-wrapper').filter({ hasText: 'Left para' }).first();
    await performSideDrop(page, handle, target, 'right');
    await expect(page.locator('[data-blok-column]')).toHaveCount(2);
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    const afterDrop = await saveBlok(page);
    const headerColumnId = findBlock(afterDrop, 'header1')?.parent;

    expect(columnIdsOf(afterDrop)).toContain(headerColumnId);

    const dropPlacement = await domColumnIndexById(page, ['header1']);
    expect(dropPlacement['header1']).toBeGreaterThanOrEqual(0);
    const headerColumnIndex = dropPlacement['header1'];

    // Duplicate the header inside the column.
    const sourceIndex = await flatIndexOf(page, 'header1');

    await page.evaluate((idx) => {
      const blok = window.blokInstance;

      if (!blok) {
        throw new Error('Blok instance not found');
      }

      const source = blok.blocks.getBlockByIndex(idx);

      if (source === undefined) {
        throw new Error('Source block not found');
      }

      blok.blocks.insert(source.name, { text: 'Dropped header', level: 3 }, {}, idx + 1, false);
    }, sourceIndex);

    await page.waitForFunction(() => {
      const blok = window.blokInstance;

      if (!blok) {
        return false;
      }

      const count = blok.blocks.getBlocksCount();
      let copies = 0;

      for (let i = 0; i < count; i += 1) {
        if (blok.blocks.getBlockByIndex(i)?.name === 'header') {
          copies += 1;
        }
      }

      return copies === 2;
    });
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    const afterDup = await saveBlok(page);
    const copyId = afterDup.blocks
      .filter((b) => b.type === 'header' && b.id !== 'header1')
      .map((b) => b.id ?? '')[0];

    expect(copyId).toBeTruthy();

    // STATE A (drop + duplicate applied): both headers in the same column.
    {
      expect(countHeaderBlocksWithText(afterDup, 'Dropped header')).toBe(2);
      expect(findBlock(afterDup, 'header1')?.parent).toBe(headerColumnId);
      expect(findBlock(afterDup, copyId)?.parent).toBe(headerColumnId);

      const place = await domColumnIndexById(page, ['header1', copyId]);
      expect(place['header1']).toBe(headerColumnIndex);
      expect(place[copyId]).toBe(headerColumnIndex);
    }

    // UNDO the duplicate -> back to a single header still inside its column.
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 300);

    const afterUndoDup = await saveBlok(page);

    {
      // The copy is gone — not orphaned at root, not stranded anywhere.
      expect(countHeaderBlocksWithText(afterUndoDup, 'Dropped header')).toBe(1);
      expect(findBlock(afterUndoDup, copyId)).toBeUndefined();

      // The original header is STILL inside the column (undo did not eject it).
      const colNow = findBlock(afterUndoDup, 'header1')?.parent;
      expect(columnIdsOf(afterUndoDup)).toContain(colNow);

      const place = await domColumnIndexById(page, ['header1', copyId]);
      expect(place['header1']).toBeGreaterThanOrEqual(0);
      expect(place[copyId]).toBe(-2); // copy not in the DOM
    }

    // UNDO the drop -> the column_list unwraps and the header returns to root.
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 300);

    const afterUndoDrop = await saveBlok(page);

    {
      // Header is back at root: no parent, no surviving columns wrapping it.
      expect(findBlock(afterUndoDrop, 'header1')?.parent).toBeUndefined();

      const place = await domColumnIndexById(page, ['header1']);
      expect(place['header1']).toBe(-1); // in DOM, NOT inside any column

      // The original paragraph is also back at root.
      expect(findBlock(afterUndoDrop, 'p1')?.parent).toBeUndefined();
    }

    // REDO the drop -> the header re-enters a column.
    await page.keyboard.press(REDO_SHORTCUT);
    await waitForDelay(page, 300);

    const afterRedoDrop = await saveBlok(page);

    {
      const colAgain = findBlock(afterRedoDrop, 'header1')?.parent;
      expect(columnIdsOf(afterRedoDrop)).toContain(colAgain);

      const place = await domColumnIndexById(page, ['header1']);
      expect(place['header1']).toBeGreaterThanOrEqual(0);
    }

    // REDO the duplicate -> the copy reappears inside the SAME column as the original.
    await page.keyboard.press(REDO_SHORTCUT);
    await waitForDelay(page, 300);

    const afterRedoDup = await saveBlok(page);

    {
      expect(countHeaderBlocksWithText(afterRedoDup, 'Dropped header')).toBe(2);

      const colFinal = findBlock(afterRedoDup, 'header1')?.parent;
      expect(columnIdsOf(afterRedoDup)).toContain(colFinal);

      // The redone copy is parented to the SAME column as the original — not root.
      const copyAgainId = afterRedoDup.blocks
        .filter((b) => b.type === 'header' && b.id !== 'header1')
        .map((b) => b.id ?? '')[0];

      expect(copyAgainId).toBeTruthy();
      expect(findBlock(afterRedoDup, copyAgainId)?.parent).toBe(colFinal);

      const place = await domColumnIndexById(page, ['header1', copyAgainId]);
      expect(place['header1']).toBeGreaterThanOrEqual(0);
      expect(place[copyAgainId]).toBe(place['header1']);
    }
  });
});
