/**
 * Board column calculation (research/16 §1): the number beside each group
 * name opens a calculation menu, and the pick applies to every column.
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
  { id: 'p-name', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-points', name: 'Points', type: 'number', position: 'a1' },
  { id: 'p-link', name: 'Link', type: 'url', position: 'a2' },
  {
    id: 'p-stage',
    name: 'Stage',
    type: 'select',
    position: 'a3',
    config: {
      options: [
        { id: 'o-todo', label: 'Not started', color: 'gray', position: 'a0' },
        { id: 'o-doing', label: 'In progress', color: 'blue', position: 'a1' },
      ],
    },
  },
];

const ROWS = [
  { id: 'r1', properties: { 'p-name': 'Alpha', 'p-points': 3, 'p-link': 'https://example.com', 'p-stage': 'o-todo' } },
  { id: 'r2', properties: { 'p-name': 'Beta', 'p-points': 5, 'p-stage': 'o-todo' } },
  { id: 'r3', properties: { 'p-name': 'Gamma', 'p-points': 7, 'p-stage': 'o-todo' } },
];

const blocks = (): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [{ id: 'v1', name: 'Board', type: 'board', position: 'a0', groupBy: 'p-stage', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
    content: ROWS.map((r) => r.id),
  },
  ...ROWS.map((r, i) => ({ id: r.id, type: 'database-row', parent: 'db-1', data: { position: `a${i}`, properties: r.properties } })),
];

const mount = async (page: Page, input: OutputBlockData[]): Promise<void> => {
  await page.evaluate(async (data) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: data } });
    await window.blokInstance.isReady;
  }, input);
};

const count = (page: Page, optionId: string): Locator =>
  page.locator(`[data-blok-database-column][data-option-id="${optionId}"]`).getByTestId('database-column-count');

// An item with a checked state is a menuitemcheckbox.
const anyItem = (page: Page, name: string): Locator =>
  page.getByRole('menuitemcheckbox', { name, exact: true }).or(page.getByRole('menuitem', { name, exact: true }));
const menuItem = (page: Page, name: string): Locator => anyItem(page, name).last();

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await mount(page, blocks());
  await expect(count(page, 'o-todo')).toHaveText('3');
});

// Longer than the 500ms hint delay.
const outwaitHintDelay = (page: Page): Promise<void> => page.evaluate(() => new Promise<void>((resolve) => {
  setTimeout(resolve, 900);
}));

// research/23 §2a: Notion's Count all number shows no tooltip.
test('the Count all number shows no hint on hover', async ({ page }) => {
  await count(page, 'o-todo').hover();
  await outwaitHintDelay(page);

  await expect(page.getByRole('tooltip')).toHaveCount(0);
});

// research/23 §2a: "99+" sits in a 38x20 button; with the switch off the full count shows.
test('a count above 99 reads 99+ until "Show large counts as 99+" is turned off', async ({ page }) => {
  const many = Array.from({ length: 136 }, (_, i) => ({ id: `m${i}`, properties: { 'p-name': `Row ${i}`, 'p-stage': 'o-todo' } }));

  await mount(page, [
    { ...blocks()[0], content: many.map((r) => r.id) },
    ...many.map((r, i) => ({ id: r.id, type: 'database-row', parent: 'db-1', data: { position: `a${String(i).padStart(3, '0')}`, properties: r.properties } })),
  ]);

  await expect(count(page, 'o-todo')).toHaveText('99+');
  const box = await count(page, 'o-todo').boundingBox();
  // The width follows the glyphs, so it depends on the installed font.
  const textWidth = await count(page, 'o-todo').evaluate((button) => {
    const range = document.createRange();

    range.selectNodeContents(button);

    return range.getBoundingClientRect().width;
  });

  // Notion's 38 is the glyphs plus 6px padding a side.
  expect(Math.abs((box?.width ?? 0) - (textWidth + 12))).toBeLessThan(0.5);
  expect(box?.height).toBe(20);

  await count(page, 'o-todo').click();
  await menuItem(page, 'Count').click();
  await page.getByRole('menuitemcheckbox', { name: /^Show large counts as 99\+/ }).click();

  await expect(count(page, 'o-todo')).toHaveText('136');
});

test('Sum › Points shows the column sums on every column and keeps them after a reload', async ({ page }) => {
  await count(page, 'o-todo').click();
  await menuItem(page, 'More options').click();
  await menuItem(page, 'Sum').click();
  await menuItem(page, 'Points').click();

  await expect(count(page, 'o-todo')).toHaveText('15');
  await expect(count(page, 'o-doing')).toHaveText('0');

  // A pick closes the whole menu, not just the property list.
  await expect(anyItem(page, 'More options')).toHaveCount(0);
  await count(page, 'o-doing').hover();
  await expect(page.getByRole('tooltip')).toHaveText('Sum in Points');

  const saved = await page.evaluate(async () => {
    const output = await window.blokInstance?.save();

    return output?.blocks.find((block) => block.id === 'db-1')?.data as { views: Array<Record<string, unknown>> } | undefined;
  });

  expect(saved?.views[0].groupCalculation).toEqual({ id: 'p-points', fn: 'sum', capCounts: false });
  await mount(page, [{ ...blocks()[0], data: saved ?? {} }, ...blocks().slice(1)]);
  await expect(count(page, 'o-todo')).toHaveText('15');
});

test('Sum lists only number properties', async ({ page }) => {
  await count(page, 'o-todo').click();
  await menuItem(page, 'More options').click();
  await menuItem(page, 'Sum').click();

  await expect(menuItem(page, 'Points')).toBeVisible();
  await expect(anyItem(page, 'Link')).toHaveCount(0);
});

test('Hide aggregation hides every count; Show aggregation brings Count all back', async ({ page }) => {
  await count(page, 'o-todo').click();
  await menuItem(page, 'Count').click();
  await menuItem(page, 'Count values').click();
  await menuItem(page, 'Link').click();
  await expect(count(page, 'o-todo')).toHaveText('1');

  const header = page.locator('[data-blok-database-column][data-option-id="o-todo"] [data-blok-database-column-header]');

  await header.hover();
  await header.getByRole('button', { name: 'More group options' }).click();
  await menuItem(page, 'Hide aggregation').click();

  await expect(count(page, 'o-todo')).toBeHidden();
  await expect(count(page, 'o-doing')).toBeHidden();

  await header.hover();
  await header.getByRole('button', { name: 'More group options' }).click();
  await menuItem(page, 'Show aggregation').click();

  await expect(count(page, 'o-todo')).toHaveText('3');
});

test('Escape closes one menu layer at a time', async ({ page }) => {
  await count(page, 'o-todo').click();
  await menuItem(page, 'More options').click();
  await expect(menuItem(page, 'Sum')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(anyItem(page, 'Sum')).toHaveCount(0);
  await expect(menuItem(page, 'More options')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(anyItem(page, 'More options')).toHaveCount(0);
});
