/**
 * Formula, relation and rollup, end to end in a table view.
 * Notion behaviour: https://www.notion.com/help/formulas,
 * https://www.notion.com/help/relations-and-rollups and research/08's
 * "+" flow (a self-relation shows both ways). Each case checks the saved
 * JSON, not only the DOM.
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

const SCHEMA = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-amount', name: 'Amount', type: 'number', position: 'a1' },
  { id: 'p-double', name: 'Double', type: 'formula', position: 'a2', formula: { expression: '{{property:p-amount}} * 2' } },
  { id: 'p-next', name: 'Next', type: 'relation', position: 'a3', relation: { targetDatabaseId: 'db-1', twoWay: true, syncedPropertyId: 'p-prev' } },
  { id: 'p-prev', name: 'Prev', type: 'relation', position: 'a4', relation: { targetDatabaseId: 'db-1', twoWay: true, syncedPropertyId: 'p-next' } },
  { id: 'p-total', name: 'Total', type: 'rollup', position: 'a5', rollup: { relationPropertyId: 'p-next', targetPropertyId: 'p-amount', function: 'sum' } },
];

const ROWS = [
  { id: 'r1', properties: { 'p-title': 'Alpha', 'p-amount': 1 } },
  { id: 'r2', properties: { 'p-title': 'Bravo', 'p-amount': 2 } },
  { id: 'r3', properties: { 'p-title': 'Charlie', 'p-amount': 4 } },
];

const blocks = (): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
    content: ROWS.map((row) => row.id),
  },
  ...ROWS.map((row, i) => ({
    id: row.id,
    type: 'database-row',
    data: { position: `a${String(i).padStart(3, '0')}`, properties: row.properties },
  })),
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
  await expect(page.getByRole('grid')).toBeVisible();
};

const savedProperties = async (page: Page, rowId: string): Promise<Record<string, unknown>> => page.evaluate(async (id) => {
  const output = await window.blokInstance?.save();
  const row = output?.blocks.find((block) => block.id === id);

  return (row?.data as { properties: Record<string, unknown> } | undefined)?.properties ?? {};
}, rowId);

const savedSchema = async (page: Page): Promise<Array<{ id: string; name: string; formula?: { expression: string } }>> => page.evaluate(async () => {
  const output = await window.blokInstance?.save();
  const db = output?.blocks.find((block) => block.id === 'db-1');

  return (db?.data as { schema: Array<{ id: string; name: string; formula?: { expression: string } }> }).schema;
});

const row = (page: Page, rowId: string): Locator => page.locator(`[data-blok-database-table-row][data-row-id="${rowId}"]`);
const cell = (page: Page, rowId: string, propertyId: string): Locator =>
  row(page, rowId).locator(`[role="gridcell"][data-property-id="${propertyId}"]`);
const header = (page: Page, propertyId: string): Locator => page.locator(`[role="columnheader"][data-property-id="${propertyId}"]`);
const editor = (page: Page): Locator => page.locator('[data-blok-database-cell-editor]');

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await mount(page, blocks());
});

test.describe('formula', () => {
  test('shows the result, follows its inputs, and is never saved as row data', async ({ page }) => {
    await expect(cell(page, 'r2', 'p-double')).toHaveText('4');

    await cell(page, 'r2', 'p-amount').click();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('10');
    await page.keyboard.press('Enter');

    await expect(cell(page, 'r2', 'p-double')).toHaveText('20');
    expect(await savedProperties(page, 'r2')).not.toHaveProperty('p-double');
  });

  test('the editor shows names, saves ids, and survives a rename', async ({ page }) => {
    await header(page, 'p-double').click();
    await page.getByRole('menuitem', { name: 'Edit property' }).click();
    const input = page.locator('[data-blok-database-formula-input]');

    await expect(input).toHaveValue('prop("Amount") * 2');
    await input.fill('prop("Amount") + 100');
    await expect(page.locator('[data-blok-database-formula-preview]')).toHaveText('101');
    await input.press('Enter');

    await expect(cell(page, 'r3', 'p-double')).toHaveText('104');
    expect((await savedSchema(page)).find((p) => p.id === 'p-double')?.formula?.expression).toBe('{{property:p-amount}} + 100');

    await header(page, 'p-amount').click();
    const name = page.locator('[data-blok-database-property-menu-name-input]');

    await name.fill('Price');
    await name.press('Enter');

    await expect(cell(page, 'r3', 'p-double')).toHaveText('104');
    await header(page, 'p-double').click();
    await page.getByRole('menuitem', { name: 'Edit property' }).click();
    await expect(page.locator('[data-blok-database-formula-input]')).toHaveValue('prop("Price") + 100');
  });

  test('a compile error shows its message and keeps the saved formula', async ({ page }) => {
    await header(page, 'p-double').click();
    await page.getByRole('menuitem', { name: 'Edit property' }).click();
    const input = page.locator('[data-blok-database-formula-input]');

    await input.fill('prop("Nope") + 1');
    await expect(page.locator('[data-blok-database-formula-error-message]')).toHaveText('Unknown property "Nope"');
    await expect(page.locator('[data-blok-database-formula-error-range]')).toHaveText('prop("Nope")');
    await input.press('Enter');

    expect((await savedSchema(page)).find((p) => p.id === 'p-double')?.formula?.expression).toBe('{{property:p-amount}} * 2');
  });
});

test.describe('relation and rollup', () => {
  test('relating a row writes both sides of a two-way relation, and one undo takes both back', async ({ page }) => {
    await cell(page, 'r1', 'p-next').click();
    await page.keyboard.press('Enter');
    await expect(editor(page)).toBeVisible();
    await editor(page).locator('[data-blok-database-relation-option="r2"]').click();
    await page.keyboard.press('Escape');

    await expect(cell(page, 'r1', 'p-next').locator('[data-blok-database-relation-chip]')).toHaveText(['Bravo']);
    await expect(cell(page, 'r2', 'p-prev').locator('[data-blok-database-relation-chip]')).toHaveText(['Alpha']);
    expect((await savedProperties(page, 'r1'))['p-next']).toEqual([{ id: 'r2' }]);
    expect((await savedProperties(page, 'r2'))['p-prev']).toEqual([{ id: 'r1' }]);

    await page.locator('[data-blok-database-table-grid]').click({ position: { x: 1, y: 1 } });
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+z');

    await expect(cell(page, 'r1', 'p-next').locator('[data-blok-database-relation-chip]')).toHaveCount(0);
    await expect(cell(page, 'r2', 'p-prev').locator('[data-blok-database-relation-chip]')).toHaveCount(0);
  });

  test('a rollup sums the related rows and follows a change', async ({ page }) => {
    await cell(page, 'r1', 'p-next').click();
    await page.keyboard.press('Enter');
    await editor(page).locator('[data-blok-database-relation-option="r2"]').click();
    await editor(page).locator('[data-blok-database-relation-option="r3"]').click();
    await page.keyboard.press('Escape');

    await expect(cell(page, 'r1', 'p-total')).toHaveText('6');
    expect(await savedProperties(page, 'r1')).not.toHaveProperty('p-total');
  });

  test('a chip opens the related row', async ({ page }) => {
    await cell(page, 'r1', 'p-next').click();
    await page.keyboard.press('Enter');
    await editor(page).locator('[data-blok-database-relation-option="r3"]').click();
    await page.keyboard.press('Escape');

    await cell(page, 'r1', 'p-next').locator('[data-blok-database-relation-chip]').click();

    await expect(page.locator('[data-blok-database-drawer]')).toBeVisible();
    await expect(page.locator('[data-blok-database-drawer]')).toContainText('Charlie');
  });

  test('deleting a related row takes it out of the relation', async ({ page }) => {
    await cell(page, 'r1', 'p-next').click();
    await page.keyboard.press('Enter');
    await editor(page).locator('[data-blok-database-relation-option="r2"]').click();
    await page.keyboard.press('Escape');

    await row(page, 'r2').locator('[data-blok-database-table-row-handle]').click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();

    await expect(row(page, 'r2')).toHaveCount(0);
    await expect(cell(page, 'r1', 'p-next').locator('[data-blok-database-relation-chip]')).toHaveCount(0);
    expect((await savedProperties(page, 'r1'))['p-next']).toEqual([]);
  });
});
