/**
 * "New data source" (research/23 §10): a second source inside one database
 * block, with its own schema and rows, and a Table view bound to it.
 */

import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

const NAMES = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];

const initial: OutputBlockData[] = [
  {
    id: 'db-1',
    type: 'database',
    data: {
      title: 'Projects',
      schema: [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }],
      views: NAMES.map((name, i) => ({
        id: `v${i}`, name, type: 'table', position: `a${i}`, sorts: [], filters: [], visibleProperties: [],
      })),
      activeViewId: 'v0',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Alpha' } } },
];

const bound: OutputBlockData[] = [
  {
    id: 'db-1',
    type: 'database',
    data: {
      title: 'Projects',
      schema: [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }],
      views: [
        { id: 'v0', name: 'Own', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] },
        { id: 'vb', name: 'Second', type: 'table', position: 'a1', sorts: [], filters: [], visibleProperties: [], dataSourceId: 'src-b' },
      ],
      activeViewId: 'vb',
    },
    content: ['r1', 'src-b'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Alpha' } } },
  {
    id: 'src-b',
    type: 'database',
    parent: 'db-1',
    data: {
      title: 'Inventory',
      schema: [
        { id: 'b-title', name: 'Name', type: 'title', position: 'a0' },
        { id: 'b-stage', name: 'Stage', type: 'select', position: 'a1', config: { options: [
          { id: 'todo', label: 'Todo', color: 'gray', position: 'a0' },
          { id: 'done', label: 'Done', color: 'green', position: 'a1' },
        ] } },
      ],
      views: [{ id: 'bv', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'bv',
    },
    content: ['b1'],
  },
  { id: 'b1', type: 'database-row', parent: 'src-b', data: { position: 'a0', properties: { 'b-title': 'Gamma', 'b-stage': 'todo' } } },
];

const mount = async (page: Page, blocks: OutputBlockData[]): Promise<void> => {
  await page.evaluate(async ({ data }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:520px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: data } });
    await window.blokInstance.isReady;
  }, { data: blocks });
  await expect(page.getByRole('grid')).toBeVisible();
};

const save = (page: Page): Promise<OutputBlockData[]> =>
  page.evaluate(async () => (await window.blokInstance?.save())?.blocks ?? []);

const openList = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: /more…$/ }).click();
  await expect(page.locator('[data-blok-database-tab-overflow-dropdown]')).toBeVisible();
};

