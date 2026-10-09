/**
 * Cell editors in the row drawer: select with create, date, number and checkbox.
 * Notion behaviour: https://www.notion.com/help/database-properties
 * (select: "Type and press Enter to create tags"; date picker with End date,
 * Include time and Clear). Each case checks the saved JSON, not only the DOM.
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

const BLOCKS: OutputBlockData[] = [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [
        { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
        {
          id: 'prop-status',
          name: 'Status',
          type: 'select',
          position: 'a1',
          config: {
            options: [
              { id: 'opt-a', label: 'Todo', color: 'gray', position: 'a0' },
              { id: 'opt-b', label: 'Doing', color: 'blue', position: 'a1' },
            ],
          },
        },
        { id: 'prop-due', name: 'Due', type: 'date', position: 'a2' },
        { id: 'prop-score', name: 'Score', type: 'number', position: 'a3' },
        { id: 'prop-done', name: 'Done', type: 'checkbox', position: 'a4' },
      ],
      views: [
        { id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: ['prop-title'] },
      ],
      activeViewId: 'view-1',
    },
    content: ['row-1'],
  },
  {
    id: 'row-1',
    type: 'database-row',
    data: {
      position: 'a0',
      properties: { 'prop-title': 'Ship it', 'prop-status': 'opt-a', 'prop-due': '2026-10-09', 'prop-score': 5, 'prop-done': false },
    },
  },
];

interface Saved {
  properties: Record<string, unknown>;
  options: Array<{ id: string; label: string; color?: string; position: string }>;
}

const saved = async (page: Page): Promise<Saved> => page.evaluate(async () => {
  const output = await window.blokInstance?.save();
  const row = output?.blocks.find((block) => block.id === 'row-1');
  const db = output?.blocks.find((block) => block.id === 'db-1');
  const schema = (db?.data as { schema: Array<{ id: string; config?: { options: Saved['options'] } }> }).schema;

  return {
    properties: (row?.data as { properties: Record<string, unknown> }).properties,
    options: schema.find((p) => p.id === 'prop-status')?.config?.options ?? [],
  };
});

const value = (page: Page, propertyId: string): ReturnType<Page['locator']> =>
  page.locator(`[data-blok-database-drawer-prop-value][data-property-id="${propertyId}"]`);

const editor = (page: Page): ReturnType<Page['locator']> => page.locator('[data-blok-database-cell-editor]');

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async (data) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:760px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: data } });
    await window.blokInstance.isReady;
  }, BLOCKS);
  await page.locator('[data-blok-database-card]').first().click();
  await expect(page.locator('[data-blok-database-drawer]')).toBeVisible();
});

test('select: typing a new name and Enter creates the option and picks it', async ({ page }) => {
  await value(page, 'prop-status').click();
  await expect(editor(page)).toBeVisible();

  await page.keyboard.type('Blocked');
  await page.keyboard.press('Enter');

  await expect(editor(page)).toHaveCount(0);
  await expect(value(page, 'prop-status')).toHaveText('Blocked');
  await expect(page.locator('[data-blok-database-drawer]')).toBeVisible();

  const { properties, options } = await saved(page);
  const created = options.find((option) => option.label === 'Blocked');

  expect(created).toBeDefined();
  // Two options existed, so the deterministic pick is the third color.
  expect(created?.color).toBe('brown');
  expect((created?.position ?? '') > 'a1').toBe(true);
  expect(properties['prop-status']).toBe(created?.id);
});

test('date: picking a day saves YYYY-MM-DD; Escape closes only the picker', async ({ page }) => {
  await value(page, 'prop-due').click();
  await expect(editor(page)).toBeVisible();

  await page.locator('[data-blok-database-date-day="2026-10-20"]').click();
  await page.keyboard.press('Escape');

  await expect(editor(page)).toHaveCount(0);
  await expect(page.locator('[data-blok-database-drawer]')).toBeVisible();
  expect((await saved(page)).properties['prop-due']).toBe('2026-10-20');
});

test('number: an invalid entry is rejected and the value stays a number', async ({ page }) => {
  await value(page, 'prop-score').click();
  const input = editor(page).locator('[data-blok-database-cell-input="number"]');

  await input.fill('12abc');
  await input.press('Enter');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await input.press('Escape');
  expect((await saved(page)).properties['prop-score']).toBe(5);

  await value(page, 'prop-score').click();
  await editor(page).locator('[data-blok-database-cell-input="number"]').fill('42.5');
  await page.keyboard.press('Enter');

  await expect(value(page, 'prop-score')).toHaveText('42.5');
  expect((await saved(page)).properties['prop-score']).toBe(42.5);
});

test('checkbox: a click flips the saved boolean with no popover', async ({ page }) => {
  await value(page, 'prop-done').click();

  await expect(editor(page)).toHaveCount(0);
  await expect(value(page, 'prop-done').locator('[data-blok-database-checkbox]')).toHaveAttribute('data-state', 'checked');
  expect((await saved(page)).properties['prop-done']).toBe(true);
});
