/**
 * Dashboard view: Add view makes it, "Add widget" fills it, a header drag
 * moves a widget, and a reload draws the same layout. Notion's widget editor
 * is unmeasured (paid plan), so this checks behaviour and saved data, not looks.
 */

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

const SCHEMA = [
  { id: 'p-title', name: 'Task', type: 'title', position: 'a0' },
  {
    id: 'p-status',
    name: 'Status',
    type: 'select',
    position: 'a1',
    config: { options: [{ id: 'o-todo', label: 'Todo', position: 'a0' }, { id: 'o-done', label: 'Done', position: 'a1' }] },
  },
  { id: 'p-points', name: 'Points', type: 'number', position: 'a2' },
];

const BLOCKS: OutputBlockData[] = [
  {
    id: 'db-1',
    type: 'database',
    data: {
      title: 'Tasks',
      schema: SCHEMA,
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['p-status', 'p-points'] }],
      activeViewId: 'v1',
    },
    content: ['r1', 'r2'],
  },
  { id: 'r1', type: 'database-row', data: { position: 'a0', properties: { 'p-title': 'Write', 'p-status': 'o-todo', 'p-points': 3 } } },
  { id: 'r2', type: 'database-row', data: { position: 'a1', properties: { 'p-title': 'Ship', 'p-status': 'o-done', 'p-points': 5 } } },
];

const mount = async (page: Page, data: OutputBlockData[]): Promise<void> => {
  await page.evaluate(async (input) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: input } });
    await window.blokInstance.isReady;
  }, data);
};

const saved = async (page: Page): Promise<OutputBlockData[]> => page.evaluate(async () => (await window.blokInstance?.save())?.blocks ?? []);

interface SavedView { id: string; type: string; dashboardViewId?: string; dashboard?: { rows: Array<{ widgets: Array<{ viewId: string }> }> } }

const views = async (page: Page): Promise<SavedView[]> =>
  ((await saved(page)).find((block) => block.id === 'db-1')?.data as { views: SavedView[] }).views;

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 1000 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test('make a dashboard, add widgets, move one by drag, and reload it', async ({ page }) => {
  await mount(page, BLOCKS);
  await page.getByRole('button', { name: 'Add view' }).first().click({ force: true });
  await page.locator('[data-blok-database-view-option="dashboard"]').click();

  await expect(page.getByRole('tab', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('Add charts, numbers, tables and lists.')).toBeVisible();

  for (const kind of ['Chart', 'Number', 'Table']) {
    await page.getByTestId('database-dashboard-add-widget').click();
    await page.getByRole('menuitem', { name: kind }).or(page.locator('[data-blok-popover-opened] [data-blok-popover-item]', { hasText: kind })).first().click();
  }
  await expect(page.locator('[data-blok-database-dashboard-widget]')).toHaveCount(3);
  await expect(page.locator('[data-blok-database-chart-number]')).toHaveText('2');
  await expect(page.locator('[data-blok-database-dashboard-widget-error]')).toHaveCount(0);

  const before = await views(page);
  const dash = before.find((view) => view.type === 'dashboard');
  const widgetIds = before.filter((view) => view.dashboardViewId === dash?.id).map((view) => view.id);

  expect(dash?.dashboard?.rows.map((row) => row.widgets.map((widget) => widget.viewId))).toEqual([[widgetIds[0], widgetIds[1]], [widgetIds[2]]]);
  await expect(page.locator('[data-blok-database-tab][data-view-id]')).toHaveCount(2);

  // Drag the table widget (second row) into the first row, after the number.
  const header = page.locator('[data-blok-database-dashboard-widget] [data-blok-database-dashboard-widget-header]').nth(2);
  const target = page.locator('[data-blok-database-dashboard-widget]').nth(1);
  const from = await header.boundingBox();
  const to = await target.boundingBox();

  if (from === null || to === null) throw new Error('no boxes');
  await page.mouse.move(from.x + 40, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 60, from.y + from.height / 2, { steps: 4 });
  await page.mouse.move(to.x + to.width - 10, to.y + to.height / 2, { steps: 8 });
  await expect(page.locator('[data-blok-database-dashboard-drop="column"]')).toHaveCount(1);
  await page.mouse.up();

  await expect.poll(async () => (await views(page)).find((view) => view.id === dash?.id)?.dashboard?.rows.map((row) => row.widgets.map((widget) => widget.viewId)))
    .toEqual([[widgetIds[0], widgetIds[1], widgetIds[2]]]);

  await mount(page, await saved(page));
  await expect(page.locator('[data-blok-database-dashboard-row]')).toHaveCount(1);
  await expect(page.locator('[data-blok-database-dashboard-widget]')).toHaveCount(3);
  await expect(page.locator('[data-blok-database-chart-number]')).toHaveText('2');
});
