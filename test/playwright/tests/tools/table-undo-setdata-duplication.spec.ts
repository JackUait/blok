/**
 * Regression: undo that reverts the table's own data (data.content grid)
 * triggers a full setData re-render. During that rebuild the table's existing
 * cell blocks are still mounted in the OLD (detached) grid's nested-blocks
 * containers, so mountBlocksInCell used to treat them as "owned by another
 * container" and created DUPLICATE blocks for every cell. The grid then
 * referenced the duplicates while the originals stayed parented to the table
 * but unreferenced by any cell — invisible in the editor, but emitted by the
 * Saver and rendered below the table as unremovable "ghost" paragraphs after
 * a save → re-render round trip (user report: Cmd+Z in a table, then save →
 * the table's text duplicated line-by-line under the table).
 *
 * Invariant locked here: after ANY undo/redo storm on a table,
 *   1. no new block ids exist that were not present initially (undo/redo may
 *      only remove or restore known blocks, never mint duplicates), and
 *   2. every saved child of the table is referenced by exactly one grid cell.
 */

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const HOLDER_ID = 'blok';
const UNDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
/** Yjs capture window is 500ms — pace presses so each is a distinct undo op. */
const PRESS_GAP_MS = 600;

type TableCell = { blocks?: string[] };

type SavedSummary = {
  ids: string[];
  tableId: string;
  childIds: string[];
  gridIds: string[];
  cellTexts: string[];
};

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page, data: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(async ({ holder, initialData }) => {
    const blok = new window.Blok({
      holder,
      data: initialData,
    } as ConstructorParameters<typeof window.Blok>[0]);

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initialData: data });
};

const summarizeSaved = async (page: Page): Promise<SavedSummary> => {
  const saved = await page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('Blok instance not found');
    }

    return await window.blokInstance.save();
  });

  const table = saved.blocks.find(block => block.type === 'table');

  expect(table, 'saved document should contain the table').toBeTruthy();

  const tableId = table?.id ?? '';
  const content = (table?.data as { content?: TableCell[][] })?.content ?? [];
  const gridIds = content.flatMap(row => row.flatMap(cell => cell.blocks ?? []));
  const children = saved.blocks.filter(
    block => (block as { parent?: string | null }).parent === tableId
  );

  return {
    ids: saved.blocks.map(block => block.id ?? ''),
    tableId,
    childIds: children.map(block => block.id ?? ''),
    gridIds,
    cellTexts: children.map(block => (block.data as { text?: string }).text ?? ''),
  };
};

type SavedAllSummary = {
  ids: string[];
  tableCount: number;
  /** Children of ANY table not referenced by that table's grid. */
  orphans: string[];
  /** Grid references of ANY table pointing at blocks missing from the output. */
  dangling: string[];
};

/** Like {@link summarizeSaved} but audits EVERY table in the document. */
const summarizeSavedAll = async (page: Page): Promise<SavedAllSummary> => {
  return await page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('Blok instance not found');
    }

    const saved = await window.blokInstance.save();
    const ids = saved.blocks.map(block => block.id ?? '');
    const idSet = new Set(ids);
    const tables = saved.blocks.filter(block => block.type === 'table');
    const orphans: string[] = [];
    const dangling: string[] = [];

    for (const table of tables) {
      const grid = (table.data as { content?: Array<Array<{ blocks?: string[] }>> })?.content ?? [];
      const refs = new Set(grid.flat().flatMap(cell => cell.blocks ?? []));

      orphans.push(...saved.blocks
        .filter(block => (block as { parent?: string | null }).parent === table.id && !refs.has(block.id ?? ''))
        .map(block => block.id ?? ''));
      dangling.push(...[...refs].filter(id => !idSet.has(id)));
    }

    return { ids, tableCount: tables.length, orphans, dangling };
  });
};

const waitForDelay = async (page: Page, delayMs: number): Promise<void> => {
  await page.evaluate(async (timeout) => {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, timeout);
    });
  }, delayMs);
};

const expectNoDuplicatesOrOrphans = (initial: SavedSummary, after: SavedSummary): void => {
  const initialIds = new Set(initial.ids);
  const mintedIds = after.ids.filter(id => !initialIds.has(id));

  expect(
    mintedIds,
    `undo/redo minted brand-new blocks (duplicates): ${JSON.stringify(mintedIds)}`
  ).toStrictEqual([]);

  const gridIdSet = new Set(after.gridIds);
  const orphanChildren = after.childIds.filter(id => !gridIdSet.has(id));

  expect(
    orphanChildren,
    `table children not referenced by any cell (ghost paragraphs after save): ${JSON.stringify(orphanChildren)}`
  ).toStrictEqual([]);

  const savedIdSet = new Set(after.ids);
  const danglingGridRefs = after.gridIds.filter(id => !savedIdSet.has(id));

  expect(
    danglingGridRefs,
    `grid references blocks missing from the saved document: ${JSON.stringify(danglingGridRefs)}`
  ).toStrictEqual([]);
};

