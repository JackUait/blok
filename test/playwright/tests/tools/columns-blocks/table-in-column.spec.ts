import type { OutputData, OutputBlockData } from '@/types';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';
import {
  ensureBlokBundleBuilt,
  createBlok,
  saveBlok,
  reloadFromSave,
  findBlock,
  childrenOf,
  editParagraphLikeText,
} from './_helpers';

/**
 * A 2x2 table living inside the first column of a two-column layout. Each cell
 * references one child paragraph (tp-r0c0 … tp-r1c1), and those paragraphs are
 * top-level blocks parented to the table — the table is a container whose cells
 * store child-block IDs, exactly like callout/toggle/database-row. The right
 * column holds a plain paragraph so we can assert it survives table operations.
 */
const tableInColumnData = (): OutputData => ({
  blocks: [
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },

    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['table1'] },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['c2p1'] },

    {
      id: 'table1',
      type: 'table',
      parent: 'c1',
      data: {
        withHeadings: false,
        withHeadingColumn: false,
        content: [
          [{ blocks: ['tp-r0c0'] }, { blocks: ['tp-r0c1'] }],
          [{ blocks: ['tp-r1c0'] }, { blocks: ['tp-r1c1'] }],
        ],
      },
      content: ['tp-r0c0', 'tp-r0c1', 'tp-r1c0', 'tp-r1c1'],
    },

    { id: 'tp-r0c0', type: 'paragraph', data: { text: 'Cell A1' }, parent: 'table1' },
    { id: 'tp-r0c1', type: 'paragraph', data: { text: 'Cell B1' }, parent: 'table1' },
    { id: 'tp-r1c0', type: 'paragraph', data: { text: 'Cell A2' }, parent: 'table1' },
    { id: 'tp-r1c1', type: 'paragraph', data: { text: 'Cell B2' }, parent: 'table1' },

    { id: 'c2p1', type: 'paragraph', data: { text: 'Right column text' }, parent: 'c2' },
  ],
});

const TABLE_CHILD_IDS = ['tp-r0c0', 'tp-r0c1', 'tp-r1c0', 'tp-r1c1'];
const TABLE_CHILD_TEXT = ['Cell A1', 'Cell B1', 'Cell A2', 'Cell B2'];

/**
 * Pull out the comparable subset of a saved tree: id, type, parent and content
 * ordering for structural blocks, plus the `text` for paragraphs. Volatile
 * geometry fields (colWidths, initialColWidth, widthRatio) are intentionally
 * excluded so the round-trip comparison stays meaningful.
 */
const structuralSnapshot = (
  saved: OutputData
): Array<{ id: string | undefined; type: string; parent: string | undefined; content: string[] | undefined; text: string | undefined }> =>
  saved.blocks.map((block) => ({
    id: block.id,
    type: block.type,
    parent: block.parent,
    content: (block as OutputBlockData & { content?: string[] }).content,
    text: (block.data as { text?: string }).text,
  }));

