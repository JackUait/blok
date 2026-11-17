/**
 * The row menu every view shares (research/12 §3, research/08 shots-08/65,
 * research/19 §2e): "Page", Edit icon, Edit property ›, Layout and Property
 * visibility on a board, Open in ›, Comment ⌘⇧M, Copy link, Duplicate, Move to
 * Trash, and the "Last edited" footer.
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

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

const blocks = (layout: 'board' | 'list' | 'table' = 'board'): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [
        { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
        { id: 'p-status', name: 'Status', type: 'select', position: 'a1', config: { options: [{ id: 'o-todo', label: 'Todo', color: 'gray', position: 'a0' }, { id: 'o-done', label: 'Done', color: 'green', position: 'a1' }] } },
      ],
      views: [{ id: 'v1', name: 'Board', type: layout, position: 'a0', groupBy: layout === 'board' ? 'p-status' : undefined, sorts: [], filters: [], visibleProperties: ['p-status'] }],
      activeViewId: 'v1',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Launch plan', 'p-status': 'o-todo' } } },
];

const mount = async (page: Page, layout: 'board' | 'list' | 'table' = 'board'): Promise<void> => {
  await page.evaluate(async (input) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');
    const globals = window as unknown as Record<string, unknown>;

    holder.id = 'blok';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: input },
      tools: { paragraph: globals.BlokParagraph, database: globals.BlokDatabase },
    });
    await window.blokInstance.isReady;
  }, blocks(layout));
};

const card = (page: Page): Locator => page.locator('[data-blok-database-card][data-row-id="r1"]');

const openCardMenu = async (page: Page): Promise<Locator> => {
  await card(page).hover();
  await card(page).getByRole('button', { name: 'Card options' }).click();
  const menu = page.getByPlaceholder('Search actions…');

  await expect(menu).toBeVisible();

  return page.locator('[data-blok-popover-opened]');
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await mount(page);
});

test('the board card ••• menu lists the measured items in order, with the word count footer', async ({ page }) => {
  const menu = await openCardMenu(page);

  await expect(menu.getByText('Page', { exact: true })).toBeVisible();
  await expect(menu.getByTestId('popover-item-title')).toHaveText([
    'Edit icon',
    'Edit property',
    'Layout',
    'Property visibility',
    'Open in',
    'Comment',
    'Copy link',
    'Duplicate',
    'Move to Trash',
  ]);
  await expect(menu.getByText('2 words, 11 characters')).toBeVisible();
});

test('Edit property › Status opens the status editor on the row page', async ({ page }) => {
  const menu = await openCardMenu(page);

  await menu.getByRole('menuitem', { name: 'Edit property' }).hover();
  await page.getByRole('menuitem', { name: 'Status' }).click();

  await expect(page.getByRole('complementary', { name: 'Card details' })).toBeVisible();
  await expect(page.getByPlaceholder('Search for an option…')).toBeFocused();
});

test('Layout opens the view settings at its Layout page', async ({ page }) => {
  const menu = await openCardMenu(page);

  await menu.getByRole('menuitem', { name: 'Layout' }).click();

  await expect(page.getByTestId('database-view-settings').getByText('Layout', { exact: true })).toBeVisible();
});

test('a right-click on the card opens the same menu', async ({ page }) => {
  await card(page).click({ button: 'right' });

  await expect(page.locator('[data-blok-popover-opened]').getByRole('menuitem', { name: 'Edit icon' })).toBeVisible();
});

// notion-motion.md Round 59 §4: a table row's right-click opens the 265-wide row menu at the pointer,
// 1px under it when it fits, else above with its bottom on the pointer when its top keeps 12.
test.describe('a table row\'s right-click', () => {
  const menuBox = async (page: Page): Promise<{ x: number; y: number; width: number; height: number }> => {
    await expect(page.getByPlaceholder('Search actions…')).toBeVisible();
    const box = await page.locator('[data-blok-popover-opened] [data-blok-popover-container]').boundingBox();

    if (box === null) throw new Error('no menu');

    return box;
  };

  test('opens the row menu 1px under the pointer when it fits', async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 900 });
    await mount(page, 'table');
    const cell = page.getByRole('gridcell').filter({ hasText: 'Launch plan' });
    const box = await cell.boundingBox();

    if (box === null) throw new Error('no cell');
    const [x, y] = [Math.round(box.x + 40), Math.round(box.y + box.height / 2)];

    await page.mouse.click(x, y, { button: 'right' });
    const menu = await menuBox(page);

    await expect(page.locator('[data-blok-popover-opened]').getByTestId('popover-item-title')).toHaveText([
      'Edit icon', 'Edit property', 'Open in', 'Comment', 'Copy link', 'Duplicate', 'Move to Trash',
    ]);
    expect(menu.x).toBeCloseTo(x, 0);
    expect(menu.y).toBeCloseTo(y + 1, 0);
    expect(menu.width).toBeCloseTo(265, 0);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-blok-database-menu-point]')).toHaveCount(0);
  });

  test('opens it above the pointer when it does not fit below', async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 717 });
    await mount(page, 'table');
    await page.evaluate(() => {
      const holder = document.getElementById('blok');

      if (holder !== null) holder.style.paddingTop = '520px';
    });
    const cell = page.getByRole('gridcell').filter({ hasText: 'Launch plan' });
    const box = await cell.boundingBox();

    if (box === null) throw new Error('no cell');
    const [x, y] = [Math.round(box.x + 40), Math.round(box.y + box.height / 2)];

    await page.mouse.click(x, y, { button: 'right' });
    const menu = await menuBox(page);

    expect(y + 1 + menu.height).toBeGreaterThan(717 - 12);
    expect(menu.x).toBeCloseTo(x, 0);
    expect(menu.y + menu.height).toBeCloseTo(y, 0);
  });
});

test('⌘⇧M on a picked card opens its comment composer', async ({ page }) => {
  // The title, not the Status pill: a click on the pill edits it.
  await card(page).getByText('Launch plan').click({ modifiers: [MOD] });
  await page.keyboard.press(`${MOD}+Shift+KeyM`);

  await expect(page.getByRole('textbox', { name: 'Add a comment…' })).toBeFocused();
});

test('a click on a list row\'s ⋮⋮ opens the list row menu, with no Layout or Property visibility', async ({ page }) => {
  await mount(page, 'list');
  const row = page.locator('[data-blok-database-list-row][data-row-id="r1"]');
  const handle = row.getByRole('button', { name: 'Drag to move, click to open menu' });

  await row.hover();
  await expect(handle).toBeVisible();
  // Left of the row, and not clipped by the view: the pointer reaches it there.
  const [rowBox, handleBox] = [await row.boundingBox(), await handle.boundingBox()];

  if (rowBox === null || handleBox === null) throw new Error('no box');
  expect(handleBox.x + handleBox.width).toBeLessThanOrEqual(rowBox.x + 1);
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-blok-database-list-row-handle]') !== null, { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 })).toBe(true);

  await handle.click();
  const menu = page.locator('[data-blok-popover-opened]');

  await expect(menu.getByTestId('popover-item-title')).toHaveText([
    'Edit icon',
    'Edit property',
    'Open in',
    'Comment',
    'Copy link',
    'Duplicate',
    'Move to Trash',
  ]);
  await expect(page.getByRole('complementary', { name: 'Card details' })).toBeHidden();
  // The row keeps a gray fill while its menu is up, never blue.
  await page.mouse.move(0, 0);
  await expect(row).toHaveCSS('background-color', 'rgba(55, 53, 47, 0.06)');
  await expect(handle).toBeVisible();
});
