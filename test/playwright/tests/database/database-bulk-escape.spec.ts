/**
 * Escape in the Place editor and in bulk editors (research/31 §4).
 * Two Notion behaviours lose data and are not copied:
 * - typing into a filled place clears it before a result is picked;
 * - a bulk Place opens on the first row's place, and one key clears every row.
 */

import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
    BlokDatabase: unknown;
    BlokDatabaseRow: unknown;
  }
}

const PARIS = { name: 'Paris', address: 'Paris, Ile-de-France, France', lat: 48.85, lon: 2.35 };

const SCHEMA = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-notes', name: 'Notes', type: 'text', position: 'a1' },
  { id: 'p-due', name: 'Due', type: 'date', position: 'a2' },
  { id: 'p-tag', name: 'Tag', type: 'select', position: 'a3', config: { options: [] } },
  { id: 'p-where', name: 'Where', type: 'place', position: 'a4' },
];

const blocks = (rows: Array<{ id: string; properties: Record<string, unknown> }>): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
    content: rows.map((row) => row.id),
  },
  ...rows.map((row, i) => ({ id: row.id, type: 'database-row', parent: 'db-1', data: { position: `a${i}`, properties: row.properties } })),
];

const ROWS = [
  { id: 'r1', properties: { 'p-title': 'R1', 'p-notes': 'bulkA', 'p-where': PARIS } },
  { id: 'r2', properties: { 'p-title': 'R2', 'p-notes': 'bulkA' } },
  { id: 'r3', properties: { 'p-title': 'R3', 'p-notes': 'bulkA' } },
];

const mount = async (page: Page): Promise<void> => {
  await page.evaluate(async (input) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:1100px;margin:80px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: input },
      tools: {
        database: {
          class: window.BlokDatabase,
          config: { map: { geocode: () => Promise.resolve([{ name: 'Berlin', address: 'Berlin, Germany', lat: 52.52, lon: 13.4 }]) } },
        },
        'database-row': { class: window.BlokDatabaseRow },
      },
    });
    await window.blokInstance.isReady;
  }, blocks(ROWS));
  await expect(page.getByRole('grid')).toBeVisible();
};

const properties = async (page: Page): Promise<Record<string, Record<string, unknown>>> => page.evaluate(async () => {
  const output = await window.blokInstance?.save();
  const rows: Record<string, Record<string, unknown>> = {};

  (output?.blocks ?? [])
    .filter((block) => block.type === 'database-row')
    .forEach((block) => {
      rows[block.id ?? ''] = (block.data as { properties: Record<string, unknown> }).properties;
    });

  return rows;
});

const column = async (page: Page, propertyId: string): Promise<unknown[]> =>
  Object.values(await properties(page)).map((values) => values[propertyId]);

const row = (page: Page, rowId: string): Locator => page.locator(`[data-blok-database-table-row][data-row-id="${rowId}"]`);
const cell = (page: Page, rowId: string, propertyId: string): Locator =>
  row(page, rowId).locator(`[role="gridcell"][data-property-id="${propertyId}"]`);
const editor = (page: Page): Locator => page.locator('[data-blok-database-cell-editor]');
const bar = (page: Page): Locator => page.locator('[data-blok-database-table-selection-bar]');

const selectAll = async (page: Page): Promise<void> => {
  await row(page, 'r1').hover();
  await row(page, 'r1').locator('[data-blok-database-table-row-checkbox]').click();
  await row(page, 'r3').hover();
  await row(page, 'r3').locator('[data-blok-database-table-row-checkbox]').click({ modifiers: ['Shift'] });
  await expect(bar(page).locator('[data-blok-database-table-selection-count]')).toHaveText('3 selected');
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.BlokDatabase === 'function');
  await mount(page);
});

test.describe('place editor', () => {
  test('Escape after typing a search keeps the saved place', async ({ page }) => {
    await cell(page, 'r1', 'p-where').click();
    await page.keyboard.type('Ber');
    await expect(page.locator('[data-blok-database-place-result]')).toHaveCount(1);
    await page.keyboard.press('Escape');

    await expect(editor(page)).toHaveCount(0);
    expect((await properties(page)).r1['p-where']).toEqual(PARIS);
  });

  test('a press outside with an unpicked search keeps the saved place', async ({ page }) => {
    await cell(page, 'r1', 'p-where').click();
    await page.keyboard.type('Ber');
    await expect(page.locator('[data-blok-database-place-result]')).toHaveCount(1);
    await page.mouse.click(20, 20);

    await expect(editor(page)).toHaveCount(0);
    expect((await properties(page)).r1['p-where']).toEqual(PARIS);
  });

  test('a picked result saves at once and the editor stays open on it (research/31 §4a)', async ({ page }) => {
    await cell(page, 'r2', 'p-where').click();
    await page.keyboard.type('Ber');
    await page.locator('[data-blok-database-place-result]').click();

    await expect(editor(page).locator('[data-blok-database-place-name]')).toHaveText('Berlin');
    await expect(cell(page, 'r2', 'p-where')).toHaveText('Berlin');
    await expect.poll(async () => (await properties(page)).r2['p-where']).toEqual({ name: 'Berlin', address: 'Berlin, Germany', lat: 52.52, lon: 13.4 });
  });
});

