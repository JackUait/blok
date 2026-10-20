/**
 * Help links and the time zone search (research/23 §1, research/26 §2).
 * "Learn about reminders" and "Learn about imports" show only with the host's
 * `config.helpLinks`.
 */

import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

const REMINDERS = 'https://example.com/help/reminders';
const IMPORTS = 'https://example.com/help/imports';

const table: OutputBlockData[] = [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [
        { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
        { id: 'p-due', name: 'Due', type: 'date', position: 'a1' },
      ],
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['p-due'] }],
      activeViewId: 'v1',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', data: { position: 'a0', properties: { 'p-title': 'Alpha', 'p-due': '2026-10-12' } } },
];

const empty: OutputBlockData[] = [{ id: 'p0', type: 'paragraph', data: { text: '' } }];

const mount = async (page: Page, blocks: OutputBlockData[], lever: boolean): Promise<void> => {
  await page.evaluate(async ({ input, withLever, urls }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:1100px;margin:40px auto 0';
    document.body.appendChild(holder);
    const tools = window as unknown as Record<string, unknown>;

    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: input },
      tools: {
        database: { class: tools.BlokDatabase, config: withLever ? { helpLinks: urls } : {} },
        'database-row': { class: tools.BlokDatabaseRow },
      },
    });
    await window.blokInstance.isReady;
  }, { input: blocks, withLever: lever, urls: { reminders: REMINDERS, imports: IMPORTS } });
};

const picker = (page: Page): Locator => page.locator('[data-blok-database-date-editor]');
const openDate = async (page: Page): Promise<void> => {
  const cell = page.getByRole('gridcell').and(page.locator('[data-property-id="p-due"]')).first();

  await cell.click();
  if (await picker(page).count() === 0) {
    await page.keyboard.press('Enter');
  }
  await expect(picker(page)).toBeVisible();
};

const openCsvDialog = async (page: Page): Promise<Locator> => {
  await page.locator('[data-blok-id="p0"] [contenteditable]').focus();
  await page.keyboard.type('/database');
  const item = page.getByTestId('toolbox-popover').locator('[data-blok-item-name="database"]:visible');

  await expect(item).toContainText('Database');
  await item.click();
  await page.getByTestId('database-new-database-panel').getByTestId('database-new-source-csv').click();
  const dialog = page.getByRole('dialog');

  await expect(dialog.getByTestId('database-csv-map')).toBeVisible();

  return dialog;
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test('"Learn about reminders" is the date picker\'s last row, a 28px link to the host URL', async ({ page }) => {
  await mount(page, table, true);
  await openDate(page);

  const link = picker(page).getByRole('link', { name: 'Learn about reminders' });

  await expect(link).toHaveAttribute('href', REMINDERS);
  await expect(link).toHaveAttribute('target', '_blank');
  const look = await link.evaluate((el) => {
    const icon = el.querySelector('svg');
    const options = el.closest('[data-blok-database-date-options]');

    return {
      // Layout sizes: the picker's open motion scales its box for a moment.
      height: (el as HTMLElement).offsetHeight,
      icon: icon === null ? '' : getComputedStyle(icon).width,
      iconInk: icon === null ? '' : getComputedStyle(icon).color,
      last: options?.lastElementChild?.contains(el) ?? false,
      line: getComputedStyle(el.parentElement ?? el).borderTopWidth,
    };
  });

  expect(look).toEqual({ height: 28, icon: '20px', iconInk: 'rgb(142, 139, 134)', last: true, line: '1px' });
});

test('without config.helpLinks neither help link shows', async ({ page }) => {
  await mount(page, table, false);
  await openDate(page);
  await expect(picker(page).locator('[data-blok-database-date-clear]')).toBeVisible();
  await expect(picker(page).getByRole('link')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await mount(page, empty, false);
  const dialog = await openCsvDialog(page);

  await expect(dialog.getByRole('link')).toHaveCount(0);
});

test('"Learn about imports" sits 8px under Map CSV headers, centred and gray', async ({ page }) => {
  await mount(page, empty, true);
  const dialog = await openCsvDialog(page);
  const link = dialog.getByRole('link', { name: 'Learn about imports' });

  await expect(link).toHaveAttribute('href', IMPORTS);
  await expect(link).toHaveAttribute('target', '_blank');
  const map = await dialog.getByTestId('database-csv-map').boundingBox();
  const box = await link.boundingBox();

  expect(box?.height).toBe(32);
  expect(Math.round((box?.y ?? 0) - ((map?.y ?? 0) + (map?.height ?? 0)))).toBe(8);
  expect(box?.width).toBe(map?.width);
  await expect(link).toHaveCSS('color', 'rgb(142, 139, 134)');
  await expect(link).toHaveCSS('justify-content', 'center');
});

// research/23 §1: "tok" found Vostok, Tokyo, Vladivostok, then Khartoum…; it is not a substring search.
test('time zone search: "tok" lists exact matches first, then near ones like Khartoum', async ({ page }) => {
  await mount(page, table, false);
  await openDate(page);
  await page.locator('[data-blok-database-date-time-toggle]').click();
  await page.locator('[data-blok-database-date-setting="timeZone"]').click();
  const menu = page.locator('[data-blok-database-date-setting-menu="timeZone"]');

  await menu.locator('[data-blok-database-date-zone-search]').fill('tok');
  const cities = menu.locator('[data-blok-database-date-setting-option] [data-blok-database-date-zone-city]');

  await expect(cities.nth(0)).toHaveText('Vostok');
  await expect(cities.nth(1)).toHaveText('Tokyo');
  await expect(cities.nth(2)).toHaveText('Vladivostok');
  await expect(cities.nth(3)).toHaveText('Khartoum');
  await expect(menu.locator('[data-blok-database-date-setting-option="America/Toronto"]')).toHaveCount(0);
  await menu.locator('[data-blok-database-date-zone-search]').fill('zzqx');
  await expect(menu.locator('[data-blok-database-date-zone-empty]')).toHaveText('No results');
});
