import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { OutputData } from '@/types';
import {
  childrenOf,
  ensureBlokBundleBuilt,
  findBlock,
  resetBlok,
  saveBlok,
  TEST_PAGE_URL,
} from './_helpers';

declare global {
  interface Window {
    BlokDatabase: unknown;
    BlokDatabaseRow: unknown;
  }
}

/**
 * The shared `createBlok` helper builds the editor with the default tool set,
 * which does NOT include the `database` / `database-row` tools (they live behind
 * the `window.BlokDatabase` / `window.BlokDatabaseRow` globals on the fixture
 * page). This local variant mirrors the shared helper but registers those two
 * tools so the nested database block can actually render.
 */
const createBlokWithDatabase = async (page: Page, data: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(
    async ({ holder, initialData }) => {
      const blok = new window.Blok({
        holder,
        data: initialData,
        tools: {
          database: { class: window.BlokDatabase },
          'database-row': { class: window.BlokDatabaseRow },
        },
      });
      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: 'blok', initialData: data }
  );
};

/**
 * Full save -> reload -> save round-trip that keeps the database tools
 * registered (the shared `reloadFromSave` rebuilds without them).
 */
const reloadFromSaveWithDatabase = async (page: Page): Promise<OutputData> => {
  const saved = await saveBlok(page);
  await createBlokWithDatabase(page, saved);
  return await saveBlok(page);
};

/**
 * The canonical fixture: a 2-column layout where the first column holds a
 * database block (board view) with two `database-row` children, and the second
 * column holds a plain paragraph.
 */
const buildBlocks = (): OutputData => ({
  blocks: [
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['database1'] },
    {
      id: 'database1',
      type: 'database',
      data: {
        title: 'Tasks',
        schema: [
          { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
          {
            id: 'prop-status',
            name: 'Status',
            type: 'select',
            position: 'a1',
            config: {
              options: [
                { id: 'opt-backlog', label: 'Backlog', color: 'gray', position: 'a0' },
              ],
            },
          },
        ],
        views: [
          {
            id: 'view-1',
            name: 'Board',
            type: 'board',
            position: 'a0',
            groupBy: 'prop-status',
            sorts: [],
            filters: [],
            visibleProperties: ['prop-title'],
          },
        ],
        activeViewId: 'view-1',
      },
      parent: 'c1',
      content: ['dbrow1', 'dbrow2'],
    },
    {
      id: 'dbrow1',
      type: 'database-row',
      data: { position: 'a0', properties: { 'prop-title': 'Fix bug', 'prop-status': 'opt-backlog' } },
      parent: 'database1',
    },
    {
      id: 'dbrow2',
      type: 'database-row',
      data: { position: 'a1', properties: { 'prop-title': 'Write tests', 'prop-status': 'opt-backlog' } },
      parent: 'database1',
    },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['p1'] },
    { id: 'p1', type: 'paragraph', data: { text: 'Second column paragraph' }, parent: 'c2' },
  ],
});

/**
 * The board view's region landmark — the most stable "the database rendered"
 * assertion. Attribute selector form is the columns.spec.ts convention.
 */
const databaseBoard = (page: Page): ReturnType<Page['locator']> => page.locator('[data-blok-database-board]');

