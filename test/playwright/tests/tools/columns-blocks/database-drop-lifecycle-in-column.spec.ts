import { expect, test } from '@playwright/test';
import type { Page, Locator } from '@playwright/test';
import type { OutputData } from '@/types';
import {
  ensureBlokBundleBuilt,
  TEST_PAGE_URL,
  resetBlok,
  saveBlok,
  findBlock,
  childrenOf,
} from './_helpers';

declare global {
  interface Window {
    BlokDatabase: unknown;
    BlokDatabaseRow: unknown;
  }
}

const BLOK = '[data-blok-interface=blok]';
const SETTINGS_BUTTON = `${BLOK} [data-blok-testid="settings-toggler"]`;

/**
 * The shared `createBlok` helper builds the editor with the default tool set,
 * which does NOT include the `database` / `database-row` tools. This local
 * variant registers those two tools (from the fixture globals) so the nested
 * database block can render and be dragged.
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
 * data-blok-id (the top edge of its own holder, away from child content) and
 * then read the single visible settings toggler. Copied verbatim from
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
 * Two root blocks: a plain target paragraph and a database block (board view)
 * with two `database-row` children. No columns yet — the side-drop builds them.
 */
const buildRootBlocks = (): OutputData => ({
  blocks: [
    { id: 'target', type: 'paragraph', data: { text: 'Target' } },
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
  ],
});

const databaseBoard = (page: Page): ReturnType<Page['locator']> => page.locator('[data-blok-database-board]');

/**
 * Build the root layout, then side-drop the database onto the RIGHT edge of the
 * "Target" paragraph. Returns the second column id (the one the database lands
 * in) so callers can keep driving the lifecycle. Asserts the immediate result:
 * a 2-column list, the database parented to + DOM-mounted in the 2nd column, and
 * its rows riding along still nested inside it.
 */
const dropDatabaseBesideTarget = async (page: Page): Promise<string> => {
  await createBlokWithDatabase(page, buildRootBlocks());

  // No columns yet.
  await expect(page.locator('[data-blok-column]')).toHaveCount(0);
  await expect(databaseBoard(page)).toHaveCount(1);

  const handle = await grabContainerHandle(page, 'database1');
  const target = page.getByTestId('block-wrapper').filter({ hasText: 'Target' }).first();
  await performSideDrop(page, handle, target, 'right');

  await expect(page.locator('[data-blok-column]')).toHaveCount(2);
  await expect(page.getByTestId('column-list')).toBeVisible();

  const saved = await saveBlok(page);

  const list = saved.blocks.find((b) => b.type === 'column_list');
  expect(list).toBeDefined();
  const columnIds = saved.blocks.filter((b) => b.type === 'column').map((b) => b.id);
  expect(columnIds).toHaveLength(2);

  // Target stays in column 0; the dropped database lands in column 1.
  expect(findBlock(saved, 'target')?.parent).toBe(columnIds[0]);
  const databaseParent = findBlock(saved, 'database1')?.parent;
  expect(databaseParent).toBe(columnIds[1]);

  // The database's rows ride along — still parented to the database, in order.
  expect(childrenOf(saved, 'database1')).toEqual(['dbrow1', 'dbrow2']);
  expect(findBlock(saved, 'dbrow1')?.parent).toBe('database1');
  expect(findBlock(saved, 'dbrow2')?.parent).toBe('database1');

  // LIVE DOM: the database holder sits in the second column (index 1).
  const placement = await domColumnIndexById(page, ['target', 'database1']);
  expect(placement['target']).toBe(0);
  expect(placement['database1']).toBe(1);

  // LIVE DOM: the board (and both row cards) is still mounted inside the
  // database, which is inside the second column.
  const secondColumnBoard = page.locator('[data-blok-column]').nth(1).locator('[data-blok-database-board]');
  await expect(secondColumnBoard).toHaveCount(1);
  await expect(secondColumnBoard.locator('[data-blok-database-card]')).toHaveCount(2);

  if (databaseParent === undefined) {
    throw new Error('database parent column not found after drop');
  }

  return databaseParent;
};

