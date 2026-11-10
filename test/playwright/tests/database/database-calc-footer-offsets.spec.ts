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
  // r10-calc-hover-numcell.raw / r10-calc-hover-textbtn.raw: the pointer in the cell but off the box leaves it clear.
  test('rules a 1px line over the row and fills only a 21px box around the value, under the pointer', async ({ page }) => {
    await mount(page);
    const calc = page.locator('[data-blok-database-table-calc][data-property-id="p-amount"]');
    const patch = calc.locator('[data-blok-database-table-calc-box]');

    await expect(patch).toBeVisible();
    await calc.hover({ position: { x: 4, y: 17 } });
    await expect(patch).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await patch.hover();
    await expect(patch).toHaveCSS('background-color', 'rgba(33, 27, 23, 0.05)');
    await expect(calc).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(patch).toHaveCSS('border-top-left-radius', '6px');
    expect((await box(patch)).height).toBe(21);
    expect((await box(patch)).width).toBeLessThan((await box(calc)).width);
    await expect(page.locator('[data-blok-database-table-footer]').first()).toHaveCSS('border-top', '1px solid rgba(42, 28, 0, 0.07)');
    expect((await box(calc)).height).toBe(35);
  });

  // notion-motion.md Round 11 (r11-gap-withcalc.raw, r11-calc-footmenu.png): a 36px row with the button 8px down,
  // the block's end 12px under it, and the value's menu 200 wide on the button's bottom-left corner.
  test('sits the value 8px under the row top, ends the block 12px under the row, opens a 200px menu on the button', async ({ page }) => {
    await mount(page);
    const footer = page.locator('[data-blok-database-table-footer]').first();
    const patch = page.locator('[data-blok-database-table-calc][data-property-id="p-amount"] [data-blok-database-table-calc-box]');
    const holder = page.locator('[data-blok-element]:has([data-blok-database-table-footer])').first();

    await expect(patch).toBeVisible();
    const footerBox = await box(footer);
    const patchBox = await box(patch);

    expect(footerBox.height).toBe(36);
    expect(patchBox.y - footerBox.y).toBeCloseTo(8, 0);
    const holderBox = await box(holder);

    expect(holderBox.y + holderBox.height - (footerBox.y + footerBox.height)).toBeCloseTo(12, 0);

    await patch.click();
    const container = page.locator('[data-blok-popover][data-blok-popover-opened="true"] [data-blok-popover-container]').first();

    await expect(container).toBeVisible();
    await settled(container);
    const menuBox = await box(container);

    expect(menuBox.width).toBe(200);
    expect(menuBox.x).toBeCloseTo(patchBox.x, 0);
    expect(menuBox.y).toBeCloseTo(patchBox.y + patchBox.height, 0);
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

  // notion-motion.md Round 12 "Unset Calculate menu placement": 200x94, on the button's left edge and bottom.
  test('opens an unset column\'s menu on its Calculate button, not the cell', async ({ page }) => {
    await mount(page);
    const calc = page.locator('[data-blok-database-table-calc][data-property-id="p-stage"]');
    const patch = calc.locator('[data-blok-database-table-calc-box]');

    await calc.hover();
    const patchBox = await box(patch);

    expect(patchBox.x).toBeGreaterThan((await box(calc)).x + 20);
    await patch.click();
    const container = page.locator('[data-blok-popover][data-blok-popover-opened="true"] [data-blok-popover-container]').first();

    await expect(container).toBeVisible();
    await settled(container);
    const menuBox = await box(container);

    expect(menuBox.width).toBe(200);
    expect(menuBox.height).toBe(94);
    expect(menuBox.x).toBeCloseTo(patchBox.x, 0);
    expect(menuBox.y).toBeCloseTo(patchBox.y + patchBox.height, 0);
  });

  // notion-motion.md Round 12 "Calculation submenu sizes": 250 wide, centred on the row, More options 181 tall,
  // Count 233.4 with its 72.4 99+ row. "Escape in calculation menus": one layer per Escape, then the footer button.
  test('opens 250-wide lists centred on their row; Escape closes the list, then the menu, back to the button', async ({ page }) => {
    await mount(page);
    const calc = page.locator('[data-blok-database-table-calc][data-property-id="p-amount"]');
    const menus = page.locator('[data-blok-popover][data-blok-popover-opened="true"] [data-blok-popover-container]');
    const row = (title: string): Locator => menus.first().locator('[data-blok-popover-item]', { hasText: title }).first();

    await calc.locator('[data-blok-database-table-calc-box]').click();
    await settled(menus.first());

    for (const [title, first, height] of [['More options', 'Sum', 181], ['Count', 'Count all', 233.4]] as const) {
      await row(title).hover();
      const nested = menus.filter({ hasText: first }).last();

      await expect(nested).toBeVisible();
      await settled(nested);
      const list = await box(nested);
      const rowBox = await box(row(title));

      expect(list.width).toBe(250);
      expect(list.height).toBeCloseTo(height, 0);
      expect(list.y + list.height / 2).toBeCloseTo(rowBox.y + rowBox.height / 2, 0);
    }

    await page.keyboard.press('Escape');
    await expect(menus).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(menus).toHaveCount(0);
    await expect(calc).toBeFocused();
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