test.describe('Table undo setData duplication', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await createBlok(page, {
      blocks: [
        { type: 'paragraph', data: { text: 'BEFORE' } },
        {
          type: 'table',
          data: { withHeadings: false, content: [['Alpha', 'Beta'], ['Gamma', 'Delta']] },
        },
        { type: 'paragraph', data: { text: 'AFTER' } },
      ],
    });
    await waitForDelay(page, 400);
  });

  test.setTimeout(60000);

  test('undoing a cell split does not duplicate cell blocks or strand orphans', async ({ page }) => {
    const initial = await summarizeSaved(page);

    expect(initial.childIds).toHaveLength(4);

    const firstCellEditable = page
      .locator('[data-blok-table-cell-row="0"][data-blok-table-cell-col="0"] [contenteditable="true"]')
      .first();

    await firstCellEditable.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('second line');
    await waitForDelay(page, PRESS_GAP_MS);

    // First undo reverts the typed text; second reverts the cell split, which
    // rewinds the table's data.content and triggers the setData re-render.
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, PRESS_GAP_MS);
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, PRESS_GAP_MS);

    const afterUndo = await summarizeSaved(page);

    expectNoDuplicatesOrOrphans(initial, afterUndo);
    expect([...afterUndo.cellTexts].sort()).toStrictEqual(['Alpha', 'Beta', 'Delta', 'Gamma']);

    // The table must still be editable and consistent after a redo leg too.
    await page.keyboard.press(REDO_SHORTCUT);
    await waitForDelay(page, PRESS_GAP_MS);
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, PRESS_GAP_MS);

    const afterRedoUndo = await summarizeSaved(page);

    expectNoDuplicatesOrOrphans(initial, afterRedoUndo);
  });

  test('read-only toggle round trip does not duplicate cell blocks or strand orphans', async ({ page }) => {
    const initial = await summarizeSaved(page);

    // The read-only round trip rebuilds the table view — the same rebuild
    // class as the undo setData path, so it must obey the same invariant.
    await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }
      await window.blokInstance.readOnly.toggle(true);
      await window.blokInstance.readOnly.toggle(false);
    });
    await waitForDelay(page, 400);

    const after = await summarizeSaved(page);

    expectNoDuplicatesOrOrphans(initial, after);
    expect([...after.cellTexts].sort()).toStrictEqual(['Alpha', 'Beta', 'Delta', 'Gamma']);
  });

  test('undoing past a table INSERT and redoing it back never mints duplicates or orphans', async ({ page }) => {
    // The redo leg re-creates a table AND its cell children from Yjs in one
    // replay batch — historically the orphan-prone direction (initializeCells
    // runs while sibling block-adds are still landing). Insert a SECOND table
    // as a captured user op so undo actually crosses table creation.
    await page.evaluate(() => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }
      window.blokInstance.blocks.insert(
        'table',
        { withHeadings: false, content: [['One', 'Two']] },
        {},
        window.blokInstance.blocks.getBlocksCount(),
        true
      );
    });
    await waitForDelay(page, PRESS_GAP_MS);

    const withSecondTable = await summarizeSavedAll(page);

    expect(withSecondTable.tableCount).toBe(2);
    expect(withSecondTable.orphans, 'orphan children right after table insert').toStrictEqual([]);
    expect(withSecondTable.dangling, 'dangling grid refs right after table insert').toStrictEqual([]);

    // Drive undo/redo through the history API — the keyboard shortcut depends
    // on focus, which an evaluate-driven insert leaves in an unreliable state.
    const historyUndo = async (): Promise<void> => {
      await page.evaluate(() => window.blokInstance?.history.undo());
    };
    const historyRedo = async (): Promise<void> => {
      await page.evaluate(() => window.blokInstance?.history.redo());
    };

    // Undo removes the inserted table and its cell children entirely.
    await historyUndo();
    await waitForDelay(page, PRESS_GAP_MS);

    const afterUndo = await summarizeSavedAll(page);
    const withSecondIds = new Set(withSecondTable.ids);

    expect(afterUndo.ids.filter(id => !withSecondIds.has(id))).toStrictEqual([]);
    expect(afterUndo.orphans).toStrictEqual([]);
    expect(afterUndo.dangling).toStrictEqual([]);
    expect(afterUndo.tableCount).toBe(1);

    // Redo re-creates the table and every cell child with their ORIGINAL ids.
    await historyRedo();
    await waitForDelay(page, PRESS_GAP_MS);

    const afterRedo = await summarizeSavedAll(page);

    expect(
      afterRedo.ids.filter(id => !withSecondIds.has(id)),
      'redo of a table insert minted brand-new blocks'
    ).toStrictEqual([]);
    expect(afterRedo.orphans, 'orphan children after redo of table insert').toStrictEqual([]);
    expect(afterRedo.dangling, 'dangling grid refs after redo of table insert').toStrictEqual([]);
    expect(afterRedo.tableCount).toBe(2);
  });

  test('undo/redo storm on a structural row insert keeps children == grid references', async ({ page }) => {
    const initial = await summarizeSaved(page);

    // Append a new row via the proximity add-row control — a structural
    // table-data write that a single Cmd+Z then rewinds.
    const table = page.locator('[data-blok-tool="table"]').first();
    const tableBox = await table.boundingBox();

    expect(tableBox).toBeTruthy();

    if (tableBox === null) {
      return;
    }

    await page.mouse.move(tableBox.x + tableBox.width / 2, tableBox.y + tableBox.height - 5);

    const addRowBtn = page.locator('[data-blok-table-add-row]');

    await expect(addRowBtn).toBeVisible();
    await addRowBtn.dispatchEvent('pointerdown');
    await waitForDelay(page, PRESS_GAP_MS);

    // Put the caret back into a cell so the undo shortcut targets the editor.
    await page
      .locator('[data-blok-table-cell-row="0"][data-blok-table-cell-col="0"] [contenteditable="true"]')
      .first()
      .click();
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, PRESS_GAP_MS);

    const afterUndo = await summarizeSaved(page);

    expectNoDuplicatesOrOrphans(initial, afterUndo);
    expect([...afterUndo.cellTexts].sort()).toStrictEqual(['Alpha', 'Beta', 'Delta', 'Gamma']);
  });
});
