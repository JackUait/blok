/**
 * research/35 §1.1-§1.3, §1.8 in a built page: Default and Gray board columns,
 * card hover, the "New" button's pressed fill and the template row "…".
 * Reads getComputedStyle, never the stylesheet.
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
  {
    id: 'p-tag',
    name: 'Tag',
    type: 'select',
    position: 'a1',
    config: {
      options: [
        { id: 'o-def', label: 'Def', color: 'default', position: 'a0' },
        { id: 'o-gry', label: 'Gry', color: 'gray', position: 'a1' },
        { id: 'o-blu', label: 'Blu', color: 'yellow', position: 'a2' },
      ],
    },
  },
];

const ROWS = [
  { id: 'r1', properties: { 'p-title': 'E1', 'p-tag': 'o-def' } },
  { id: 'r2', properties: { 'p-title': 'E2', 'p-tag': 'o-gry' } },
  { id: 'r3', properties: { 'p-title': 'E3', 'p-tag': 'o-blu' } },
];

const blocks = (): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [{ id: 'v1', name: 'Board', type: 'board', groupBy: 'p-tag', position: 'a0', sorts: [], filters: [], visibleProperties: ['p-title'] }],
      activeViewId: 'v1',
    },
    content: [...ROWS.map((row) => row.id), 'tpl'],
  },
  ...ROWS.map((row, i) => ({
    id: row.id,
    type: 'database-row',
    parent: 'db-1',
    data: { position: `a${i}`, properties: row.properties },
  })),
  { id: 'tpl', type: 'database-row', parent: 'db-1', data: { position: 'a9', properties: { 'p-title': 'TplA' }, template: true } },
];

const mount = async (page: Page): Promise<void> => {
  await page.evaluate(async (data) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:1100px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: data } });
    await window.blokInstance.isReady;
  }, blocks());
};

const bg = (locator: Locator): Promise<string> => locator.evaluate((el) => getComputedStyle(el).backgroundColor);
const ink = (locator: Locator): Promise<string> => locator.evaluate((el) => getComputedStyle(el).color);
const column = (page: Page, color: string): Locator => page.locator(`[data-blok-database-column][data-color="${color}"]`);

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.afterEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
});

interface ColumnLook { color: string; card: string; hover: string }

// Chrome prints an alpha with two decimals when they name the same 8-bit step: 0.031 reads 0.03, 0.051 reads 0.05.
const BOARD: Record<'light' | 'dark', { counts: [string, string]; looks: ColumnLook[] }> = {
  light: {
    counts: ['rgb(95, 94, 89)', 'rgb(110, 107, 102)'],
    looks: [
      { color: 'default', card: 'rgb(255, 255, 255)', hover: 'rgba(54, 29, 2, 0.03)' },
      { color: 'gray', card: 'rgb(255, 255, 255)', hover: 'rgba(54, 29, 2, 0.03)' },
      { color: 'yellow', card: 'rgb(255, 255, 255)', hover: 'rgba(194, 164, 0, 0.063)' },
    ],
  },
  dark: {
    counts: ['rgb(188, 186, 182)', 'rgb(156, 153, 148)'],
    looks: [
      { color: 'default', card: 'rgb(32, 32, 32)', hover: 'rgb(38, 38, 38)' },
      { color: 'gray', card: 'rgb(44, 44, 43)', hover: 'rgb(50, 50, 49)' },
      { color: 'yellow', card: 'rgb(55, 51, 37)', hover: 'rgb(63, 58, 42)' },
    ],
  },
};

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: Default, Gray and Yellow columns take Notion's count, card and card hover`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await mount(page);

    const [defaultCount, grayCount] = BOARD[theme].counts;

    expect(await ink(column(page, 'default').getByTestId('database-column-count'))).toBe(defaultCount);
    expect(await ink(column(page, 'gray').getByTestId('database-column-count'))).toBe(grayCount);

    for (const { color, card: cardBg, hover } of BOARD[theme].looks) {
      const card = column(page, color).locator('[data-blok-database-card]');

      await expect(card).toHaveCount(1);
      expect(await bg(card)).toBe(cardBg);
      await card.hover();
      await expect.poll(() => bg(card)).toBe(hover);
      await page.mouse.move(0, 0);
    }
  });

  test(`${theme}: "New" darkens or lightens on hover and press`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await mount(page);

    const chevron = page.getByTestId('database-toolbar-new-menu');

    await chevron.hover();
    await expect.poll(() => bg(chevron)).toBe(theme === 'light' ? 'rgb(24, 96, 172)' : 'rgb(36, 115, 201)');
    await page.mouse.down();
    await expect.poll(() => bg(chevron)).toBe(theme === 'light' ? 'rgb(21, 85, 153)' : 'rgb(36, 115, 201)');
    await page.mouse.move(0, 0);
    await page.mouse.up();
  });

  test(`${theme}: the template "…" is icon gray and its submenu tops out level with it`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await mount(page);
    await page.getByTestId('database-toolbar-new-menu').click();

    const row = page.getByRole('menuitem', { name: 'TplA' });
    const more = row.getByTestId('popover-item-more');

    expect(await ink(more)).toBe(theme === 'light' ? 'rgb(142, 139, 134)' : 'rgb(173, 169, 163)');
    await more.click();

    const edit = page.getByRole('menuitem', { name: 'Edit' });

    await expect(edit).toBeVisible();
    // The pointer moves onto the submenu: the "…" keeps its hover fill.
    await edit.hover();
    expect(await bg(more)).toBe(theme === 'light' ? 'rgba(33, 27, 23, 0.05)' : 'rgba(255, 255, 255, 0.055)');

    const submenuTop = await edit.evaluate((el) => el.closest('[data-blok-popover-container]')?.getBoundingClientRect().top ?? NaN);
    const moreTop = await more.evaluate((el) => el.getBoundingClientRect().top);

    expect(Math.round(submenuTop)).toBe(Math.round(moreTop));
  });
}