const grid = (page: Page) => page.getByRole('grid');

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('database New data source', () => {
  test('a second source keeps its own rows and property through views and a reload', async ({ page }) => {
    await mount(page, initial);
    await openList(page);
    await page.getByRole('option', { name: 'New data source' }).click();

    // The new Table view is selected and shows only the title property.
    await expect(grid(page).getByRole('columnheader')).toHaveCount(1);
    await expect(grid(page)).not.toContainText('Alpha');
    // The title line is the new source's: empty, so it shows the placeholder.
    await expect(page.locator('[data-blok-database-source-title]')).toHaveAttribute('data-placeholder', 'New data source');
    await expect(page.locator('[data-blok-database-source-title]')).not.toHaveAttribute('hidden', '');
    await expect(page.getByRole('tab', { name: 'Table' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Table' })).toBeVisible();

    // A row and a property on the new source.
    await grid(page).locator('[data-blok-database-table-add-row]').first().click();
    await expect(page.locator('[data-blok-database-cell-editor]')).toBeVisible();
    await page.keyboard.type('Beta');
    await page.keyboard.press('Enter');
    await expect(grid(page)).toContainText('Beta');
    await grid(page).locator('[data-blok-database-table-add-property]').click();
    await page.locator('[data-blok-database-property-type-option="text"]').click();
    await page.keyboard.press('Escape');
    await expect(grid(page).getByRole('columnheader')).toHaveCount(2);
    await expect(grid(page)).toContainText('Beta');

    // Back on the first source: its own row, its one property.
    await page.getByRole('tab', { name: 'First' }).click();
    await expect(grid(page)).toContainText('Alpha');
    await expect(grid(page)).not.toContainText('Beta');
    await expect(grid(page).getByRole('columnheader')).toHaveCount(1);

    // save → render.
    const saved = await save(page);
    const source = saved.find((block) => block.type === 'database' && block.id !== 'db-1');

    expect(source).toBeDefined();
    expect(saved.filter((block) => block.type === 'database-row' && block.parent === source?.id)).toHaveLength(1);
    await mount(page, saved);
    await expect(grid(page)).toContainText('Alpha');

    await openList(page);
    await page.locator('[data-blok-database-tab-overflow-item]').last().click();
    await expect(grid(page)).toContainText('Beta');
    await expect(grid(page)).not.toContainText('Alpha');
    await expect(grid(page).getByRole('columnheader')).toHaveCount(2);
  });

  test('Layout switches a second source\'s view to a board of its rows, and CSV exports them', async ({ page }) => {
    await mount(page, bound);
    const settings = page.getByTestId('database-toolbar-settings');

    await settings.click();
    await page.getByTestId('database-settings-layout').click();
    await page.getByTestId('database-layout-board').click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    const board = page.locator('[data-blok-database-board]');

    await expect(board).toBeVisible();
    await expect(board).toContainText('Gamma');
    await expect(board).toContainText('Todo');
    await expect(board).not.toContainText('Alpha');

    // A card added in Done lands in the second source, in Done.
    await board.locator('[data-blok-database-add-card][data-option-id="done"]').click();
    await expect.poll(async () => {
      const saved = await save(page);

      return saved.filter((block) => block.type === 'database-row' && block.parent === 'src-b')
        .map((block) => (block.data as { properties: Record<string, unknown> }).properties['b-stage']);
    }).toEqual(['todo', 'done']);
    const views = (await save(page)).find((block) => block.id === 'db-1')?.data as { views: Array<{ id: string; type: string; groupBy?: string }> };

    expect(views.views.find((view) => view.id === 'vb')).toMatchObject({ type: 'board', groupBy: 'b-stage' });

    await settings.click();
    const download = page.waitForEvent('download');

    await page.getByTestId('database-settings-csv-export').click();
    const csv = readFileSync(await (await download).path(), 'utf8');

    expect(csv).toContain('Gamma');
    expect(csv).not.toContain('Alpha');
  });

  test('View settings "Source" moves a view onto the other source and back', async ({ page }) => {
    const table = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
      id, name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...extra,
    });

    await mount(page, [
      {
        id: 'db-1', type: 'database', content: ['r1', 'src-b'],
        data: {
          title: 'Projects',
          schema: [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }],
          views: [table('v0', { name: 'First' }), table('vb', { name: 'Second', position: 'a1', dataSourceId: 'src-b' })],
          activeViewId: 'v0',
        },
      },
      { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Alpha' } } },
      {
        id: 'src-b', type: 'database', parent: 'db-1', content: ['b1'],
        data: { title: 'Src B', schema: [{ id: 'b-title', name: 'Name', type: 'title', position: 'a0' }], views: [table('bv')], activeViewId: 'bv' },
      },
      { id: 'b1', type: 'database-row', parent: 'src-b', data: { position: 'a0', properties: { 'b-title': 'Beta' } } },
    ]);
    await expect(grid(page)).toContainText('Alpha');

    await page.getByTestId('database-toolbar-settings').click();
    await page.getByTestId('database-settings-source').click();
    await expect(page.getByTestId('database-source-search')).toHaveAttribute('placeholder', 'Link to a data source…');
    await page.getByTestId('database-source-option-src-b').click();
    await expect(grid(page)).toContainText('Beta');
    await expect(grid(page)).not.toContainText('Alpha');

    await page.getByTestId('database-toolbar-settings').click();
    await page.getByTestId('database-settings-source').click();
    await page.getByTestId('database-source-option-db-1').click();
    await expect(grid(page)).toContainText('Alpha');
    const views = (await save(page)).find((block) => block.id === 'db-1')?.data as { views: Array<{ id: string; dataSourceId?: string }> };

    expect(views.views.find((view) => view.id === 'v0')?.dataSourceId).toBeUndefined();
  });

  test.describe('the "New data source" panel', () => {
    const withOther: OutputBlockData[] = [
      ...initial,
      {
        id: 'db-2', type: 'database', content: ['o1'],
        data: {
          title: 'Stock',
          schema: [{ id: 'o-title', name: 'Name', type: 'title', position: 'a0' }],
          views: [{ id: 'ov', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
          activeViewId: 'ov',
        },
      },
      { id: 'o1', type: 'database-row', parent: 'db-2', data: { position: 'a0', properties: { 'o-title': 'Omega' } } },
    ];
    const firstGrid = (page: Page) => page.locator('[data-blok-id="db-1"]').getByRole('grid').first();
    const panel = (page: Page) => page.getByTestId('database-new-source-panel');

    const openPanel = async (page: Page): Promise<void> => {
      await openList(page);
      await page.getByRole('option', { name: 'New data source' }).click();
      await expect(panel(page)).toBeVisible();
    };

    test('opens with the measured rows, and Import CSV fills the new source', async ({ page }) => {
      await mount(page, initial);
      await openPanel(page);

      await expect(page.getByTestId('database-new-source-search')).toHaveAttribute('placeholder', 'Search…');
      await expect(page.getByTestId('database-new-source-search')).toBeFocused();
      await expect(panel(page)).toContainText('New empty data source');
      await expect(panel(page)).not.toContainText('Suggested');

      await page.getByTestId('database-new-source-csv').click();
      const dialog = page.getByRole('dialog');

      await dialog.locator('[data-blok-database-csv-input]').setInputFiles({ name: 'stock.csv', mimeType: 'text/csv', buffer: Buffer.from('Name,Size\nNut,3\nBolt,5') });
      await dialog.getByTestId('database-csv-map').click();
      await dialog.getByTestId('database-csv-import').click();

      await expect(grid(page)).toContainText('Nut');
      await expect(grid(page)).toContainText('Bolt');
      await expect(grid(page)).not.toContainText('Alpha');
      await expect(grid(page).getByRole('columnheader')).toHaveCount(2);
      // research/27 §2: the title stays the placeholder, not the file name.
      await expect(page.locator('[data-blok-database-source-title]')).toHaveText('');
      const saved = await save(page);
      const source = saved.find((block) => block.type === 'database' && block.parent === 'db-1');

      expect(saved.filter((block) => block.type === 'database-row' && block.parent === source?.id)).toHaveLength(2);
    });

    test('New empty data source closes it and keeps the empty source', async ({ page }) => {
      await mount(page, initial);
      await openPanel(page);
      await page.getByTestId('database-new-source-empty').click();

      await expect(panel(page)).toBeHidden();
      await expect(grid(page).getByRole('columnheader')).toHaveCount(1);
      expect((await save(page)).filter((block) => block.type === 'database' && block.parent === 'db-1')).toHaveLength(1);
    });

    test('Link to existing data source puts the new view on another database of the page', async ({ page }) => {
      await page.evaluate(async ({ data }) => {
        if (window.blokInstance) {
          await window.blokInstance.destroy?.();
          window.blokInstance = undefined;
        }
        document.getElementById('blok')?.remove();
        const holder = document.createElement('div');

        holder.id = 'blok';
        holder.style.cssText = 'max-width:520px;margin:40px auto 0';
        document.body.appendChild(holder);
        window.blokInstance = new window.Blok({ holder, data: { blocks: data } });
        await window.blokInstance.isReady;
      }, { data: withOther });
      await expect(firstGrid(page)).toContainText('Alpha');
      await openPanel(page);
      await page.getByTestId('database-new-source-link').click();
      await expect(panel(page)).toContainText('Existing data sources');
      await page.getByTestId('database-new-source-existing-db-2').click();

      await expect(panel(page)).toBeHidden();
      await expect(firstGrid(page)).toContainText('Omega');
      await expect(firstGrid(page)).not.toContainText('Alpha');
      const saved = await save(page);
      const views = saved.find((block) => block.id === 'db-1')?.data as { views: Array<{ dataSourceId?: string }>; activeViewId: string };

      expect(saved.filter((block) => block.type === 'database' && block.parent === 'db-1')).toHaveLength(0);
      expect(views.views.some((view) => view.dataSourceId === 'db-2')).toBe(true);
    });

    // research/26 §2.
    test('a typed query becomes New “<query>” data source, which names the new source', async ({ page }) => {
      await mount(page, initial);
      await openPanel(page);
      await page.getByTestId('database-new-source-search').fill('Stock');

      await expect(page.getByTestId('database-new-source-named')).toHaveText('New \u201CStock\u201D data source');
      await expect(page.getByTestId('database-new-source-csv')).toBeVisible();
      await expect(page.getByTestId('database-new-source-empty')).toHaveCount(0);
      await page.getByTestId('database-new-source-named').click();

      await expect(panel(page)).toBeHidden();
      await expect(page.locator('[data-blok-database-source-title]')).toHaveText('Stock');
      const source = (await save(page)).find((block) => block.type === 'database' && block.parent === 'db-1');

      expect((source?.data as { title?: string } | undefined)?.title).toBe('Stock');
    });

    test('Link to existing data source suggests this database\'s own data first', async ({ page }) => {
      await mount(page, initial);
      await openPanel(page);
      await page.getByTestId('database-new-source-link').click();
      await expect(panel(page)).toContainText('Suggested');
      await page.getByTestId('database-new-source-suggested-db-1').click();

      await expect(panel(page)).toBeHidden();
      await expect(firstGrid(page)).toContainText('Alpha');
      expect((await save(page)).filter((block) => block.type === 'database' && block.parent === 'db-1')).toHaveLength(0);
    });
  });

  // research/26 §5a.
  test.describe('deleting the last view of a source', () => {
    const deleteFromSettings = async (page: Page): Promise<void> => {
      await page.getByTestId('database-toolbar-settings').click();
      await page.getByTestId('database-settings-delete').click();
      await expect(page.getByRole('alertdialog')).toContainText('Delete the last view for this data source?');
    };

    test('"Delete view only" is picked and keeps the source and its rows', async ({ page }) => {
      await mount(page, bound);
      await deleteFromSettings(page);
      const dialog = page.getByRole('alertdialog');

      await expect(dialog.getByRole('radio', { name: /Delete view only/ })).toHaveAttribute('aria-checked', 'true');
      await dialog.getByRole('button', { name: 'Delete view', exact: true }).click();
      await expect(dialog).toBeHidden();
      const saved = await save(page);

      expect(saved.some((block) => block.id === 'src-b')).toBe(true);
      expect(saved.some((block) => block.id === 'b1')).toBe(true);
    });

    test('"Delete view and data source" removes the source and its rows; undo brings them back', async ({ page }) => {
      await mount(page, bound);
      await deleteFromSettings(page);
      const dialog = page.getByRole('alertdialog');

      await dialog.getByRole('radio', { name: /Delete view and data source/ }).click();
      await dialog.getByRole('button', { name: 'Delete view', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(grid(page)).toContainText('Alpha');
      const saved = await save(page);

      expect(saved.some((block) => block.id === 'src-b' || block.id === 'b1')).toBe(false);
      expect(saved.filter((block) => block.type === 'database-row').map((block) => block.id)).toEqual(['r1']);

      await page.evaluate(() => window.blokInstance?.history.undo());
      await expect.poll(async () => (await save(page)).find((block) => block.id === 'b1')?.parent).toBe('src-b');
    });
  });

  // research/26 §5b, 27 §5: every filter goes; the title sort stays, on the new source's title.
  test('picking another source drops every filter and keeps only the title sort', async ({ page }) => {
    const rules = {
      sorts: [{ id: 's1', propertyId: 'p-title', direction: 'desc' }],
      filters: [{ id: 'f1', propertyId: 'p-title', operator: 'contains', value: 'zzz' }],
    };
    const sortedBound = bound.map((block) => (block.id === 'db-1'
      ? { ...block, data: { ...block.data, activeViewId: 'v0', views: (block.data as { views: Array<Record<string, unknown>> }).views.map((view) => (view.id === 'v0' ? { ...view, ...rules } : view)) } }
      : block));

    await mount(page, sortedBound);
    await page.getByTestId('database-toolbar-settings').click();
    await page.getByTestId('database-settings-source').click();
    await page.getByTestId('database-source-option-src-b').click();
    // "zzz" matches no row: Gamma shows only once the filter is gone.
    await expect(grid(page)).toContainText('Gamma');
    const views = (await save(page)).find((block) => block.id === 'db-1')?.data as { views: Array<{ id: string; sorts: unknown[]; filters: unknown[] }> };
    const moved = views.views.find((view) => view.id === 'v0');

    expect(moved?.filters).toEqual([]);
    expect(moved?.sorts).toEqual([{ id: 's1', propertyId: 'b-title', direction: 'desc' }]);
  });
});
