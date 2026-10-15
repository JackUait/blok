/**
 * Person property "Edit property" (research/16 §5): Limit, Default and
 * Notifications, each with Notion's choices and default.
 */

import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    BlokDatabase: unknown;
    BlokDatabaseRow: unknown;
    blokInstance?: Blok;
  }
}

const blocks = (): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [
        { id: 'p-name', name: 'Name', type: 'title', position: 'a0' },
        { id: 'p-owner', name: 'Owner', type: 'person', position: 'a1' },
      ],
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['p-name', 'p-owner'] }],
      activeViewId: 'v1',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-name': 'Alpha', 'p-owner': [] } } },
];

const mount = async (page: Page, input: OutputBlockData[], me: string | null): Promise<void> => {
  await page.evaluate(async ({ data, meId }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(holder);
    const people = {
      list: async () => [{ id: 'u-ada', name: 'Ada Lovelace' }, { id: 'u-grace', name: 'Grace Hopper' }, { id: 'u-me', name: 'Jack' }],
      ...(meId === null ? {} : { me: () => meId }),
    };

    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: data },
      tools: {
        database: { class: window.BlokDatabase, config: { people } },
        'database-row': { class: window.BlokDatabaseRow },
      },
    });
    await window.blokInstance.isReady;
  }, { data: input, meId: me });
  await expect(page.getByRole('grid').first()).toBeVisible();
};

const saved = async (page: Page): Promise<{ owner: Record<string, unknown> | undefined; rows: Array<Record<string, unknown>> }> => page.evaluate(async () => {
  const output = await window.blokInstance?.save();
  const db = output?.blocks.find((block) => block.id === 'db-1');
  const schema = (db?.data as { schema: Array<Record<string, unknown>> }).schema;

  return {
    owner: schema.find((p) => p.id === 'p-owner'),
    rows: (output?.blocks ?? []).filter((block) => block.type === 'database-row').map((block) => (block.data as { properties: Record<string, unknown> }).properties),
  };
});

const header = (page: Page): Locator => page.getByRole('columnheader', { name: 'Owner' });
const openMenu = (page: Page): Locator => page.locator('[data-blok-popover-opened="true"]').last();
const ownerCell = (page: Page, rowId: string): Locator =>
  page.locator(`[data-blok-database-table-row][data-row-id="${rowId}"] [role="gridcell"][data-property-id="p-owner"]`);

const openEditProperty = async (page: Page): Promise<void> => {
  await header(page).click();
  await openMenu(page).getByRole('menuitem', { name: 'Edit property' }).click();
};

const pick = async (page: Page, row: RegExp, choice: string): Promise<void> => {
  await openEditProperty(page);
  await openMenu(page).getByRole('menuitem', { name: row }).click();
  await page.getByRole('menuitemcheckbox', { name: choice, exact: true }).last().click();
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test('Edit property lists Limit, Default and Notifications with Notion\'s defaults', async ({ page }) => {
  await mount(page, blocks(), 'u-me');
  await openEditProperty(page);

  const menu = openMenu(page);

  await expect(menu.getByRole('menuitem', { name: /^Limit/ })).toContainText('No limit');
  await expect(menu.getByRole('menuitem', { name: /^Default/ })).toContainText('No default');
  await expect(menu.getByRole('menuitem', { name: /^Notifications/ })).toContainText('Users only');
});

test('Limit "1 Person" makes the picker replace the chosen person', async ({ page }) => {
  await mount(page, blocks(), 'u-me');
  await pick(page, /^Limit/, '1 Person');
  await expect.poll(async () => (await saved(page)).owner?.person).toEqual({ limit: 1 });
  await page.keyboard.press('Escape');

  await ownerCell(page, 'r1').click();
  await page.getByRole('option', { name: 'Ada Lovelace' }).click();
  await page.getByRole('option', { name: 'Grace Hopper' }).click();

  await expect(page.getByRole('listbox')).toHaveAttribute('aria-multiselectable', 'false');
  await expect.poll(async () => (await saved(page)).rows[0]['p-owner']).toEqual([{ id: 'u-grace' }]);
});

test('Default "Created by" gives a new row the current user', async ({ page }) => {
  await mount(page, blocks(), 'u-me');
  await pick(page, /^Default/, 'Created by');
  await expect.poll(async () => (await saved(page)).owner?.person).toEqual({ default: 'createdBy' });
  await page.keyboard.press('Escape');

  await page.locator('[data-blok-database-table-add-row]').click();

  await expect.poll(async () => (await saved(page)).rows.map((properties) => properties['p-owner'])).toEqual([[], [{ id: 'u-me' }]]);
});

test('Default "Created by" leaves a new row empty when no current user is known', async ({ page }) => {
  const input = blocks();

  input[0] = { ...input[0], data: { ...input[0].data, schema: [
    { id: 'p-name', name: 'Name', type: 'title', position: 'a0' },
    { id: 'p-owner', name: 'Owner', type: 'person', position: 'a1', person: { default: 'createdBy' } },
  ] } };
  await mount(page, input, null);
  await page.locator('[data-blok-database-table-add-row]').click();

  await expect.poll(async () => (await saved(page)).rows.map((properties) => properties['p-owner'])).toEqual([[], []]);
});

test('Notifications "None" is stored on the property and shown as the current choice', async ({ page }) => {
  await mount(page, blocks(), 'u-me');
  await pick(page, /^Notifications/, 'None');
  await expect.poll(async () => (await saved(page)).owner?.person).toEqual({ notifications: 'none' });
  await page.keyboard.press('Escape');

  await openEditProperty(page);
  await expect(openMenu(page).getByRole('menuitem', { name: /^Notifications/ })).toContainText('None');
});
