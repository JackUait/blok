/**
 * notion-spec-2 §16.1: the row page Edit property panel's Calculate and Number
 * format lists, and Type swapping the panel for the type list.
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

const blocks: OutputBlockData[] = [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [
        { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
        { id: 'p-amount', name: 'Amount', type: 'number', position: 'a1' },
        { id: 'p-next', name: 'Next', type: 'relation', position: 'a2', relation: { targetDatabaseId: 'db-1', twoWay: true, syncedPropertyId: 'p-prev' } },
        { id: 'p-prev', name: 'Prev', type: 'relation', position: 'a3', relation: { targetDatabaseId: 'db-1', twoWay: true, syncedPropertyId: 'p-next' } },
        { id: 'p-total', name: 'Total', type: 'rollup', position: 'a4', rollup: { relationPropertyId: 'p-next', targetPropertyId: 'p-amount', function: 'show_original' } },
      ],
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Alpha', 'p-amount': 1 } } },
];

const openPanel = async (page: Page): Promise<void> => {
  await page.evaluate(async (input) => {
    const holder = document.createElement('div');

    holder.id = 'blok';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: input }, tools: { database: { class: (window as unknown as Record<string, unknown>).BlokDatabase } } });
    await window.blokInstance.isReady;
  }, blocks);
  const row = page.getByRole('row', { name: /Alpha/ });

  await row.hover();
  await row.getByRole('button', { name: 'Open', exact: true }).click();
  await page.getByRole('complementary', { name: 'Card details' }).getByRole('button', { name: 'Total', exact: true }).first().click();
  await page.getByRole('menuitem', { name: 'Edit property' }).click();
};

const box = async (page: Page, name: string): Promise<{ x: number; y: number; width: number; height: number; right: number; bottom: number }> =>
  page.locator(`[data-blok-item-name="${name}"]`).evaluate(async (el) => {
    // The entrance scales the menu: measure once it ends.
    await Promise.all(el.closest('[data-blok-popover-container]')?.getAnimations().map((animation) => animation.finished) ?? []);
    const rect = el.getBoundingClientRect();

    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
  });

/** The list holding `item`: its container's box. */
const listBox = async (page: Page, item: string): Promise<{ x: number; y: number; width: number; height: number }> =>
  page.locator(`[data-blok-item-name="${item}"]`).evaluate(async (el) => {
    const list = el.closest('[data-blok-popover-container]');

    // The entrance scales the list: measure once it ends.
    await Promise.all(list?.getAnimations().map((animation) => animation.finished) ?? []);
    const rect = list?.getBoundingClientRect();

    return { x: rect?.x ?? 0, y: rect?.y ?? 0, width: rect?.width ?? 0, height: rect?.height ?? 0 };
  });

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 717 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test('Calculate is 200x152 under its row, rows 192x28 at 4px, 29 apart', async ({ page }) => {
  await openPanel(page);
  const row = await box(page, 'rollupFunction');

  await page.locator('[data-blok-item-name="rollupFunction"]').click();
  const list = await listBox(page, 'rollupFunction-show_original');
  const first = await box(page, 'rollupFunction-show_original');
  const second = await box(page, 'rollupFunction-show_unique');

  expect({ width: list.width, height: list.height }).toEqual({ width: 200, height: 152 });
  expect({ width: first.width, height: first.height }).toEqual({ width: 192, height: 28 });
  // §17.7: Notion's lists are 4 + rows of 28, 1px apart, + 4.
  expect(first.x - list.x).toBe(4);
  expect(first.y - list.y).toBe(4);
  expect(second.y - first.y).toBe(29);
  expect(list.x + list.width).toBe(row.right);
  expect(list.y).toBe(row.bottom);
});

