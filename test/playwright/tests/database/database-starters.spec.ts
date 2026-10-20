/**
 * The "New database" panel's Suggested templates (research/27 §1): Tasks
 * Tracker and Projects through the Customize modal, Skills at once. The panel
 * opens on every user insert, so no AI lever is given.
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

interface Property { id: string; name: string; type: string; config?: { options: Array<{ id: string; label: string; color?: string }> } }
interface View { name: string; type: string; groupBy?: string; filters: Array<{ propertyId: string; operator: string; value: unknown }>; timelineZoom?: string; showTimelineTable?: boolean; calculations?: Array<{ id: string; fn: string }> }
interface Database { title?: string; schema: Property[]; views: View[] }

const mount = async (page: Page): Promise<void> => {
  await page.evaluate(async () => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:1100px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: [{ id: 'p0', type: 'paragraph', data: { text: '' } }] },
      tools: {
        database: {
          class: (window as unknown as Record<string, unknown>).BlokDatabase,
        },
        'database-row': { class: (window as unknown as Record<string, unknown>).BlokDatabaseRow },
      },
    });
    await window.blokInstance.isReady;
  });
};

const insertDatabase = async (page: Page): Promise<void> => {
  await page.locator('[data-blok-id="p0"] [contenteditable]').focus();
  await page.keyboard.type('/database');
  const item = page.getByTestId('toolbox-popover').locator('[data-blok-item-name="database"]:visible');

  await expect(item).toContainText('Database');
  await item.click();
  await expect(page.getByTestId('database-new-database-panel')).toBeVisible();
};

const saved = async (page: Page): Promise<OutputBlockData[]> => page.evaluate(async () => (await window.blokInstance?.save())?.blocks ?? []);

const read = async (page: Page): Promise<{ db: Database; rows: OutputBlockData[]; children: (id: string | undefined) => OutputBlockData[] }> => {
  const blocks = await saved(page);
  const block = blocks.find((b) => b.type === 'database');
  const rows = blocks.filter((b) => b.type === 'database-row' && b.parent === block?.id);

  return { db: block?.data as unknown as Database, rows, children: (id: string | undefined) => blocks.filter((b) => b.parent !== undefined && b.parent === id) };
};

const nameOf = (db: Database, id: string | undefined): string | undefined => db.schema.find((p) => p.id === id)?.name;

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test('the panel lists the three Suggested templates; More templates is not there', async ({ page }) => {
  await mount(page);
  await insertDatabase(page);
  const panel = page.getByTestId('database-new-database-panel');

  await expect(panel.getByText('Suggested', { exact: true })).toBeVisible();
  await expect(panel.locator('[data-blok-database-panel-row]')).toHaveText(['New empty data source', 'Import CSV', 'Tasks Tracker', 'Projects', 'Skills', 'Link to existing data source']);
});

test('Tasks Tracker: Customize, then the measured schema, views and rows; one undo takes it all back', async ({ page }) => {
  await mount(page);
  await insertDatabase(page);
  await page.getByTestId('database-new-database-panel').getByRole('button', { name: 'Tasks Tracker' }).click();

  const dialog = page.getByRole('dialog', { name: 'Customize Tasks Tracker' });

  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Select features to turn on or off')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Priority' })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('button', { name: 'Updated at' })).toHaveAttribute('aria-pressed', 'false');
  await dialog.getByRole('button', { name: 'Get started' }).click();
  await expect(dialog.getByText('Select how you prefer to see your Tasks Tracker')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Checklist' })).toHaveAttribute('aria-pressed', 'false');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByRole('columnheader', { name: 'Task name' })).toBeVisible();
  await expect(page.getByText('Improve website copy')).toBeVisible();
  const { db, rows, children } = await read(page);

  expect(db.title).toBe('Tasks Tracker');
  expect(db.schema.map((p) => [p.name, p.type])).toEqual([
    ['Task name', 'title'], ['Status', 'status'], ['Assignee', 'person'], ['Due date', 'date'],
    ['Priority', 'select'], ['Task type', 'multiSelect'], ['Description', 'text'], ['Effort level', 'select'],
  ]);
  expect(db.schema.find((p) => p.name === 'Priority')?.config?.options.map((o) => [o.label, o.color])).toEqual([['High', 'red'], ['Medium', 'yellow'], ['Low', 'green']]);
  expect(db.views.map((v) => [v.name, v.type])).toEqual([['All Tasks', 'table'], ['By Status', 'board'], ['My Tasks', 'table']]);
  expect(nameOf(db, db.views[1].groupBy)).toBe('Status');
  expect(db.views[2].filters.map((f) => [nameOf(db, f.propertyId), f.operator, f.value])).toEqual([['Assignee', 'contains', ['me']]]);
  expect(rows.map((r) => (r.data as { title?: string }).title)).toEqual(['Improve website copy', 'Update help center & FAQ', 'Publish release notes']);
  expect(children(rows[0].id).map((b) => b.type)).toEqual(['header', 'paragraph', 'paragraph', 'header', 'list', 'list', 'list', 'header']);

  await page.evaluate(() => window.blokInstance?.history.undo());
  await expect.poll(async () => {
    const back = await read(page);

    return [back.db.title ?? '', back.db.schema.map((p) => p.name), back.rows.length];
  }).toEqual(['', ['Name'], 0]);
});

test('Projects: Gantt is a timeline grouped by Status at Month zoom with the table shown', async ({ page }) => {
  await mount(page);
  await insertDatabase(page);
  await page.getByTestId('database-new-database-panel').getByRole('button', { name: 'Projects' }).click();
  const dialog = page.getByRole('dialog', { name: 'Customize Projects' });

  await dialog.getByRole('button', { name: 'Get started' }).click();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();

  await expect.poll(async () => (await read(page)).rows.length).toBe(3);
  const { db, rows } = await read(page);
  const gantt = db.views.find((v) => v.name === 'Gantt');

  expect(db.title).toBe('Projects');
  expect(db.schema.map((p) => [p.name, p.type])).toEqual([
    ['Project name', 'title'], ['Assignee', 'person'], ['Priority', 'select'], ['Attach file', 'files'],
    ['End date', 'date'], ['Start date', 'date'], ['Status', 'status'], ['Team', 'multiSelect'],
  ]);
  expect(db.views.map((v) => [v.name, v.type])).toEqual([['By Status', 'board'], ['All Projects', 'table'], ['Gantt', 'timeline']]);
  expect([nameOf(db, gantt?.groupBy), gantt?.timelineZoom, gantt?.showTimelineTable]).toEqual(['Status', 'month', true]);
  expect(rows.map((r) => (r.data as { title?: string }).title)).toEqual(['Quarterly sales planning', 'Revamp new hire onboarding', 'Public launch of iOS app']);
});

test('Skills builds at once: five properties, Count on the title, no rows', async ({ page }) => {
  await mount(page);
  await insertDatabase(page);
  await page.getByTestId('database-new-database-panel').getByRole('button', { name: 'Skills' }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Skill name' })).toBeVisible();
  const { db, rows } = await read(page);

  expect(db.title).toBe('Skills');
  expect(db.schema.map((p) => [p.name, p.type])).toEqual([['Skill name', 'title'], ['Description', 'text'], ['Files', 'files'], ['Tags', 'multiSelect'], ['Created by', 'createdBy']]);
  expect(db.views).toHaveLength(1);
  expect(db.views[0].calculations).toEqual([{ id: db.schema[0].id, fn: 'count' }]);
  expect(rows).toHaveLength(0);
});
