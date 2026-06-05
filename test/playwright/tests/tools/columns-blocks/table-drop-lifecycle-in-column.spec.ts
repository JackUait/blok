import { expect, test } from '@playwright/test';
import type { Page, Locator } from '@playwright/test';
import type { OutputData, OutputBlockData } from '@/types';
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

const BLOK = '[data-blok-interface=blok]';
const SETTINGS_BUTTON = `${BLOK} [data-blok-testid="settings-toggler"]`;

const TABLE_CHILD_IDS = ['tp-r0c0', 'tp-r0c1', 'tp-r1c0', 'tp-r1c1'];
const TABLE_CHILD_TEXT = ['Cell A1', 'Cell B1', 'Cell A2', 'Cell B2'];

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
};

/**
 * Reveal a container block's OWN drag handle. Hovering a child of the container
 * would surface the child's handle, so we hover the container holder by its
 * data-blok-id (the top edge of its own holder, clear of nested child content)
 * and then read the single visible settings toggler. Copied verbatim from
 * container-drag-in-column.spec.ts.
 */
const grabContainerHandle = async (page: Page, containerId: string): Promise<Locator> => {
  const holder = page.locator(`[data-blok-id="${containerId}"]`).first();
  const box = await holder.boundingBox();

  if (!box) {
    throw new Error(`missing bounding box for container ${containerId}`);
  }

  await page.mouse.move(box.x + box.width / 2, box.y + 2);

  const handle = page.locator(SETTINGS_BUTTON);
  await expect(handle).toBeVisible();

  return handle;
};

/**
 * For each given block id, report whether its holder is mounted inside any
 * [data-blok-column], and if so, which column index (document order). Proves the
 * LIVE DOM placement, not merely the saved model. Copied verbatim from
 * container-drag-in-column.spec.ts.
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
 * Two root blocks: a plain "Target" paragraph and a 2x2 table whose cells each
 * reference one child paragraph (tp-r0c0 … tp-r1c1). The table is a container —
 * its cell paragraphs are top-level blocks parented to the table, exactly like
 * callout/toggle/database. We drive a real side-drop of the table beside the
 * target paragraph to fold both into a column_list.
 */
const dropFixture = (): OutputData => ({
  blocks: [
    { id: 'target', type: 'paragraph', data: { text: 'Target' } },
    {
      id: 'table1',
      type: 'table',
      data: {
        withHeadings: false,
        withHeadingColumn: false,
        content: [
          [{ blocks: ['tp-r0c0'] }, { blocks: ['tp-r0c1'] }],
          [{ blocks: ['tp-r1c0'] }, { blocks: ['tp-r1c1'] }],
        ],
      },
      content: TABLE_CHILD_IDS,
    },
    { id: 'tp-r0c0', type: 'paragraph', data: { text: 'Cell A1' }, parent: 'table1' },
    { id: 'tp-r0c1', type: 'paragraph', data: { text: 'Cell B1' }, parent: 'table1' },
    { id: 'tp-r1c0', type: 'paragraph', data: { text: 'Cell A2' }, parent: 'table1' },
    { id: 'tp-r1c1', type: 'paragraph', data: { text: 'Cell B2' }, parent: 'table1' },
  ],
});

const textOf = (block: OutputBlockData | undefined): string | undefined =>
  (block?.data as { text?: string } | undefined)?.text;

const gridOf = (saved: OutputData): string[][][] | undefined =>
  (findBlock(saved, 'table1')?.data as { content?: Array<Array<{ blocks: string[] }>> } | undefined)?.content?.map(
    (row) => row.map((cell) => cell.blocks)
  );

/**
 * Side-drop the root table onto the RIGHT edge of the "Target" paragraph,
 * folding [target | table] into a fresh column_list, and return the column ids
 * in document order plus the column the table landed in.
 */