test('Calculate opens with the current calculation\'s row in the hover tint, a check on it', async ({ page }) => {
  await openPanel(page);
  await page.locator('[data-blok-item-name="rollupFunction"]').click();
  const current = page.locator('[data-blok-item-name="rollupFunction-show_original"]');

  await expect(current).toHaveCSS('background-color', 'rgba(33, 27, 23, 0.05)');
  await expect(page.locator('[data-blok-item-name="rollupFunction-show_unique"]')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(current.getByTestId('popover-item-trailing-icon')).toHaveCount(1);
  await expect(page.getByRole('menuitemcheckbox', { name: 'Show original' })).toHaveAttribute('aria-checked', 'true');
});

test('Decimal places tells a screen reader which one is current, and paints it no fill', async ({ page }) => {
  await openPanel(page);
  await page.locator('[data-blok-item-name="decimals"]').click();
  const current = page.getByRole('menuitemcheckbox', { name: 'Default' });

  await expect(current).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('menuitemcheckbox', { name: '2' })).toHaveAttribute('aria-checked', 'false');
  await expect(current).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await current.hover();
  await expect(current).toHaveCSS('background-color', 'rgba(33, 27, 23, 0.05)');
});

test('the group submenus are 250 wide', async ({ page }) => {
  await openPanel(page);
  await page.locator('[data-blok-item-name="rollupFunction"]').click();
  await page.locator('[data-blok-item-name="rollupFunctionGroup-calcPercent"]').hover();

  expect((await listBox(page, 'rollupFunction-percent_empty')).width).toBe(250);
});

test('Decimal places is 250x210 under its row: Default and 0 to 5, no scrolling', async ({ page }) => {
  // At 717 the row ends 11px too low for the list to fit under it with the 12px margin.
  await page.setViewportSize({ width: 1512, height: 800 });
  await openPanel(page);
  const row = await box(page, 'decimals');

  await page.locator('[data-blok-item-name="decimals"]').click();
  const list = await listBox(page, 'decimals-default');

  expect(list).toEqual({ x: row.right - 250, y: row.bottom, width: 250, height: 210 });
  await expect(page.locator('[data-blok-item-name^="decimals-"]')).toHaveText(['Default', '0', '1', '2', '3', '4', '5']);
});

// §17.7 measured this list from the column header's Edit property.
test('the column header\'s Decimal places is 250x210 too', async ({ page }) => {
  await openPanel(page);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.getByRole('columnheader', { name: 'Total' }).getByRole('button', { name: 'Total' }).click();
  await page.getByRole('menuitem', { name: 'Edit property' }).hover();
  await page.getByTestId('popover').locator('[data-blok-item-name="decimals"]').click();
  const list = await listBox(page, 'decimals-default');

  expect({ width: list.width, height: list.height }).toEqual({ width: 250, height: 210 });
});

test('Number format is 192 wide, its end edge on its row\'s', async ({ page }) => {
  await openPanel(page);
  const row = await box(page, 'numberFormat');

  await page.locator('[data-blok-item-name="numberFormat"]').click();
  const list = await listBox(page, 'format-number');

  expect(list.width).toBe(192);
  expect(list.x + list.width).toBe(row.right);
  // No format name is cut off at that width.
  const clipped = await page.locator('[data-blok-item-name^="format-"] [data-blok-popover-item-title]').evaluateAll((titles) =>
    titles.filter((title) => title.scrollWidth > title.clientWidth).map((title) => title.textContent));

  expect(clipped).toEqual([]);
});

test('Type swaps the panel for the type list, fitted in the window; Escape lands on the label menu', async ({ page }) => {
  await openPanel(page);
  const panel = await listBox(page, 'changeType');

  await page.locator('[data-blok-item-name="changeType"]').click();
  await expect(page.locator('[data-blok-item-name="changeType"]')).toHaveCount(0);
  const list = await listBox(page, 'type-text');
  // §17.9: a 282x28 "Type" line 4px in, its magnifier, then the types.
  const heading = await page.locator('[data-blok-database-property-type-list-heading]').boundingBox();

  expect({ x: (heading?.x ?? 0) - list.x, width: heading?.width, height: heading?.height }).toEqual({ x: 4, width: 282, height: 28 });
  await expect(page.getByRole('button', { name: 'Search property types…' })).toBeVisible();

  expect(list.x).toBe(panel.x);
  expect(list.width).toBe(290);
  // Moved up so it ends 11px over the window's bottom edge.
  expect(list.y + list.height).toBe(717 - 11);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
  await expect(page.locator('[data-blok-item-name^="type-"]')).toHaveCount(0);
});