test.describe('bulk editors', () => {
  test('Text opens on the value every selected row shares', async ({ page }) => {
    await selectAll(page);
    await bar(page).getByRole('button', { name: 'Notes' }).click();

    await expect(editor(page).locator('[data-blok-database-cell-input]')).toHaveValue('bulkA');
  });

  test('Text shows each key in every selected cell while typing', async ({ page }) => {
    await selectAll(page);
    await bar(page).getByRole('button', { name: 'Notes' }).click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Zed');

    await expect(cell(page, 'r1', 'p-notes')).toHaveText('Zed');
    await expect(cell(page, 'r3', 'p-notes')).toHaveText('Zed');
  });

  test('Text keeps the typed value on Escape and clears the selection; one undo takes it back', async ({ page }) => {
    await selectAll(page);
    await bar(page).getByRole('button', { name: 'Notes' }).click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Zed');
    await page.keyboard.press('Escape');

    await expect.poll(() => column(page, 'p-notes')).toEqual(['Zed', 'Zed', 'Zed']);
    await expect(bar(page)).toHaveCount(0);

    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => column(page, 'p-notes')).toEqual(['bulkA', 'bulkA', 'bulkA']);
  });

  test('Select: Escape drops the typed option and keeps the selection; Enter on Create sets every row and clears it', async ({ page }) => {
    await selectAll(page);
    await bar(page).getByRole('button', { name: 'Tag' }).click();
    await page.keyboard.type('alpha');
    await page.keyboard.press('Escape');

    await expect(editor(page)).toHaveCount(0);
    await expect(bar(page)).toHaveCount(1);
    expect(await column(page, 'p-tag')).toEqual([undefined, undefined, undefined]);

    await bar(page).getByRole('button', { name: 'Tag' }).click();
    await page.keyboard.type('alpha');
    await page.keyboard.press('Enter');

    await expect.poll(async () => (await column(page, 'p-tag')).every((value) => typeof value === 'string' && value !== '')).toBe(true);
    await expect(editor(page)).toHaveCount(0);
    await expect(bar(page)).toHaveCount(0);
  });

  test('Date opens on today without writing, and Escape then writes nothing', async ({ page }) => {
    await selectAll(page);
    await bar(page).getByRole('button', { name: 'Due' }).click();

    await expect(page.locator('[data-blok-database-date-input="start"]')).not.toHaveValue('');
    expect(await column(page, 'p-due')).toEqual([undefined, undefined, undefined]);
    await page.keyboard.press('Escape');
    await expect(editor(page)).toHaveCount(0);
    expect(await column(page, 'p-due')).toEqual([undefined, undefined, undefined]);
  });

  test('Date saves a typed date on Escape and keeps the selection; one undo takes it back', async ({ page }) => {
    await selectAll(page);
    await bar(page).getByRole('button', { name: 'Due' }).click();
    await page.locator('[data-blok-database-date-input="start"]').fill('Oct 5, 2026');
    await page.keyboard.press('Escape');

    await expect.poll(() => column(page, 'p-due')).toEqual(['2026-10-05', '2026-10-05', '2026-10-05']);
    await expect(bar(page)).toHaveCount(1);

    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => column(page, 'p-due')).toEqual([undefined, undefined, undefined]);
  });

  test('Place opens empty on mixed rows, and Escape after typing writes nothing', async ({ page }) => {
    await selectAll(page);
    await bar(page).getByRole('button', { name: 'Where' }).click();
    const field = editor(page).locator('[data-blok-database-cell-input]');

    await expect(field).toHaveValue('');
    await expect(editor(page).locator('[data-blok-database-place-chip]')).toHaveCount(0);
    await page.keyboard.type('B');
    await page.keyboard.press('Escape');

    await expect(editor(page)).toHaveCount(0);
    await expect(bar(page)).toHaveCount(1);
    expect(await column(page, 'p-where')).toEqual([PARIS, undefined, undefined]);
  });
});
