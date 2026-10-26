/**
 * A Number shown as Bar or Ring draws its gauge beside the value in every
 * place the value shows: table cell, row page, board, gallery and list cards.
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
  { id: 'p-bar', name: 'Done', type: 'number', position: 'a1', number: { showAs: 'bar', color: 'green', divideBy: 100 } },
  { id: 'p-ring', name: 'Score', type: 'number', position: 'a2', number: { showAs: 'ring', color: 'red', divideBy: 100 } },
  {
    id: 'p-stage',
    name: 'Stage',
    type: 'select',
    position: 'a3',
    config: { options: [ { id: 'o-plan', label: 'Plan', color: 'blue', position: 'a0' } ] },
  },
];

const blocks = (view: Record<string, unknown>): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [ { id: 'v1', name: 'View', position: 'a0', sorts: [], filters: [], visibleProperties: [ 'p-bar', 'p-ring' ], ...view } ],
      activeViewId: 'v1',
    },
    content: [ 'r1' ],
  },
  {
    id: 'r1',
    type: 'database-row',
    parent: 'db-1',
    data: { position: 'a0', properties: { 'p-title': 'Alpha', 'p-bar': 40, 'p-ring': 40, 'p-stage': 'o-plan' } },
  },
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

const box = async (gauge: Locator): Promise<{ width: number; height: number }> => {
  await expect(gauge).toBeAttached();

  return gauge.evaluate((el) => {
    const rect = el.getBoundingClientRect();

    return { width: Math.round(rect.width), height: Math.round(rect.height) };
  });
};

const FULL_SIZE = { bar: { width: 64, height: 4 }, ring: { width: 16, height: 16 } };

const gaugeSizes = async (scope: Locator): Promise<typeof FULL_SIZE> => ({
  bar: await box(scope.locator('[data-blok-database-number-bar]').first()),
  ring: await box(scope.locator('[data-blok-database-number-ring]').first()),
});

const THEMES = [
  { name: 'light', apply: (page: Page) => page.emulateMedia({ colorScheme: 'light' }) },
  { name: 'dark', apply: (page: Page) => page.emulateMedia({ colorScheme: 'dark' }) },
];

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.afterEach(async ({ page }) => {
  await page.evaluate(async () => {
    await window.blokInstance?.destroy?.();
    window.blokInstance = undefined;
  });
  await page.emulateMedia({ colorScheme: null });
});

for (const theme of THEMES) {
  test.describe(`number gauge, ${theme.name}`, () => {
    test('a table cell draws the bar and the ring at full size', async ({ page }) => {
      await mount(page, blocks({ type: 'table' }));
      await theme.apply(page);
      const row = page.locator('[data-blok-database-table-row][data-row-id="r1"]');

      expect(await gaugeSizes(row)).toEqual(FULL_SIZE);
      // The table cell is block-level to hold rows at 37px; the gauge must not grow it.
      expect(Math.round((await row.boundingBox())?.height ?? 0)).toBe(37);
      for (const gauge of [ '[data-blok-database-number-bar]', '[data-blok-database-number-ring]' ]) {
        const gap = await row.locator(gauge).evaluate((el) => {
          const text = el.parentElement?.querySelector('[data-blok-database-number-text]');

          return text ? Math.round(el.getBoundingClientRect().left - text.getBoundingClientRect().right) : null;
        });

        expect(gap).toBe(6);
      }
    });

    test('the row page draws the bar and the ring at full size', async ({ page }) => {
      await mount(page, blocks({ type: 'table' }));
      await theme.apply(page);
      const row = page.locator('[data-blok-database-table-row][data-row-id="r1"]');

      await row.hover();
      await row.locator('[data-blok-database-table-open]').click();
      const drawer = page.locator('[data-blok-database-drawer]');

      await expect(drawer).toHaveCSS('transform', 'none');
      expect(await gaugeSizes(drawer)).toEqual(FULL_SIZE);
    });

    for (const view of [ { type: 'board', groupBy: 'p-stage' }, { type: 'gallery' }, { type: 'list' } ]) {
      test(`a ${view.type} card draws the bar and the ring at full size`, async ({ page }) => {
        await mount(page, blocks(view));
        await theme.apply(page);
        expect(await gaugeSizes(page.locator('[data-blok-id="db-1"]'))).toEqual(FULL_SIZE);
      });
    }
  });
}
