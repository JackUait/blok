/**
 * Notion's light values and dark leftovers (research/26 §1, §4, §5f).
 * Reads computed styles only. Dark runs on both dark copies: the OS media
 * query and the theme attribute over a light OS.
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
  { id: 'p-due', name: 'Due', type: 'date', position: 'a1' },
  { id: 'p-site', name: 'Site', type: 'url', position: 'a2' },
  {
    id: 'p-stage',
    name: 'Stage',
    type: 'select',
    position: 'a3',
    config: {
      options: [
        { id: 'o-blue', label: 'Plan', color: 'blue', position: 'a0' },
        { id: 'o-brown', label: 'Build', color: 'brown', position: 'a1' },
      ],
    },
  },
];

const blocks = (view: Record<string, unknown>): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [ { id: 'v1', name: 'View', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...view } ],
      activeViewId: 'v1',
    },
    content: [ 'r1', 'r2' ],
  },
  {
    id: 'r1',
    type: 'database-row',
    parent: 'db-1',
    data: {
      position: 'a0',
      properties: { 'p-title': 'Alpha', 'p-due': '2026-10-09', 'p-site': 'https://example.com', 'p-stage': 'o-blue' },
      reminders: { 'p-due': { remind: '1_day_before' } },
    },
  },
  { id: 'r2', type: 'database-row', parent: 'db-1', data: { position: 'a1', properties: { 'p-title': 'Bravo', 'p-stage': 'o-brown' } } },
];

const mount = async (page: Page, data: OutputBlockData[]): Promise<void> => {
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
  }, { input: data });
};

const THEMES = [
  { name: 'light', dark: false, apply: (page: Page) => page.emulateMedia({ colorScheme: 'light' }) },
  { name: 'system dark', dark: true, apply: (page: Page) => page.emulateMedia({ colorScheme: 'dark' }) },
  {
    name: 'theme set to dark',
    dark: true,
    apply: async (page: Page): Promise<void> => {
      await page.emulateMedia({ colorScheme: 'light' });
      await page.evaluate(() => window.blokInstance?.theme.set('dark'));
    },
  },
];

const row = (page: Page, id: string): Locator => page.locator(`[data-blok-database-table-row][data-row-id="${id}"]`);
const peek = (page: Page): Locator => page.locator('[data-blok-database-drawer]');

const openPicker = async (page: Page, rowId: string): Promise<Locator> => {
  await row(page, rowId).locator('[role="gridcell"][data-property-id="p-due"]').click();
  const picker = page.locator('[data-blok-database-date-editor]');

  if (!await picker.isVisible()) await page.keyboard.press('Enter');
  await expect(picker).toBeVisible();

  return picker;
};

const openRow = async (page: Page, id: string): Promise<void> => {
  await row(page, id).hover();
  await row(page, id).locator('[data-blok-database-table-open]').click();
  await expect(peek(page)).toHaveCSS('transform', 'none');
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

// The page is shared: leave no theme behind for the next spec.
test.afterEach(async ({ page }) => {
  await page.evaluate(async () => {
    await window.blokInstance?.destroy?.();
    window.blokInstance = undefined;
    document.documentElement.removeAttribute('data-blok-theme');
  });
  await page.emulateMedia({ colorScheme: null });
});

for (const theme of THEMES) {
  test.describe(`research/26, ${theme.name}`, () => {
    test('view settings: the root title is a 12px/16px 500 secondary label; "Layout" is 14px/21px 600 (§1a)', async ({ page }) => {
      await mount(page, blocks({ type: 'table' }));
      await theme.apply(page);
      await page.getByTestId('database-toolbar-settings').click();
      const title = page.locator('[data-blok-database-panel-header]');

      // The light AA step: Notion's rgb(125, 122, 117) is 4.27:1 on white.
      await expect(title).toHaveCSS('color', theme.dark ? 'rgb(173, 169, 163)' : 'rgb(114, 111, 106)');
      await expect(title).toHaveCSS('font-size', '12px');
      await expect(title).toHaveCSS('line-height', '16px');
      await expect(title).toHaveCSS('font-weight', '500');

      await page.getByTestId('database-settings-layout').click();
      await expect(title).toHaveCSS('font-size', '14px');
      await expect(title).toHaveCSS('line-height', '21px');
      await expect(title).toHaveCSS('font-weight', '600');
    });

    test('date picker: today is a white digit on a 24px red circle; "Today" is a 20px box (§1c, §1d)', async ({ page }) => {
      await mount(page, blocks({ type: 'table' }));
      await theme.apply(page);
      const picker = await openPicker(page, 'r2');
      const today = picker.locator('[data-blok-database-date-day][data-today]');

      await expect(today).toHaveCSS('color', 'rgb(255, 255, 255)');
      await expect(today).toHaveCSS('font-weight', '400');
      const circle = await today.evaluate((el) => {
        const after = getComputedStyle(el, '::after');

        return { width: after.width, height: after.height, background: after.backgroundColor, radius: after.borderRadius };
      });

      expect(circle).toEqual({ width: '24px', height: '24px', background: 'rgb(229, 100, 88)', radius: '9999px' });

      const button = picker.locator('[data-blok-database-date-today]');

      await expect(button).toHaveCSS('height', '20px');
      await expect(button).toHaveCSS('padding', '0px 8px');
      await expect(button).toHaveCSS('border-radius', '4px');
      await expect(button).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(button).toHaveCSS('font-size', '12px');
      await expect(button).toHaveCSS('font-weight', '500');
    });

    test('date picker: Date format and Time format are 180 wide, Remind 250 (§1f)', async ({ page }) => {
      await mount(page, blocks({ type: 'table' }));
      await theme.apply(page);
      const picker = await openPicker(page, 'r1');

      // Time format shows only with Include time on.
      await picker.locator('[data-blok-database-date-time-toggle]').click();
      for (const kind of [ 'dateFormat', 'timeFormat' ]) {
        await picker.locator(`[data-blok-database-date-setting="${kind}"]`).click();
        const menu = page.locator(`[data-blok-database-date-setting-menu="${kind}"]`);

        await expect(menu).toBeVisible();
        expect((await menu.boundingBox())?.width).toBe(180);
        await picker.locator(`[data-blok-database-date-setting="${kind}"]`).click();
        await expect(menu).toHaveCount(0);
      }
      await picker.locator('[data-blok-database-date-remind]').click();
      const remind = page.locator('[data-blok-database-date-remind-menu]');

      await expect(remind).toBeVisible();
      expect((await remind.boundingBox())?.width).toBe(250);
    });

    test('a reminder date is the AA reminder blue (§4f)', async ({ page }) => {
      await mount(page, blocks({ type: 'table' }));
      await theme.apply(page);

      await expect(row(page, 'r1').locator('[data-blok-database-cell="date"][data-reminder]')).toHaveCSS('color', theme.dark ? 'rgb(41, 137, 232)' : 'rgb(35, 119, 211)');
    });

    test('center peek title is 40px/48px 700 (§1e)', async ({ page }) => {
      await mount(page, blocks({ type: 'table', openPagesIn: 'center' }));
      await theme.apply(page);
      await openRow(page, 'r1');
      const title = peek(page).locator('[data-blok-database-drawer-title]');

      await expect(title).toHaveCSS('font-size', '40px');
      await expect(title).toHaveCSS('line-height', '48px');
      await expect(title).toHaveCSS('font-weight', '700');
    });

    test('gallery property text is primary ink (§4c)', async ({ page }) => {
      await mount(page, blocks({ type: 'gallery', visibleProperties: [ 'p-site' ] }));
      await theme.apply(page);
      const card = page.locator('[data-blok-database-gallery-card][data-row-id="r1"]');
      const ink = theme.dark ? 'rgb(240, 239, 237)' : 'rgb(44, 44, 43)';

      await expect(card.locator('[data-blok-database-gallery-property] [data-blok-database-cell-link]')).toHaveCSS('color', ink);
    });
  });
}

test.describe('research/26 §5f, light side peek hovers', () => {
  test('label cells and "Add a property" hover rgba(33, 27, 23, 0.051); a value has no fill', async ({ page }) => {
    await mount(page, blocks({ type: 'table', openPagesIn: 'side' }));
    await page.emulateMedia({ colorScheme: 'light' });
    await openRow(page, 'r2');
    const cell = peek(page).locator('[data-blok-database-drawer-prop-head]', {
      has: page.locator('[data-blok-database-drawer-prop-label][role="button"]', { hasText: 'Site' }),
    });

    // Chromium prints the authored 0.051 alpha as 0.05.
    await cell.locator('[data-blok-database-drawer-prop-label]').hover();
    await expect(cell).toHaveCSS('background-color', 'rgba(33, 27, 23, 0.05)');

    const value = peek(page).locator('[data-blok-database-drawer-prop-value][data-property-id="p-due"]');

    await value.hover();
    await expect(value).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

    const add = peek(page).locator('[data-blok-database-drawer-add-prop]');

    await add.hover();
    await expect(add).toHaveCSS('background-color', 'rgba(33, 27, 23, 0.05)');
  });
});

for (const theme of THEMES.filter((t) => t.dark)) {
  test.describe(`research/26 §4e, board in ${theme.name}`, () => {
    test('blue and brown columns, counts, cards and card hovers take the measured dark values', async ({ page }) => {
      await mount(page, blocks({ type: 'board', groupBy: 'p-stage' }));
      await theme.apply(page);
      const column = (color: string): Locator => page.locator(`[data-blok-database-column][data-color="${color}"]`);
      const card = (id: string): Locator => page.locator(`[data-blok-database-card][data-row-id="${id}"]`);

      await expect(column('brown')).toHaveCSS('background-color', 'rgba(253, 158, 101, 0.05)');
      await expect(column('brown').locator('[data-blok-database-column-count]')).toHaveCSS('color', 'rgb(187, 142, 106)');
      await expect(card('r2')).toHaveCSS('background-color', 'rgb(56, 45, 38)');
      await expect(card('r2')).toHaveCSS('box-shadow', 'rgba(25, 25, 25, 0.08) 0px 2px 4px 0px, rgba(255, 174, 122, 0.133) 0px 0px 0px 1px');
      await card('r2').hover();
      await expect(card('r2')).toHaveCSS('background-color', 'rgb(64, 51, 43)');

      await expect(column('blue')).toHaveCSS('background-color', 'rgba(41, 139, 253, 0.063)');
      await expect(card('r1')).toHaveCSS('background-color', 'rgb(33, 48, 65)');
      await card('r1').hover();
      await expect(card('r1')).toHaveCSS('background-color', 'rgb(37, 54, 73)');
    });
  });
}