const textOf = (block: OutputBlockData | undefined): string | undefined =>
  (block?.data as { text?: string } | undefined)?.text;

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Table inside a column', () => {
  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('renders inside the first column', async ({ page }) => {
    await createBlok(page, tableInColumnData());

    const columns = page.locator('[data-blok-column]');
    await expect(columns).toHaveCount(2);

    // The table wrapper is mounted inside the FIRST column (no testid on the
    // table itself — it carries data-blok-tool="table").
    const tableInFirstColumn = columns.first().locator('[data-blok-tool="table"]');
    await expect(tableInFirstColumn).toBeVisible();

    // Its structural landmarks render: at least one table row exists inside col 0.
    await expect(columns.first().locator('[data-blok-table-row]').first()).toBeVisible();

    // All four seeded cell paragraphs are present, in the first column.
    for (const cellText of TABLE_CHILD_TEXT) {
      await expect(columns.first().getByText(cellText)).toBeVisible();
    }

    // The right column's own paragraph is untouched and lives in column 1.
    await expect(columns.nth(1).getByText('Right column text')).toBeVisible();
  });

  test('@smoke saves the nested tree intact', async ({ page }) => {
    await createBlok(page, tableInColumnData());

    const saved = await saveBlok(page);

    // column_list + exactly two columns survive.
    expect(findBlock(saved, 'cl1')?.type).toBe('column_list');
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(2);
    expect(childrenOf(saved, 'cl1')).toEqual(['c1', 'c2']);

    // The table block is parented to the first column.
    const table = findBlock(saved, 'table1');
    expect(table?.type).toBe('table');
    expect(table?.parent).toBe('c1');

    // Container contract: the four cell paragraphs stay parented to the table and
    // appear under its content array, in order.
    expect(childrenOf(saved, 'table1')).toEqual(TABLE_CHILD_IDS);
    expect((table)?.content).toEqual(TABLE_CHILD_IDS);

    // The right column keeps its own paragraph.
    expect(childrenOf(saved, 'c2')).toEqual(['c2p1']);

    // Table data round-trips: heading flags and the cell->block reference grid.
    const data = table?.data as {
      withHeadings?: boolean;
      withHeadingColumn?: boolean;
      content?: Array<Array<{ blocks: string[] }>>;
    };
    expect(data.withHeadings).toBe(false);
    expect(data.withHeadingColumn).toBe(false);
    expect(data.content?.map((row) => row.map((cell) => cell.blocks))).toEqual([
      [['tp-r0c0'], ['tp-r0c1']],
      [['tp-r1c0'], ['tp-r1c1']],
    ]);

    // The cell text round-trips on the child paragraphs.
    expect(TABLE_CHILD_IDS.map((id) => textOf(findBlock(saved, id)))).toEqual(TABLE_CHILD_TEXT);
  });

  test('survives a save -> reload -> save round-trip unchanged', async ({ page }) => {
    await createBlok(page, tableInColumnData());

    const before = await saveBlok(page);
    const after = await reloadFromSave(page);

    // The meaningful structural subset (ids, types, parent links, content order,
    // and paragraph text) must be byte-for-byte identical across the round-trip.
    expect(structuralSnapshot(after)).toEqual(structuralSnapshot(before));

    // Spot-check the load-bearing invariants explicitly so a failure is legible.
    expect(findBlock(after, 'table1')?.parent).toBe('c1');
    expect(childrenOf(after, 'table1')).toEqual(TABLE_CHILD_IDS);
    expect(childrenOf(after, 'cl1')).toEqual(['c1', 'c2']);
    expect(childrenOf(after, 'c2')).toEqual(['c2p1']);
    expect(TABLE_CHILD_IDS.map((id) => textOf(findBlock(after, id)))).toEqual(TABLE_CHILD_TEXT);
  });

  test("edits to the block's content persist through save", async ({ page }) => {
    await createBlok(page, tableInColumnData());

    // Edit the primary content: the child paragraph inside cell A1.
    await editParagraphLikeText(page, 'Cell A1', 'Edited A1');

    await expect(page.getByText('Edited A1')).toBeVisible();

    const saved = await saveBlok(page);

    // The edited text lands on the same child paragraph (id unchanged), and the
    // table's cell-reference grid still points at that same id.
    const edited = findBlock(saved, 'tp-r0c0');
    expect(textOf(edited)).toBe('Edited A1');
    expect(edited?.parent).toBe('table1');

    const data = findBlock(saved, 'table1')?.data as { content?: Array<Array<{ blocks: string[] }>> };
    expect(data.content?.[0][0].blocks).toEqual(['tp-r0c0']);

    // The table block is still parented to the first column — editing a cell did
    // not relocate it out of the column.
    expect(findBlock(saved, 'table1')?.parent).toBe('c1');

    // The other cells are untouched.
    expect(textOf(findBlock(saved, 'tp-r0c1'))).toBe('Cell B1');
    expect(textOf(findBlock(saved, 'tp-r1c0'))).toBe('Cell A2');
    expect(textOf(findBlock(saved, 'tp-r1c1'))).toBe('Cell B2');
  });

  test('removing the block collapses the emptied column and unwraps the layout', async ({ page }) => {
    await createBlok(page, tableInColumnData());

    // Delete the table via its flat index (mirrors the columns.spec pattern).
    await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }
      const index = window.blokInstance.blocks.getBlockIndex('table1');
      await window.blokInstance.blocks.delete(index);
    });

    // Deleting the sole child empties the column, which is removed; the list drops
    // to one column and unwraps. The unwrap is fire-and-forget async.
    await page.waitForFunction(
      () => window.blokInstance !== undefined && window.blokInstance.blocks.getBlockIndex('cl1') === undefined
    );

    const saved = await saveBlok(page);

    // The table block and its entire subtree (the four cell paragraphs) are gone.
    expect(findBlock(saved, 'table1')).toBeUndefined();
    for (const id of TABLE_CHILD_IDS) {
      expect(findBlock(saved, id)).toBeUndefined();
    }
    expect(saved.blocks.filter((b) => b.type === 'column_list')).toHaveLength(0);
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(0);

    // No table renders in the DOM anymore, and its cell text is gone.
    await expect(page.locator('[data-blok-tool="table"]')).toHaveCount(0);
    await expect(page.getByText('Cell A1')).toHaveCount(0);

    // The other column's paragraph is promoted to ROOT, content intact.
    expect(findBlock(saved, 'c2p1')?.parent ?? null).toBeNull();
    expect((findBlock(saved, 'c2p1')?.data as { text?: string }).text).toBe('Right column text');
    await expect(page.getByText('Right column text')).toBeVisible();

    const allIds = new Set(saved.blocks.map((b) => b.id));
    const orphans = saved.blocks.filter((b) => b.parent !== undefined && b.parent !== null && !allIds.has(b.parent));
    expect(orphans).toEqual([]);

    // No column holders render anymore.
    await expect(page.locator('[data-blok-column]')).toHaveCount(0);
  });

  test("the block's own children stay correctly parented after a reload inside the column", async ({ page }) => {
    await createBlok(page, tableInColumnData());

    const after = await reloadFromSave(page);

    // Model: every cell paragraph keeps parent "table1", and the table keeps
    // parent "c1" after the reload.
    for (const id of TABLE_CHILD_IDS) {
      expect(findBlock(after, id)?.parent).toBe('table1');
    }
    expect(findBlock(after, 'table1')?.parent).toBe('c1');
    expect(childrenOf(after, 'table1')).toEqual(TABLE_CHILD_IDS);

    // LIVE DOM: each cell's child paragraph is mounted inside the table, which is
    // inside the FIRST column. Assert by id via the tool-renderer's data-blok-id.
    const placement = await page.evaluate((childIds: string[]) => {
      const columnHolders = Array.from(document.querySelectorAll('[data-blok-columns] > [data-blok-element]'));

      return childIds.map((id) => {
        const childHolder = document.querySelector(`[data-blok-id="${id}"]`);

        if (!(childHolder instanceof HTMLElement)) {
          return { id, insideTable: false, columnIndex: -1 };
        }

        const insideTable = childHolder.closest('[data-blok-tool="table"]') !== null;
        const ownColumn = childHolder.closest('[data-blok-column]')?.closest('[data-blok-element]') ?? null;
        const columnIndex = ownColumn instanceof HTMLElement ? columnHolders.indexOf(ownColumn) : -1;

        return { id, insideTable, columnIndex };
      });
    }, TABLE_CHILD_IDS);

    for (const entry of placement) {
      expect(entry.insideTable).toBe(true);
      expect(entry.columnIndex).toBe(0);
    }

    // The table block itself sits in the first column, and the second column's
    // paragraph stays put.
    const columns = page.locator('[data-blok-column]');
    await expect(columns.first().locator('[data-blok-tool="table"]')).toBeVisible();
    await expect(columns.nth(1).getByText('Right column text')).toBeVisible();
  });
});
