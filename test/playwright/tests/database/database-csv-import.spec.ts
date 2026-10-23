/**
 * CSV import (research/26 §2, research/27 §2, research/30 §9): the preview,
 * "Use first row as headers", the Date type's format submenu, and Merge with CSV.
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

const NEUTRAL = [
  'Title,Contact,When',
  'Alpha,+1 555 123 4567,03/04/2026',
  'Bravo,(555) 123-4567,03/05/2026',
].join('\n');

const empty: OutputBlockData[] = [{ id: 'p0', type: 'paragraph', data: { text: '' } }];

const existing: OutputBlockData[] = [
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
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'R1', 'p-due': '2026-01-01' } } },
];

const mount = async (page: Page, blocks: OutputBlockData[]): Promise<void> => {
  await page.evaluate(async ({ input }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:1100px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: input } });
    await window.blokInstance.isReady;
  }, { input: blocks });
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

const grid = (page: Page): Locator => page.getByRole('grid');

/** ArrowDown until the row has keyboard focus. */
const arrowTo = async (page: Page, row: Locator): Promise<void> => {
  await expect(row).toBeVisible();
  for (const _ of Array.from({ length: 12 })) {
    if (await row.getAttribute('data-blok-focused') === 'true') return;
    await page.keyboard.press('ArrowDown');
  }
  await expect(row).toHaveAttribute('data-blok-focused', 'true');
};
// The preview is aria-hidden, so role locators do not reach its rows.
const rows = (preview: Locator): Locator => preview.locator('[data-blok-database-csv-preview-body] [data-blok-database-csv-preview-row]');

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('database CSV import', () => {
  test('preview, headers off and a Day/Month/Year date picked with the mouse reach the new database', async ({ page }) => {
    await mount(page, empty);
    const dialog = await openCsvDialog(page);
    const preview = dialog.getByTestId('database-csv-preview');

    await expect(preview).toBeVisible();
    await expect(preview).toContainText('New table');
    // A new import cannot merge, so it does not offer one.
    await expect(dialog.getByText('Create a new database with your CSV', { exact: true })).toBeVisible();

    await dialog.locator('[data-blok-database-csv-input]').setInputFiles({ name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from(NEUTRAL) });
    await expect(preview).toContainText('people');
    await expect(preview).not.toContainText('people.csv');
    await dialog.getByTestId('database-csv-map').click();

    // research/30 §9a: Phone comes from the values under a neutral header, and a "Title" header reads "Name".
    await expect(dialog.getByTestId('database-csv-type').nth(1)).toContainText('Phone');
    await expect(preview.locator('[data-blok-database-csv-preview-thead] [data-blok-database-csv-preview-cell]').first()).toHaveText('Name');
    await expect(rows(preview).first()).toContainText('Alpha');

    const headers = dialog.getByTestId('database-csv-headers');

    await expect(headers).toHaveAttribute('aria-checked', 'true');
    await headers.click();
    await expect(headers).toHaveAttribute('aria-checked', 'false');
    await expect(rows(preview).first()).toContainText('Title');

    // Notion opens the format submenu with ArrowRight only; here a hover opens it.
    await dialog.getByTestId('database-csv-type').nth(2).click();
    await page.locator('[data-blok-item-name="database-csv-type-new"]:visible').hover();
    await page.locator('[data-blok-item-name="database-csv-type-new-date"]:visible').hover();
    const dmy = page.locator('[data-blok-item-name="database-csv-date-day_month_year"]:visible');

    await expect(dmy).toBeVisible();
    await dmy.click();
    await expect(dialog.getByTestId('database-csv-type').nth(2)).toContainText('Day/Month/Year');
    await expect(rows(preview).nth(1)).toContainText('April 3, 2026');

    await dialog.getByTestId('database-csv-import').click();

    await expect(grid(page).getByRole('columnheader', { name: /Column 2/ })).toBeVisible();
    await expect(grid(page).getByRole('row').filter({ hasText: 'Alpha' })).toContainText('April 3, 2026');
    await expect(grid(page)).toContainText('Title');
  });

  // research/30 §9b: the keyboard path Notion has, ArrowRight into the format submenu.
  test('ArrowRight opens the date formats and Enter picks one', async ({ page }) => {
    await mount(page, empty);
    const dialog = await openCsvDialog(page);

    await dialog.locator('[data-blok-database-csv-input]').setInputFiles({ name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from(NEUTRAL) });
    await dialog.getByTestId('database-csv-map').click();
    await dialog.getByTestId('database-csv-type').nth(2).click();
    await arrowTo(page, page.locator('[data-blok-item-name="database-csv-type-new"]:visible'));
    await page.keyboard.press('ArrowRight');
    await arrowTo(page, page.locator('[data-blok-item-name="database-csv-type-new-date"]:visible'));
    await page.keyboard.press('ArrowRight');
    await arrowTo(page, page.locator('[data-blok-item-name="database-csv-date-day_month_year"]:visible'));
    await page.keyboard.press('Enter');
    await expect(dialog.getByTestId('database-csv-type').nth(2)).toContainText('Day/Month/Year');
  });

  // Notion: a click on the Date row picks Date with the default format; it does not open the formats.
  test('a click on the Date row picks Date at once', async ({ page }) => {
    await mount(page, empty);
    const dialog = await openCsvDialog(page);

    await dialog.locator('[data-blok-database-csv-input]').setInputFiles({ name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from(NEUTRAL) });
    await dialog.getByTestId('database-csv-map').click();
    await dialog.getByTestId('database-csv-type').nth(1).click();
    await page.locator('[data-blok-item-name="database-csv-type-new"]:visible').click();
    await page.locator('[data-blok-item-name="database-csv-type-new-date"]:visible').click();

    await expect(dialog.getByTestId('database-csv-type').nth(1)).toContainText('Date • Full date');
    await expect(page.locator('[data-blok-item-name="database-csv-date-full"]:visible')).toHaveCount(0);
    await expect(page.locator('[data-blok-item-name="database-csv-type-new-date"]:visible')).toHaveCount(0);
  });

  // research/30 §9f: the import dialog with "Import Location"; Due maps onto Due, Extra becomes a new Text property.
  test('Merge with CSV maps columns onto existing properties, adds an unmatched one, and only adds rows', async ({ page }) => {
    await mount(page, existing);
    await expect(grid(page)).toContainText('R1');
    await page.getByTestId('database-toolbar-settings').click();
    await page.getByTestId('database-settings-more').click();
    await page.getByTestId('database-settings-csv-merge').click();
    const dialog = page.getByRole('dialog');

    await expect(dialog.getByTestId('database-csv-location')).toHaveAttribute('aria-disabled', 'true');
    await expect(dialog.getByTestId('database-csv-location')).toHaveText('New database');
    // research/31 §5a: the field ends in an up/down chevron about 9x13 px.
    const chevron = dialog.getByTestId('database-csv-location').locator('[data-blok-database-csv-select-chevron]');

    expect(await chevron.evaluate((el) => {
      const svg = el.querySelector('svg');

      return {
        paths: [...el.querySelectorAll('path')].map((path) => path.getAttribute('d')),
        size: [svg?.getBoundingClientRect().width, svg?.getBoundingClientRect().height],
      };
    })).toEqual({ paths: ['M5.5 8L10 3.5L14.5 8', 'M5.5 12L10 16.5L14.5 12'], size: [20, 20] });
    // research/31 §5a: the merge dialog says it can merge.
    await expect(dialog.getByText('Create a new database with your CSV or merge it into an existing one', { exact: true })).toBeVisible();
    await dialog.locator('[data-blok-database-csv-input]').setInputFiles({ name: 'merge.csv', mimeType: 'text/csv', buffer: Buffer.from('Name,Due,Extra\nR1,2026-03-04,x1\nR9,2026-03-05,x9') });
    await dialog.getByTestId('database-csv-map').click();

    const types = dialog.getByTestId('database-csv-type');

    await expect(types).toHaveText(['Name', 'Due', 'Text']);
    await types.nth(1).click();
    await expect(page.locator('[data-blok-item-name="database-csv-type-existing-p-due"]:visible [data-blok-testid="popover-item-trailing-icon"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-blok-item-name="database-csv-type-existing-p-due"]:visible')).toHaveCount(0);
    await dialog.getByTestId('database-csv-import').click();
    await expect(dialog).toHaveCount(0);

    await expect(grid(page).getByRole('columnheader', { name: 'Extra' })).toBeVisible();
    await expect(grid(page).getByRole('row').filter({ hasText: 'R9' })).toContainText('x9');
    await expect(grid(page).getByRole('row').filter({ hasText: 'R9' })).toContainText('March 5, 2026');
    await expect(grid(page).getByRole('row').filter({ hasText: /^\s*R1/ })).toHaveCount(2);
    await expect(grid(page).getByRole('row').filter({ hasText: 'R1' }).first()).toContainText('January 1, 2026');
  });

  // research/31 §5b
  test('Merge with CSV matches headers in any case and never offers a Place property', async ({ page }) => {
    const [database, row] = existing;
    const schema = [
      { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
      { id: 'p-tag', name: 'Tag', type: 'select', position: 'a1', config: { options: [{ id: 'o1', label: 'alpha', position: 'a0' }] } },
      { id: 'p-where', name: 'Where', type: 'place', position: 'a2' },
    ];

    await mount(page, [{ ...database, data: { ...database.data, schema, views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['p-tag', 'p-where'] }] } }, row]);
    await expect(grid(page)).toContainText('R1');
    await page.getByTestId('database-toolbar-settings').click();
    await page.getByTestId('database-settings-more').click();
    await page.getByTestId('database-settings-csv-merge').click();
    const dialog = page.getByRole('dialog');

    await dialog.locator('[data-blok-database-csv-input]').setInputFiles({ name: 'merge.csv', mimeType: 'text/csv', buffer: Buffer.from('name,tag\nR7,alpha') });
    await dialog.getByTestId('database-csv-map').click();
    const types = dialog.getByTestId('database-csv-type');

    await expect(types).toHaveText(['Name', 'Tag']);
    await types.nth(1).click();
    await expect(page.locator('[data-blok-item-name="database-csv-type-existing-p-tag"]:visible [data-blok-testid="popover-item-trailing-icon"]')).toBeVisible();
    await expect(page.locator('[data-blok-item-name="database-csv-type-existing-p-title"]:visible')).toBeVisible();
    await expect(page.locator('[data-blok-item-name="database-csv-type-existing-p-where"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await dialog.getByTestId('database-csv-import').click();
    await expect(dialog).toHaveCount(0);

    await expect(grid(page).getByRole('row').filter({ hasText: 'R7' })).toContainText('alpha');
    await expect(grid(page).getByRole('columnheader', { name: 'tag', exact: true })).toHaveCount(0);
  });
});