const sideDropTableBesideTarget = async (
  page: Page
): Promise<{ saved: OutputData; columnIds: string[]; tableColumnId: string | undefined }> => {
  await expect(page.locator('[data-blok-column]')).toHaveCount(0);

  const handle = await grabContainerHandle(page, 'table1');
  const target = page.getByTestId('block-wrapper').filter({ hasText: 'Target' }).first();
  await performSideDrop(page, handle, target, 'right');

  await expect(page.locator('[data-blok-column]')).toHaveCount(2);

  const saved = await saveBlok(page);
  const columnIds = saved.blocks
    .filter((b) => b.type === 'column')
    .map((b) => b.id)
    .filter((id): id is string => id !== undefined);
  const tableColumnId = findBlock(saved, 'table1')?.parent;

  return { saved, columnIds, tableColumnId };
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Table block: full live-drag lifecycle in a column', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(TEST_PAGE_URL);
  });

  test('DROP: side-dropping a root table beside a block wraps both into columns and the table keeps its cell subtree', async ({ page }) => {
    await createBlok(page, dropFixture());

    const { saved, columnIds, tableColumnId } = await sideDropTableBesideTarget(page);

    // A column_list with exactly two columns now exists.
    expect(saved.blocks.find((b) => b.type === 'column_list')).toBeDefined();
    expect(columnIds).toHaveLength(2);

    // MODEL: the table is parented to the SECOND column ([target | table]).
    expect(tableColumnId).toBe(columnIds[1]);

    // CRITICAL: the table carried its cell subtree along — every cell paragraph
    // still belongs to the table, in order, none stranded or orphaned.
    expect(childrenOf(saved, 'table1')).toEqual(TABLE_CHILD_IDS);
    for (const id of TABLE_CHILD_IDS) {
      expect(findBlock(saved, id)?.parent).toBe('table1');
    }
    expect(gridOf(saved)).toEqual([
      [['tp-r0c0'], ['tp-r0c1']],
      [['tp-r1c0'], ['tp-r1c1']],
    ]);

    // LIVE DOM: the table holder sits in column index 1, and so do its cells.
    const placement = await domColumnIndexById(page, ['table1', ...TABLE_CHILD_IDS]);
    expect(placement['table1']).toBe(1);
    for (const id of TABLE_CHILD_IDS) {
      expect(placement[id]).toBe(1);
    }

    // LIVE DOM: every cell paragraph is still mounted inside the table container.
    const cellsInsideTable = await page.evaluate((ids: string[]) => {
      return ids.every((id) => {
        const cell = document.querySelector(`[data-blok-id="${id}"]`);

        return cell instanceof HTMLElement && cell.closest('[data-blok-tool="table"]') !== null;
      });
    }, TABLE_CHILD_IDS);
    expect(cellsInsideTable).toBe(true);
  });

  test('SAVE: the saved model nests column_list -> column -> table -> cells after the drop', async ({ page }) => {
    await createBlok(page, dropFixture());

    const { saved, columnIds, tableColumnId } = await sideDropTableBesideTarget(page);

    // column_list owns exactly the two columns, in order.
    const listId = saved.blocks.find((b) => b.type === 'column_list')?.id;
    expect(listId).toBeDefined();
    expect(childrenOf(saved, listId as string)).toEqual(columnIds);

    // The target paragraph is in the first column, the table in the second.
    expect(findBlock(saved, 'target')?.parent).toBe(columnIds[0]);
    expect(tableColumnId).toBe(columnIds[1]);
    expect(childrenOf(saved, columnIds[1])).toEqual(['table1']);

    // Container contract: cells parented to the table, in order, mirrored in grid.
    expect(childrenOf(saved, 'table1')).toEqual(TABLE_CHILD_IDS);
    expect(gridOf(saved)).toEqual([
      [['tp-r0c0'], ['tp-r0c1']],
      [['tp-r1c0'], ['tp-r1c1']],
    ]);
    expect(TABLE_CHILD_IDS.map((id) => textOf(findBlock(saved, id)))).toEqual(TABLE_CHILD_TEXT);
  });

  test('RELOAD: the table stays inside its column in both model and live DOM after a round-trip', async ({ page }) => {
    await createBlok(page, dropFixture());

    const { columnIds } = await sideDropTableBesideTarget(page);
    const tableColumnId = columnIds[1];

    const after = await reloadFromSave(page);

    // MODEL: table still parented to the same column id; cells still parented to
    // the table, in order; grid intact.
    expect(findBlock(after, 'table1')?.parent).toBe(tableColumnId);
    expect(childrenOf(after, 'table1')).toEqual(TABLE_CHILD_IDS);
    for (const id of TABLE_CHILD_IDS) {
      expect(findBlock(after, id)?.parent).toBe('table1');
    }
    expect(gridOf(after)).toEqual([
      [['tp-r0c0'], ['tp-r0c1']],
      [['tp-r1c0'], ['tp-r1c1']],
    ]);

    // LIVE DOM: after the full rebuild, the table + cells are still in column 1.
    const placement = await domColumnIndexById(page, ['table1', ...TABLE_CHILD_IDS]);
    expect(placement['table1']).toBe(1);
    for (const id of TABLE_CHILD_IDS) {
      expect(placement[id]).toBe(1);
    }

    const cellsInsideTable = await page.evaluate((ids: string[]) => {
      return ids.every((id) => {
        const cell = document.querySelector(`[data-blok-id="${id}"]`);

        return cell instanceof HTMLElement && cell.closest('[data-blok-tool="table"]') !== null;
      });
    }, TABLE_CHILD_IDS);
    expect(cellsInsideTable).toBe(true);
  });

  test('EDIT: editing a table cell persists and keeps the table in its column', async ({ page }) => {
    await createBlok(page, dropFixture());

    const { columnIds } = await sideDropTableBesideTarget(page);
    const tableColumnId = columnIds[1];

    // Edit the primary content: the child paragraph inside cell A1.
    await editParagraphLikeText(page, 'Cell A1', 'Edited A1');
    await expect(page.getByText('Edited A1')).toBeVisible();

    const saved = await saveBlok(page);

    // The edit lands on the same child paragraph (id unchanged), still parented to
    // the table, and the cell-reference grid still points at that id.
    const edited = findBlock(saved, 'tp-r0c0');
    expect(textOf(edited)).toBe('Edited A1');
    expect(edited?.parent).toBe('table1');
    expect(gridOf(saved)?.[0][0]).toEqual(['tp-r0c0']);

    // The table did NOT relocate out of its column when a cell was edited.
    expect(findBlock(saved, 'table1')?.parent).toBe(tableColumnId);

    // LIVE DOM: the table + edited cell are still in column 1.
    const placement = await domColumnIndexById(page, ['table1', 'tp-r0c0']);
    expect(placement['table1']).toBe(1);
    expect(placement['tp-r0c0']).toBe(1);

    // The untouched cells keep their text.
    expect(textOf(findBlock(saved, 'tp-r0c1'))).toBe('Cell B1');
    expect(textOf(findBlock(saved, 'tp-r1c0'))).toBe('Cell A2');
    expect(textOf(findBlock(saved, 'tp-r1c1'))).toBe('Cell B2');
  });

  test('REMOVE: deleting the table leaves its (now sole-child) column childless without reseed or unwrap', async ({ page }) => {
    await createBlok(page, dropFixture());

    const { columnIds } = await sideDropTableBesideTarget(page);
    const targetColumnId = columnIds[0];
    const tableColumnId = columnIds[1];

    // Delete the table via its flat index (mirrors the columns.spec pattern).
    await page.evaluate(async () => {
      if (!window.blokInstance) {
        return;
      }
      const index = window.blokInstance.blocks.getBlockIndex('table1');
      await window.blokInstance.blocks.delete(index);
    });

    // The delete + container teardown is async; wait until the table is gone.
    await page.waitForFunction(
      () => window.blokInstance !== undefined && window.blokInstance.blocks.getBlockIndex('table1') === undefined
    );

    const saved = await saveBlok(page);

    // The table and its entire cell subtree are gone — no orphans dangling.
    expect(findBlock(saved, 'table1')).toBeUndefined();
    for (const id of TABLE_CHILD_IDS) {
      expect(findBlock(saved, id)).toBeUndefined();
    }
    expect(childrenOf(saved, 'table1')).toEqual([]);

    // Product rule: deleting a column's SOLE child leaves the column CHILDLESS —
    // no reseed, no unwrap. The column_list survives with both columns; the
    // table's column is now empty, the target's column keeps its paragraph.
    const listId = saved.blocks.find((b) => b.type === 'column_list')?.id;
    expect(listId).toBeDefined();
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(2);
    expect(childrenOf(saved, listId as string)).toEqual(columnIds);
    expect(childrenOf(saved, tableColumnId)).toEqual([]);
    expect(childrenOf(saved, targetColumnId)).toEqual(['target']);

    // LIVE DOM: two columns still render; the table is gone from the DOM.
    await expect(page.locator('[data-blok-column]')).toHaveCount(2);
    await expect(page.locator('[data-blok-tool="table"]')).toHaveCount(0);
    await expect(page.getByText('Cell A1')).toHaveCount(0);
    await expect(page.getByText('Target')).toBeVisible();

    const placement = await domColumnIndexById(page, ['table1', 'target']);
    expect(placement['table1']).toBe(-2); // gone from DOM
    expect(placement['target']).toBe(0); // target stays in its column
  });
});
