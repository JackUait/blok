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
  {
    id: 'p-stage',
    name: 'Stage',
    type: 'select',
    position: 'a2',
    config: {
      options: [
        { id: 'o-default', label: 'Idea', color: 'default', position: 'a0' },
        { id: 'o-brown', label: 'Build', color: 'brown', position: 'a1' },
        { id: 'o-red', label: 'Ship', color: 'red', position: 'a2' },
      ],
    },
  },
  { id: 'p-due', name: 'Due', type: 'date', position: 'a3' },
];

const ROWS = [ [ 'r1', 'Alpha', 3, 'o-default' ], [ 'r2', 'Bravo', 5, 'o-brown' ], [ 'r3', 'Charlie', 7, 'o-red' ] ] as const;

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
  ...ROWS.map(([ id, title, amount, stage ], i) => ({
    id,
    type: 'database-row',
    parent: 'db-1',
    data: { position: `a${i}`, properties: { 'p-title': title, 'p-amount': amount, 'p-stage': stage } },
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

      await expect(calc.locator('[data-blok-database-table-calc-label]')).toHaveCSS('color', 'rgb(143, 140, 135)');
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

    test('OPEN button: Notion\'s dark fill (findings K06), the measured dark shadow, secondary ink and the dark hover (research/22 §12)', async ({ page }) => {
      await row(page).hover();
      const open = row(page).locator('[data-blok-database-table-open]');

      await expect(open).toBeVisible();
      await expect(open).toHaveCSS('background-color', 'rgb(32, 32, 32)');
      await expect(open).toHaveCSS('box-shadow', 'rgb(56, 56, 54) 0px 0px 0px 1px, rgba(25, 25, 25, 0.08) 0px 4px 12px -2px');
      await expect(open).toHaveCSS('color', 'rgb(173, 169, 163)');
      await open.hover();
      await expect(open).toHaveCSS('background-image', `linear-gradient(${HOVER_FILL}, ${HOVER_FILL})`);
    });

    test('"+ New page": dark ink, and the hover fills only the button (research/22 §12)', async ({ page }) => {
      const add = page.locator('[data-blok-database-table-add-row]').first();

      await expect(add).toHaveCSS('color', 'rgb(143, 140, 135)');
      // The plus icon's wrapper is the button's first child.
      expect(await add.evaluate((el) => (el.firstElementChild === null ? null : getComputedStyle(el.firstElementChild).color))).toBe('rgb(125, 122, 117)');
      await add.hover();
      await expect(add).toHaveCSS('background-color', HOVER_FILL);
      const box = await add.boundingBox();
      const rowBox = await row(page).boundingBox();

      expect(box?.height).toBe(28);
      expect(box?.width ?? 0).toBeLessThan((rowBox?.width ?? 0) / 2);
    });

    test('select pills: the measured dark default, brown and red (research/22 §12)', async ({ page }) => {
      const pill = (label: string): Locator => page.locator('[data-blok-database-option-pill]', { hasText: label }).first();

      await expect(pill('Idea')).toHaveCSS('background-color', 'rgba(255, 255, 243, 0.082)');
      await expect(pill('Idea')).toHaveCSS('color', 'rgb(240, 239, 237)');
      await expect(pill('Build')).toHaveCSS('background-color', 'rgba(255, 184, 132, 0.365)');
      await expect(pill('Build')).toHaveCSS('color', 'rgb(245, 237, 233)');
      await expect(pill('Ship')).toHaveCSS('background-color', 'rgba(255, 116, 105, 0.525)');
      await expect(pill('Ship')).toHaveCSS('color', 'rgb(252, 233, 231)');
    });

    test('date picker: measured weekday ink, a 12px gray "Today", dark Remind value (§1l)', async ({ page }) => {
      await row(page).locator('[role="gridcell"][data-property-id="p-due"]').click();
      const picker = page.locator('[data-blok-database-date-editor]');

      if (!await picker.isVisible()) await page.keyboard.press('Enter');
      await expect(picker).toBeVisible();
      await expect(picker.locator('[data-blok-database-date-weekday]').first()).toHaveCSS('color', 'rgb(139, 152, 152)');
      const today = picker.locator('[data-blok-database-date-today]');

      await expect(today).toHaveCSS('color', 'rgb(142, 139, 134)');
      await expect(today).toHaveCSS('font-size', '12px');
      await expect(today).toHaveCSS('font-weight', '500');
      await expect(picker.locator('[data-blok-database-date-remind-value]')).toHaveCSS('color', 'rgb(173, 169, 163)');
    });

    test('view settings: row values in the nearest AA gray; "Add sort" in dark secondary (§1l, §1c)', async ({ page }) => {
      await page.getByTestId('database-toolbar-settings').click();
      // The dark tertiary AA step: Notion's rgb(125, 122, 117) is 3.6:1 on the menu.
      await expect(page.getByTestId('database-settings-layout').locator('[data-blok-database-panel-value]')).toHaveCSS('color', 'rgb(143, 140, 135)');
      await page.getByTestId('database-settings-sort').click();
      // An empty Sort page is the property picker; "Add sort" shows once a sort exists (feel/findings-toolbar V15).
      await page.locator('[data-blok-testid^="database-pick-property-"]:not([data-blok-testid$="-search"])').first().click();
      await expect(page.getByTestId('database-sort-add')).toHaveCSS('color', 'rgb(173, 169, 163)');
    });

    test('filter rule editor: AA operator ink and the dark field fill; "+ Filter" AA ink (§1c)', async ({ page }) => {
      // The dark tertiary AA step: Notion's rgb(125, 122, 117) is 3.9:1 on the page.
      await expect(page.locator('[data-blok-database-filter-add]')).toHaveCSS('color', 'rgb(143, 140, 135)');
      await page.locator('[data-blok-database-filter-pill]').first().click();
      // The chip popover's "Name operator" head (findings V17) takes the dark secondary ink.
      await expect(page.getByTestId('database-filter-operator')).toHaveCSS('color', 'rgb(173, 169, 163)');
      await expect(page.getByTestId('database-filter-value')).toHaveCSS('background-color', 'rgba(252, 252, 252, 0.03)');
    });

    test('database menus: the dark menu fill (§1a)', async ({ page }) => {
      await page.locator('[data-blok-database-filter-pill]').first().click();

      await expect(page.locator('[data-blok-popover-opened="true"] [data-blok-popover-container]')).toHaveCSS('background-color', 'rgb(37, 37, 37)');
    });
  });
}