test.describe('Database drop lifecycle in a column', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(TEST_PAGE_URL);
  });

  test('DROP: side-dropping a root database beside a block wraps both into columns and the database keeps its rows', async ({ page }) => {
    // dropDatabaseBesideTarget asserts the full drop outcome (2 columns, database
    // parented to the 2nd, rows intact, live DOM membership) and returns that column id.
    const databaseColumn = await dropDatabaseBesideTarget(page);
    expect(databaseColumn).toBeTruthy();
  });

  test('SAVE: the saved model nests column_list -> column -> database -> rows', async ({ page }) => {
    const databaseColumn = await dropDatabaseBesideTarget(page);

    const saved = await saveBlok(page);

    // column_list owns exactly the two columns, in order.
    const list = saved.blocks.find((b) => b.type === 'column_list');
    expect(list).toBeDefined();
    if (!list?.id) {
      throw new Error('column_list id missing');
    }
    const columnIds = saved.blocks.filter((b) => b.type === 'column').map((b) => b.id);
    expect(columnIds).toHaveLength(2);
    expect(childrenOf(saved, list.id)).toEqual(columnIds);

    // The database is parented to its column and is that column's sole child.
    expect(findBlock(saved, 'database1')?.parent).toBe(databaseColumn);
    expect(childrenOf(saved, databaseColumn)).toEqual(['database1']);

    // The rows keep their parent link and content membership.
    expect(childrenOf(saved, 'database1')).toEqual(['dbrow1', 'dbrow2']);
    expect(findBlock(saved, 'dbrow1')?.parent).toBe('database1');
    expect(findBlock(saved, 'dbrow2')?.parent).toBe('database1');

    // The database `data` round-trips its key fields.
    const data = findBlock(saved, 'database1')?.data as {
      title?: string;
      activeViewId?: string;
      schema?: Array<{ id: string }>;
      views?: Array<{ id: string }>;
    };
    expect(data.title).toBe('Tasks');
    expect(data.activeViewId).toBe('view-1');
    expect(data.schema?.map((s) => s.id)).toEqual(['prop-title', 'prop-status']);
    expect(data.views?.map((v) => v.id)).toEqual(['view-1']);
  });

  test('RELOAD: the database stays inside its column in model and live DOM after a round-trip', async ({ page }) => {
    const databaseColumn = await dropDatabaseBesideTarget(page);

    const after = await reloadFromSaveWithDatabase(page);

    // Model: the database is still parented to its column; rows still nested.
    expect(findBlock(after, 'database1')?.parent).toBe(databaseColumn);
    expect(childrenOf(after, databaseColumn)).toEqual(['database1']);
    expect(childrenOf(after, 'database1')).toEqual(['dbrow1', 'dbrow2']);
    expect(findBlock(after, 'dbrow1')?.parent).toBe('database1');
    expect(findBlock(after, 'dbrow2')?.parent).toBe('database1');

    // Live DOM: the database holder is in the second column; its board + both
    // row cards are mounted inside it.
    const placement = await domColumnIndexById(page, ['database1']);
    expect(placement['database1']).toBe(1);

    const secondColumnBoard = page.locator('[data-blok-column]').nth(1).locator('[data-blok-database-board]');
    await expect(secondColumnBoard).toHaveCount(1);
    await expect(secondColumnBoard.locator('[data-blok-database-card]')).toHaveCount(2);
    await expect(secondColumnBoard.getByText('Fix bug')).toBeVisible();
    await expect(secondColumnBoard.getByText('Write tests')).toBeVisible();
  });

  test("EDIT: renaming the database title persists and the database stays in its column", async ({ page }) => {
    const databaseColumn = await dropDatabaseBesideTarget(page);

    // The database title is the cleanest editable surface that round-trips
    // through the block's own `data`. The full-width header title fails the
    // actionability check, so focus the contenteditable directly.
    const title = page.locator('[data-blok-database-title]');
    await expect(title).toBeVisible();
    await title.focus();

    const isMac = process.platform === 'darwin';
    const selectAll = isMac ? 'Meta+A' : 'Control+A';
    await title.press(selectAll);
    await title.pressSequentially('Renamed Tasks');
    await title.press('Enter');

    await expect(page.getByText('Renamed Tasks')).toBeVisible();

    const saved = await saveBlok(page);

    // The edit persisted.
    expect((findBlock(saved, 'database1')?.data as { title?: string }).title).toBe('Renamed Tasks');

    // Model: the database stayed inside its column with its rows intact.
    expect(findBlock(saved, 'database1')?.parent).toBe(databaseColumn);
    expect(childrenOf(saved, databaseColumn)).toEqual(['database1']);
    expect(childrenOf(saved, 'database1')).toEqual(['dbrow1', 'dbrow2']);

    // Live DOM: the database holder is still in the second column.
    const placement = await domColumnIndexById(page, ['database1']);
    expect(placement['database1']).toBe(1);
  });

  test('REMOVE: deleting the database collapses the emptied column and unwraps the layout', async ({ page }) => {
    await dropDatabaseBesideTarget(page);

    // Delete the database block by its flat index via the public API.
    await page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }
      const index = window.blokInstance.blocks.getBlockIndex('database1');
      await window.blokInstance.blocks.delete(index);
    });

    // Deleting the database (the sole child of its column) empties that column,
    // which is removed; the list drops to one column and unwraps. The unwrap is
    // fire-and-forget async — poll until the scaffold dissolves.
    await expect
      .poll(async () => (await saveBlok(page)).blocks.filter((b) => b.type === 'column_list').length, { timeout: 3000 })
      .toBe(0);

    // Live DOM: the board is gone; the target paragraph remains; no columns left.
    await expect(databaseBoard(page)).toHaveCount(0);
    await expect(page.getByText('Target')).toBeVisible();
    await expect(page.locator('[data-blok-column]')).toHaveCount(0);

    const saved = await saveBlok(page);

    // The database block itself is gone.
    expect(findBlock(saved, 'database1')).toBeUndefined();
    expect(saved.blocks.filter((b) => b.type === 'database')).toHaveLength(0);

    // Known data-integrity smell: the database's rows are promoted to root rather
    // than cascade-deleted.
    expect(findBlock(saved, 'dbrow1')?.parent ?? null).toBeNull();
    expect(findBlock(saved, 'dbrow2')?.parent ?? null).toBeNull();

    // The columns scaffold dissolves: no column_list, no column survives.
    expect(saved.blocks.filter((b) => b.type === 'column_list')).toHaveLength(0);
    expect(saved.blocks.filter((b) => b.type === 'column')).toHaveLength(0);

    // The other column's target paragraph is promoted to ROOT, content intact.
    expect(findBlock(saved, 'target')?.parent ?? null).toBeNull();
    expect((findBlock(saved, 'target')?.data as { text?: string }).text).toBe('Target');

    // No orphaned blocks.
    const allIds = new Set(saved.blocks.map((b) => b.id));
    const orphans = saved.blocks.filter((b) => b.parent !== undefined && b.parent !== null && !allIds.has(b.parent));
    expect(orphans).toEqual([]);
  });
});
