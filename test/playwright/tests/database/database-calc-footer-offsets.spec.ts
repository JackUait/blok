/**
 * Boxes against Notion's recorded geometry: the calculation row, the header menu,
 * the select cell editor and the list row.
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
  {
    id: 'p-stage',
    name: 'Stage',
    type: 'select',
    position: 'a2',
    config: { options: [{ id: 'o-idea', label: 'Idea', color: 'yellow', position: 'a0' }, { id: 'o-build', label: 'Build', color: 'gray', position: 'a1' }] },
  },
];

const blocks = (activeViewId: string): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [
        { id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], calculations: [{ id: 'p-amount', fn: 'sum' }] },
        { id: 'v2', name: 'List', type: 'list', position: 'a1', sorts: [], filters: [], visibleProperties: ['p-title'] },
      ],
      activeViewId,
    },
    content: ['r1', 'r2'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Alpha', 'p-amount': 42, 'p-stage': 'o-idea' } } },
  { id: 'r2', type: 'database-row', parent: 'db-1', data: { position: 'a1', properties: { 'p-title': 'Beta', 'p-amount': 7 } } },
];

const mount = async (page: Page, activeViewId = 'v1'): Promise<void> => {
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
  }, blocks(activeViewId));
};

const box = async (locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
  const rect = await locator.boundingBox();

  if (rect === null) {
    throw new Error('no box');
  }

  return rect;
};

/** The popover entrance scales its card, which skews the box until it ends. */
const settled = async (locator: Locator): Promise<void> => {
  await expect.poll(() => locator.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.emulateMedia({ colorScheme: 'light' });
});

test.describe('table calculation row (research/21 §1d, research/08 shot 66)', () => {
  test('rules a 1px line over the row and fills only a 21px box around the value on hover', async ({ page }) => {
    await mount(page);
    const calc = page.locator('[data-blok-database-table-calc][data-property-id="p-amount"]');
    const patch = calc.locator('[data-blok-database-table-calc-box]');

    await expect(patch).toBeVisible();
    await calc.hover();
    await expect(patch).toHaveCSS('background-color', 'rgba(33, 27, 23, 0.05)');
    await expect(calc).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(patch).toHaveCSS('border-top-left-radius', '6px');
    expect((await box(patch)).height).toBe(21);
    expect((await box(patch)).width).toBeLessThan((await box(calc)).width);
    await expect(page.locator('[data-blok-database-table-footer]').first()).toHaveCSS('box-shadow', 'rgba(42, 28, 0, 0.07) 0px 1px 0px 0px inset');
    expect((await box(calc)).height).toBe(35);
  });

  test('keeps a number 10px short of the column end, as shot 66', async ({ page }) => {
    await mount(page);
    const calc = page.locator('[data-blok-database-table-calc][data-property-id="p-amount"]');
    const value = calc.locator('[data-blok-database-table-calc-value]');

    await expect(value).toBeVisible();
    const cellBox = await box(calc);
    const valueBox = await box(value);

    expect(cellBox.x + cellBox.width - (valueBox.x + valueBox.width)).toBeCloseTo(10, 0);
  });
});

test('the header menu opens 6px left of its cell, on its bottom edge (notion-live/header.png)', async ({ page }) => {
  await mount(page);
  const header = page.locator('[data-blok-database-table-column-header][data-property-id="p-amount"]');

  await header.locator('[data-blok-database-table-column-button]').click();
  const container = page.locator('[data-blok-popover][data-blok-popover-custom-class~="blok-database-column-menu"][data-blok-popover-opened="true"] [data-blok-popover-container]');

  await expect(container).toBeVisible();
  await settled(container);
  const headerBox = await box(header);
  const menuBox = await box(container);

  expect(menuBox.x).toBeCloseTo(headerBox.x - 6, 0);
  expect(menuBox.y).toBeCloseTo(headerBox.y + headerBox.height, 0);
});

test('the select editor puts its hint 12px in and its first pill 76px down (notion-live/selectcell.png)', async ({ page }) => {
  await mount(page);
  await page.locator('[data-blok-database-table-row][data-row-id="r1"] [role="gridcell"][data-property-id="p-stage"]').click();
  const editor = page.locator('[data-blok-database-select-editor="select"]');

  await expect(editor).toBeVisible();
  const container = page.locator('[data-blok-popover-container]:has([data-blok-database-select-editor="select"])');

  await settled(container);
  const popover = await box(container);
  const hint = editor.locator('[data-blok-database-select-hint]');
  const hintText = await hint.evaluate((el) => {
    const range = document.createRange();

    range.selectNodeContents(el);

    return range.getBoundingClientRect().x;
  });
  const pill = await box(editor.locator('[data-blok-database-select-option] [data-blok-database-option-pill]').first());

  expect(hintText - popover.x).toBeCloseTo(12, 0);
  expect(pill.y - popover.y).toBeCloseTo(76, 0);
  expect(pill.x - popover.x).toBeCloseTo(40, 0);
});

test('a list row starts its glyph 6px in and its title 31px in, with a 30x24 pencil on hover (sweep9a/pixel-scans.txt)', async ({ page }) => {
  await mount(page, 'v2');
  const row = page.locator('[data-blok-database-list-row]').first();

  await expect(row).toBeVisible();
  const rowBox = await box(row);
  const glyph = await box(row.locator('[data-blok-database-page-icon-placeholder]'));
  const title = await box(row.locator('[data-blok-database-list-row-title]'));

  expect(glyph.x - rowBox.x).toBe(6);
  expect(title.x - rowBox.x).toBe(31);
  await row.hover();
  const edit = row.locator('[data-blok-database-list-row-edit]');

  await expect(edit).toBeVisible();
  expect(await box(edit)).toMatchObject({ width: 30, height: 24 });
});
