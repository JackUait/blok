/**
 * The controls research/26 §3 and §1b measured that Blok lacked, in light and
 * dark (§4a). Reads getComputedStyle and boxes, never the stylesheet text.
 * Dark runs once on the OS preference and once on the forced dark theme.
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
  { id: 'p-amount', name: 'Amount', type: 'number', position: 'a2' },
];

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
          sorts: [ { id: 's1', propertyId: 'p-due', direction: 'asc' } ],
          filters: [],
          visibleProperties: [],
        },
      ],
      activeViewId: 'v1',
    },
    content: [ 'r1', 'r2' ],
  },
  ...[ 'Alpha', 'Bravo' ].map((title, i) => ({
    id: `r${i + 1}`,
    type: 'database-row',
    parent: 'db-1',
    data: { position: `a${i}`, properties: { 'p-title': title, 'p-amount': i } },
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

interface Look {
  border: string;
  sortBg: string;
  sortHover: string;
  sortLabel: string;
  divider: string;
  iconInk: string;
  iconHover: string;
  closeBg: string;
  closeHover: string;
  closeGlyph: string;
}

const LIGHT: Look = {
  border: 'rgba(28, 19, 1, 0.11)',
  sortBg: 'rgb(255, 255, 255)',
  sortHover: 'rgb(244, 243, 243)',
  sortLabel: 'rgb(44, 44, 43)',
  divider: 'rgba(42, 28, 0, 0.07)',
  iconInk: 'rgb(85, 83, 78)',
  iconHover: 'rgb(249, 248, 247)',
  closeBg: 'rgba(42, 28, 0, 0.07)',
  closeHover: 'rgba(42, 28, 0, 0.106)',
  closeGlyph: 'rgb(142, 139, 134)',
};

const DARK: Look = {
  border: 'rgba(255, 255, 235, 0.1)',
  sortBg: 'rgb(25, 25, 25)',
  sortHover: 'rgb(38, 38, 38)',
  sortLabel: 'rgb(240, 239, 237)',
  divider: 'rgba(255, 255, 243, 0.082)',
  iconInk: 'rgb(211, 211, 211)',
  iconHover: 'rgb(32, 32, 32)',
  closeBg: 'rgba(255, 255, 235, 0.1)',
  closeHover: 'rgba(255, 255, 235, 0.153)',
  closeGlyph: 'rgb(173, 169, 163)',
};

const paths: Array<{ name: string; look: Look; setup: (page: Page) => Promise<void> }> = [
  {
    name: 'light',
    look: LIGHT,
    setup: async (page) => {
      await page.emulateMedia({ colorScheme: 'light' });
      await mount(page);
    },
  },
  {
    name: 'OS dark preference',
    look: DARK,
    setup: async (page) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await mount(page);
    },
  },
  {
    name: 'forced dark theme',
    look: DARK,
    setup: async (page) => {
      await page.emulateMedia({ colorScheme: 'light' });
      await mount(page);
      await page.evaluate(() => window.blokInstance?.theme.set('dark'));
    },
  },
];

/** Layout size, not the box: popovers open with a scale transform. */
const size = (locator: Locator): Promise<{ width: number; height: number }> =>
  locator.evaluate((el: HTMLElement) => ({ width: el.offsetWidth, height: el.offsetHeight }));

test.beforeAll(ensureBlokBundleBuilt);

for (const path of paths) {
  const { look } = path;

  test.describe(`Notion's bordered controls, ${path.name} (research/26 §3, §1b)`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 1400, height: 900 });
      await gotoTestPage(page);
      await page.waitForFunction(() => typeof window.Blok === 'function');
      await path.setup(page);
    });

    test('sort panel: 32px bordered property and direction buttons, hover fill, a 24px remove × (§3a)', async ({ page }) => {
      await page.getByTestId('database-toolbar-sort').click();
      const property = page.getByTestId('database-sort-property-s1');
      const direction = page.getByTestId('database-sort-direction-s1');
      const remove = page.getByTestId('database-sort-remove-s1');

      for (const button of [ property, direction ]) {
        await expect(button).toHaveCSS('border-top', `1px solid ${look.border}`);
        await expect(button).toHaveCSS('border-radius', '6px');
        await expect(button).toHaveCSS('background-color', look.sortBg);
        await expect(button).toHaveCSS('font-weight', '500');
        await expect(button).toHaveCSS('color', look.sortLabel);
        expect((await size(button)).height).toBe(32);
      }
      await expect(property.locator('[data-blok-database-panel-icon] svg')).toBeVisible();
      await property.hover();
      await expect(property).toHaveCSS('background-color', look.sortHover);
      await expect(property).toHaveCSS('border-top', `1px solid ${look.border}`);

      await expect(remove).toHaveAccessibleName(/.+/);
      await expect(remove).toHaveCSS('border-top-width', '0px');
      expect(await size(remove)).toEqual({ width: 24, height: 24 });
    });

    test('selection bar: a 1px divider shadow on every segment but the last (§3b)', async ({ page }) => {
      const row = page.locator('[data-blok-database-table-row][data-row-id="r1"]');

      await row.hover();
      await row.locator('[data-blok-database-table-row-checkbox]').click();
      const bar = page.locator('[data-blok-database-table-selection-bar]');

      await expect(bar).toBeVisible();
      const segments = await bar.evaluate((el) => [ ...el.children ].map((child) => {
        const previous = child.previousElementSibling?.getBoundingClientRect();

        return {
          shadow: getComputedStyle(child).boxShadow,
          gap: previous === undefined ? 0 : child.getBoundingClientRect().left - previous.right,
        };
      }));
      const last = segments.pop();

      expect(segments.length).toBeGreaterThan(1);
      for (const segment of segments) {
        expect(segment.shadow).toBe(`${look.divider} 1px 0px 0px 0px`);
      }
      expect(last?.shadow).toBe('none');
      const gap = segments[1].gap;

      expect(Math.round(gap)).toBe(1);
    });

    test('property menu: a 28px bordered icon button with no fill and the measured hover (§3c)', async ({ page }) => {
      await page.locator('[data-blok-database-table-column-header][data-property-id="p-due"]').click();
      const icon = page.locator('[data-blok-popover-opened="true"] [data-blok-database-property-menu-icon]');

      await expect(icon).toBeVisible();
      expect(await size(icon)).toEqual({ width: 28, height: 28 });
      await expect(icon).toHaveCSS('border-top', `1px solid ${look.border}`);
      await expect(icon).toHaveCSS('border-radius', '6px');
      await expect(icon).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(icon).toHaveCSS('color', look.iconInk);
      await icon.hover();
      await expect(icon).toHaveCSS('background-color', look.iconHover);
    });

    test('view settings: a 20px round Close × with the measured fills, no hint, and it closes (§1b)', async ({ page }) => {
      await page.getByTestId('database-toolbar-settings').click();
      const panel = page.getByTestId('database-view-settings');
      const close = panel.getByRole('button', { name: 'Close', exact: true });

      await expect(close).toBeVisible();
      expect(await size(close)).toEqual({ width: 20, height: 20 });
      await expect(close).toHaveCSS('border-radius', '50%');
      await expect(close).toHaveCSS('background-color', look.closeBg);
      await expect(close).toHaveCSS('color', look.closeGlyph);
      await close.hover();
      await expect(close).toHaveCSS('background-color', look.closeHover);
      // Notion shows no hint here. Wait past the 500ms hint delay, then look.
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 700)));
      await expect(page.getByTestId('tooltip-content').filter({ visible: true })).toHaveCount(0);

      await close.click();
      await expect(panel).toBeHidden();
    });
  });
}
