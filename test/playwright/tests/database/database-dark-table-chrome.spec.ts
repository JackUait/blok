/**
 * Table chrome in dark against Notion's measured dark values (research/21 §1).
 * Reads getComputedStyle, never the stylesheet text. Runs once on the OS
 * dark preference (auto theme) and once on the forced dark theme.
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
];

const ROWS = [ [ 'r1', 'Alpha', 3 ], [ 'r2', 'Bravo', 5 ] ] as const;

const blocks = (): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [
        {
          id: 'v1',
          name: 'Table',
          type: 'table',
          position: 'a0',
          sorts: [],
          filters: [ { id: 'f1', propertyId: 'p-amount', operator: 'greater_than', value: 0 } ],
          visibleProperties: [],
          calculations: [ { id: 'p-amount', fn: 'sum' } ],
        },
        { id: 'v2', name: 'Board', type: 'board', position: 'a1', sorts: [], filters: [], visibleProperties: [] },
      ],
      activeViewId: 'v1',
    },
    content: ROWS.map(([ id ]) => id),
  },
  ...ROWS.map(([ id, title, amount ], i) => ({
    id,
    type: 'database-row',
    parent: 'db-1',
    data: { position: `a${i}`, properties: { 'p-title': title, 'p-amount': amount } },
  })),
];

const mount = async (page: Page): Promise<void> => {
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
  }, blocks());
  await expect(page.getByRole('grid')).toBeVisible();
};

/** The editor's own page fill, read through a probe inside the editor. */
const editorBackground = (page: Page): Promise<string> => page.evaluate(() => {
  const probe = document.createElement('div');

  probe.style.background = 'var(--blok-bg-primary)';
  document.querySelector('[data-blok-interface]')?.appendChild(probe);
  const value = getComputedStyle(probe).backgroundColor;

  probe.remove();

  return value;
});

const BUTTON_BORDER = 'rgba(255, 255, 235, 0.1)';
const HOVER_FILL = 'rgba(255, 255, 255, 0.055)';

const header = (page: Page): Locator => page.locator('[data-blok-database-table-header]');
const columnHeader = (page: Page): Locator => page.locator('[data-blok-database-table-column-header]').first();
const row = (page: Page): Locator => page.locator('[data-blok-database-table-row][data-row-id="r1"]');

test.beforeAll(ensureBlokBundleBuilt);

const paths: Array<{ name: string; setup: (page: Page) => Promise<void> }> = [
  {
    name: 'OS dark preference',
    setup: async (page) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await mount(page);
    },
  },
  {
    name: 'forced dark theme',
    setup: async (page) => {
      await page.emulateMedia({ colorScheme: 'light' });
      await mount(page);
      await page.evaluate(() => window.blokInstance?.theme.set('dark'));
    },
  },
];

for (const path of paths) {
  test.describe(`dark table chrome, ${path.name} (research/21 §1)`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 1400, height: 900 });
      await gotoTestPage(page);
      await page.waitForFunction(() => typeof window.Blok === 'function');
      await path.setup(page);
    });

    test('header: the page fill, a dark divider, secondary ink and the dark hover fill (§1d)', async ({ page }) => {
      await expect(header(page)).toHaveCSS('background-color', await editorBackground(page));
      await expect(header(page)).toHaveCSS('box-shadow', 'rgba(255, 255, 243, 0.082) 0px -1px 0px 0px inset');
      await expect(columnHeader(page)).toHaveCSS('color', 'rgb(173, 169, 163)');

      // The hover fill is a gradient layer over the solid header fill.
      await columnHeader(page).hover();
      await expect(columnHeader(page)).toHaveCSS('background-image', `linear-gradient(${HOVER_FILL}, ${HOVER_FILL})`);
    });

    test('row hover: no fill (§1d)', async ({ page }) => {
      await row(page).hover();
      await expect(row(page)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(row(page).locator('[data-blok-database-table-cell]').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    });

    test('calculation row: tertiary label and the dark hover fill (§1d)', async ({ page }) => {
      const calc = page.locator('[data-blok-database-table-calc][data-property-id="p-amount"]');

      await expect(calc.locator('[data-blok-database-table-calc-label]')).toHaveCSS('color', 'rgb(125, 122, 117)');
      await calc.hover();
      await expect(calc).toHaveCSS('background-color', HOVER_FILL);
    });

    test('view tabs and toolbar icons: dark ink, the measured tab hover (§1b)', async ({ page }) => {
      const inactive = page.locator('[data-blok-database-tab][data-view-id="v2"]');

      await expect(inactive).toHaveCSS('color', 'rgb(173, 169, 163)');
      await inactive.hover();
      await expect(inactive).toHaveCSS('background-color', BUTTON_BORDER);
      await expect(page.getByTestId('database-toolbar-search')).toHaveCSS('color', 'rgb(173, 169, 163)');
    });

    test('"New": hover gets lighter as in Notion, kept AA; chevron split by the dark border (§1b)', async ({ page }) => {
      const main = page.getByTestId('database-toolbar-new');

      // The fill is Blok's AA step of Notion's blue (research/08), the same in both themes.
      await expect(main).toHaveCSS('background-color', 'rgb(30, 110, 195)');
      await expect(page.getByTestId('database-toolbar-new-menu')).toHaveCSS('box-shadow', `${BUTTON_BORDER} 1px 0px 0px 0px inset`);
      await main.hover();
      await expect(main).toHaveCSS('background-color', 'rgb(36, 115, 201)');
    });

    test('filter pill: stays gray, the user\'s divergence from Notion\'s blue (ledger S4)', async ({ page }) => {
      const fill = await page.locator('[data-blok-database-filter-pill]').first().evaluate((el) => getComputedStyle(el).backgroundColor);
      const [ r, g, b ] = (fill.match(/\d+/g) ?? []).map(Number);

      expect(r).toBe(g);
      expect(g).toBe(b);
    });

    test('selection bar: the dark menu fill and the measured bar shadow (§1e)', async ({ page }) => {
      await row(page).hover();
      await row(page).locator('[data-blok-database-table-row-checkbox]').click();
      const bar = page.locator('[data-blok-database-table-selection-bar]');

      await expect(bar).toHaveCSS('background-color', 'rgb(37, 37, 37)');
      await expect(bar).toHaveCSS('box-shadow', 'rgb(56, 56, 54) 0px 0px 0px 1px, rgba(25, 25, 25, 0.08) 0px 4px 12px -2px');
    });

    test('database menus: the dark menu fill (§1a)', async ({ page }) => {
      await page.locator('[data-blok-database-filter-pill]').first().click();

      await expect(page.locator('[data-blok-popover-opened="true"] [data-blok-popover-container]')).toHaveCSS('background-color', 'rgb(37, 37, 37)');
    });
  });
}