// §16.1: Notion's 44 formats show 502 tall at y 203 in a 717 window (0.7 x 717 = 502, inferred), 12 over its bottom.
test('Number format is capped and scrolls, its bottom 12px over the window\'s', async ({ page }) => {
  await openPanel(page);
  await page.locator('[data-blok-item-name="numberFormat"]').click();
  const list = await listBox(page, 'format-number');
  const scrolls = await page.locator('[data-blok-item-name="format-number"]').evaluate((el) => {
    const items = el.closest('[data-blok-popover-items]');

    return items !== null && items.scrollHeight > items.clientHeight;
  });

  expect(list.y + list.height).toBeCloseTo(717 - 12, 0);
  expect(list.height).toBeCloseTo(717 * 0.7, 0);
  expect(scrolls).toBe(true);
});

// §17.3: with 11.6px left under the row, Display as flipped above it. Blok's lists flip below a 12px margin.
test('a list flips above its row when less than 12px would be left under it', async ({ page }) => {
  await openPanel(page);
  const row = await box(page, 'decimals');

  // 210 tall list; leave 10px under it.
  await page.setViewportSize({ width: 1512, height: Math.ceil(row.bottom + 210 + 10) });
  const moved = await box(page, 'decimals');
  const height = page.viewportSize()?.height ?? 0;

  expect(height - (moved.bottom + 210)).toBeGreaterThan(8);
  expect(height - (moved.bottom + 210)).toBeLessThan(12);
  await page.locator('[data-blok-item-name="decimals"]').click();
  const list = await listBox(page, 'decimals-default');

  expect(list.y + list.height).toBe(moved.y);
});

// §17.2: Notion's search input is 244x20, 18px in and 16px down; the rows start 52 down. 258 tall with 7 properties.
test('Target property\'s search field has Notion\'s size, so the list is Notion\'s height', async ({ page }) => {
  await openPanel(page);
  await page.locator('[data-blok-item-name="rollupProperty"]').click();
  const list = await listBox(page, 'rollupProperty-p-title');
  const input = await page.locator('[data-blok-popover-container]:has([data-blok-item-name="rollupProperty-p-title"]) [data-blok-testid="popover-search-input"]').boundingBox();
  const first = await box(page, 'rollupProperty-p-title');
  const count = await page.locator('[data-blok-item-name^="rollupProperty-"]').count();

  expect({ x: (input?.x ?? 0) - list.x, y: (input?.y ?? 0) - list.y, width: input?.width, height: input?.height }).toEqual({ x: 18, y: 16, width: 244, height: 20 });
  expect(first.y - list.y).toBe(52);
  expect(list.height).toBe(52 + count * 29 - 1 + 4);
});

test('other searchable lists keep the shared search field', async ({ page }) => {
  await openPanel(page);
  await page.locator('[data-blok-item-name="numberFormat"]').click();
  await listBox(page, 'format-number');
  const input = await page.locator('[data-blok-popover-container]:has([data-blok-item-name="format-number"]) [data-blok-testid="popover-search-input"]').boundingBox();

  expect(input?.height).toBe(22);
});

// §17.8: Notion's box is 156 wide; other hints keep the 300 max-width.
test('the Show unique values hint is 156 wide', async ({ page }) => {
  await openPanel(page);
  await page.locator('[data-blok-item-name="rollupFunction"]').click();
  await page.locator('[data-blok-item-name="rollupFunction-show_unique"]').hover();
  const hint = page.getByTestId('tooltip');

  await expect(hint).toBeVisible();
  const rect = await hint.boundingBox();

  expect(rect?.width).toBe(156);
});

// §17.10: the tint starts on the current calculation and moves to the hovered row.
test('in Calculate the tint leaves the current row for the hovered one', async ({ page }) => {
  await openPanel(page);
  await page.locator('[data-blok-item-name="rollupFunction"]').click();
  const current = page.locator('[data-blok-item-name="rollupFunction-show_original"]');

  await expect(current).toHaveCSS('background-color', 'rgba(33, 27, 23, 0.05)');
  await page.locator('[data-blok-item-name="rollupFunction-show_unique"]').hover();
  await expect(current).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('[data-blok-item-name="rollupFunction-show_unique"]')).toHaveCSS('background-color', 'rgba(33, 27, 23, 0.05)');
  // A group row still opens on hover.
  await page.locator('[data-blok-item-name="rollupFunctionGroup-calcCount"]').hover();
  await expect(page.locator('[data-blok-item-name="rollupFunction-count"]')).toBeVisible();
  await expect(current).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});