test.describe('Database inside a column', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('renders inside the first column', async ({ page }) => {
    await createBlokWithDatabase(page, buildBlocks());

    // Two columns side by side.
    const columns = page.locator('[data-blok-column]');
    await expect(columns).toHaveCount(2);

    // The database board renders, and it lives inside the FIRST column.
    const firstColumnBoard = page
      .locator('[data-blok-column]')
      .nth(0)
      .locator('[data-blok-database-board]');
    await expect(firstColumnBoard).toHaveCount(1);
    await expect(databaseBoard(page)).toHaveCount(1);

    // The database's own surfaces and children are present: title + both card
    // titles + the group header pill.
    await expect(page.getByText('Tasks')).toBeVisible();
    await expect(page.getByText('Backlog')).toBeVisible();
    await expect(page.getByText('Fix bug')).toBeVisible();
    await expect(page.getByText('Write tests')).toBeVisible();

    // The second column's paragraph proves the layout did not collapse.
    await expect(page.getByText('Second column paragraph')).toBeVisible();

    // The database must not escape its column: its board stays within the
    // first column's bounds (the stretched-mode width risk).
    const columnBox = await columns.nth(0).boundingBox();
    const boardBox = await databaseBoard(page).boundingBox();
    if (!columnBox || !boardBox) {
      throw new Error('missing bounding box for column/board');
    }
    // Allow a 1px rounding slack on the right edge.
    expect(boardBox.x + boardBox.width).toBeLessThanOrEqual(columnBox.x + columnBox.width + 1);
  });

  test('@smoke saves the nested tree intact', async ({ page }) => {
    await createBlokWithDatabase(page, buildBlocks());

    const saved = await saveBlok(page);

    // column_list + exactly two columns survive.
    expect(findBlock(saved, 'cl1')?.type).toBe('column_list');
    const columnIds = saved.blocks.filter((b) => b.type === 'column').map((b) => b.id);
    expect(columnIds).toEqual(['c1', 'c2']);

    // The database block is parented to the first column.
    const database = findBlock(saved, 'database1');
    expect(database?.type).toBe('database');
    expect(database?.parent).toBe('c1');
    expect(childrenOf(saved, 'c1')).toEqual(['database1']);

    // Its row children keep their parent link and appear under its content.
    expect(childrenOf(saved, 'database1')).toEqual(['dbrow1', 'dbrow2']);
    expect(findBlock(saved, 'dbrow1')?.parent).toBe('database1');
    expect(findBlock(saved, 'dbrow2')?.parent).toBe('database1');

    // The database `data` round-trips its key fields (title + schema + views).
    const data = database?.data as {
      title?: string;
      activeViewId?: string;
      schema?: Array<{ id: string }>;
      views?: Array<{ id: string }>;
    };
    expect(data.title).toBe('Tasks');
    expect(data.activeViewId).toBe('view-1');
    expect(data.schema?.map((s) => s.id)).toEqual(['prop-title', 'prop-status']);
    expect(data.views?.map((v) => v.id)).toEqual(['view-1']);

    // Row data round-trips its properties.
    const row1 = findBlock(saved, 'dbrow1')?.data as { properties?: Record<string, string> };
    expect(row1.properties?.['prop-title']).toBe('Fix bug');
    expect(row1.properties?.['prop-status']).toBe('opt-backlog');

    // The second column still owns its paragraph.
    expect(childrenOf(saved, 'c2')).toEqual(['p1']);
    expect(findBlock(saved, 'p1')?.parent).toBe('c2');
  });

  test('survives a save -> reload -> save round-trip unchanged', async ({ page }) => {
    await createBlokWithDatabase(page, buildBlocks());

    const before = await saveBlok(page);
    const after = await reloadFromSaveWithDatabase(page);

    // Compare a meaningful, non-volatile subset for every block: id, type,
    // parent link, and the block's primary data field(s).
    type Shape = {
      id: string | undefined;
      type: string;
      parent: string | undefined;
      content: string[] | undefined;
      primary: unknown;
    };

    const primaryOf = (block: { type: string; data: Record<string, unknown> }): unknown => {
      if (block.type === 'database') {
        return {
          title: block.data.title,
          activeViewId: block.data.activeViewId,
          schemaIds: (block.data.schema as Array<{ id: string }> | undefined)?.map((s) => s.id),
          viewIds: (block.data.views as Array<{ id: string }> | undefined)?.map((v) => v.id),
        };
      }
      if (block.type === 'database-row') {
        return block.data.properties;
      }
      if (block.type === 'paragraph') {
        return block.data.text;
      }
      // column / column_list carry no primary content worth diffing.
      return null;
    };

    const project = (saved: OutputData): Shape[] =>
      saved.blocks.map((block) => ({
        id: block.id,
        type: block.type,
        parent: block.parent,
        content: block.content,
        primary: primaryOf({ type: block.type, data: block.data }),
      }));

    expect(project(after)).toEqual(project(before));
  });

  test("edits to the block's content persist through save", async ({ page }) => {
    await createBlokWithDatabase(page, buildBlocks());

    // The database title is the cleanest editable surface that round-trips
    // through the block's own `data` (contenteditable, blurred by Enter).
    const title = page.locator('[data-blok-database-title]');
    await expect(title).toBeVisible();
    // The full-width header title fails Playwright's actionability check, so
    // focus the contenteditable directly and drive the keyboard through the
    // locator so the input lands on the title element, not the page.
    await title.focus();

    const isMac = process.platform === 'darwin';
    const selectAll = isMac ? 'Meta+A' : 'Control+A';
    await title.press(selectAll);
    await title.pressSequentially('Renamed Tasks');
    await title.press('Enter');

    // Wait for the new title to be reflected in the DOM before saving.
    await expect(page.getByText('Renamed Tasks')).toBeVisible();

    const saved = await saveBlok(page);
    const database = findBlock(saved, 'database1');

    expect((database?.data as { title?: string }).title).toBe('Renamed Tasks');
    // Still nested inside the first column.
    expect(database?.parent).toBe('c1');
    expect(childrenOf(saved, 'c1')).toEqual(['database1']);
  });

  test('removing the block collapses the emptied column and unwraps the layout', async ({ page }) => {
    await createBlokWithDatabase(page, buildBlocks());

    // Delete the database block by its flat index via the public API.
    await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }
      const index = window.blokInstance.blocks.getBlockIndex('database1');
      await window.blokInstance.blocks.delete(index);
    });

    // Deleting the database (the sole child of column c1) empties c1, so the
    // column is removed; the list then has one column and unwraps. The unwrap is
    // fire-and-forget async — wait for the whole scaffold to dissolve.
    await page.waitForFunction(
      () => window.blokInstance !== undefined && window.blokInstance.blocks.getBlockIndex('cl1') === undefined
    );

    // The board is gone from the DOM, the surviving paragraph is still visible.
    await expect(databaseBoard(page)).toHaveCount(0);
    await expect(page.getByText('Second column paragraph')).toBeVisible();

    const saved = await saveBlok(page);

    // The database block itself is gone — no `database` block survives.
    expect(findBlock(saved, 'database1')).toBeUndefined();
    expect(saved.blocks.filter((b) => b.type === 'database')).toHaveLength(0);

    // Known data-integrity smell: deleting the database does NOT cascade-delete
    // its `database-row` children. Instead each former row is PROMOTED to root —
    // it survives with `parent` undefined rather than being removed.
    expect(findBlock(saved, 'dbrow1')).toBeDefined();
    expect(findBlock(saved, 'dbrow2')).toBeDefined();
    expect(findBlock(saved, 'dbrow1')?.parent).toBeUndefined();
    expect(findBlock(saved, 'dbrow2')?.parent).toBeUndefined();

    // The columns scaffold dissolves: no column_list, no column survives.
    expect(saved.blocks.filter((b) => b.type === 'column_list')).toHaveLength(0);
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(0);

    // The other column's paragraph is promoted to ROOT, content intact.
    expect(findBlock(saved, 'p1')?.parent ?? null).toBeNull();

    // No orphaned blocks: every parented block resolves to a live parent.
    const allIds = new Set(saved.blocks.map((b) => b.id));
    const orphans = saved.blocks.filter((b) => b.parent !== undefined && b.parent !== null && !allIds.has(b.parent));
    expect(orphans).toEqual([]);
  });

  test("the block's own children stay correctly parented after a reload inside the column", async ({ page }) => {
    await createBlokWithDatabase(page, buildBlocks());

    const after = await reloadFromSaveWithDatabase(page);

    // Model: the row children keep their parent ids and content membership.
    expect(findBlock(after, 'dbrow1')?.parent).toBe('database1');
    expect(findBlock(after, 'dbrow2')?.parent).toBe('database1');
    expect(childrenOf(after, 'database1')).toEqual(['dbrow1', 'dbrow2']);
    // The database itself stays inside the first column.
    expect(findBlock(after, 'database1')?.parent).toBe('c1');
    expect(childrenOf(after, 'c1')).toEqual(['database1']);

    // DOM: both row cards render inside the database board, which is inside the
    // first column. (The rows are projected as cards by the board view.)
    const firstColumn = page.locator('[data-blok-column]').nth(0);
    const boardInFirstColumn = firstColumn.locator('[data-blok-database-board]');
    await expect(boardInFirstColumn).toHaveCount(1);

    const cardsInBoard = boardInFirstColumn.locator('[data-blok-database-card]');
    await expect(cardsInBoard).toHaveCount(2);
    await expect(boardInFirstColumn.getByText('Fix bug')).toBeVisible();
    await expect(boardInFirstColumn.getByText('Write tests')).toBeVisible();
  });
});
