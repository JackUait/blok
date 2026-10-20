/**
 * The row page peeks and the layout builder in dark, against Notion's
 * measured dark values (research/21 §1m, §1n). Reads computed styles only.
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

const blocks = (openPagesIn: 'side' | 'center'): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [
        { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
        { id: 'p-notes', name: 'Notes', type: 'text', position: 'a1' },
      ],
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], openPagesIn }],
      activeViewId: 'v1',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Alpha', 'p-notes': 'Note' } } },
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
    holder.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: input } });
    await window.blokInstance.isReady;
  }, { input: data });
  await expect(page.getByRole('grid')).toBeVisible();
};

const openRow = async (page: Page): Promise<void> => {
  const row = page.locator('[data-blok-database-table-row][data-row-id="r1"]');

  await row.hover();
  await row.locator('[data-blok-database-table-open]').click();
};

const peek = (page: Page): Locator => page.locator('[data-blok-database-drawer]');
const label = (page: Page, name: string): Locator =>
  peek(page).locator('[data-blok-database-drawer-prop-label][role="button"]', { hasText: name });
/** The whole label column cell: Notion's hover box (research/21 §1m). */
const labelCell = (page: Page, name: string): Locator =>
  peek(page).locator('[data-blok-database-drawer-prop-head]', {
    has: page.locator('[data-blok-database-drawer-prop-label][role="button"]', { hasText: name }),
  });
const value = (page: Page, propertyId: string): Locator =>
  peek(page).locator(`[data-blok-database-drawer-prop-value][data-property-id="${propertyId}"]`);

/** Both dark copies: the OS media query, and the theme attribute over a light OS. */
const DARK_MODES = [
  { name: 'system dark', apply: (page: Page) => page.emulateMedia({ colorScheme: 'dark' }) },
  {
    name: 'theme set to dark',
    apply: async (page: Page): Promise<void> => {
      await page.emulateMedia({ colorScheme: 'light' });
      await page.evaluate(() => window.blokInstance?.theme.set('dark'));
    },
  },
];

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

for (const mode of DARK_MODES) {
  test.describe(`row page peek, ${mode.name} (research/21 §1m)`, () => {
    test('side peek: rgb(32, 32, 32) panel, label ink and hover', async ({ page }) => {
      await mount(page, blocks('side'));
      await mode.apply(page);
      await openRow(page);
      await expect(peek(page)).toHaveCSS('transform', 'none');

      await expect(peek(page)).toHaveCSS('background-color', 'rgb(32, 32, 32)');
      await expect(peek(page)).toHaveCSS('box-shadow', 'rgb(56, 56, 54) 0px 0px 0px 1px, rgba(25, 25, 25, 0.08) 0px 4px 12px -2px');
      await expect(peek(page)).toHaveCSS('border-left-width', '0px');
      await expect(peek(page).locator('[data-blok-database-drawer-title]')).toHaveCSS('color', 'rgb(240, 239, 237)');
      await expect(label(page, 'Notes')).toHaveCSS('color', 'rgb(173, 169, 163)');

      await label(page, 'Notes').hover();
      await expect(labelCell(page, 'Notes')).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.055)');
      await expect(labelCell(page, 'Notes')).toHaveCSS('border-radius', '6px');
      const box = await labelCell(page, 'Notes').boundingBox();

      expect(box?.width).toBe(160);
      expect(box?.height).toBe(34);

      await value(page, 'p-notes').hover();
      await expect(value(page, 'p-notes')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    });

    test('center peek: rgb(32, 32, 32) panel, measured shadow, 0.8 backdrop', async ({ page }) => {
      await mount(page, blocks('center'));
      await mode.apply(page);
      await openRow(page);
      const dialog = page.getByRole('dialog');

      await expect(dialog).toHaveCSS('background-color', 'rgb(32, 32, 32)');
      await expect(dialog).toHaveCSS('box-shadow', 'rgb(56, 56, 54) 0px 0px 0px 1px, rgba(25, 25, 25, 0.08) 0px 4px 12px -2px');
      await expect(page.locator('[data-blok-database-peek-backdrop]')).toHaveCSS('background-color', 'rgba(15, 15, 15, 0.8)');
      await label(page, 'Notes').hover();
      await expect(labelCell(page, 'Notes')).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.055)');
    });
  });
}

test('the layout builder paints the measured dark surfaces (research/21 §1n)', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await mount(page, blocks('side'));
  await openRow(page);
  await peek(page).hover();
  await peek(page).getByRole('button', { name: 'Customize layout' }).click();
  const dialog = page.getByRole('dialog', { name: 'Customize page layout' });

  await expect(dialog).toHaveCSS('background-color', 'rgb(32, 32, 32)');
  await expect(dialog.locator('[data-blok-database-layout-canvas]')).toHaveCSS('background-color', 'rgb(25, 25, 25)');
  await expect(dialog.locator('[data-blok-database-layout-module="heading"]')).toHaveCSS('background-color', 'rgb(25, 25, 25)');
  await expect(dialog.locator('[data-blok-database-layout-structure-card]').first()).toHaveCSS('background-color', 'rgb(32, 32, 32)');
  // Selected "Simple" label white, unselected "Tabbed" rgb(90, 90, 90).
  await expect(dialog.locator('[data-blok-database-layout-structure-card][aria-pressed="true"]')).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(dialog.locator('[data-blok-database-layout-structure-card][aria-pressed="false"]')).toHaveCSS('color', 'rgb(90, 90, 90)');
});

test('light keeps the 0.6 backdrop and the white panel (research/08)', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await mount(page, blocks('center'));
  await openRow(page);

  await expect(page.getByRole('dialog')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('[data-blok-database-peek-backdrop]')).toHaveCSS('background-color', 'rgba(15, 15, 15, 0.6)');
});
